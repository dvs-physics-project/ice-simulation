/*
 * V-образный дизель: газораспределение OHV — распредвал в развале блока, толкатели, штанги, коромысла,
 * по два клапана на цилиндр (впускной и выпускной) с двумя пружинами каждый.
 *
 *   valvetrain(context) → { camshaft, instanced, fixed, portMesh, ports, lifts, update(crankAngle) }
 *     camshaft  — распредвал, вращается с половиной скорости коленвала;
 *     instanced — клапаны, толкатели, штанги, коромысла, винты, пружины, тарелки, сухари (InstancedMesh);
 *     fixed     — оси коромысел со стойками, направляющие втулки, колпачки, шайбы пружин;
 *     ports     — средние линии впускных и выпускных каналов головки (для частиц газа);
 *     lifts     — подъём клапанов: [впуск цил. 1…8, выпуск цил. 1…8].
 *
 * Цепочка движения: кулачок поднимает толкатель на spec.tappetLift; штанга упирается в толкатель снизу
 * и в винт коромысла сверху; коромысло поворачивается на угол из spec.rockerForTappetLift, и его носок
 * опускает клапан. Штанга наклоняется так, чтобы соединять свои две опоры.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Vector3 = THREE.Vector3;
const Banks = window.CylinderBanks;
const builders = window.EngineBuilders.v8;
const SIDES = ['intake', 'exhaust'];

function rockerGeometry(spec) {
  const pivot = spec.rockerPivot;
  const cup = { side: spec.pushrodCupAtRest.side - pivot.side, along: spec.pushrodCupAtRest.along - pivot.along };
  const pad = { side: spec.rockerPadAtRest.side - pivot.side, along: spec.rockerPadAtRest.along - pivot.along };
  const outline = [];
  for (let k = 0; k <= 10; k++) {
    const angle = Math.PI * (1.18 + 0.64 * k / 10);
    outline.push([pad.side + spec.rockerPadRadius * Math.cos(angle), pad.along + spec.rockerPadRadius * Math.sin(angle)]);
  }
  outline.push([pad.side + 14, pad.along - 4.5], [-16, -7.5], [-11, -13.5], [0, -16.5], [11, -13.5], [18, -9], [cup.side - 9, cup.along + 7.5],
    [cup.side + 1, cup.along + 6], [cup.side + 9, cup.along + 7.5], [cup.side + 11.5, cup.along + 13.5], [cup.side + 9, cup.along + 20],
    [cup.side - 2, cup.along + 21], [16, 11.5], [9, 16.5], [0, 17.5], [-9, 16.5], [-17, 11.5], [pad.side + 16, pad.along + 4.5],
    [pad.side + 4, pad.along + 8.5], [pad.side - 4, pad.along + 7.5]);
  const shape = Geometry.polygonShape(outline.map(([side, along]) => [along, side]));
  shape.holes.push(Geometry.circleHole(0, 0, 11.6, true));
  const body = Geometry.extrudeAlongX(shape, -8, 8, { curveSegments: 18, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 1 });

  const screw = Geometry.mergeGeometries([
    new THREE.CylinderGeometry(5, 5, 32, 16).translate(0, cup.along + 15, cup.side),
    Geometry.hexPrism(15, 6.5).translate(0, cup.along + 21.5, cup.side),
    new THREE.CylinderGeometry(4.2, 4.2, 4, 14).translate(0, cup.along + 32, cup.side),
    new THREE.SphereGeometry(6, 18, 12).translate(0, cup.along, cup.side),
  ]);
  return { body: Geometry.mergeGeometries([body, Geometry.tubeAlongX(11.6, 17, -12, 12, 40)]), screw };
}

function camshaft(spec, materials, tag) {
  const group = new THREE.Group();
  group.position.set(0, spec.camY, 0);
  const core = [Geometry.cylinderAlongX(17, -352, 352, 32), Geometry.cylinderAlongX(33, -361, -354, 48), Geometry.cylinderAlongX(20, 352, 388, 36)];
  const polished = spec.mainJournalX.map((x, journal) => Geometry.cylinderAlongX(spec.camJournalRadius, x - (journal === 0 ? 18 : 15), x + 15, 48));
  const lobeShapes = {
    intake: Geometry.polygonShape(spec.lobeProfile(spec.camHalfWidth.intake, 240)),
    exhaust: Geometry.polygonShape(spec.lobeProfile(spec.camHalfWidth.exhaust, 240)),
  };
  spec.cylinders.forEach((cylinder, index) => {
    for (const side of SIDES) {
      const x = spec.valveX(index, side);
      const lobe = new THREE.ExtrudeGeometry(lobeShapes[side], { depth: spec.lobeWidth, bevelEnabled: false, curveSegments: 1 });
      lobe.rotateZ(spec.lobeAngle(index, side));
      lobe.translate(0, 0, x - spec.lobeWidth / 2);
      Geometry.shapeToYZ(lobe);
      polished.push(lobe);
    }
  });
  const boltHead = Geometry.hexPrism(24, 7);
  Geometry.rotateToX(boltHead);
  boltHead.translate(391, 0, 0);
  [
    [Geometry.mergeGeometries(core), materials.solid.camshaft],
    [Geometry.mergeGeometries(polished), materials.solid.camLobe],
    [Geometry.mergeGeometries([boltHead, Geometry.tubeAlongX(8, 22, 388.5, 391, 32)]), materials.solid.noseBolt],
  ].forEach(([geometry, material]) => {
    const mesh = tag(new THREE.Mesh(geometry, material), 'camshaft', 'valvetrain');
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

function tappetGeometry(spec) {
  const R = spec.tappetFaceRadius, stem = spec.tappetStemRadius, L = spec.tappetLength;
  return Geometry.lathe([[0, 0], [R - 0.6, 0], [R, 0.6], [R, 4], [R - 2.5, 5.5], [stem + 1, 9], [stem, 12], [stem, L + 2.2],
    [stem - 1.6, L + 3.4], [6.6, L + 3.4], [6.2, L], [5.83, L - 2.12], [4.75, L - 3.99], [3.1, L - 5.37], [0, L - 6.2]], 28, 0, undefined, true);
}

function pushrodGeometry(spec) {
  const L = spec.pushrodLength;
  const tube = new THREE.CylinderGeometry(4.6, 4.6, L - 13, 14, 1, true);
  tube.translate(0, (L - 13) / 2 + 4, 0);
  return Geometry.mergeGeometries([
    new THREE.SphereGeometry(6, 18, 12),
    tube,
    Geometry.lathe([[4.6, L - 9], [6.5, L - 7.5], [8.6, L - 4.5], [8.6, L + 1.5], [6.4, L + 1.5], [6.25, L],
      [5.4, L - 3.1], [3.1, L - 5.4], [0, L - 6.25]], 22, 0, undefined, true),
  ]);
}

function valveGeometry(spec, side) {
  const R = spec.valveHeadRadius[side], length = spec.valveLength, stem = 5;
  const profile = [[0, 0], [R - 0.5, 0], [R, 0.6], [R, 2.4], [R - 3.2, 5.2]];
  for (let k = 1; k <= 9; k++) {
    const t = k / 9;
    profile.push([(R - 3.2) + (stem - (R - 3.2)) * (1 - Math.pow(1 - t, 2.4)), 5.2 + 22 * t]);
  }
  profile.push([stem, length - 10], [stem - 0.8, length - 9.2], [stem - 0.8, length - 7.6], [stem, length - 6.8], [stem, length - 0.6], [stem - 0.6, length], [0, length]);
  return Geometry.lathe(profile, 36);
}

function rockerSupportsAndGuides(spec, materials, tag) {
  const pivot = spec.rockerPivot;
  const pedestal = new THREE.Shape();
  pedestal.moveTo(spec.headTop - pivot.along, -16);
  pedestal.lineTo(0, -16);
  pedestal.absarc(0, 0, 16, -Math.PI / 2, Math.PI / 2, false);
  pedestal.lineTo(spec.headTop - pivot.along, 16);
  pedestal.closePath();
  pedestal.holes.push(Geometry.circleHole(0, 0, 11.05, true));

  const pieces = { shafts: [], pedestals: [], bolts: [], guides: [], springSeats: [], seals: [] };
  spec.cylinders.forEach((cylinder, index) => {
    const rotation = Banks.rotation(spec, index);
    const placed = geometry => {
      Geometry.applyQuaternion(geometry, rotation);
      return geometry.translate(cylinder.x, 0, 0);
    };
    pieces.shafts.push(placed(Geometry.cylinderAlongX(11, -60, 60, 28).translate(0, pivot.along, pivot.side)));
    for (const x of [-52, 52]) {
      pieces.pedestals.push(placed(Geometry.extrudeAlongX(pedestal, x - 8, x + 8, { curveSegments: 14 }).translate(0, pivot.along, pivot.side)));
      pieces.bolts.push(placed(Geometry.hexPrism(15, 7).translate(x, pivot.along + 16, pivot.side)));
      pieces.shafts.push(placed(Geometry.tubeAlongX(11, 15, -0.8, 0.8, 24).translate(x > 0 ? 43 : -43, pivot.along, pivot.side)));
    }
    for (const side of SIDES) {
      const localX = side === 'intake' ? -spec.valveOffsetX : spec.valveOffsetX;
      pieces.guides.push(placed(Geometry.lathe([[5.05, 0], [8, 0], [8, 70], [7, 71], [5.05, 71]], 24, 0, undefined, true)
        .translate(localX, spec.springSeatDistance - 58, spec.valveSide)));
      pieces.springSeats.push(placed(Geometry.lathe([[8.6, 0], [21, 0], [21, 1.6], [8.6, 1.6], [8.6, 0]], 40, 0, undefined, true)
        .translate(localX, spec.springSeatDistance, spec.valveSide)));
      pieces.seals.push(placed(Geometry.lathe([[5.2, 0], [9.2, 0], [9.2, 6], [6.6, 8.5], [5.2, 8.5], [5.2, 0]], 24, 0, undefined, true)
        .translate(localX, spec.springSeatDistance + 13, spec.valveSide)));
    }
  });

  const rubber = new THREE.MeshStandardMaterial({ color: materials.srgb('#16181b'), roughness: 0.65, metalness: 0 });
  return [
    [pieces.shafts, materials.solid.rockerShaft, 'rocker'],
    [pieces.pedestals, materials.hardware.aluminium, 'rocker'],
    [pieces.bolts, materials.hardware.steel, 'rocker'],
    [pieces.guides, materials.hardware.steel, 'head'],
    [pieces.springSeats, materials.solid.retainer, 'springs'],
    [pieces.seals, rubber, 'head'],
  ].map(([geometries, material, part]) => {
    const mesh = tag(new THREE.Mesh(Geometry.mergeGeometries(geometries), material), part, 'valvetrain');
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  });
}

function gasPorts(spec, materials, tag) {
  const curves = { intake: [], exhaust: [] }, tubes = [];
  const curveThrough = (cylinder, points) => new THREE.CatmullRomCurve3(
    points.map(([localX, along, side]) => Banks.point(spec, cylinder, localX, along, side)), false, 'centripetal');
  const intakeX = -spec.valveOffsetX, exhaustX = spec.valveOffsetX, seat = spec.valveSeatDistance + 6;
  spec.cylinders.forEach((cylinder, index) => {
    const intakePoints = [[-54, 468, 172], [-54, 468, 140], [-53, 466, 112], [-46, 460, 80], [-36, 450, 50], [intakeX, 436, 26], [intakeX, seat, spec.valveSide]];
    const exhaustPoints = [[exhaustX, seat, spec.valveSide], [exhaustX, 436, 12], [33, 452, -24], [34, 462, -62], [34, 466, -95], [34, 466, -128]];
    curves.intake.push(curveThrough(index, intakePoints));
    curves.exhaust.push(curveThrough(index, exhaustPoints));
    tubes.push(new THREE.TubeGeometry(curveThrough(index, intakePoints.slice(1)), 40, 16, 14, false));
    tubes.push(new THREE.TubeGeometry(curveThrough(index, exhaustPoints.slice(0, 5)), 36, 14.5, 14, false));
  });
  const mesh = new THREE.Mesh(Geometry.mergeGeometries(tubes), materials.ghost.ports);
  mesh.renderOrder = 2;
  return { curves, mesh: tag(mesh, 'head', 'housing') };
}

function valvetrain({ spec, materials, tag }) {
  const solid = materials.solid;
  const instanced = [];
  const instances = (geometry, material, part, count) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tag(mesh, part, 'valvetrain');
    mesh.castShadow = mesh.receiveShadow = true;
    instanced.push(mesh);
    return mesh;
  };
  const springFreeHeight = spec.springTopDistance - spec.springSeatDistance - 1.6;
  const rocker = rockerGeometry(spec);
  const valves = {
    intake: instances(valveGeometry(spec, 'intake'), solid.valveIn, 'valveIn', 8),
    exhaust: instances(valveGeometry(spec, 'exhaust'), solid.valveEx, 'valveEx', 8),
  };
  const tappets = instances(tappetGeometry(spec), solid.tappet, 'tappet', 16);
  const pushrods = instances(pushrodGeometry(spec), solid.pushrod, 'pushrod', 16);
  const rockers = instances(rocker.body, solid.rocker, 'rocker', 16);
  const screws = instances(rocker.screw, solid.adjScrew, 'rocker', 16);
  const outerSprings = instances(Geometry.coilSpring(16.5, 2.3, 5.4, springFreeHeight, 1, 6, 16), solid.spring, 'springs', 16);
  const innerSprings = instances(Geometry.coilSpring(11, 1.7, 7.2, springFreeHeight, -1, 5, 16), solid.spring, 'springs', 16);
  const retainers = instances(Geometry.lathe([[6.4, -7], [8.2, -7], [9.8, -1.5], [19.6, 0], [19.6, 1.8], [16, 2.6], [10.5, 5.5], [7.8, 5.5], [6.4, -7]],
    40, 0, undefined, true), solid.retainer, 'springs', 16);
  const keepers = instances(Geometry.lathe([[5.05, -6.5], [6.35, -6.5], [7.75, 4.8], [5.05, 4.8], [5.05, -6.5]], 24, 0, undefined, true),
    solid.adjScrew, 'springs', 16);

  const camshaftGroup = camshaft(spec, materials, tag);
  const fixed = rockerSupportsAndGuides(spec, materials, tag);
  const ports = gasPorts(spec, materials, tag);
  const bankRotations = spec.cylinders.map((cylinder, index) => Banks.rotation(spec, index));

  const lifts = new Float32Array(16);
  const pivot = spec.rockerPivot;
  const cupFromPivot = { side: spec.pushrodCupAtRest.side - pivot.side, along: spec.pushrodCupAtRest.along - pivot.along };
  const matrix = new THREE.Matrix4(), position = new Vector3(), unitScale = new Vector3(1, 1, 1), springScale = new Vector3(1, 1, 1);
  const tilt = new THREE.Quaternion(), tilted = new THREE.Quaternion(), axisX = new Vector3(1, 0, 0);

  function update(crankAngle) {
    camshaftGroup.rotation.x = spec.camSpeedRatio * crankAngle;
    spec.cylinders.forEach((cylinder, index) => {
      const rotation = bankRotations[index];
      for (const side of SIDES) {
        const k = (side === 'intake' ? 0 : 8) + index;
        const localX = side === 'intake' ? -spec.valveOffsetX : spec.valveOffsetX;
        const inRow = (along, sideOffset) => Banks.point(spec, index, localX, along, sideOffset, position);
        const tappetLift = spec.tappetLift(index, side, crankAngle);
        const rockerState = spec.rockerForTappetLift(tappetLift);
        const lift = rockerState.valveLift;
        lifts[k] = lift;

        inRow(spec.valveSeatDistance - lift, spec.valveSide);
        valves[side].setMatrixAt(index, matrix.compose(position, rotation, unitScale));

        inRow(spec.springSeatDistance + 1.6, spec.valveSide);
        springScale.set(1, (springFreeHeight - lift) / springFreeHeight, 1);
        matrix.compose(position, rotation, springScale);
        outerSprings.setMatrixAt(k, matrix);
        innerSprings.setMatrixAt(k, matrix);

        inRow(spec.springTopDistance - lift, spec.valveSide);
        matrix.compose(position, rotation, unitScale);
        retainers.setMatrixAt(k, matrix);
        keepers.setMatrixAt(k, matrix);

        inRow(spec.camAlong + spec.camBaseRadius + tappetLift, spec.camSide);
        tappets.setMatrixAt(k, matrix.compose(position, rotation, unitScale));

        const bottomSide = spec.camSide, bottomAlong = spec.pushrodBottomAtRest + tappetLift;
        const angle = rockerState.angle;
        const cupSide = pivot.side + cupFromPivot.side * Math.cos(angle) - cupFromPivot.along * Math.sin(angle);
        const cupAlong = pivot.along + cupFromPivot.side * Math.sin(angle) + cupFromPivot.along * Math.cos(angle);
        inRow(bottomAlong, bottomSide);
        tilt.setFromAxisAngle(axisX, Math.atan2(cupSide - bottomSide, cupAlong - bottomAlong));
        pushrods.setMatrixAt(k, matrix.compose(position, tilted.copy(rotation).multiply(tilt), unitScale));

        inRow(pivot.along, pivot.side);
        tilt.setFromAxisAngle(axisX, -angle);
        matrix.compose(position, tilted.copy(rotation).multiply(tilt), unitScale);
        rockers.setMatrixAt(k, matrix);
        screws.setMatrixAt(k, matrix);
      }
    });
    instanced.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
  }

  return { camshaft: camshaftGroup, instanced, fixed, portMesh: ports.mesh, ports: ports.curves, lifts, update };
}

builders.valvetrain = valvetrain;
})();
