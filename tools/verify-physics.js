#!/usr/bin/env node
/*
 * Сверка 3D-симуляции с расчётным ядром ice-core и с теорией отчёта.
 * Запуск: node tools/verify-physics.js   (без браузера и без three.js)
 *
 * Проверяется, что всё, что показывает симуляция, следует из расчёта:
 *  1) размеры и степень сжатия в spec.js совпадают с исходными данными ядра;
 *  2) ход поршня в spec.js совпадает с точной формулой КШМ ядра, объём на p–V-диаграмме — тоже из ядра;
 *  3) порядок работы и углы колен дают вспышку в ВМТ каждого цилиндра через 720°/i;
 *  4) закон подъёма клапанов I4 совпадает с функцией ядра, распредвалы вращаются вдвое медленнее вала;
 *  5) ремни содержат целое число зубьев, окно впрыска V8 совпадает с параметрами ядра;
 *  6) p–V-диаграмма на экране замыкает ту же работу, что посчитало ядро;
 *  7) показанные мощность и момент — эффективные: N_e = p_e·V_л·n/120, M_e = N_e/ω.
 */
'use strict';
const path = require('path');
globalThis.window = globalThis;
const file = name => path.join(__dirname, '..', 'js', name);
const Core = require(file('ice-core.js'));
globalThis.ICE_CORE = Core;
const specs = { I4: require(file('i4/spec.js')), B4: require(file('b4/spec.js')), V8: require(file('v8/spec.js')) };
require(file('physics.js'));

let failed = 0, total = 0;
const check = (condition, message) => {
  total++;
  if (!condition) { failed++; console.log('  ✗ ' + message); }
};
const relative = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
const DEG = Math.PI / 180;
const DEFAULT_RPM = { I4: 2400, B4: 2400, V8: 1400 };
const regimeFor = (key, engine, rpm) => (key === 'V8' ? Core.dieselSimParams(engine, {}, rpm) : Core.regimeParams(engine, {}, rpm));

for (const key of ['I4', 'B4', 'V8']) {
  const spec = specs[key], engine = Core.SIM_ENGINES[key], physics = spec.physics;
  console.log(`${key}:`);

  check(spec.bore / 1000 === engine.bore && spec.stroke / 1000 === engine.stroke && spec.rodLength / 1000 === engine.rod, 'размеры D, S, L совпадают с ядром');
  check(spec.compressionRatio === engine.cr, 'степень сжатия совпадает с ядром');

  let travelError = 0;
  for (let cylinder = 0; cylinder < engine.cylinders; cylinder++) {
    for (let degrees = 0; degrees < 360; degrees += 5) {
      const position = spec.pistonPosition(cylinder, degrees * DEG);
      travelError = Math.max(travelError, Math.abs(position.travel / 1000 - Core.kinematics(engine, position.crankAngleFromAxis).x));
    }
  }
  check(travelError < 1e-9, `ход поршня всех цилиндров по spec.js = точной формуле ядра (откл. ${travelError.toExponential(1)} м)`);

  const firings = [];
  for (let cylinder = 0; cylinder < engine.cylinders; cylinder++) {
    const crankDeg = ((360 - spec.cycleOffsetDeg[cylinder]) % 720 + 720) % 720;
    firings.push(crankDeg);
    check(Math.abs(spec.pistonPosition(cylinder, crankDeg * DEG).travel) < 1e-6, `цилиндр ${cylinder + 1}: при вспышке поршень в ВМТ`);
  }
  firings.sort((a, b) => a - b);
  const interval = 720 / engine.cylinders;
  check(firings.every((crankDeg, k) => Math.abs(crankDeg - k * interval) < 1e-9), `вспышки следуют через 720°/${engine.cylinders} = ${interval}°`);

  physics.setRpm(DEFAULT_RPM[key]);
  let work = 0;
  for (let k = 0; k < physics.cycle.length - 1; k++) {
    const a = physics.cycle[k], b = physics.cycle[k + 1];
    work += 0.5 * (a.P + b.P) * (b.V - a.V);
  }
  const regime = regimeFor(key, engine, DEFAULT_RPM[key]);
  const coreWork = physics.workPerCycle - (regime.pr - regime.pa) * Core.geometry(engine).Vh;
  check(relative(work, coreWork) < 0.02, `работа p–V-диаграммы на экране ${work.toFixed(1)} Дж ≈ ядро ${coreWork.toFixed(1)} Дж`);

  const totalVolume = Core.geometry(engine).Vtotal;
  for (const rpm of key === 'V8' ? [800, 1400, 2400] : [1000, 3000, 6000]) {
    const rpmRegime = regimeFor(key, engine, rpm);
    const cycle = Core.simulateCycle(engine, rpmRegime, { rpm, stepDeg: 1 });
    const performance = Core.performance(engine, cycle.Li, rpm, rpmRegime);
    const power = performance.pe * totalVolume * rpm / 120;
    check(relative(physics.effectivePower(rpm), power) < 1e-9 && relative(physics.effectiveTorque(rpm), power / Core.omegaOf(rpm)) < 1e-9,
      `${rpm} об/мин: N_e = p_e·V_л·n/120 = ${(power / 1000).toFixed(1)} кВт`);
    check(performance.etaM > 0.6 && performance.etaM < 0.95, `${rpm} об/мин: механический КПД ${performance.etaM.toFixed(3)} в пределах 0,6…0,95`);
  }
  check(physics.burnDeg > 0 && physics.sparkDeg > 300 && physics.sparkDeg < 360,
    `сгорание начинается до ВМТ (${physics.sparkDeg}°) и длится ${physics.burnDeg}°`);
}

console.log('ГРМ и приводы:');
const I4 = specs.I4, B4 = specs.B4, V8 = specs.V8;
let liftError = 0;
for (let phase = 0; phase < 720; phase++) {
  for (const side of [I4.INTAKE, I4.EXHAUST]) {
    const coreLift = Core.valveMotion(I4.camLift, I4.camHalfWidth, I4.peakDeg[side], phase).h;
    liftError = Math.max(liftError, Math.abs(I4.liftAtCyclePhase(side, phase) - coreLift));
  }
}
check(liftError < 1e-9, `I4: подъём клапанов в spec.js = закону ядра h = H(1 − u²)² (откл. ${liftError.toExponential(1)} мм)`);
check(I4.teeth.cam / I4.teeth.crank === 2 && B4.teeth.cam / B4.teeth.crank === 2, 'I4, B4: шкив распредвала вдвое больше шкива вала (n_р = n/2)');
check(Math.abs(Math.abs(V8.gearSpeedRatio.cam) - 0.5) < 1e-12 && V8.gears.cam.teeth / V8.gears.crank.teeth === 2,
  'V8: шестерни дают передаточное отношение распредвала 1/2');
for (const [name, spec] of [['I4', I4], ['B4', B4]]) {
  const belt = spec.solveBelt();
  check(Math.abs(belt.path.length - belt.teethCount * spec.beltPitch) < 1e-6,
    `${name}: ремень ровно ${belt.teethCount} зубьев × ${spec.beltPitch} мм = ${(belt.teethCount * spec.beltPitch).toFixed(0)} мм`);
}
check(V8.injection.start === Core.DIESEL_PARAMS.injStartDeg && V8.injection.end === Core.DIESEL_PARAMS.injEndDeg,
  'V8: окно впрыска в spec.js = параметрам ядра (344–368°)');

console.log(`\n${total - failed} из ${total} проверок пройдено`);
process.exit(failed ? 1 : 0);
