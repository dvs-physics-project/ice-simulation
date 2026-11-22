/*
 * Оппозитный двигатель: газораспределение SOHC — по одному распредвалу на ряд, клапаны открываются коромыслами.
 *
 *   valvetrain(context, belt) → { camshafts, instanced, fixed, portMeshes, ports, lifts, update(crankAngle) }
 *     camshafts  — два распредвала со шкивами ремня, вращаются с половиной скорости коленвала;
 *     instanced  — клапаны, пружины, тарелки, сухари, коромысла и регулировочные винты (InstancedMesh);
 *     fixed      — оси коромысел с опорами, направляющие втулки, колпачки, опорные шайбы пружин;
 *     ports      — средние линии впускных и выпускных каналов (по ним летят частицы газа);
 *     lifts      — подъём всех 16 клапанов: [впуск цил.1 перед, впуск цил.1 зад, …, выпуск …].
 *
 * Коромысло поворачивается вокруг своей оси на угол spec.rockerAngleAt, его шаровой винт давит на клапан,
 * и клапан опускается на spec.valveLiftFromRockerAngle. Площадка коромысла (rockerOutlines) делается
 * такой ширины, чтобы точка касания с кулачком за весь оборот не сходила с неё (padContactRange).
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Vector3 = THREE.Vector3;
const builders = window.EngineBuilders.b4;
const Banks = window.CylinderBanks;
const SIDES = ['intake', 'exhaust'];
const BANKS = ['right', 'left'];
const HUB_RADIUS = 11.5, SHAFT_BORE_RADIUS = 8.2, PAD_DEPTH = 5.5;

const cylindersOf = (spec, bank) => spec.cylinders.filter(cylinder => cylinder.bank === bank).map(cylinder => cylinder.index);
const headPart = bank => (bank === 'right' ? 'headR' : 'headL');
const sectionShape = (bank, points) => Geometry.polygonShape(points.map(([along, side]) => builders.sectionPoint(bank, along, side)));

function padContactRange(spec, side) {
  const valve = spec.valves[side];
  let lowest = Infinity, highest = -Infinity;
  for (let k = 0; k < 720; k++) {
    const camAngle = -Math.PI + 2 * Math.PI * k / 720;
    const rocker = spec.rockerAngleLaw(side, camAngle), rockerSlope = spec.rockerAngleSlope(side, camAngle), epsilon = 1e-6;
    const distanceSlope = (spec.padLineAt(side, rocker + epsilon).distance - spec.padLineAt(side, rocker - epsilon).distance) / (2 * epsilon);
    const contactShift = distanceSlope * rockerSlope / (valve.rockerSign * rockerSlope - 1);
    const pad = spec.padLineAt(side, rocker), tangent = [-pad.normal[1], pad.normal[0]];
    const offset = contactShift - ((pad.center[0] - spec.camAlong) * tangent[0] + (pad.center[1] - spec.camSide) * tangent[1]);
    lowest = Math.min(lowest, offset);
    highest = Math.max(highest, offset);
  }
  return [lowest, highest];
}

function rockerOutlines(spec, side) {
  const valve = spec.valves[side];
  const pivot = [valve.rockerShaft.along, valve.rockerShaft.side];
  const [lowest, highest] = padContactRange(spec, side);
  const padStart = lowest - 1.6, padEnd = highest + 1.6;
  const tangent = [-valve.padNormal[1], valve.padNormal[0]];
  const padPoint = (t, depth) => [
    valve.padCenter[0] + t * tangent[0] + depth * valve.padNormal[0] - pivot[0],
    valve.padCenter[1] + t * tangent[1] + depth * valve.padNormal[1] - pivot[1],
  ];
  const padFace = padPoint(0, 0);
  const aboveFace = point => (point[0] - padFace[0]) * valve.padNormal[0] + (point[1] - padFace[1]) * valve.padNormal[1];
  const cutBelowPadFace = polygon => {
    const result = [];
    for (let k = 0; k < polygon.length; k++) {
      const a = polygon[k], b = polygon[(k + 1) % polygon.length], da = aboveFace(a), db = aboveFace(b);
      if (da >= 0) result.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return result;
  };
  const pad = [padPoint(padStart, 0), padPoint(padEnd, 0), padPoint(padEnd, PAD_DEPTH), padPoint(padStart, PAD_DEPTH)];
  const padArm = cutBelowPadFace(Geometry.convexHull(pad.concat(Geometry.circlePoints([0, 0], HUB_RADIUS, 48))));

  const ball = [valve.ball[0] - pivot[0], valve.ball[1] - pivot[1]];
  const axis = valve.axis, across = [-axis[1], axis[0]];
  const screwBoss = [];
  for (const distance of [3, 15]) {
    for (const offset of [-6.5, 6.5]) {
      screwBoss.push([ball[0] + distance * axis[0] + offset * across[0], ball[1] + distance * axis[1] + offset * across[1]]);
    }
  }
  const valveArm = Geometry.convexHull(screwBoss.concat(Geometry.circlePoints([0, 0], 10.5, 48)));
  return { padArm, valveArm, ball, axisAngle: Math.atan2(axis[1], axis[0]) };
}

function camshaft(spec, materials, tag, bank, toothPhase) {
  const solid = materials.solid;
  const group = new THREE.Group();
  group.position.set(0, spec.camSide, (bank === 'right' ? -1 : 1) * spec.camAlong);
  const beltX = spec.beltX, pulleyRadius = spec.pitchRadius(spec.teeth.cam);
  const headStart = spec.headSpanX[bank][0], camEnd = spec.camEndX[bank], journals = spec.camJournalX[bank];

  const core = [
    Geometry.cylinderAlongX(15, beltX - 13, headStart + 6, 36),
    Geometry.cylinderAlongX(11.5, headStart + 6, camEnd, 32),
    Geometry.cylinderAlongX(19, journals[0] - 12.5, journals[0] - 9.5, 40),
    Geometry.cylinderAlongX(13, camEnd - 2, camEnd + 3, 32),
  ];
  const polished = journals.map(x => Geometry.cylinderAlongX(spec.camJournalRadius, x - 9, x + 9, 44));
  for (const cylinder of cylindersOf(spec, bank)) {
    const { x, sign } = spec.cylinders[cylinder];
    for (const side of SIDES) {
      const outline = Geometry.polygonShape(spec.lobeProfile(side, 240).map(([along, across]) => builders.sectionPoint(bank, along, across)));
      for (const rear of [false, true]) {
        const lobeX = x + sign * spec.lobeOffsetAlongX(side, rear);
        const lobe = Geometry.extrudeAlongX(outline, lobeX - spec.lobeWidth / 2, lobeX + spec.lobeWidth / 2, { curveSegments: 1 });
        lobe.rotateX(-spec.camSpeedRatio * spec.crankAngleAtPeak(cylinder, side));
        polished.push(lobe);
      }
    }
  }
  const add = (geometry, material, part, layer, castShadow) => {
    const mesh = tag(new THREE.Mesh(geometry, material), part, layer);
    if (castShadow) mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(Geometry.mergeGeometries(core), solid.camshaft, 'camshaft', 'valvetrain', true);
  add(Geometry.mergeGeometries(polished), solid.camLobe, 'camshaft', 'valvetrain', true);

  const holes = [Geometry.circleHole(0, 0, 15, true)];
  for (let k = 0; k < 6; k++) {
    const angle = (k + 0.5) / 6 * Math.PI * 2;
    holes.push(Geometry.circleHole(40 * Math.cos(angle), 40 * Math.sin(angle), 10.5, true));
  }
  add(Geometry.mergeGeometries([
    Geometry.extrudeAlongX(Geometry.timingPulleyShape(spec.teeth.cam, pulleyRadius, { phase: toothPhase, holes }), beltX - 13, beltX + 13, { curveSegments: 24 }),
    Geometry.tubeAlongX(56, pulleyRadius + 4.5, beltX - 14.6, beltX - 13, 96),
    Geometry.tubeAlongX(56, pulleyRadius + 4.5, beltX + 13, beltX + 14.6, 96),
    Geometry.tubeAlongX(15, 24, beltX - 13, beltX + 20, 40),
  ]), solid.camPulley, 'camPulley', 'timing', true);

  const boltHead = Geometry.hexPrism(19, 8);
  Geometry.rotateToX(boltHead);
  boltHead.translate(beltX - 24.5, 0, 0);
  add(Geometry.mergeGeometries([Geometry.tubeAlongX(0, 17, beltX - 16.5, beltX - 13, 36), boltHead]), solid.noseBolt, 'camPulley', 'timing', false);

  const arrow = new THREE.Shape();
  arrow.moveTo(pulleyRadius + 4.2, -3);
  arrow.lineTo(pulleyRadius + 4.2, 3);
  arrow.lineTo(pulleyRadius - 3, 0);
  arrow.closePath();
  add(Geometry.extrudeAlongX(arrow, beltX - 15.2, beltX - 14.5), builders.markMaterial(), 'camPulley', 'timing', false);
  return group;
}

function valveGeometry(spec, side) {
  const { headRadius: R, length } = spec.valves[side], stem = spec.stemRadius;
  const profile = [[0, 0], [R - 0.5, 0], [R, 0.6], [R, 1.7], [R - 2.8, 4.5]];
  for (let k = 1; k <= 9; k++) {
    const t = k / 9;
    profile.push([(R - 2.8) + (stem - (R - 2.8)) * (1 - Math.pow(1 - t, 2.4)), 4.5 + 17 * t]);
  }
  profile.push([stem, length - 9], [stem - 0.6, length - 8.4], [stem - 0.6, length - 6.6], [stem, length - 6], [stem, length - 0.5], [stem - 0.5, length], [0, length]);
  return Geometry.lathe(profile, 36);
}

function rockerGeometries(spec, side) {
  const outlines = rockerOutlines(spec, side);
  const lobeToValve = spec.lobeOffsetAlongX(side, true) - spec.valveOffsetAlongX(side, true);
  const withShaftBore = points => {
    const shape = Geometry.polygonShape(points);
    shape.holes.push(Geometry.circleHole(0, 0, SHAFT_BORE_RADIUS, true));
    return shape;
  };
  const padShape = withShaftBore(outlines.padArm), armShape = withShaftBore(outlines.valveArm);

  const rockers = [false, true].map(rear => {
    const span = (from, to) => (rear ? [from, to] : [-to, -from]);
    const [padFrom, padTo] = lobeToValve > 0 ? span(lobeToValve - 3.5, lobeToValve + 5.5) : span(lobeToValve - 5, lobeToValve + 5);
    const [hubFrom, hubTo] = lobeToValve > 0 ? span(-5, lobeToValve - 3.5) : span(lobeToValve + 5, 4.5);
    const [armFrom, armTo] = lobeToValve > 0 ? span(-5, 5) : span(-5, 4.5);
    const screwBoss = new THREE.CylinderGeometry(6.8, 6.8, 12, 24);
    screwBoss.translate(0, 9, 0);
    screwBoss.rotateX(outlines.axisAngle);
    screwBoss.translate(0, outlines.ball[0], outlines.ball[1]);
    return Geometry.mergeGeometries([
      Geometry.extrudeAlongX(padShape, padFrom, padTo, { curveSegments: 12 }),
      Geometry.tubeAlongX(SHAFT_BORE_RADIUS, HUB_RADIUS, hubFrom, hubTo, 40),
      Geometry.extrudeAlongX(armShape, armFrom, armTo, { curveSegments: 12, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 1 }),
      screwBoss,
    ]);
  });

  const screwShank = new THREE.CylinderGeometry(4, 4, 24, 16);
  screwShank.translate(0, 12, 0);
  const lockNut = Geometry.hexPrism(11, 5);
  lockNut.translate(0, 15.4, 0);
  const screw = Geometry.mergeGeometries([new THREE.SphereGeometry(4.2, 16, 10), screwShank, lockNut]);
  screw.rotateX(outlines.axisAngle);
  screw.translate(0, outlines.ball[0], outlines.ball[1]);
  return { rockers, screw };
}

function rockerShaftSupports(spec, materials, tag) {
  const intakeShaft = spec.valves.intake.rockerShaft, exhaustShaft = spec.valves.exhaust.rockerShaft;
  const holderOutline = Geometry.convexHull([
    ...Geometry.circlePoints([spec.camAlong, spec.camSide], 21, 40),
    ...Geometry.circlePoints([intakeShaft.along, intakeShaft.side], 13, 32),
    ...Geometry.circlePoints([exhaustShaft.along, exhaustShaft.side], 13, 32),
    [296, -30], [296, 30],
  ]);
  const meshes = [];
  const add = (geometry, material) => {
    const mesh = tag(new THREE.Mesh(geometry, material), 'rockerShaft', 'valvetrain');
    mesh.castShadow = mesh.receiveShadow = true;
    meshes.push(mesh);
  };
  for (const bank of BANKS) {
    const [x0, x1] = spec.headSpanX[bank];
    const shafts = [intakeShaft, exhaustShaft].map(shaft => {
      const geometry = Geometry.cylinderAlongX(spec.rockerShaftRadius, x0 + 10, x1 - 10, 28);
      const [y, z] = builders.sectionPoint(bank, shaft.along, shaft.side);
      return geometry.translate(0, y, z);
    });
    const holderShape = sectionShape(bank, holderOutline);
    for (const [along, side, radius] of [[spec.camAlong, spec.camSide, spec.camJournalRadius + 0.15],
      [intakeShaft.along, intakeShaft.side, spec.rockerShaftRadius + 0.05], [exhaustShaft.along, exhaustShaft.side, spec.rockerShaftRadius + 0.05]]) {
      const [y, z] = builders.sectionPoint(bank, along, side);
      holderShape.holes.push(Geometry.circleHole(y, z, radius, true));
    }
    const holders = [], bolts = [];
    spec.camJournalX[bank].forEach(x => {
      holders.push(Geometry.extrudeAlongX(holderShape, x - 8, x + 8, { curveSegments: 14 }));
      for (const side of [-9, 9]) {
        const bolt = Geometry.hexPrism(12, 6);
        bolt.rotateX(bank === 'right' ? -Math.PI / 2 : Math.PI / 2);
        const [y, z] = builders.sectionPoint(bank, intakeShaft.along + 13, side);
        bolt.translate(x, y, z);
        bolts.push(bolt);
      }
    });
    add(Geometry.mergeGeometries(shafts), materials.solid.rockerShaft);
    add(Geometry.mergeGeometries(holders), materials.hardware.aluminium);
    add(Geometry.mergeGeometries(bolts), materials.hardware.steel);
  }
  return meshes;
}

function valveGuidesAndSeals(spec, materials, tag) {
  const rubber = new THREE.MeshStandardMaterial({ color: materials.srgb('#16181b'), roughness: 0.65, metalness: 0 });
  const guides = { right: [], left: [] }, seals = { right: [], left: [] }, springSeats = [];
  spec.cylinders.forEach((cylinder, index) => {
    for (const side of SIDES) {
      const valve = spec.valves[side];
      const rotation = Banks.rotation(spec, index, valve.rockerSign * valve.tilt);
      for (const rear of [false, true]) {
        const offsetX = spec.valveOffsetAlongX(side, rear);
        const placeOnValveAxis = (geometry, distance) => {
          Geometry.applyQuaternion(geometry, rotation);
          const point = Banks.point(spec, index, offsetX, valve.seat[0] + distance * valve.axis[0], valve.seat[1] + distance * valve.axis[1]);
          return geometry.translate(point.x, point.y, point.z);
        };
        guides[cylinder.bank].push(placeOnValveAxis(Geometry.lathe([[3.05, 0], [6.2, 0], [6.2, 40], [5.4, 41], [3.05, 41]], 20, 0, undefined, true), 32));
        springSeats.push(placeOnValveAxis(Geometry.lathe([[6.4, 0], [14.2, 0], [14.2, 1.5], [6.4, 1.5], [6.4, 0]], 32, 0, undefined, true), spec.springSeatDistance));
        seals[cylinder.bank].push(placeOnValveAxis(Geometry.lathe([[3.1, 0], [7, 0], [7, 5], [5, 7.5], [3.1, 7.5], [3.1, 0]], 20, 0, undefined, true), 73));
      }
    }
  });
  const meshes = [];
  const add = (geometry, material, part) => {
    const mesh = tag(new THREE.Mesh(geometry, material), part, 'valvetrain');
    mesh.castShadow = mesh.receiveShadow = true;
    meshes.push(mesh);
  };
  for (const bank of BANKS) {
    add(Geometry.mergeGeometries(guides[bank]), materials.hardware.steel, headPart(bank));
    add(Geometry.mergeGeometries(seals[bank]), rubber, headPart(bank));
  }
  add(Geometry.mergeGeometries(springSeats), materials.solid.retainer, 'springs');
  return meshes;
}

function gasPorts(spec, materials, tag) {
  const intake = spec.valves.intake, exhaust = spec.valves.exhaust;
  const curves = { intake: [], exhaust: [] }, tubes = { right: [], left: [] };
  const curveThrough = (cylinder, points) => new THREE.CatmullRomCurve3(
    points.map(([offsetX, along, side]) => Banks.point(spec, cylinder, offsetX, along, side)), false, 'centripetal');

  spec.cylinders.forEach((cylinder, index) => {
    curves.intake.push([]);
    curves.exhaust.push([]);
    for (const rear of [false, true]) {
      const inX = spec.valveOffsetAlongX('intake', rear), exX = spec.valveOffsetAlongX('exhaust', rear);
      const intakePoints = [[0, 287, 86], [0, 285, 70], [inX * 0.45, 276, 53], [inX * 0.85, 259, 36], [inX, 243, 25],
        [inX, intake.seat[0] + 4 * intake.axis[0], intake.seat[1] + 4 * intake.axis[1]]];
      const exhaustPoints = [[exX, exhaust.seat[0] + 4 * exhaust.axis[0], exhaust.seat[1] + 4 * exhaust.axis[1]], [exX, 243, -25],
        [exX * 0.85, 256, -41], [exX * 0.4, 264, -62], [0, 266, -82], [0, 266, -96]];
      curves.intake[index].push(curveThrough(index, intakePoints));
      curves.exhaust[index].push(curveThrough(index, exhaustPoints));
      tubes[cylinder.bank].push(new THREE.TubeGeometry(curveThrough(index, intakePoints.slice(1)), 28, rear ? 12 : 12.2, 12, false));
      tubes[cylinder.bank].push(new THREE.TubeGeometry(curveThrough(index, exhaustPoints.slice(0, 5)), 28, 10.5, 12, false));
    }
    tubes[cylinder.bank].push(new THREE.TubeGeometry(curveThrough(index, [[0, 287, 88], [0, 286, 74], [0, 280, 60]]), 8, 17, 16, false));
    tubes[cylinder.bank].push(new THREE.TubeGeometry(curveThrough(index, [[0, 265, -70], [0, 266, -84], [0, 266, -97]]), 8, 15, 16, false));
  });
  const meshes = BANKS.map(bank => {
    const mesh = new THREE.Mesh(Geometry.mergeGeometries(tubes[bank]), materials.ghost.ports);
    mesh.renderOrder = 2;
    return tag(mesh, headPart(bank), 'housing');
  });
  return { curves, meshes };
}

function valvetrain({ spec, materials, tag }, belt) {
  const solid = materials.solid;
  const camshafts = BANKS.map(bank => camshaft(spec, materials, tag, bank, belt.toothPhase[bank === 'right' ? 'camRight' : 'camLeft']));

  const instanced = [];
  const instances = (geometry, material, part, count) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tag(mesh, part, 'valvetrain');
    mesh.castShadow = mesh.receiveShadow = true;
    instanced.push(mesh);
    return mesh;
  };
  const springFreeHeight = spec.springTopDistance - spec.springSeatDistance - 1.5;
  const valves = {
    intake: instances(valveGeometry(spec, 'intake'), solid.valveIn, 'valveIn', 8),
    exhaust: instances(valveGeometry(spec, 'exhaust'), solid.valveEx, 'valveEx', 8),
  };
  const springs = instances(Geometry.coilSpring(12.2, 1.9, 5.2, springFreeHeight, 1, 6, 18), solid.spring, 'springs', 16);
  const retainers = instances(Geometry.lathe([[3.6, -7], [6.2, -7], [7.6, -1.6], [15.6, -0.2], [15.6, 1.6], [12, 2.4], [7.4, 4.6], [3.6, 4.6], [3.6, -7]],
    36, 0, undefined, true), solid.retainer, 'springs', 16);
  const keepers = instances(Geometry.lathe([[3.05, -7], [4.6, -7], [5.6, 4], [3.05, 4], [3.05, -7]], 20, 0, undefined, true), solid.adjScrew, 'springs', 16);
  const rockers = {}, screws = {};
  for (const side of SIDES) {
    const geometries = rockerGeometries(spec, side);
    rockers[side] = geometries.rockers.map(geometry => instances(geometry, solid.rocker, 'rocker', 4));
    screws[side] = instances(geometries.screw, solid.adjScrew, 'rocker', 8);
  }

  const fixed = [...rockerShaftSupports(spec, materials, tag), ...valveGuidesAndSeals(spec, materials, tag)];
  const ports = gasPorts(spec, materials, tag);

  const bankRotations = spec.cylinders.map((cylinder, index) => Banks.rotation(spec, index));
  const valveRotations = {};
  for (const side of SIDES) {
    const valve = spec.valves[side];
    valveRotations[side] = spec.cylinders.map((cylinder, index) => Banks.rotation(spec, index, valve.rockerSign * valve.tilt));
  }

  const lifts = new Float32Array(16);
  const matrix = new THREE.Matrix4(), position = new Vector3(), unitScale = new Vector3(1, 1, 1), springScale = new Vector3(1, 1, 1);
  const rockerTurn = new THREE.Quaternion(), rockerRotation = new THREE.Quaternion(), axisX = new Vector3(1, 0, 0);

  function update(crankAngle) {
    camshafts.forEach(group => { group.rotation.x = spec.camSpeedRatio * crankAngle; });
    for (const side of SIDES) {
      const valve = spec.valves[side], firstIndex = side === 'intake' ? 0 : 8;
      const pointOnValveAxis = (cylinder, offsetX, distance) =>
        Banks.point(spec, cylinder, offsetX, valve.seat[0] + distance * valve.axis[0], valve.seat[1] + distance * valve.axis[1], position);
      for (let cylinder = 0; cylinder < 4; cylinder++) {
        const rockerAngle = spec.rockerAngleAt(cylinder, side, crankAngle);
        const lift = spec.valveLiftFromRockerAngle(side, rockerAngle);
        const valveRotation = valveRotations[side][cylinder];
        rockerTurn.setFromAxisAngle(axisX, valve.rockerSign * rockerAngle);
        rockerRotation.copy(bankRotations[cylinder]).multiply(rockerTurn);
        [false, true].forEach((rear, valveIndex) => {
          const k = cylinder * 2 + valveIndex, offsetX = spec.valveOffsetAlongX(side, rear);
          lifts[firstIndex + k] = lift;

          pointOnValveAxis(cylinder, offsetX, -lift);
          valves[side].setMatrixAt(k, matrix.compose(position, valveRotation, unitScale));

          pointOnValveAxis(cylinder, offsetX, spec.springSeatDistance + 1.5);
          springScale.set(1, (springFreeHeight - lift) / springFreeHeight, 1);
          springs.setMatrixAt(firstIndex + k, matrix.compose(position, valveRotation, springScale));

          pointOnValveAxis(cylinder, offsetX, spec.springTopDistance - lift);
          matrix.compose(position, valveRotation, unitScale);
          retainers.setMatrixAt(firstIndex + k, matrix);
          keepers.setMatrixAt(firstIndex + k, matrix);

          Banks.point(spec, cylinder, offsetX, valve.rockerShaft.along, valve.rockerShaft.side, position);
          matrix.compose(position, rockerRotation, unitScale);
          rockers[side][valveIndex].setMatrixAt(cylinder, matrix);
          screws[side].setMatrixAt(k, matrix);
        });
      }
    }
    instanced.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
  }

  return { camshafts, instanced, fixed, portMeshes: ports.meshes, ports: ports.curves, lifts, update };
}

builders.valvetrain = valvetrain;
})();
