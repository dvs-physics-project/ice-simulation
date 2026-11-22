/*
 * V-образный восьмицилиндровый дизель с углом развала 90°: размеры по чертежу (мм) и кинематика.
 * Ось X — вдоль вала; правый ряд (цилиндры 1–4) наклонён на −45°, левый (5–8) на +45°.
 * Два шатуна сидят на одной шатунной шейке, поэтому ряды сдвинуты вдоль вала на bankOffset.
 * Точки внутри ряда задаются координатами «вдоль оси цилиндра» (along) и «вбок» (side) — см. pointInBank.
 *
 *   pistonPosition(cylinder, crankAngle)  — шатунная шейка, расстояние до пальца, ход поршня, угол шатуна
 *   cyclePhaseDeg(cylinder, crankDeg)     — угол рабочего цикла цилиндра (вспышки через 90°)
 *
 * Газораспределение OHV: один распредвал в развале, толкатель → штанга → коромысло → клапан.
 *   tappetLift(cylinder, side, crankAngle)  — подъём толкателя по закону h = hmax(1 − u²)²
 *   solveRocker(tappetLift)                 — угол коромысла, при котором штанга сохраняет свою длину
 *                                             (решается делением отрезка пополам), и подъём клапана
 *   rockerForTappetLift(h)                  — то же по заранее посчитанной таблице (быстро)
 *   valveLift(cylinder, side, crankAngle), liftAtCyclePhase(side, phaseDeg)
 *
 * Шестерни привода: коленвал → паразитная → распредвал → ТНВД. Центр паразитной шестерни
 * находится из условия зацепления с обеими соседними; meshPhase поворачивает шестерню так,
 * чтобы её зуб попал во впадину соседней.
 * ТНВД: рядный, по плунжеру на цилиндр; plungerLift — ход плунжера, injection — угол впрыска.
 * Клиновой ремень: коленвал → вентилятор → генератор.
 */
