/*
 * Физика рабочего процесса для 3D-моделей: связывает размеры двигателя (spec) с расчётным ядром ice-core.
 *
 * attach(spec, coreEngine, defaultRpm) добавляет к spec объект spec.physics:
 *   setRpm(rpm)            — пересчитать цикл для новой частоты вращения (около 2 мс, результат кэшируется
 *                            с шагом 50 об/мин);
 *   stateAt(phaseDeg)      — давление P (Па), температура T (К), объём V (м³) и такт в данной точке цикла;
 *   cycle                  — точки цикла через 2° для индикаторной диаграммы;
 *   effectivePower(rpm), effectiveTorque(rpm) — мощность (Вт) и момент (Н·м) на валу, за вычетом
 *                            механических потерь;
 *   sparkDeg, burnDeg      — начало сгорания и его продолжительность по закону Вибе (°);
 *   pressureRange          — логарифмы давления в конце впуска ·0,8 и наибольшего давления цикла
 *                            (для прозрачности газа на модели).
 *
 * Бензиновые I4 и B4: давление впуска зависит от оборотов, пошаговый расчёт с законом Вибе и теплоотдачей.
 * Дизель V8: смешанный цикл с наддувом, сгорание начинается после задержки воспламенения.
 */
(function () {
'use strict';

const Core = window.ICE_CORE;
const DEG = Math.PI / 180;
const CYCLE_STEP_DEG = 2;
const STROKE_NAMES = { intake: 'Впуск', compression: 'Сжатие', power: 'Рабочий ход', exhaust: 'Выпуск' };

function attach(spec, coreEngine, defaultRpm) {
  const isDiesel = coreEngine.fuel === 'diesel';
  const geometry = Core.geometry(coreEngine);
  const solvedByRpm = new Map();

  function solve(rpm) {
    const roundedRpm = Math.max(100, Math.round(rpm / 50) * 50);
    if (!solvedByRpm.has(roundedRpm)) {
      const regime = isDiesel
        ? Core.dieselSimParams(coreEngine, {}, roundedRpm)
        : Core.regimeParams(coreEngine, {}, roundedRpm);
      const cycle = Core.simulateCycle(coreEngine, regime, { rpm: roundedRpm, stepDeg: 1 });
      const performance = Core.performance(coreEngine, cycle.Li, roundedRpm, regime);
      solvedByRpm.set(roundedRpm, { regime, cycle, performance });
    }
    return solvedByRpm.get(roundedRpm);
  }

  let current = null;

  const physics = {
    strokeNames: STROKE_NAMES,
    clearanceVolume: geometry.Vc,
    maxVolume: geometry.Va,

    setRpm(rpm) {
      current = solve(rpm);
      const { regime, cycle, performance } = current;
      physics.rpm = rpm;
      physics.sparkDeg = regime.sparkDeg;
      physics.burnDeg = regime.burnDeg;
      physics.maxPressure = cycle.pmax;
      physics.pressureRange = { low: Math.log10(regime.pa * 0.8), high: Math.log10(cycle.pmax) };
      physics.workPerCycle = cycle.Li;
      physics.meanIndicatedPressure = performance.pi;
      physics.cycle = [];
      for (let phase = 0; phase <= 720; phase += CYCLE_STEP_DEG) physics.cycle.push(physics.stateAt(phase));
    },

    stateAt(phaseDeg) {
      const phase = ((phaseDeg % 720) + 720) % 720;
      const state = current.cycle.state(phaseDeg);
      const volume = Core.kinematics(coreEngine, (phase % 360) * DEG).V;
      return { phase, V: volume, P: state.p, T: state.T, stroke: state.stroke };
    },

    effectivePower: rpm => (rpm > 0 ? solve(rpm).performance.Ne : 0),
    effectiveTorque: rpm => (rpm > 0 ? solve(rpm).performance.Me : 0),
  };

  spec.physics = physics;
  physics.setRpm(defaultRpm);
}

const DEFAULT_RPM = { i4: 2400, b4: 2400, v8: 1400 };
Object.entries(window.EngineSpecs).forEach(([id, spec]) => attach(spec, Core.SIM_ENGINES[id.toUpperCase()], DEFAULT_RPM[id]));

window.EnginePhysics = { attach };
})();
