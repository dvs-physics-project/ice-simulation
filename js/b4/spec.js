/*
 * Оппозитный четырёхцилиндровый двигатель («боксер»): размеры по четырём листам чертежа (мм) и кинематика.
 * Ось X — вдоль вала; цилиндры лежат горизонтально: правый ряд (цилиндры 1, 3) смотрит в −Z, левый (2, 4) в +Z.
 * Точки внутри ряда задаются координатами «вдоль оси цилиндра» (along) и «вбок» (side) — см. pointInBank.
 *
 *   pistonPosition(cylinder, crankAngle)  — шатунная шейка, расстояние до пальца, ход поршня, угол шатуна
 *   cyclePhaseDeg(cylinder, crankDeg)     — угол рабочего цикла цилиндра
 *
 * Газораспределение SOHC с коромыслами. Задан закон угла коромысла φ(угол кулачка) = φmax(1 − u²)²;
 * клапан опускается шаровой опорой регулировочного винта, а кулачок строится как огибающая площадки
 * коромысла (lobeProfile), поэтому подъём клапана в точности следует из геометрии рычага:
 *   rockerAngleLaw(side, camAngle), padLineAt(side, φ), adjusterBallAt(side, φ), valveLiftForRocker(side, φ)
 *   valveLift(cylinder, side, crankAngle), liftAtCyclePhase(side, phaseDeg)
 *
 * Ремень ГРМ: восемь шкивов и роликов, solveBelt подбирает угол натяжителя под целое число зубьев (201).
 */