(function (root) {
'use strict';

const isNode = typeof require === 'function';
const { DEG, TAU, positiveModulo, wrapToPi } = isNode ? require('../shared/math.js') : root.EngineMath;
const Belt = isNode ? require('../shared/belt.js') : root.Belt;

const spec = {
  id: 'v8',
  bore: 125,
  stroke: 130,
  crankRadius: 65,
  rodLength: 250,
  compressionHeight: 99,
  compressionRatio: 17,
  cylinderPitch: 170,
  bankOffset: 18.5,
  mainJournalDiameter: 95,
  mainJournalWidth: 40,
  crankpinDiameter: 80,
  crankpinWidth: 74,
  webThickness: 28,
  rodWidth: 36,
  rodBigEndBore: 85,
  pistonRadius: 62.3,
  pistonHeight: 140,
  pinOuterDiameter: 50,
  pinInnerDiameter: 28,
  deckDistance: 413.5,
  gasketThickness: 1.5,
  headTop: 520,
  crankpinAngle: [-45, 45, -135, 135].map(degrees => degrees * DEG),
  firingOrder: [1, 5, 4, 2, 6, 3, 7, 8],
};
spec.mainJournalX = [-2, -1, 0, 1, 2].map(k => k * spec.cylinderPitch);
spec.crankpinX = [-1.5, -0.5, 0.5, 1.5].map(k => k * spec.cylinderPitch);
spec.combustionFace = spec.deckDistance + spec.gasketThickness;
spec.displacementCm3 = Math.PI * spec.bore ** 2 / 4 * spec.stroke * 8 / 1000;

spec.cylinders = [];
for (let index = 0; index < 8; index++) {
  const right = index < 4, throwIndex = index % 4;
  spec.cylinders.push({
    number: index + 1, index, throwIndex,
    bank: right ? 'right' : 'left',
    axisAngle: (right ? -45 : 45) * DEG,
    x: spec.crankpinX[throwIndex] + (right ? -spec.bankOffset : spec.bankOffset),
    sign: right ? 1 : -1,
  });
}

spec.cylinderAxis = cylinder => {
  const angle = spec.cylinders[cylinder].axisAngle;
  return { y: Math.cos(angle), z: Math.sin(angle) };
};

spec.bankSideAxis = cylinder => {
  const { axisAngle, sign } = spec.cylinders[cylinder];
  return { y: -Math.sin(axisAngle) * sign, z: Math.cos(axisAngle) * sign };
};

spec.pointInBank = function (cylinder, x, along, side) {
  const axis = spec.cylinderAxis(cylinder), sideways = spec.bankSideAxis(cylinder);
  return [x, along * axis.y + side * sideways.y, along * axis.z + side * sideways.z];
};

spec.pistonPosition = function (cylinder, crankAngle) {
  const { axisAngle, throwIndex } = spec.cylinders[cylinder];
  const throwAngle = spec.crankpinAngle[throwIndex] + crankAngle;
  const fromAxis = throwAngle - axisAngle;
  const sinFromAxis = Math.sin(fromAxis), cosFromAxis = Math.cos(fromAxis);
  const r = spec.crankRadius, L = spec.rodLength;
  const pinDistance = r * cosFromAxis + Math.sqrt(L * L - r * r * sinFromAxis * sinFromAxis);
  return {
    crankAngleFromAxis: fromAxis, throwAngle, pinDistance,
    crankpinY: r * Math.cos(throwAngle),
    crankpinZ: r * Math.sin(throwAngle),
    crownDistance: pinDistance + spec.compressionHeight,
    travel: r + L - pinDistance,
    rodAngle: axisAngle + Math.atan2(-r * sinFromAxis, pinDistance - r * cosFromAxis),
  };
};

spec.cycleOffsetDeg = new Array(8).fill(0);
spec.firingOrder.forEach((cylinderNumber, position) => {
  spec.cycleOffsetDeg[cylinderNumber - 1] = positiveModulo(360 - 90 * position, 720);
});
spec.cyclePhaseDeg = (cylinder, crankDeg) => positiveModulo(crankDeg + spec.cycleOffsetDeg[cylinder], 720);

Object.assign(spec, {
  camY: 168,
  camSpeedRatio: 0.5,
  camBaseRadius: 22,
  camLift: 8.5,
  lobeWidth: 16,
  camJournalRadius: 27,
  camHalfWidth: { intake: 65.6 * DEG, exhaust: 69.4 * DEG },
  peakDeg: { intake: 108, exhaust: 602 },
  valveOffsetX: 30,
  valveSide: 20,
  valveHeadRadius: { intake: 23, exhaust: 20 },
  valveLength: 159,
  tappetLength: 62,
  tappetFaceRadius: 16,
  tappetStemRadius: 10.5,
  pushrodTopAtRest: 566,
  rockerPadRadius: 9,
  pocketDepth: 4,
});
spec.camAlong = spec.camY * Math.SQRT1_2;
spec.camSide = spec.camAlong;
spec.valveSeatDistance = spec.combustionFace + 1;
spec.valveTipDistance = spec.valveSeatDistance + spec.valveLength;
spec.springSeatDistance = spec.headTop;
spec.springTopDistance = spec.valveTipDistance - 13;
spec.pushrodBottomAtRest = spec.camAlong + spec.camBaseRadius + spec.tappetLength;
spec.pushrodLength = spec.pushrodTopAtRest - spec.pushrodBottomAtRest;
spec.rockerPivot = { along: 578, side: spec.valveSide + (spec.camSide - spec.valveSide) * 0.6 };
spec.pushrodCupAtRest = { along: spec.pushrodTopAtRest, side: spec.camSide };
spec.rockerPadAtRest = { along: spec.valveTipDistance + spec.rockerPadRadius, side: spec.valveSide };

spec.valveX = function (cylinder, side) {
  const { x, bank } = spec.cylinders[cylinder];
  const towardFront = (side === 'intake') === (bank === 'right');
  return x + (towardFront ? -spec.valveOffsetX : spec.valveOffsetX);
};

spec.tappetLiftLaw = function (camAngle, halfWidth) {
  const u = wrapToPi(camAngle) / halfWidth;
  if (Math.abs(u) >= 1) return 0;
  const w = 1 - u * u;
  return spec.camLift * w * w;
};

spec.tappetLiftSlope = function (camAngle, halfWidth) {
  const u = wrapToPi(camAngle) / halfWidth;
  if (Math.abs(u) >= 1) return 0;
  return -4 * spec.camLift * u * (1 - u * u) / halfWidth;
};

spec.lobeProfile = function (halfWidth, pointCount) {
  const count = pointCount || 240;
  const points = [];
  for (let k = 0; k < count; k++) {
    const angle = -Math.PI + TAU * k / count;
    const radius = spec.camBaseRadius + spec.tappetLiftLaw(angle, halfWidth), slope = spec.tappetLiftSlope(angle, halfWidth);
    points.push([radius * Math.cos(angle) - slope * Math.sin(angle), radius * Math.sin(angle) + slope * Math.cos(angle)]);
  }
  return points;
};

spec.lobeAngle = function (cylinder, side) {
  const crankAngleAtPeak = positiveModulo(spec.peakDeg[side] - spec.cycleOffsetDeg[cylinder], 720) * DEG;
  return spec.cylinders[cylinder].axisAngle - spec.camSpeedRatio * crankAngleAtPeak;
};
spec.tappetLift = (cylinder, side, crankAngle) => spec.tappetLiftLaw(
  spec.lobeAngle(cylinder, side) + spec.camSpeedRatio * crankAngle - spec.cylinders[cylinder].axisAngle, spec.camHalfWidth[side]);
spec.tappetLiftAtCyclePhase = (side, phaseDeg) =>
  spec.tappetLiftLaw((phaseDeg - spec.peakDeg[side]) * DEG * spec.camSpeedRatio, spec.camHalfWidth[side]);

const rotateSideAlong = (point, angle) => ({
  side: point.side * Math.cos(angle) - point.along * Math.sin(angle),
  along: point.side * Math.sin(angle) + point.along * Math.cos(angle),
});

spec.solveRocker = function (tappetLift) {
  const pivot = spec.rockerPivot;
  const cupFromPivot = { side: spec.pushrodCupAtRest.side - pivot.side, along: spec.pushrodCupAtRest.along - pivot.along };
  const pushrodBottom = { side: spec.camSide, along: spec.pushrodBottomAtRest + tappetLift };
  const pushrodLengthError = angle => {
    const cup = rotateSideAlong(cupFromPivot, angle);
    return Math.hypot(pivot.side + cup.side - pushrodBottom.side, pivot.along + cup.along - pushrodBottom.along) - spec.pushrodLength;
  };
  let low = -0.05, high = 0.6;
  for (let iteration = 0; iteration < 60; iteration++) {
    const middle = (low + high) / 2;
    if (pushrodLengthError(middle) < 0) low = middle;
    else high = middle;
  }
  const angle = (low + high) / 2;
  const padFromPivot = rotateSideAlong({ side: spec.rockerPadAtRest.side - pivot.side, along: spec.rockerPadAtRest.along - pivot.along }, angle);
  const cup = rotateSideAlong(cupFromPivot, angle);
  return {
    angle,
    valveLift: spec.rockerPadAtRest.along - (pivot.along + padFromPivot.along),
    cup: { side: pivot.side + cup.side, along: pivot.along + cup.along },
    pushrodBottom,
  };
};

const ROCKER_TABLE_STEPS = 400;
const rockerTable = [];
for (let k = 0; k <= ROCKER_TABLE_STEPS; k++) rockerTable.push(spec.solveRocker(spec.camLift * k / ROCKER_TABLE_STEPS));

spec.rockerForTappetLift = function (tappetLift) {
  const position = Math.max(0, Math.min(1, tappetLift / spec.camLift)) * ROCKER_TABLE_STEPS;
  const index = Math.min(ROCKER_TABLE_STEPS - 1, Math.floor(position)), fraction = position - index;
  const a = rockerTable[index], b = rockerTable[index + 1];
  return { angle: a.angle + (b.angle - a.angle) * fraction, valveLift: a.valveLift + (b.valveLift - a.valveLift) * fraction };
};
spec.maxValveLift = spec.rockerForTappetLift(spec.camLift).valveLift;
spec.valveLift = (cylinder, side, crankAngle) => spec.rockerForTappetLift(spec.tappetLift(cylinder, side, crankAngle)).valveLift;
spec.liftAtCyclePhase = (side, phaseDeg) => spec.rockerForTappetLift(spec.tappetLiftAtCyclePhase(side, phaseDeg)).valveLift;

Object.assign(spec, {
  gearX: 375,
  gearWidth: 24,
  gearModule: 4,
  gears: {
    crank: { teeth: 24, y: 0, z: 0 },
    idler: { teeth: 30, y: 0, z: 0 },
    cam: { teeth: 48, y: spec.camY, z: 0 },
    pump: { teeth: 48, y: 0, z: 0 },
  },
  frontGear: { x: -377, teeth: 46, oilPumpY: -184 },
});

spec.meshPhase = function (phase1, teeth1, center1, center2, teeth2) {
  const toSecond = Math.atan2(center2.z - center1.z, center2.y - center1.y), toFirst = toSecond + Math.PI;
  const toothFraction = positiveModulo((toSecond - phase1) / (TAU / teeth1), 1);
  return toFirst - (0.5 - toothFraction) * TAU / teeth2;
};

(function placeGears() {
  const gears = spec.gears;
  const radius = name => spec.gearModule * gears[name].teeth / 2;
  const crankToIdler = radius('crank') + radius('idler'), idlerToCam = radius('idler') + radius('cam');
  const idlerY = (crankToIdler * crankToIdler - idlerToCam * idlerToCam + spec.camY * spec.camY) / (2 * spec.camY);
  gears.idler.y = idlerY;
  gears.idler.z = -Math.sqrt(crankToIdler * crankToIdler - idlerY * idlerY);
  gears.pump.y = spec.camY + radius('cam') + radius('pump');

  gears.crank.phase = Math.atan2(gears.idler.z, gears.idler.y);
  gears.idler.phase = spec.meshPhase(gears.crank.phase, gears.crank.teeth, gears.crank, gears.idler, gears.idler.teeth);
  gears.cam.phase = spec.meshPhase(gears.idler.phase, gears.idler.teeth, gears.idler, gears.cam, gears.cam.teeth);
  gears.pump.phase = spec.meshPhase(gears.cam.phase, gears.cam.teeth, gears.cam, gears.pump, gears.pump.teeth);
})();
spec.gearSpeedRatio = { crank: 1, idler: -spec.gears.crank.teeth / spec.gears.idler.teeth, cam: spec.camSpeedRatio, pump: -spec.camSpeedRatio };

spec.injectionPump = {
  x0: -110, x1: 190,
  rowAngle: 37.5 * DEG,
  baseRadius: 22, lift: 8, halfWidth: 70 * DEG, peakDeg: 372,
  plungerX: [-55, -15, 25, 65].map(x => x + 10),
  lobeWidth: 14, plungerRadius: 6, tappetRadius: 13,
};
spec.injection = { start: 344, end: 368 };
spec.isInjecting = phaseDeg => phaseDeg >= spec.injection.start && phaseDeg <= spec.injection.end;

spec.plungerPosition = function (cylinder) {
  const { throwIndex, bank } = spec.cylinders[cylinder], pump = spec.injectionPump;
  return {
    x: pump.plungerX[throwIndex] + (bank === 'right' ? -12 : 12),
    rowAngle: bank === 'right' ? -pump.rowAngle : pump.rowAngle,
  };
};

spec.pumpLobeAngle = function (cylinder) {
  const crankAngleAtPeak = positiveModulo(spec.injectionPump.peakDeg - spec.cycleOffsetDeg[cylinder], 720) * DEG;
  return spec.plungerPosition(cylinder).rowAngle + spec.camSpeedRatio * crankAngleAtPeak;
};

spec.plungerLiftLaw = function (camAngle) {
  const pump = spec.injectionPump, u = wrapToPi(camAngle) / pump.halfWidth;
  if (Math.abs(u) >= 1) return 0;
  const w = 1 - u * u;
  return pump.lift * w * w;
};

spec.plungerLiftSlope = function (camAngle) {
  const pump = spec.injectionPump, u = wrapToPi(camAngle) / pump.halfWidth;
  if (Math.abs(u) >= 1) return 0;
  return -4 * pump.lift * u * (1 - u * u) / pump.halfWidth;
};

spec.pumpLobeProfile = function (pointCount) {
  const count = pointCount || 200;
  const points = [];
  for (let k = 0; k < count; k++) {
    const angle = -Math.PI + TAU * k / count;
    const radius = spec.injectionPump.baseRadius + spec.plungerLiftLaw(angle), slope = spec.plungerLiftSlope(angle);
    points.push([radius * Math.cos(angle) - slope * Math.sin(angle), radius * Math.sin(angle) + slope * Math.cos(angle)]);
  }
  return points;
};
spec.plungerLift = (cylinder, crankAngle) =>
  spec.plungerLiftLaw(spec.pumpLobeAngle(cylinder) - spec.camSpeedRatio * crankAngle - spec.plungerPosition(cylinder).rowAngle);

Object.assign(spec, {
  beltX: -470,
  fanY: 262,
  fanSlip: 0.97,
  vBeltPulleys: [
    { name: 'alternator', u: 150, v: -232, radius: 40, side: 1 },
    { name: 'fan', u: 262, v: 0, radius: 95, side: 1 },
    { name: 'crank', u: 0, v: 0, radius: 95, side: 1 },
  ],
});
spec.vBeltPath = () => Belt.layout(spec.vBeltPulleys);

if (typeof module !== 'undefined' && module.exports) module.exports = spec;
root.EngineSpecs = Object.assign(root.EngineSpecs || {}, { v8: spec });
})(typeof window !== 'undefined' ? window : globalThis);
