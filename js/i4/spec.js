/*
 * Рядный четырёхцилиндровый двигатель: размеры по чертежу (мм) и кинематика всех подвижных деталей.
 * Ось X — вдоль коленчатого вала, Y — вверх по оси цилиндров, Z — поперёк (впуск при z < 0, выпуск при z > 0).
 *
 *   cyclePhaseDeg(cylinder, crankDeg)       — угол рабочего цикла цилиндра (0…720°, 360° — ВМТ вспышки)
 *   pistonPosition(cylinder, crankAngle)    — положение шатунной шейки, поршня и угол шатуна (точные формулы КШМ)
 *   liftLaw(camAngle)                       — подъём толкателя по углу кулачка: h = H(1 − u²)²
 *   lobeProfile(points)                     — контур кулачка, который даёт этот закон для плоского толкателя
 *   valveLift(cylinder, side, crankAngle)   — подъём клапана в данный момент
 *   liftAtCyclePhase(side, phaseDeg)        — подъём клапана по углу цикла (для графика фаз)
 *   pulleys(tensionerAngle, pumpShift)      — шкивы ремня ГРМ на плоскости сечения
 *   solveBelt()                             — положение насоса и натяжителя, при котором ремень ровно 137 зубьев
 *
 * Сторона клапана: INTAKE = −1 (впуск), EXHAUST = +1 (выпуск) — это же знак координаты z.
 */