(function (root) {
'use strict';

const isNode = typeof require === 'function';
const { DEG, TAU, positiveModulo, wrapToPi, rotate2d } = isNode ? require('../shared/math.js') : root.EngineMath;
const Belt = isNode ? require('../shared/belt.js') : root.Belt;

const spec = {
  id: 'b4',
  bore: 83,
  stroke: 83,
  crankRadius: 41.5,
  rodLength: 143.5,
  compressionHeight: 32.5,
  compressionRatio: 10,
  cylinderPitch: 108,
  crankpinX: [-81, -27, 27, 81],
  mainJournalX: [-108, -54, 0, 54, 108],
  mainJournalDiameter: 60,
  mainJournalWidth: 19,
  crankpinDiameter: 52,
  crankpinWidth: 21,
  webThickness: 7,
  rodWidth: 20,
  rodBigEndBore: 55,
  pistonRadius: 41.3,
  pistonHeight: 50,
  pinOuterDiameter: 23,
  pinInnerDiameter: 14,
  deckDistance: 218,
  gasketThickness: 1.2,
  blockSpanX: [-136, 132],
  oilPumpSpanX: [-150, -136],
  flywheelX: 160,
  headSpanX: { right: [-149, 118], left: [-149, 158] },
  camJournalX: { right: [-130, -27, 78], left: [-120, 27, 135] },
  camEndX: { right: 104, left: 150 },
  crankpinAngle: [-90, 90, 90, -90].map(degrees => degrees * DEG),
  firingOrder: [1, 3, 2, 4],
};
spec.combustionFace = spec.deckDistance + spec.gasketThickness;
spec.displacementCm3 = Math.PI * spec.bore ** 2 / 4 * spec.stroke * 4 / 1000;

spec.cylinders = [0, 1, 2, 3].map(index => {
  const right = index % 2 === 0;
  return {
    number: index + 1, index,
    bank: right ? 'right' : 'left',
    axisAngle: (right ? -90 : 90) * DEG,
    x: spec.crankpinX[index],
    sign: right ? 1 : -1,
  };
});

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
  const { axisAngle } = spec.cylinders[cylinder];
  const throwAngle = spec.crankpinAngle[cylinder] + crankAngle;
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

spec.cycleOffsetDeg = [0, 0, 0, 0];
spec.firingOrder.forEach((cylinderNumber, position) => {
  spec.cycleOffsetDeg[cylinderNumber - 1] = positiveModulo(360 - 180 * position, 720);
});
spec.cyclePhaseDeg = (cylinder, crankDeg) => positiveModulo(crankDeg + spec.cycleOffsetDeg[cylinder], 720);

Object.assign(spec, {
  roofRidgeHeight: 13.5,
  camAlong: 316,
  camSide: 0,
  camSpeedRatio: 0.5,
  camBaseRadius: 18,
  camJournalRadius: 13.5,
  lobeWidth: 12,
  camHalfWidth: 76 * DEG,
  peakDeg: { intake: 108, exhaust: 612 },
  stemRadius: 3,
  adjusterBallRadius: 4,
  rockerShaftRadius: 8,
  springSeatDistance: 62,
  springTopDistance: 106,
  pocketDepth: 2.6,
  sparkPlugAngle: 24 * DEG,
  valves: {
    intake: { rockerSign: 1, tilt: 22 * DEG, seatSide: 17, offsetX: 18, headRadius: 16.5, length: 116,
      rockerShaft: { along: 347, side: 22.5 }, padNormalAngle: -8 * DEG, maxRockerAngle: 13.4 * DEG, lobeOffsetX: 27 },
    exhaust: { rockerSign: -1, tilt: 17 * DEG, seatSide: -16, offsetX: 18, headRadius: 14, length: 116,
      rockerShaft: { along: 347, side: -22.5 }, padNormalAngle: -4 * DEG, maxRockerAngle: 16.9 * DEG, lobeOffsetX: 10 },
  },
});
spec.roofRidgeDistance = spec.combustionFace + spec.roofRidgeHeight;
spec.sparkPlugTip = [spec.roofRidgeDistance - 2.2, 0];

['intake', 'exhaust'].forEach(side => {
  const valve = spec.valves[side];
  valve.axis = [Math.cos(valve.tilt), valve.rockerSign * Math.sin(valve.tilt)];
  valve.seat = [spec.roofRidgeDistance - Math.abs(valve.seatSide) * Math.tan(valve.tilt), valve.seatSide];
  valve.tip = [valve.seat[0] + valve.length * valve.axis[0], valve.seat[1] + valve.length * valve.axis[1]];
  valve.ball = [valve.tip[0] + spec.adjusterBallRadius * valve.axis[0], valve.tip[1] + spec.adjusterBallRadius * valve.axis[1]];
  valve.padNormal = [Math.cos(valve.padNormalAngle), Math.sin(valve.padNormalAngle)];
  valve.padCenter = [spec.camAlong + spec.camBaseRadius * valve.padNormal[0], spec.camSide + spec.camBaseRadius * valve.padNormal[1]];
});

spec.rockerAngleLaw = function (side, camAngle) {
  const u = wrapToPi(camAngle) / spec.camHalfWidth;
  if (Math.abs(u) >= 1) return 0;
  const w = 1 - u * u;
  return spec.valves[side].maxRockerAngle * w * w;
};

spec.rockerAngleSlope = function (side, camAngle) {
  const u = wrapToPi(camAngle) / spec.camHalfWidth;
  if (Math.abs(u) >= 1) return 0;
  return -4 * spec.valves[side].maxRockerAngle * u * (1 - u * u) / spec.camHalfWidth;
};

spec.padLineAt = function (side, rockerAngle) {
  const valve = spec.valves[side];
  const pivot = [valve.rockerShaft.along, valve.rockerShaft.side];
  const turn = valve.rockerSign * rockerAngle;
  const normal = rotate2d(valve.padNormal, turn);
  const offset = rotate2d([valve.padCenter[0] - pivot[0], valve.padCenter[1] - pivot[1]], turn);
  const center = [pivot[0] + offset[0], pivot[1] + offset[1]];
  return { normal, center, distance: normal[0] * (center[0] - spec.camAlong) + normal[1] * (center[1] - spec.camSide) };
};

spec.adjusterBallAt = function (side, rockerAngle) {
  const valve = spec.valves[side];
  const pivot = [valve.rockerShaft.along, valve.rockerShaft.side];
  const offset = rotate2d([valve.ball[0] - pivot[0], valve.ball[1] - pivot[1]], valve.rockerSign * rockerAngle);
  return [pivot[0] + offset[0], pivot[1] + offset[1]];
};

spec.valveLiftForRocker = function (side, rockerAngle) {
  const valve = spec.valves[side];
  const ball = spec.adjusterBallAt(side, rockerAngle);
  return -((ball[0] - valve.ball[0]) * valve.axis[0] + (ball[1] - valve.ball[1]) * valve.axis[1]);
};

spec.lobeProfile = function (side, pointCount) {
  const count = pointCount || 360;
  const valve = spec.valves[side];
  const points = [];
  for (let k = 0; k < count; k++) {
    const camAngle = -Math.PI + TAU * k / count;
    const rocker = spec.rockerAngleLaw(side, camAngle);
    const rockerSlope = spec.rockerAngleSlope(side, camAngle);
    const normalAngle = valve.padNormalAngle + valve.rockerSign * rocker - camAngle;
    const normalAngleSlope = valve.rockerSign * rockerSlope - 1;
    const distance = spec.padLineAt(side, rocker).distance;
    const epsilon = 1e-6;
    const distancePerRocker = (spec.padLineAt(side, rocker + epsilon).distance - spec.padLineAt(side, rocker - epsilon).distance) / (2 * epsilon);
    const tangentShift = distancePerRocker * rockerSlope / normalAngleSlope;
    points.push([
      distance * Math.cos(normalAngle) - tangentShift * Math.sin(normalAngle),
      distance * Math.sin(normalAngle) + tangentShift * Math.cos(normalAngle),
    ]);
  }
  return points;
};

spec.crankAngleAtPeak = (cylinder, side) => positiveModulo(spec.peakDeg[side] - spec.cycleOffsetDeg[cylinder], 720) * DEG;
spec.camAngleFromPeak = (cylinder, side, crankAngle) => spec.camSpeedRatio * (crankAngle - spec.crankAngleAtPeak(cylinder, side));
spec.rockerAngleAt = (cylinder, side, crankAngle) => spec.rockerAngleLaw(side, spec.camAngleFromPeak(cylinder, side, crankAngle));

const LIFT_TABLE_STEPS = 600;
const liftTable = { intake: [], exhaust: [] };
['intake', 'exhaust'].forEach(side => {
  for (let k = 0; k <= LIFT_TABLE_STEPS; k++) {
    liftTable[side].push(spec.valveLiftForRocker(side, spec.valves[side].maxRockerAngle * k / LIFT_TABLE_STEPS));
  }
});

spec.valveLiftFromRockerAngle = function (side, rockerAngle) {
  const position = Math.max(0, Math.min(1, rockerAngle / spec.valves[side].maxRockerAngle)) * LIFT_TABLE_STEPS;
  const index = Math.min(LIFT_TABLE_STEPS - 1, Math.floor(position));
  const fraction = position - index;
  return liftTable[side][index] + (liftTable[side][index + 1] - liftTable[side][index]) * fraction;
};
spec.maxValveLift = { intake: liftTable.intake[LIFT_TABLE_STEPS], exhaust: liftTable.exhaust[LIFT_TABLE_STEPS] };
spec.valveLift = (cylinder, side, crankAngle) => spec.valveLiftFromRockerAngle(side, spec.rockerAngleAt(cylinder, side, crankAngle));
spec.liftAtCyclePhase = (side, phaseDeg) =>
  spec.valveLiftFromRockerAngle(side, spec.rockerAngleLaw(side, (phaseDeg - spec.peakDeg[side]) * DEG * spec.camSpeedRatio));
spec.valveOffsetAlongX = (side, rear) => (rear ? 1 : -1) * spec.valves[side].offsetX;
spec.lobeOffsetAlongX = (side, rear) => (rear ? 1 : -1) * spec.valves[side].lobeOffsetX;

Object.assign(spec, {
  beltX: -165,
  beltWidth: 24,
  beltPitch: 9.525,
  beltBackThickness: 2.0,
  beltToothOffset: 0.8,
  beltToothHeight: 3.6,
  teeth: { crank: 22, cam: 44, pump: 24 },
  idlerRadius: 34.5,
  tensionerRadius: 38.5,
  tensioner: { pivot: { u: 40.3, v: 39.8 }, armLength: 53.6, preferredAngle: 132 * DEG },
});

spec.pitchRadius = teeth => teeth * spec.beltPitch / Math.PI / 2;

spec.pulleys = function (tensionerAngle) {
  const { pivot, armLength } = spec.tensioner;
  const camRadius = spec.pitchRadius(spec.teeth.cam);
  return [
    { name: 'camRight', u: 0, v: -spec.camAlong, radius: camRadius, side: 1 },
    { name: 'idler1', u: -25.4, v: -78.5, radius: spec.idlerRadius, side: -1 },
    { name: 'crank', u: 0, v: 0, radius: spec.pitchRadius(spec.teeth.crank), side: 1 },
    { name: 'tensioner', u: pivot.u + armLength * Math.cos(tensionerAngle), v: pivot.v + armLength * Math.sin(tensionerAngle),
      radius: spec.tensionerRadius, side: -1 },
    { name: 'camLeft', u: 0, v: spec.camAlong, radius: camRadius, side: 1 },
    { name: 'idler3', u: -58.8, v: 162.0, radius: spec.idlerRadius, side: -1 },
    { name: 'pump', u: -91.8, v: 94.1, radius: spec.pitchRadius(spec.teeth.pump), side: 1 },
    { name: 'idler2', u: -112.7, v: -89.9, radius: spec.idlerRadius, side: -1 },
  ];
};

spec.solveBelt = function () {
  const lengthAt = angle => {
    const path = Belt.layout(spec.pulleys(angle));
    return path ? path.length : NaN;
  };
  const teethCount = Math.round(lengthAt(spec.tensioner.preferredAngle) / spec.beltPitch);
  const tensionerAngle = Belt.findTensionerAngle({
    lengthAt, wantedLength: teethCount * spec.beltPitch, fromDeg: 60, toDeg: 220, stepDeg: 0.25,
    preferredAngle: spec.tensioner.preferredAngle,
  });
  if (tensionerAngle === null) throw new Error('ремень: ни при каком угле натяжителя не получается целое число зубьев');
  const pulleys = spec.pulleys(tensionerAngle);
  return { tensionerAngle, teethCount, pulleys, path: Belt.layout(pulleys) };
};

if (typeof module !== 'undefined' && module.exports) module.exports = spec;
root.EngineSpecs = Object.assign(root.EngineSpecs || {}, { b4: spec });
})(typeof window !== 'undefined' ? window : globalThis);
