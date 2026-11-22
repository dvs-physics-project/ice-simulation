/*!
 * ice-core 1.0.0 — расчётное ядро ДВС (собрано из src/ командой node tools/bundle.js).
 * Все величины в СИ: м, кг, с, Па, К, Дж, Н, Н·м, Вт, рад.
 * Браузер: window.ICE_CORE; Node: require('./ice-core.js').
 */
(function (root) {
'use strict';
const defs = {
  'characteristics': function (module, exports, require) {
    /*
     * Скоростные характеристики.
     *
     *   speedCharacteristic(engine, params, rpms, options) — внешняя скоростная характеристика: на каждых оборотах
     *       свои p_a и T_a (для дизеля ещё и α), пошаговый расчёт цикла и показатели: p_i, p_м, p_e, N_e, M_e,
     *       η_e, удельный расход g_e
     *   leidermanPower(NeN, nN, n) — эмпирическая формула Лейдермана по номинальной мощности (для сравнения формы кривой)
     */
    const { dieselSimParams } = require('./diesel');
    const { regimeParams } = require('./intake');
    const { performance, specificConsumption } = require('./performance');
    const { simulateCycle } = require('./thermo/simulate');

    function speedCharacteristic(engine, regime, rpms, options) {
      const isDiesel = engine.fuel === 'diesel';
      return rpms.map((rpm) => {
        const params = isDiesel ? dieselSimParams(engine, regime, rpm) : regimeParams(engine, regime, rpm);
        const sim = simulateCycle(engine, params, Object.assign({ rpm, stepDeg: 1 }, options || {}));
        const perf = performance(engine, sim.Li, rpm, params);
        const etaE = (sim.Li * perf.etaM) / sim.Qfuel;
        return {
          rpm, pa: params.pa, Ta: params.Ta, etaV: sim.etaV, pmax: sim.pmax, Li: sim.Li,
          pi: perf.pi, pm: perf.pm, pe: perf.pe, Ne: perf.Ne, Me: perf.Me,
          etaE, ge: specificConsumption(etaE, params.Hu), alpha: params.alphaAir,
        };
      });
    }

    const leidermanPower = (NeN, nN, n) => NeN * (n / nN) * (1 + n / nN - (n / nN) ** 2);

    module.exports = { speedCharacteristic, leidermanPower };

  },
  'diesel': function (module, exports, require) {
    /*
     * Смешанный цикл дизеля V8 (подвод теплоты сначала при V = const, затем при p = const).
     *
     *   dieselCycle(engine, params)        — уровень 1 с заданными λ_z и ρ_z: точки c, z′, z, b; работа;
     *                                        теплота Q1, нужная для такого подвода, и отсюда «подразумеваемые»
     *                                        расход топлива и коэффициент избытка воздуха α (проверка цикла по α)
     *   dieselState(engine, cycle, phaseDeg) — давление и температура по углу цикла
     *   dieselSimParams(engine, params, rpm) — параметры пошагового расчёта: p_a и T_a по оборотам, α из уровня 1,
     *                                        сгорание начинается после задержки воспламенения от начала впрыска
     */
    const { DIESEL_PARAMS } = require('./engines');
    const { geometry } = require('./geometry');
    const { regimeParams } = require('./intake');
    const { kinematics } = require('./kinematics');
    const { withDefaults } = require('./params');
    const { uBurned, uFresh } = require('./thermo/properties');
    const { DEG, mod } = require('./util');

    const ALPHA_FOR_HEAT_CAPACITY = 1.8;
    const EXHAUST_EXPANSION_INDEX = 1.27;

    function dieselCycle(engine, regime) {
      const params = withDefaults(Object.assign({}, DIESEL_PARAMS, regime));
      const geom = geometry(engine);
      const m = (params.pa * geom.Va) / (params.Rgas * params.Ta);
      const pc = params.pa * engine.cr ** params.n1;
      const Tc = params.Ta * engine.cr ** (params.n1 - 1);
      const pz = params.lambdaZ * pc;
      const Tz1 = params.lambdaZ * Tc;
      const Tz = params.rhoZ * Tz1;
      const Vz = params.rhoZ * geom.Vc;
      const delta = geom.Va / Vz;
      const pb = pz / delta ** params.n2;
      const Tb = Tz / delta ** (params.n2 - 1);
      const products = Object.assign({}, params, { alphaAir: params.alphaGuess || ALPHA_FOR_HEAT_CAPACITY });
      const heatAtConstantVolume = m * (uBurned(products, Tz1) - uFresh(products, Tc));
      const heatAtConstantPressure = m * ((uBurned(products, Tz) - uBurned(products, Tz1)) + params.Rgas * (Tz - Tz1));
      const Q1 = heatAtConstantVolume + heatAtConstantPressure;
      const mFuel = Q1 / (params.xiZ * params.Hu);
      const gammaR = ((params.T0 + params.dT) / params.Tr) * (params.pr / (engine.cr * params.pa - params.pr));
      const mAir = m / (1 + gammaR);
      const alpha = (mAir - mFuel) / (params.l0 * mFuel);
      const Lz = pz * (Vz - geom.Vc);
      const Lexp = (pz * Vz - pb * geom.Va) / (params.n2 - 1);
      const Lcomp = (pc * geom.Vc - params.pa * geom.Va) / (params.n1 - 1);
      const LiTheor = Lz + Lexp - Lcomp;
      const Li = params.phiFull * LiTheor;
      return {
        level: 1, m, pc, Tc, pz, Tz1, Tz, Vz, delta, pb, Tb, Q1, mFuel, alpha, gammaR, Lz, Lexp, Lcomp, LiTheor, Li,
        pi: Li / geom.Vh, Qfuel: mFuel * params.Hu, etaI: Li / (mFuel * params.Hu),
        pa: params.pa, Ta: params.Ta, pr: params.pr, nComp: params.n1, nExp: params.n2,
      };
    }

    function dieselState(engine, cycle, phaseDeg) {
      const geom = geometry(engine);
      const phase = mod(phaseDeg, 720);
      const V = kinematics(engine, (phase % 360) * DEG).V;
      if (phase < 180) return { phase, stroke: 'intake', V, p: cycle.pa, T: cycle.Ta };
      if (phase < 360) {
        const ratio = geom.Va / V;
        return { phase, stroke: 'compression', V, p: cycle.pa * ratio ** cycle.nComp, T: cycle.Ta * ratio ** (cycle.nComp - 1) };
      }
      if (phase < 540) {
        if (V <= cycle.Vz) return { phase, stroke: 'power', V, p: cycle.pz, T: cycle.Tz1 * V / geom.Vc };
        const ratio = cycle.Vz / V;
        return { phase, stroke: 'power', V, p: cycle.pz * ratio ** cycle.nExp, T: cycle.Tz * ratio ** (cycle.nExp - 1) };
      }
      const exponent = (EXHAUST_EXPANSION_INDEX - 1) / EXHAUST_EXPANSION_INDEX;
      return { phase, stroke: 'exhaust', V, p: cycle.pr, T: cycle.Tb * (cycle.pr / cycle.pb) ** exponent };
    }

    function dieselSimParams(engine, regime, rpm) {
      const params = regimeParams(engine, Object.assign({}, DIESEL_PARAMS, regime), rpm);
      const cycle = dieselCycle(engine, params);
      return Object.assign({}, params, { alphaAir: cycle.alpha, sparkDeg: params.injStartDeg + params.ignDelayDeg });
    }

    module.exports = { dieselCycle, dieselState, dieselSimParams };

  },
  'dynamics': function (module, exports, require) {
    /*
     * Силы в КШМ, крутящий момент и уравновешенность (формулы 5.1–5.8, 5.11–5.12).
     *
     *   reciprocatingMass(params)       — масса поступательно движущихся частей m_j = m_п + доля массы шатуна
     *   forces(engine, params, p, alpha, omega) — силы одного цилиндра при давлении p и угле кривошипа alpha:
     *       газовая Fg = (p − p_картера)·F, инерционная Fj = −m_j·a, суммарная, боковая FN, вдоль шатуна,
     *       тангенциальная Fτ, радиальная FK; момент Fτ·R и его газовая часть
     *   engineTorque(engine, layout, stateFn, params, θ, ω) — суммарный момент всех цилиндров при угле вала θ;
     *       stateFn(phaseDeg) даёт давление газа по углу цикла
     *   torqueCurve(engine, layout, stateFn, params, rpm, stepDeg) — момент за цикл, средний, размах;
     *       избыточная работа — размах накопленного отклонения энергии; неравномерность δ = L_изб / (J·ω²)
     *   inertiaResultant(engine, layout, params, θ, ω) — равнодействующие сил инерции 1-го и 2-го порядка
     *       в осях двигателя (y — вверх)
     */
    const { cyclePhaseDeg, geometry, localCrankDeg } = require('./geometry');
    const { kinematics, omegaOf } = require('./kinematics');
    const { withDefaults } = require('./params');
    const { DEG } = require('./util');

    const reciprocatingMass = (params) => params.mPiston + params.rodSplit * params.mRod;

    function forces(engine, regime, p, alpha, omega) {
      const params = withDefaults(regime);
      const geom = geometry(engine);
      const piston = kinematics(engine, alpha, omega);
      const Fg = (p - params.pCrankcase) * geom.F;
      const Fj = -reciprocatingMass(params) * piston.a;
      const Fsum = Fg + Fj;
      const cosBeta = Math.cos(piston.beta);
      const Ftau = (Fsum * Math.sin(alpha + piston.beta)) / cosBeta;
      return {
        Fg,
        Fj,
        Fsum,
        FN: Fsum * Math.tan(piston.beta),
        Frod: Fsum / cosBeta,
        Ftau,
        FK: (Fsum * Math.cos(alpha + piston.beta)) / cosBeta,
        torque: Ftau * geom.R,
        torqueGas: ((Fg * Math.sin(alpha + piston.beta)) / cosBeta) * geom.R,
      };
    }

    function engineTorque(engine, layout, stateFn, params, thetaDeg, omega) {
      let torque = 0;
      for (let j = 0; j < layout.cylinders.length; j++) {
        const gas = stateFn(cyclePhaseDeg(layout, j, thetaDeg));
        torque += forces(engine, params, gas.p, localCrankDeg(layout, j, thetaDeg) * DEG, omega).torque;
      }
      return torque;
    }

    function torqueCurve(engine, layout, stateFn, regime, rpm, stepDeg = 1) {
      const params = withDefaults(regime);
      const omega = omegaOf(rpm);
      const theta = [];
      const M = [];
      for (let thetaDeg = 0; thetaDeg < 720; thetaDeg += stepDeg) {
        theta.push(thetaDeg);
        M.push(engineTorque(engine, layout, stateFn, params, thetaDeg, omega));
      }
      const mean = M.reduce((sum, value) => sum + value, 0) / M.length;
      let energy = 0;
      let energyMax = 0;
      let energyMin = 0;
      for (const value of M) {
        energy += (value - mean) * stepDeg * DEG;
        energyMax = Math.max(energyMax, energy);
        energyMin = Math.min(energyMin, energy);
      }
      const excessWork = energyMax - energyMin;
      return {
        theta,
        M,
        mean,
        max: Math.max(...M),
        min: Math.min(...M),
        excessWork,
        irregularity: excessWork / (params.J * omega * omega),
      };
    }

    function inertiaResultant(engine, layout, regime, thetaDeg, omega) {
      const params = withDefaults(regime);
      const geom = geometry(engine);
      const amplitude = reciprocatingMass(params) * geom.R * omega * omega;
      const F1 = [0, 0];
      const F2 = [0, 0];
      layout.cylinders.forEach((cylinder, j) => {
        const alpha = localCrankDeg(layout, j, thetaDeg) * DEG;
        const axis = [Math.cos(cylinder.axisDeg * DEG), Math.sin(cylinder.axisDeg * DEG)];
        const first = -amplitude * Math.cos(alpha);
        const second = -amplitude * geom.lambda * Math.cos(2 * alpha);
        F1[0] += first * axis[0];
        F1[1] += first * axis[1];
        F2[0] += second * axis[0];
        F2[1] += second * axis[1];
      });
      return { F1, F2, amplitude };
    }

    module.exports = { reciprocatingMass, forces, engineTorque, torqueCurve, inertiaResultant };

  },
  'engines': function (module, exports, require) {
    /*
     * Двигатели 3D-симуляции и параметры дизеля.
     *
     * SIM_ENGINES — размеры двигателей, показанных в симуляции (те же, что в spec.js каждого двигателя симуляции):
     *   I4 — рядный бензиновый, B4 — оппозитный бензиновый, V8 — V-образный дизель с наддувом.
     *
     * DIESEL_PARAMS — рабочий процесс дизеля V8 (дополняют DEFAULT_PARAMS):
     *   Hu, l0       — теплота сгорания дизельного топлива и кг воздуха на 1 кг топлива
     *   n1, n2       — показатели политроп; lambdaZ, rhoZ — степени повышения давления и предварительного
     *                  расширения смешанного цикла
     *   pk, nk       — давление наддува и показатель политропы сжатия в компрессоре; pr — давление перед турбиной
     *   dT, Tr       — подогрев заряда и температура остаточных газов; xiZ, phiFull — как у бензиновых
     *   chi, wiebeA, wiebeM, burnDeg — закон Вибе; injStartDeg…injEndDeg — впрыск по углу цикла;
     *   ignDelayDeg  — задержка воспламенения; pmA, pmB — механические потери; mPiston, mRod, J — массы
     */

    const SIM_ENGINES = Object.freeze({
      I4: Object.freeze({ name: 'I4 симуляции (КП.2011)', bore: 0.072, stroke: 0.069, rod: 0.122, cr: 10.5, cylinders: 4, fuel: 'petrol' }),
      B4: Object.freeze({ name: 'B4 симуляции', bore: 0.083, stroke: 0.083, rod: 0.1435, cr: 10, cylinders: 4, fuel: 'petrol' }),
      V8: Object.freeze({ name: 'V8-дизель симуляции (ДВС КР 09)', bore: 0.125, stroke: 0.13, rod: 0.25, cr: 17, cylinders: 8, fuel: 'diesel' }),
    });

    const DIESEL_PARAMS = Object.freeze({
      Hu: 42.5e6,
      l0: 14.45,
      n1: 1.36,
      n2: 1.27,
      lambdaZ: 1.45,
      rhoZ: 1.45,
      pk: 1.55e5,
      nk: 1.6,
      pr: 1.35e5,
      dT: 10,
      Tr: 800,
      xiZ: 0.85,
      phiFull: 0.95,
      chi: 0.97,
      wiebeA: 5,
      wiebeM: 0.6,
      injStartDeg: 344,
      injEndDeg: 368,
      ignDelayDeg: 6,
      burnDeg: 70,
      pmA: 0.089e6,
      pmB: 0.0118e6,
      mPiston: 3.2,
      mRod: 3.6,
      J: 3.5,
    });

    module.exports = { SIM_ENGINES, DIESEL_PARAMS };

  },
  'geometry': function (module, exports, require) {
    /*
     * Геометрия цилиндра, компоновки двигателей и фазы цилиндров (формулы 1.1–1.9).
     *
     *   geometry(engine)                 — R, λ = R/L, площадь поршня F, рабочий объём Vh, объём камеры
     *                                      сгорания Vc = Vh/(ε − 1), полный объём Va, литраж, высота камеры hc
     *   wallArea(engine, x)              — поверхность теплообмена при смещении поршня x: 2F + πD(hc + x)
     *   makeLayout(axesDeg, firingOrder) — компоновка: для каждого цилиндра угол оси γ_j, место в порядке работы,
     *                                      угол вспышки θ_j = k·720°/i и угол колена δ_j = γ_j − θ_j
     *   layouts.inline4 / vee8 / boxer4 / radial(N) — готовые компоновки
     *   cyclePhaseDeg(layout, j, θ)      — угол цикла цилиндра j: 0…720°, вспышка при 360°
     *   localCrankDeg(layout, j, θ)      — угол кривошипа от ВМТ своего цилиндра, 0…360°
     *   strokeOf(phaseDeg)               — такт по углу цикла: intake, compression, power, exhaust
     */
    const { mod } = require('./util');

    function geometry(engine) {
      const R = engine.stroke / 2;
      const lambda = R / engine.rod;
      const F = (Math.PI * engine.bore * engine.bore) / 4;
      const Vh = F * engine.stroke;
      const Vc = Vh / (engine.cr - 1);
      const Va = Vc + Vh;
      return { R, lambda, F, Vh, Vc, Va, Vtotal: Vh * engine.cylinders, hc: Vc / F, SD: engine.stroke / engine.bore };
    }

    function wallArea(engine, x) {
      const geom = geometry(engine);
      return 2 * geom.F + Math.PI * engine.bore * (geom.hc + x);
    }

    function makeLayout(axesDeg, firingOrder) {
      const intervalDeg = 720 / axesDeg.length;
      const cylinders = axesDeg.map((axisDeg, j) => {
        const positionInOrder = firingOrder.indexOf(j + 1);
        if (positionInOrder < 0) throw new Error('порядок работы должен содержать каждый цилиндр');
        const fireAtDeg = positionInOrder * intervalDeg;
        let throwDeg = mod(axisDeg - fireAtDeg, 360);
        if (throwDeg > 180) throwDeg -= 360;
        return { n: j + 1, axisDeg, k: positionInOrder, fireAtDeg, throwDeg };
      });
      return { cylinders, intervalDeg, firingOrder: firingOrder.slice() };
    }

    const layouts = {
      inline4: () => makeLayout([0, 0, 0, 0], [1, 3, 4, 2]),
      vee8: (bankDeg = 90) =>
        makeLayout(
          [1, 2, 3, 4, 5, 6, 7, 8].map((number) => (number <= 4 ? -bankDeg / 2 : bankDeg / 2)),
          [1, 5, 4, 2, 6, 3, 7, 8]
        ),
      boxer4: () => makeLayout([-90, 90, -90, 90], [1, 3, 2, 4]),
      radial: (count) => {
        if (count % 2 === 0) throw new Error('четырёхтактная звезда требует нечётного числа цилиндров');
        const order = [];
        for (let number = 1; number <= count; number += 2) order.push(number);
        for (let number = 2; number <= count; number += 2) order.push(number);
        return makeLayout(Array.from({ length: count }, (_, j) => (360 * j) / count), order);
      },
    };

    const cyclePhaseDeg = (layout, j, thetaDeg) => mod(thetaDeg - layout.cylinders[j].fireAtDeg + 360, 720);

    const localCrankDeg = (layout, j, thetaDeg) =>
      mod(thetaDeg + layout.cylinders[j].throwDeg - layout.cylinders[j].axisDeg, 360);

    const STROKES = ['intake', 'compression', 'power', 'exhaust'];
    const strokeOf = (phaseDeg) => STROKES[Math.floor(mod(phaseDeg, 720) / 180)];

    module.exports = { geometry, wallArea, makeLayout, layouts, cyclePhaseDeg, localCrankDeg, STROKES, strokeOf };

  },
  'heat/balance': function (module, exports, require) {
    /*
     * Температура стенок и тепловой баланс (формулы 4.6, 4.8–4.9).
     *
     *   wallTemperatures(q, wall) — стенка как два последовательных тепловых сопротивления (теплопроводность
     *                               стенки и теплоотдача в охлаждающую жидкость); q — плотность теплового потока,
     *                               Вт/м²; wall = { Tcoolant, hCoolant, thickness, conductivity }
     *                               → температуры поверхности со стороны газа и со стороны жидкости
     *   heatBalance(engine, sim, params) — куда уходит теплота топлива: полезная работа, механические потери,
     *                               стенки, отработавшие газы, недогорание; доли и КПД η_i, η_м, η_e
     */
    const { withDefaults } = require('../params');
    const { performance } = require('../performance');

    function wallTemperatures(q, wall) {
      const TwCoolant = wall.Tcoolant + q / wall.hCoolant;
      const TwGas = TwCoolant + (q * wall.thickness) / wall.conductivity;
      return { TwGas, TwCoolant };
    }

    function heatBalance(engine, sim, regime) {
      const params = withDefaults(regime);
      const { etaM } = performance(engine, sim.Li, sim.rpm, params);
      const Qe = sim.Li * etaM;
      const Qm = sim.Li - Qe;
      const Qinc = sim.Qfuel - sim.Qb;
      const Qgas = sim.Qfuel - sim.Li - sim.Qw - Qinc;
      return {
        Qfuel: sim.Qfuel,
        Qe,
        Qm,
        Qw: sim.Qw,
        Qgas,
        Qinc,
        shares: {
          effective: Qe / sim.Qfuel,
          mechanical: Qm / sim.Qfuel,
          walls: sim.Qw / sim.Qfuel,
          exhaust: Qgas / sim.Qfuel,
          incomplete: Qinc / sim.Qfuel,
        },
        etaI: sim.Li / sim.Qfuel,
        etaM,
        etaE: (sim.Li * etaM) / sim.Qfuel,
      };
    }

    module.exports = { wallTemperatures, heatBalance };

  },
  'heat/woschni': function (module, exports, require) {
    /*
     * Коэффициент теплоотдачи от газа к стенке по Вошни (формулы 4.3–4.4).
     *
     *   woschni(engine, params, gas) → { h — Вт/(м²·К), w — характерная скорость газа, pMot — давление прокрутки }
     *     gas = { p, T, V, phaseDeg, vp }: давление, температура, объём, угол цикла и средняя скорость поршня.
     *     После начала сгорания к скорости 2,28·v_п добавляется слагаемое от роста давления над прокруткой.
     */
    const { geometry } = require('../geometry');

    function woschni(engine, params, gas) {
      const geom = geometry(engine);
      const pMot = params.pa * (geom.Va / gas.V) ** params.n1;
      const combustionTerm = gas.phaseDeg >= params.sparkDeg ? 3.24e-3 : 0;
      const w = 2.28 * gas.vp + combustionTerm * ((geom.Vh * params.Ta) / (params.pa * geom.Va)) * Math.max(0, gas.p - pMot);
      const h = 3.26 * engine.bore ** -0.2 * (gas.p / 1000) ** 0.8 * gas.T ** -0.53 * w ** 0.8;
      return { h, w, pMot };
    }

    module.exports = { woschni };

  },
  'index': function (module, exports, require) {
    /*!
     * ice-core — расчётное ядро ДВС. Собирает функции модулей в один публичный набор (тот же, что в dist/ice-core.js).
     * Все величины в СИ: м, кг, с, Па, К, Дж, Н, Н·м, Вт, рад. Углы с суффиксом Deg — в градусах поворота вала.
     *
     * Номера формул в шапках модулей — по документу «ДВС: теоретико-расчётная база и спецификация ice-core»:
     *   1 — геометрия и компоновка, 2 — кинематика, 3 — термодинамика (уровни 0, 1, 2), 4 — теплообмен,
     *   5 — динамика и показатели, а также газообмен по оборотам, дизель, наддув и газораспределение.
     */

    const all = Object.assign({},
      require('./util'),
      require('./params'),
      require('./geometry'),
      require('./kinematics'),
      require('./thermo/properties'),
      require('./thermo/charge'),
      require('./thermo/otto'),
      require('./thermo/cycle'),
      require('./thermo/combustion'),
      require('./heat/woschni'),
      require('./thermo/simulate'),
      require('./heat/balance'),
      require('./dynamics'),
      require('./performance'),
      require('./engines'),
      require('./intake'),
      require('./diesel'),
      require('./characteristics'),
      require('./valvetrain'),
    );

    module.exports = {
      DEG: all.DEG,
      R_UNIV: all.R_UNIV,
      VAZ21126: all.VAZ21126,
      DEFAULT_PARAMS: all.DEFAULT_PARAMS,
      geometry: all.geometry,
      wallArea: all.wallArea,
      makeLayout: all.makeLayout,
      layouts: all.layouts,
      cyclePhaseDeg: all.cyclePhaseDeg,
      localCrankDeg: all.localCrankDeg,
      strokeOf: all.strokeOf,
      omegaOf: all.omegaOf,
      kinematics: all.kinematics,
      kinematicsApprox: all.kinematicsApprox,
      meanPistonSpeed: all.meanPistonSpeed,
      cv: all.cv,
      cvFresh: all.cvFresh,
      cvBurned: all.cvBurned,
      uFresh: all.uFresh,
      uBurned: all.uBurned,
      uInt: all.uInt,
      exhaustTemperature: all.exhaustTemperature,
      charge: all.charge,
      ottoIdeal: all.ottoIdeal,
      calcCycle: all.calcCycle,
      cycleState: all.cycleState,
      wiebe: all.wiebe,
      woschni: all.woschni,
      simulateCycle: all.simulateCycle,
      wallTemperatures: all.wallTemperatures,
      heatBalance: all.heatBalance,
      reciprocatingMass: all.reciprocatingMass,
      forces: all.forces,
      engineTorque: all.engineTorque,
      torqueCurve: all.torqueCurve,
      inertiaResultant: all.inertiaResultant,
      performance: all.performance,
      specificConsumption: all.specificConsumption,
      SIM_ENGINES: all.SIM_ENGINES,
      DIESEL_PARAMS: all.DIESEL_PARAMS,
      intakeState: all.intakeState,
      regimeParams: all.regimeParams,
      compressor: all.compressor,
      dieselCycle: all.dieselCycle,
      dieselState: all.dieselState,
      dieselSimParams: all.dieselSimParams,
      speedCharacteristic: all.speedCharacteristic,
      leidermanPower: all.leidermanPower,
      valveMotion: all.valveMotion,
      valveTiming: all.valveTiming,
      valveGasSpeed: all.valveGasSpeed,
      drives: all.drives,
      fStoich: all.fStoich,
    };

  },
  'intake': function (module, exports, require) {
    /*
     * Газообмен по оборотам и наддув.
     *
     *   intakeState(engine, params, rpm) — давление и температура в конце впуска на данных оборотах.
     *       Потери на впуске Δp_a = ζ·ρ_к·w²/2, где w = Kw·c_m — средняя скорость заряда в клапане
     *       (Kw = 6,6, ζ = β² + ξ_вп = 3 по методике теплового расчёта). С наддувом заряд перед впуском —
     *       воздух после компрессора (p_k, T_k), без наддува — окружающий воздух.
     *       T_a — из смешения свежего заряда (с подогревом ΔT) и остаточных газов.
     *   regimeParams(engine, params, rpm) — параметры режима с p_a и T_a, найденными по оборотам
     *   compressor(params, airFlow)       — работа и мощность компрессора наддува: степень повышения давления,
     *                                       температура после компрессора, удельная работа, адиабатный КПД
     */
    const { meanPistonSpeed } = require('./kinematics');
    const { withDefaults } = require('./params');

    const CHARGE_SPEED_FACTOR = 6.6;
    const INTAKE_LOSS_FACTOR = 3;

    function intakeState(engine, regime, rpm) {
      const params = withDefaults(regime);
      const cm = meanPistonSpeed(engine, rpm);
      const pk = params.pk || params.p0;
      const Tk = params.pk ? params.T0 * (params.pk / params.p0) ** ((params.nk - 1) / params.nk) : params.T0;
      const rhoK = pk / (params.Rgas * Tk);
      const wIn = (params.Kw || CHARGE_SPEED_FACTOR) * cm;
      const dpa = (params.zetaIn || INTAKE_LOSS_FACTOR) * rhoK * wIn * wIn / 2;
      const pa = pk - dpa;
      const gammaR = ((Tk + params.dT) / params.Tr) * (params.pr / (engine.cr * pa - params.pr));
      const Ta = (Tk + params.dT + gammaR * params.Tr) / (1 + gammaR);
      return { cm, pk, Tk, rhoK, wIn, dpa, pa, Ta, gammaR };
    }

    function regimeParams(engine, regime, rpm) {
      const params = withDefaults(regime);
      const intake = intakeState(engine, params, rpm);
      const result = Object.assign({}, params, { pa: intake.pa, Ta: intake.Ta });
      if (params.pk) Object.assign(result, { T0: intake.Tk, p0: params.pk });
      return result;
    }

    function compressor(params, airFlow) {
      const cp = params.Rgas * params.k / (params.k - 1);
      const pik = params.pk / params.p0;
      const Tk = params.T0 * pik ** ((params.nk - 1) / params.nk);
      const lk = cp * (Tk - params.T0);
      const adiabaticWork = cp * params.T0 * (pik ** ((params.k - 1) / params.k) - 1);
      return { pik, Tk, lk, etaAd: adiabaticWork / lk, power: lk * airFlow };
    }

    module.exports = { intakeState, regimeParams, compressor };

  },
  'kinematics': function (module, exports, require) {
    /*
     * Кинематика кривошипно-шатунного механизма (формулы 2.1–2.10). alpha — угол кривошипа от ВМТ, рад.
     *
     *   omegaOf(rpm)                         — угловая скорость ω = πn/30
     *   kinematics(engine, alpha, omega)     — точные формулы: угол шатуна β, расстояние y от оси вала до пальца,
     *                                          ход x, объём V, dx/dα, dV/dα, скорость и ускорение поршня,
     *                                          угловая скорость шатуна
     *   kinematicsApprox(engine, alpha, ω)   — приближённые формулы (первые члены ряда по λ)
     *   meanPistonSpeed(engine, rpm)         — средняя скорость поршня S·n/30
     */
    const { geometry } = require('./geometry');

    const omegaOf = (rpm) => (Math.PI * rpm) / 30;

    function kinematics(engine, alpha, omega = 0) {
      const { R, lambda, F, Vc } = geometry(engine);
      const sin = Math.sin(alpha);
      const cos = Math.cos(alpha);
      const cosBeta = Math.sqrt(1 - lambda * lambda * sin * sin);
      const beta = Math.asin(lambda * sin);
      const y = R * cos + engine.rod * cosBeta;
      const x = R + engine.rod - y;
      const dxda = R * (sin + (lambda * sin * cos) / cosBeta);
      const a = R * omega * omega * (cos + (lambda * (Math.cos(2 * alpha) + lambda ** 2 * sin ** 4)) / cosBeta ** 3);
      return {
        beta,
        y,
        x,
        V: Vc + F * x,
        dxda,
        dVda: F * dxda,
        v: omega * dxda,
        a,
        omegaRod: (omega * lambda * cos) / cosBeta,
      };
    }

    function kinematicsApprox(engine, alpha, omega = 0) {
      const { R, lambda, F, Vc } = geometry(engine);
      const sin = Math.sin(alpha);
      const cos = Math.cos(alpha);
      const x = R * (1 - cos + (lambda / 2) * sin * sin);
      return {
        y: R + engine.rod - x,
        x,
        V: Vc + F * x,
        v: R * omega * (sin + (lambda / 2) * Math.sin(2 * alpha)),
        a: R * omega * omega * (cos + lambda * Math.cos(2 * alpha)),
      };
    }

    const meanPistonSpeed = (engine, rpm) => (engine.stroke * rpm) / 30;

    module.exports = { omegaOf, kinematics, kinematicsApprox, meanPistonSpeed };

  },
  'params': function (module, exports, require) {
    /*
     * Эталонный двигатель ВАЗ-21126 и параметры рабочего процесса по умолчанию.
     *
     * Описание двигателя: bore (D, м), stroke (S, м), rod (L, м), cr (ε), cylinders (i).
     *
     * DEFAULT_PARAMS — исходные данные команды и принятые величины, СИ:
     *   впуск:        pa, Ta — давление и температура в конце впуска; p0, T0 — окружающая среда;
     *                 dT — подогрев свежего заряда; pr, Tr — давление и температура остаточных газов
     *   рабочее тело: Rgas — газовая постоянная воздуха; k — показатель адиабаты (идеальный цикл);
     *                 Hu — низшая теплота сгорания бензина; l0 — кг воздуха на 1 кг топлива; alphaAir — α
     *   цикл ур. 1:   n1, n2 — показатели политроп сжатия и расширения; xiZ — коэффициент использования
     *                 теплоты; phiFull — коэффициент полноты диаграммы
     *   теплоёмкость: c_v(T) = A + B·T для свежей смеси (cvFreshA, cvFreshB) и продуктов (cvBurnedA, cvBurnedB);
     *                 Tref — начало отсчёта внутренней энергии
     *   цикл ур. 2:   chi — полнота сгорания; wiebeA, wiebeM — параметры закона Вибе; sparkDeg — начало
     *                 сгорания по углу цикла (340° = 20° до ВМТ); burnDeg — продолжительность; Tw — стенка
     *   потери:       p_м = pmA + pmB·v_п.ср
     *   массы:        mPiston — поршень с пальцем (235 + 65 г), mRod — шатун (485 г), rodSplit — доля шатуна,
     *                 отнесённая к поршню; pCrankcase — давление в картере; J — момент инерции вала с маховиком
     *
     *   withDefaults(params) — параметры по умолчанию, поверх которых записаны переданные
     */
    const { R_UNIV } = require('./util');

    const VAZ21126 = Object.freeze({
      name: 'ВАЗ-21126',
      bore: 0.082,
      stroke: 0.0756,
      rod: 0.13333,
      cr: 11,
      cylinders: 4,
    });

    const DEFAULT_PARAMS = Object.freeze({
      pa: 85000,
      Ta: 340,
      Rgas: R_UNIV / 0.029,
      k: 1.4,
      Hu: 44e6,
      l0: 14.7,
      alphaAir: 1,
      p0: 101325,
      T0: 293,
      dT: 20,
      pr: 115000,
      Tr: 1000,
      n1: 1.38,
      n2: 1.3,
      xiZ: 0.9,
      phiFull: 0.96,
      cvFreshA: 635,
      cvFreshB: 0.242,
      cvBurnedA: 900,
      cvBurnedB: 0.105,
      Tref: 293,
      chi: 0.95,
      wiebeA: 5,
      wiebeM: 2,
      sparkDeg: 340,
      burnDeg: 55,
      Tw: 450,
      pmA: 0.034e6,
      pmB: 0.0113e6,
      mPiston: 0.3,
      mRod: 0.485,
      rodSplit: 0.275,
      pCrankcase: 1e5,
      J: 0.13,
    });

    const withDefaults = (params) => Object.assign({}, DEFAULT_PARAMS, params || {});

    module.exports = { VAZ21126, DEFAULT_PARAMS, withDefaults };

  },
  'performance': function (module, exports, require) {
    /*
     * Индикаторные и эффективные показатели (формулы 5.9–5.10).
     *
     *   performance(engine, Li, rpm, params) → по индикаторной работе цикла одного цилиндра Li:
     *     pi = Li/Vh, механические потери pm = pmA + pmB·v_п.ср, pe = pi − pm, η_м = pe/pi,
     *     мощности Ni = Li·i·n/120 и Ne = Ni·η_м, моменты Mi, Me = N/ω, литровая мощность
     *   specificConsumption(eta, Hu) — удельный расход топлива, г/(кВт·ч), по КПД
     */
    const { geometry } = require('./geometry');
    const { meanPistonSpeed, omegaOf } = require('./kinematics');
    const { withDefaults } = require('./params');

    function performance(engine, Li, rpm, regime) {
      const params = withDefaults(regime);
      const geom = geometry(engine);
      const omega = omegaOf(rpm);
      const pi = Li / geom.Vh;
      const pm = params.pmA + params.pmB * meanPistonSpeed(engine, rpm);
      const pe = pi - pm;
      const etaM = pe / pi;
      const Ni = (Li * engine.cylinders * rpm) / 120;
      const Ne = Ni * etaM;
      return { pi, pm, pe, etaM, Ni, Ne, Mi: Ni / omega, Me: Ne / omega, literPower: Ne / geom.Vtotal };
    }

    const specificConsumption = (eta, Hu) => 3.6e9 / (eta * Hu);

    module.exports = { performance, specificConsumption };

  },
  'thermo/charge': function (module, exports, require) {
    /*
     * Заряд цилиндра (формулы 3.1, 3.6).
     *
     *   charge(engine, params) → {
     *     m       — масса заряда в конце впуска  p_a·V_a / (R·T_a)
     *     gammaR  — коэффициент остаточных газов
     *     mFresh  — масса свежей смеси, mFuel — масса топлива, Qfuel — теплота топлива
     *     etaV    — коэффициент наполнения (свежая смесь / заряд при условиях окружающей среды)
     *     TaCheck — температура конца впуска из смешения свежего заряда и остаточных газов (для проверки T_a)
     *   }
     */
    const { geometry } = require('../geometry');
    const { withDefaults } = require('../params');

    function charge(engine, regime) {
      const params = withDefaults(regime);
      const geom = geometry(engine);
      const m = (params.pa * geom.Va) / (params.Rgas * params.Ta);
      const gammaR = ((params.T0 + params.dT) / params.Tr) * (params.pr / (engine.cr * params.pa - params.pr));
      const mFresh = m / (1 + gammaR);
      const mFuel = mFresh / (1 + params.alphaAir * params.l0);
      const ambientDensity = params.p0 / (params.Rgas * params.T0);
      return {
        m,
        gammaR,
        mFresh,
        mFuel,
        Qfuel: mFuel * params.Hu,
        etaV: mFresh / (ambientDensity * geom.Vh),
        TaCheck: (params.T0 + params.dT + gammaR * params.Tr) / (1 + gammaR),
      };
    }

    module.exports = { charge };

  },
  'thermo/combustion': function (module, exports, require) {
    /*
     * Закон сгорания Вибе (формула 3.14): x = 1 − exp(−a·t^(m+1)), t = (Φ − Φ_нач) / Φ_z.
     *
     *   wiebe(phaseDeg, params) → { x — доля сгоревшего топлива, dxda — её производная по углу, 1/рад }
     */
    const { DEG } = require('../util');

    function wiebe(phaseDeg, params) {
      const t = (phaseDeg - params.sparkDeg) / params.burnDeg;
      if (t <= 0) return { x: 0, dxda: 0 };
      if (t >= 1) return { x: 1 - Math.exp(-params.wiebeA), dxda: 0 };
      const unburned = Math.exp(-params.wiebeA * t ** (params.wiebeM + 1));
      return {
        x: 1 - unburned,
        dxda: ((params.wiebeA * (params.wiebeM + 1)) / (params.burnDeg * DEG)) * t ** params.wiebeM * unburned,
      };
    }

    module.exports = { wiebe };

  },
  'thermo/cycle': function (module, exports, require) {
    /*
     * Уровень 1: расчётный цикл (формулы 3.6–3.12) — политропы сжатия и расширения, сгорание при V = const
     * с теплоёмкостью c_v(T).
     *
     *   calcCycle(engine, params)       — точки цикла c, z, b; работа сжатия и расширения; теоретическая и
     *                                     действительная (×φ_полн) индикаторная работа; p_i; η_i; η_t.
     *                                     Температура сгорания T_z находится из уравнения
     *                                     ξ_z·q_см + u_см(T_c) = u_пс(T_z) — квадратного относительно T_z.
     *   exhaustTemperature(params, Tb, pb) — температура газа после свободного выпуска (адиабата от p_b до p_r)
     *   cycleState(engine, cycle, phaseDeg) — давление и температура по углу цикла для уровней 0 и 1:
     *                                     впуск и выпуск — изобары, сжатие и расширение — политропы
     */
    const { geometry, strokeOf } = require('../geometry');
    const { kinematics } = require('../kinematics');
    const { withDefaults } = require('../params');
    const { charge } = require('../thermo/charge');
    const { cvBurned, fStoich, uFresh } = require('../thermo/properties');
    const { DEG, mod } = require('../util');

    function exhaustTemperature(params, Tb, pb) {
      const kBurned = 1 + params.Rgas / cvBurned(params, Tb);
      return Tb * (params.pr / pb) ** ((kBurned - 1) / kBurned);
    }

    function combustionTemperature(params, Tc, heatPerKg) {
      const share = fStoich(params);
      const A = (share * params.cvBurnedB + (1 - share) * params.cvFreshB) / 2;
      const B = share * params.cvBurnedA + (1 - share) * params.cvFreshA;
      const C = -(heatPerKg + uFresh(params, Tc)) - (B * params.Tref + A * params.Tref * params.Tref);
      return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
    }

    function calcCycle(engine, regime) {
      const params = withDefaults(regime);
      const geom = geometry(engine);
      const chargeState = charge(engine, params);
      const pc = params.pa * engine.cr ** params.n1;
      const Tc = params.Ta * engine.cr ** (params.n1 - 1);
      const qMix = (params.xiZ * chargeState.Qfuel) / chargeState.m;
      const Tz = combustionTemperature(params, Tc, qMix);
      const pz = (pc * Tz) / Tc;
      const pb = pz / engine.cr ** params.n2;
      const Tb = Tz / engine.cr ** (params.n2 - 1);
      const Tr = exhaustTemperature(params, Tb, pb);
      const Lexp = (pz * geom.Vc - pb * geom.Va) / (params.n2 - 1);
      const Lcomp = (pc * geom.Vc - params.pa * geom.Va) / (params.n1 - 1);
      const LiTheor = Lexp - Lcomp;
      const Li = params.phiFull * LiTheor;
      return Object.assign({}, chargeState, {
        level: 1,
        pc,
        Tc,
        Tz,
        pz,
        lambdaP: Tz / Tc,
        pb,
        Tb,
        Tr,
        qMix,
        Lexp,
        Lcomp,
        LiTheor,
        piTheor: LiTheor / geom.Vh,
        Li,
        pi: Li / geom.Vh,
        etaI: Li / chargeState.Qfuel,
        etaT: 1 - engine.cr ** (1 - params.k),
        pa: params.pa,
        Ta: params.Ta,
        pr: params.pr,
        nComp: params.n1,
        nExp: params.n2,
      });
    }

    function cycleState(engine, cycle, phaseDeg) {
      const geom = geometry(engine);
      const phase = mod(phaseDeg, 720);
      const V = kinematics(engine, (phase % 360) * DEG).V;
      let p;
      let T;
      if (phase < 180) {
        p = cycle.pa;
        T = cycle.Ta;
      } else if (phase < 360) {
        const ratio = geom.Va / V;
        p = cycle.pa * ratio ** cycle.nComp;
        T = cycle.Ta * ratio ** (cycle.nComp - 1);
      } else if (phase < 540) {
        const ratio = geom.Vc / V;
        p = cycle.pz * ratio ** cycle.nExp;
        T = cycle.Tz * ratio ** (cycle.nExp - 1);
      } else {
        p = cycle.pr;
        T = cycle.Tr;
      }
      return { phase, stroke: strokeOf(phase), V, p, T };
    }

    module.exports = { exhaustTemperature, calcCycle, cycleState };

  },
  'thermo/otto': function (module, exports, require) {
    /*
     * Уровень 0: идеальный цикл Отто (формулы 3.4–3.5) — постоянная теплоёмкость, адиабаты, подвод теплоты при V = const.
     *
     *   ottoIdeal(engine, params) → точки цикла 1–4 (p, T, V), подведённая и отведённая теплота Q1, Q2,
     *     термический КПД η_t = 1 − ε^(1−k), работа и среднее давление цикла.
     *     Поля pa, Ta, pr, nComp, nExp, pz, Tz, Tb, Tr нужны для cycleState (давление по углу цикла).
     */
    const { geometry } = require('../geometry');
    const { withDefaults } = require('../params');

    function ottoIdeal(engine, regime) {
      const params = withDefaults(regime);
      const geom = geometry(engine);
      const k = params.k, cr = engine.cr;
      const cvConst = params.Rgas / (k - 1);
      const m = (params.pa * geom.Va) / (params.Rgas * params.Ta);
      const heatPerKg = params.Hu / (1 + params.alphaAir * params.l0);
      const T2 = params.Ta * cr ** (k - 1);
      const p2 = params.pa * cr ** k;
      const T3 = T2 + heatPerKg / cvConst;
      const p3 = (p2 * T3) / T2;
      const T4 = T3 / cr ** (k - 1);
      const p4 = p3 / cr ** k;
      const etaT = 1 - cr ** (1 - k);
      const Q1 = m * heatPerKg;
      const work = etaT * Q1;
      return {
        level: 0,
        m,
        q: heatPerKg,
        cv: cvConst,
        points: [
          { p: params.pa, T: params.Ta, V: geom.Va },
          { p: p2, T: T2, V: geom.Vc },
          { p: p3, T: T3, V: geom.Vc },
          { p: p4, T: T4, V: geom.Va },
        ],
        Q1,
        Q2: Q1 - work,
        etaT,
        work,
        pMean: work / geom.Vh,
        pa: params.pa,
        Ta: params.Ta,
        pr: params.pa,
        nComp: k,
        nExp: k,
        pz: p3,
        Tz: T3,
        Tb: T4,
        Tr: params.Ta,
      };
    }

    module.exports = { ottoIdeal };

  },
  'thermo/properties': function (module, exports, require) {
    /*
     * Свойства рабочего тела (формула 3.7): теплоёмкость c_v(T) = A + B·T и внутренняя энергия.
     * x — массовая доля продуктов сгорания (0 — свежая смесь, 1 — продукты). Внутренняя энергия отсчитывается
     * от Tref, чтобы теплота сгорания Hu, определённая при Tref, входила в баланс без поправок.
     * При α > 1 продукты сгорания — смесь стехиометрических продуктов и избыточного воздуха.
     *
     *   cvFresh(params, T), cvBurned(params, T), cv(params, T, x)       — теплоёмкость, Дж/(кг·К)
     *   uFresh(params, T), uBurned(params, T), uInt(params, T, x)       — внутренняя энергия, Дж/кг
     *   uBurnedStoich(params, T)                                         — энергия стехиометрических продуктов
     *   fStoich(params)                                                  — доля стехиометрических продуктов
     */

    const cvFresh = (params, T) => params.cvFreshA + params.cvFreshB * T;
    const fStoich = (params) => (params.alphaAir > 1 ? (1 + params.l0) / (1 + params.alphaAir * params.l0) : 1);

    function cvBurned(params, T) {
      const share = fStoich(params);
      return share * (params.cvBurnedA + params.cvBurnedB * T) + (1 - share) * cvFresh(params, T);
    }

    const cv = (params, T, x = 0) => (1 - x) * cvFresh(params, T) + x * cvBurned(params, T);

    const uFresh = (params, T) => params.cvFreshA * (T - params.Tref) + (params.cvFreshB / 2) * (T * T - params.Tref * params.Tref);
    const uBurnedStoich = (params, T) => params.cvBurnedA * (T - params.Tref) + (params.cvBurnedB / 2) * (T * T - params.Tref * params.Tref);

    function uBurned(params, T) {
      const share = fStoich(params);
      return share * uBurnedStoich(params, T) + (1 - share) * uFresh(params, T);
    }

    const uInt = (params, T, x = 0) => (1 - x) * uFresh(params, T) + x * uBurned(params, T);

    module.exports = { cvFresh, fStoich, cvBurned, cv, uFresh, uBurnedStoich, uBurned, uInt };

  },
  'thermo/simulate': function (module, exports, require) {
    /*
     * Уровень 2: пошаговый расчёт закрытой части цикла (180°–540°) методом Рунге — Кутты 4-го порядка
     * (формулы 3.13–3.16, 4.1–4.5).
     *
     * Неизвестная — температура газа T(Φ). На каждом шаге первый закон термодинамики даёт
     *   m·c_v·dT/dΦ = dQ_сгор − dQ_стенки − p·dV − (изменение энергии из-за смены состава),
     * где dQ_сгор — теплота по закону Вибе, dQ_стенки — теплоотдача по Вошни, давление p = m·R·T/V.
     * Попутно интегрируются работа L, теплота в стенки Qw и выделившаяся теплота Qb.
     *
     *   simulateCycle(engine, params, { rpm, stepDeg }) → результат charge() плюс:
     *     series       — массивы по углу: phaseDeg, V, p, T, x (доля сгоревшего), h, qw
     *     pmax, Tmax и углы, где они достигаются; pc, Tc (ВМТ), pb, Tb (НМТ), Tr
     *     Li           — индикаторная работа закрытой части; Lpump — работа насосных ходов; LiNet = Li + Lpump
     *     pi, etaI     — среднее индикаторное давление и индикаторный КПД
     *     Qb, Qw, dU, energyResidual — баланс энергии (невязка показывает точность интегрирования)
     *     n1eff, n2eff — эффективные показатели политроп сжатия и расширения по двум точкам кривой
     *     state(phaseDeg) — давление и температура в любой точке цикла (впуск и выпуск — изобары)
     */
    const { geometry, strokeOf, wallArea } = require('../geometry');
    const { woschni } = require('../heat/woschni');
    const { kinematics, meanPistonSpeed, omegaOf } = require('../kinematics');
    const { withDefaults } = require('../params');
    const { charge } = require('../thermo/charge');
    const { wiebe } = require('../thermo/combustion');
    const { exhaustTemperature } = require('../thermo/cycle');
    const { cv, uBurned, uFresh, uInt } = require('../thermo/properties');
    const { DEG, mod } = require('../util');

    function simulateCycle(engine, regime, settings) {
      const params = withDefaults(regime);
      const options = Object.assign({ rpm: 3000, stepDeg: 0.5 }, settings || {});
      const geom = geometry(engine);
      const chargeState = charge(engine, params);
      const omega = omegaOf(options.rpm);
      const pistonSpeed = meanPistonSpeed(engine, options.rpm);
      const burnedHeat = params.chi * chargeState.Qfuel;
      const mass = chargeState.m;

      const rates = (phaseDeg, T) => {
        const piston = kinematics(engine, (phaseDeg % 360) * DEG);
        const p = (mass * params.Rgas * T) / piston.V;
        const combustion = wiebe(phaseDeg, params);
        const heatTransfer = woschni(engine, params, { p, T, V: piston.V, phaseDeg, vp: pistonSpeed });
        const dQb = burnedHeat * combustion.dxda;
        const dQw = (heatTransfer.h * wallArea(engine, piston.x) * (T - params.Tw)) / omega;
        const dL = p * piston.dVda;
        const dUcomposition = mass * (uBurned(params, T) - uFresh(params, T)) * combustion.dxda;
        return {
          p,
          V: piston.V,
          x: combustion.x,
          h: heatTransfer.h,
          dQb,
          dQw,
          dL,
          dT: (dQb - dQw - dL - dUcomposition) / (mass * cv(params, T, combustion.x)),
        };
      };

      const steps = Math.round(360 / options.stepDeg);
      const step = options.stepDeg * DEG;
      const series = { phaseDeg: [], V: [], p: [], T: [], x: [], h: [], qw: [] };
      let T = params.Ta;
      let work = 0;
      let wallHeat = 0;
      let releasedHeat = 0;
      let pmax = 0;
      let phaseAtPmax = 0;
      let Tmax = 0;
      let phaseAtTmax = 0;
      for (let i = 0; i <= steps; i++) {
        const phase = 180 + i * options.stepDeg;
        const k1 = rates(phase, T);
        series.phaseDeg.push(phase);
        series.V.push(k1.V);
        series.p.push(k1.p);
        series.T.push(T);
        series.x.push(k1.x);
        series.h.push(k1.h);
        series.qw.push(k1.dQw);
        if (k1.p > pmax) {
          pmax = k1.p;
          phaseAtPmax = phase;
        }
        if (T > Tmax) {
          Tmax = T;
          phaseAtTmax = phase;
        }
        if (i === steps) break;
        const k2 = rates(phase + options.stepDeg / 2, T + (step / 2) * k1.dT);
        const k3 = rates(phase + options.stepDeg / 2, T + (step / 2) * k2.dT);
        const k4 = rates(phase + options.stepDeg, T + step * k3.dT);
        T += (step / 6) * (k1.dT + 2 * k2.dT + 2 * k3.dT + k4.dT);
        work += (step / 6) * (k1.dL + 2 * k2.dL + 2 * k3.dL + k4.dL);
        wallHeat += (step / 6) * (k1.dQw + 2 * k2.dQw + 2 * k3.dQw + k4.dQw);
        releasedHeat += (step / 6) * (k1.dQb + 2 * k2.dQb + 2 * k3.dQb + k4.dQb);
      }

      const interpolate = (phaseDeg) => {
        const position = (mod(phaseDeg, 720) - 180) / options.stepDeg;
        const i = Math.max(0, Math.min(steps - 1, Math.floor(position)));
        const w = position - i;
        const between = (values) => values[i] + (values[i + 1] - values[i]) * w;
        return { V: between(series.V), p: between(series.p), T: between(series.T), x: between(series.x) };
      };
      const polytropicIndex = (fromDeg, toDeg) => {
        const a = interpolate(fromDeg);
        const b = interpolate(toDeg);
        return Math.log(a.p / b.p) / Math.log(b.V / a.V);
      };

      const Tb = series.T[steps];
      const pb = series.p[steps];
      const dU = mass * (uInt(params, Tb, series.x[steps]) - uInt(params, params.Ta, 0));
      const Lpump = -(params.pr - params.pa) * geom.Vh;
      const Tr = exhaustTemperature(params, Tb, pb);
      const result = Object.assign({}, chargeState, {
        level: 2,
        rpm: options.rpm,
        series,
        pmax,
        phaseAtPmax,
        Tmax,
        phaseAtTmax,
        pc: interpolate(360).p,
        Tc: interpolate(360).T,
        pb,
        Tb,
        Tr,
        Li: work,
        Lpump,
        LiNet: work + Lpump,
        pi: work / geom.Vh,
        Qb: releasedHeat,
        Qw: wallHeat,
        dU,
        energyResidual: releasedHeat - wallHeat - work - dU,
        etaI: work / chargeState.Qfuel,
        n1eff: polytropicIndex(200, 330),
        n2eff: polytropicIndex(420, 530),
        pa: params.pa,
        Ta: params.Ta,
        pr: params.pr,
      });

      result.state = (phaseDeg) => {
        const phase = mod(phaseDeg, 720);
        if (phase >= 180 && phase <= 540) {
          const gas = interpolate(phase);
          return { phase, stroke: strokeOf(phase), V: gas.V, p: gas.p, T: gas.T };
        }
        const V = kinematics(engine, (phase % 360) * DEG).V;
        if (phase < 180) return { phase, stroke: 'intake', V, p: params.pa, T: params.Ta };
        return { phase, stroke: 'exhaust', V, p: params.pr, T: Tr };
      };
      return result;
    }

    module.exports = { simulateCycle };

  },
  'util': function (module, exports, require) {
    /*
     * Общие константы.
     *
     *   DEG          — радиан в одном градусе
     *   R_UNIV       — универсальная газовая постоянная, Дж/(моль·К)
     *   mod(a, m)    — остаток от деления, всегда неотрицательный (для углов цикла 0…720°)
     */

    const DEG = Math.PI / 180;
    const R_UNIV = 8.314;
    const mod = (a, m) => ((a % m) + m) % m;

    module.exports = { DEG, R_UNIV, mod };

  },
  'valvetrain': function (module, exports, require) {
    /*
     * Газораспределение и приводы.
     *
     *   valveMotion(H, halfWidthRad, peakDeg, phaseDeg, omega) — закон подъёма клапана симуляции
     *       h = H·(1 − u²)², u = (Φ − Φ_max) / (2β): β — половина угла действия кулачка по углу распредвала,
     *       Φ — угол цикла. Скорость и ускорение клапана — производные по времени при ω_р = ω/2.
     *   valveTiming(H, halfWidthRad, peakDeg, threshold) — фазы: углы открытия и закрытия по порогу подъёма
     *   valveGasSpeed(engine, valves, diameter, lift, pistonSpeed) — средняя скорость газа в клапане
     *       по уравнению неразрывности (через меньшее из сечений: щель клапана или горловина)
     *   drives — передачи: делительный диаметр шкива, длина ремня N·p, передаточное отношение, скорость ремня,
     *       шестерни модуля m, межосевое расстояние, скорость наружного ротора героторного насоса
     */
    const { geometry } = require('./geometry');
    const { DEG, mod } = require('./util');

    function valveMotion(H, halfWidthRad, peakDeg, phaseDeg, omega = 0) {
      const fromPeakDeg = mod(phaseDeg - peakDeg + 360, 720) - 360;
      const u = (fromPeakDeg * DEG) / (2 * halfWidthRad);
      if (Math.abs(u) >= 1) return { h: 0, v: 0, a: 0, u };
      const w = 1 - u * u;
      const dudt = omega / (2 * halfWidthRad);
      return { h: H * w * w, v: -4 * H * u * w * dudt, a: H * (12 * u * u - 4) * dudt * dudt, u };
    }

    function valveTiming(H, halfWidthRad, peakDeg, threshold = 0) {
      const u = threshold > 0 ? Math.sqrt(1 - Math.sqrt(threshold / H)) : 1;
      const halfDurationDeg = (u * 2 * halfWidthRad) / DEG;
      return { open: mod(peakDeg - halfDurationDeg, 720), close: mod(peakDeg + halfDurationDeg, 720), durationDeg: 2 * halfDurationDeg };
    }

    function valveGasSpeed(engine, valves, diameter, lift, pistonSpeed) {
      const geom = geometry(engine);
      const curtainArea = valves * Math.PI * diameter * lift;
      const throatArea = valves * Math.PI * diameter * diameter / 4;
      const area = Math.min(curtainArea, throatArea);
      return area > 0 ? Math.abs(pistonSpeed) * geom.F / area : Infinity;
    }

    const drives = {
      pitchDiameter: (teeth, pitch) => (teeth * pitch) / Math.PI,
      beltLength: (teeth, pitch) => teeth * pitch,
      ratio: (driverTeeth, drivenTeeth) => driverTeeth / drivenTeeth,
      beltSpeed: (teeth, pitch, rpm) => ((teeth * pitch) / Math.PI) * Math.PI * rpm / 60,
      gearPitchDiameter: (module, teeth) => module * teeth,
      centerDistance: (module, teeth1, teeth2) => (module * (teeth1 + teeth2)) / 2,
      gerotorOuterSpeed: (innerTeeth, outerTeeth, rpm) => (rpm * innerTeeth) / outerTeeth,
    };

    module.exports = { valveMotion, valveTiming, valveGasSpeed, drives };

  },
};
const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const module = (cache[name] = { exports: {} });
  const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '';
  defs[name](module, module.exports, (rel) => load(resolve(dir, rel)));
  return module.exports;
}
function resolve(dir, rel) {
  const parts = (dir + rel).split('/');
  const outp = [];
  parts.forEach((p) => { if (p === '..') outp.pop(); else if (p !== '.' && p !== '') outp.push(p); });
  return outp.join('/');
}
const api = load('index');
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.ICE_CORE = api;
})(typeof window !== 'undefined' ? window : globalThis);