(function (root) {
'use strict';

const isNode = typeof require === 'function';
const { DEG, TAU, positiveModulo, wrapToPi } = isNode ? require('../shared/math.js') : root.EngineMath;
const Belt = isNode ? require('../shared/belt.js') : root.Belt;

const INTAKE = -1, EXHAUST = 1;

const spec = {
  id: 'i4',
  INTAKE, EXHAUST,
  bore: 72,
  stroke: 69,
  crankRadius: 34.5,
  rodLength: 122,
  compressionRatio: 10.5,
  cylinderCount: 4,
  cylinderPitch: 86,
  compressionHeight: 33,
  deckY: 190,
  gasketThickness: 1.2,
  pistonRadius: 35.9,
  pistonHeight: 52,
  pinDiameter: 18,
  mainJournalDiameter: 48,
  mainJournalWidth: 20,
  crankpinDiameter: 42,
  crankpinWidth: 24,
  webThickness: 16,
  counterweightRadius: 62,
  counterweightHalfAngle: 64 * DEG,
  pinBossRadius: 28,
  rodBigEndBore: 45,
  blockFrontX: -182,
  blockRearX: 182,
  crankThrowAngle: [0, Math.PI, Math.PI, 0],
  firingOrder: [1, 3, 4, 2],
};

spec.cylinderX = [-1.5, -0.5, 0.5, 1.5].map(k => k * spec.cylinderPitch);
spec.mainJournalX = [-2, -1, 0, 1, 2].map(k => k * spec.cylinderPitch);
spec.headFaceY = spec.deckY + spec.gasketThickness;
spec.webInnerOffset = spec.crankpinWidth / 2;
spec.displacementCm3 = Math.PI * spec.bore ** 2 / 4 * spec.stroke * spec.cylinderCount / 1000;

spec.cycleOffsetDeg = [0, 0, 0, 0];
spec.firingOrder.forEach((cylinderNumber, position) => {
  spec.cycleOffsetDeg[cylinderNumber - 1] = positiveModulo(360 - 180 * position, 720);
});

spec.cyclePhaseDeg = (cylinder, crankDeg) => positiveModulo(crankDeg + spec.cycleOffsetDeg[cylinder], 720);

spec.pistonPosition = function (cylinder, crankAngle) {
  const angle = crankAngle + spec.crankThrowAngle[cylinder];
  const crankpinY = spec.crankRadius * Math.cos(angle);
  const crankpinZ = spec.crankRadius * Math.sin(angle);
  const pinY = crankpinY + Math.sqrt(spec.rodLength * spec.rodLength - crankpinZ * crankpinZ);
  return {
    crankAngleFromAxis: angle,
    crankpinY, crankpinZ, pinY,
    crownY: pinY + spec.compressionHeight,
    travel: spec.crankRadius + spec.rodLength - pinY,
    rodAngle: Math.atan2(-crankpinZ, pinY - crankpinY),
  };
};

Object.assign(spec, {
  valveTilt: 28 * DEG,
  valveSeatZ: 20,
  valveOffsetX: 18.5,
  camDistance: 121,
  camBaseRadius: 17.5,
  camLift: 8.0,
  camHalfWidth: 75 * DEG,
  lobeWidth: 15,
  valveHeadRadius: { [INTAKE]: 13.5, [EXHAUST]: 11.5 },
  stemRadius: 2.75,
  tappetRadius: 15,
  tappetHeight: 22,
  springSeatDistance: 50,
  springTopDistance: 92,
  peakDeg: { [INTAKE]: 105, [EXHAUST]: 615 },
});
spec.valveSeatY = spec.headFaceY + 12.2;
spec.camY = spec.valveSeatY + spec.camDistance * Math.cos(spec.valveTilt);
spec.camZ = spec.valveSeatZ + spec.camDistance * Math.sin(spec.valveTilt);
spec.tappetTopDistance = spec.camDistance - spec.camBaseRadius;
spec.valveLength = spec.tappetTopDistance - 4;

spec.valveAxis = side => ({ y: Math.cos(spec.valveTilt), z: side * Math.sin(spec.valveTilt) });
spec.followerAngle = side => Math.atan2(-side * Math.sin(spec.valveTilt), -Math.cos(spec.valveTilt));

spec.liftLaw = function (camAngle) {
  const u = wrapToPi(camAngle) / spec.camHalfWidth;
  if (Math.abs(u) >= 1) return 0;
  const w = 1 - u * u;
  return spec.camLift * w * w;
};

spec.liftLawSlope = function (camAngle) {
  const u = wrapToPi(camAngle) / spec.camHalfWidth;
  if (Math.abs(u) >= 1) return 0;
  return -4 * spec.camLift * u * (1 - u * u) / spec.camHalfWidth;
};

spec.lobeProfile = function (pointCount) {
  const count = pointCount || 220;
  const points = [];
  for (let k = 0; k < count; k++) {
    const angle = -Math.PI + TAU * k / count;
    const radius = spec.camBaseRadius + spec.liftLaw(angle);
    const slope = spec.liftLawSlope(angle);
    points.push([
      radius * Math.cos(angle) - slope * Math.sin(angle),
      radius * Math.sin(angle) + slope * Math.cos(angle),
    ]);
  }
  return points;
};

spec.lobeAngle = function (cylinder, side) {
  const crankAngleAtPeak = positiveModulo(spec.peakDeg[side] - spec.cycleOffsetDeg[cylinder], 720) * DEG;
  return spec.followerAngle(side) - crankAngleAtPeak / 2;
};

spec.valveLift = (cylinder, side, crankAngle) =>
  spec.liftLaw(spec.lobeAngle(cylinder, side) + crankAngle / 2 - spec.followerAngle(side));

spec.liftAtCyclePhase = (side, phaseDeg) => spec.liftLaw((phaseDeg - spec.peakDeg[side]) * DEG / 2);

Object.assign(spec, {
  beltX: -218,
  beltWidth: 25,
  beltPitch: 8,
  beltBackThickness: 1.8,
  beltToothOffset: 0.7,
  beltToothHeight: 3.4,
  teeth: { crank: 23, cam: 46, pump: 19 },
  pumpPosition: { u: 134, v: 74 },
  tensioner: { pivot: { u: 172, v: -60 }, armLength: 74, rollerRadius: 28, preferredAngle: -60 * DEG },
});

spec.pitchRadius = teeth => teeth * spec.beltPitch / Math.PI / 2;

spec.pulleys = function (tensionerAngle, pumpShift) {
  const { pivot, armLength, rollerRadius } = spec.tensioner;
  return [
    { name: 'crank', u: 0, v: 0, radius: spec.pitchRadius(spec.teeth.crank), side: 1 },
    { name: 'tensioner', u: pivot.u + armLength * Math.cos(tensionerAngle), v: pivot.v + armLength * Math.sin(tensionerAngle),
      radius: rollerRadius, side: -1 },
    { name: 'camIntake', u: spec.camY, v: -spec.camZ, radius: spec.pitchRadius(spec.teeth.cam), side: 1 },
    { name: 'camExhaust', u: spec.camY, v: spec.camZ, radius: spec.pitchRadius(spec.teeth.cam), side: 1 },
    { name: 'pump', u: spec.pumpPosition.u, v: spec.pumpPosition.v + (pumpShift || 0), radius: spec.pitchRadius(spec.teeth.pump), side: 1 },
  ];
};

spec.solveBelt = function () {
  const pitch = spec.beltPitch;
  const tensioner = spec.tensioner;
  const tensionerTakeUp = 1.2;

  const withoutTensioner = pumpShift => spec.pulleys(0, pumpShift).filter(pulley => pulley.name !== 'tensioner');
  const lengthWithoutTensioner = pumpShift => {
    const path = Belt.layout(withoutTensioner(pumpShift));
    return path ? path.length : NaN;
  };

  const shortestLength = lengthWithoutTensioner(0);
  const teethCount = Math.ceil((shortestLength + tensionerTakeUp) / pitch);
  const wantedLength = teethCount * pitch;

  let pumpShift = 0;
  if (wantedLength - tensionerTakeUp > shortestLength) {
    let low = 0, high = 40;
    if (!(lengthWithoutTensioner(high) > wantedLength - tensionerTakeUp)) {
      throw new Error('насос не может выбрать свободную длину ремня');
    }
    for (let iteration = 0; iteration < 60; iteration++) {
      const middle = (low + high) / 2;
      if (lengthWithoutTensioner(middle) < wantedLength - tensionerTakeUp) low = middle;
      else high = middle;
    }
    pumpShift = (low + high) / 2;
  }

  const freePath = Belt.layout(withoutTensioner(pumpShift));
  const slackSpan = freePath.pieces[1];
  const spanNormal = { u: slackSpan.directionV, v: -slackSpan.directionU };
  const deflectionAt = angle => {
    const rollerU = tensioner.pivot.u + tensioner.armLength * Math.cos(angle);
    const rollerV = tensioner.pivot.v + tensioner.armLength * Math.sin(angle);
    const distanceToSpan = (rollerU - slackSpan.start.u) * spanNormal.u + (rollerV - slackSpan.start.v) * spanNormal.v;
    return tensioner.rollerRadius - distanceToSpan;
  };
  const lengthAt = angle => {
    const deflection = deflectionAt(angle);
    if (!(deflection > 0.2 && deflection < 25)) return NaN;
    const path = Belt.layout(spec.pulleys(angle, pumpShift));
    return path ? path.length : NaN;
  };

  const tensionerAngle = Belt.findTensionerAngle({
    lengthAt, wantedLength, fromDeg: -179, toDeg: 180, stepDeg: 0.25, preferredAngle: tensioner.preferredAngle,
  });
  if (tensionerAngle === null) throw new Error('не удалось подобрать целое число зубьев ремня');

  const pulleys = spec.pulleys(tensionerAngle, pumpShift);
  return {
    tensionerAngle, teethCount, pumpShift, pulleys,
    path: Belt.layout(pulleys),
    freeLength: freePath.length,
    deflection: deflectionAt(tensionerAngle),
  };
};

if (typeof module !== 'undefined' && module.exports) module.exports = spec;
root.EngineSpecs = Object.assign(root.EngineSpecs || {}, { i4: spec });
})(typeof window !== 'undefined' ? window : globalThis);
