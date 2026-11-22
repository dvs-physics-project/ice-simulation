/*
 * Рядный двигатель: газораспределение DOHC 16V.
 *
 *   valvetrain(context, belt) → { camshafts, bearingCaps, portMesh, ports, instanced, fixed, lifts, update(crankAngle) }
 *     camshafts  — впускной и выпускной распредвалы со шкивами ремня; вращаются с половиной скорости вала;
 *     instanced  — 16 клапанов, толкателей, шайб, пружин и тарелок (InstancedMesh: одна геометрия на все копии);
 *     ports      — средние линии впускных и выпускных каналов (по ним летят частицы газа);
 *     lifts      — текущий подъём всех 16 клапанов: [впуск цил.1 перед, впуск цил.1 зад, …, выпуск …].
 *
 * Клапан, толкатель и пружина двигаются вдоль оси клапана на величину spec.valveLift — подъём,
 * который даёт профиль кулачка.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Vector3 = THREE.Vector3;
const { INTAKE, EXHAUST } = window.EngineSpecs.i4;
const CAM_JOURNAL_X = [-172, -86, 0, 86, 172];

function camshaft(spec, materials, tag, side, toothPhase) {
  const solid = materials.solid;
  const group = new THREE.Group();
  group.position.set(0, spec.camY, side * spec.camZ);

  const core = [Geometry.cylinderAlongX(11, -205, 188, 28), Geometry.cylinderAlongX(10, -232, -205, 28)];
  const polished = CAM_JOURNAL_X.map((x, journal) => Geometry.cylinderAlongX(12.5, x - (journal === 0 ? 14 : 10), x + 10, 36));
  polished.push(Geometry.cylinderAlongX(17, -159, -156, 36));

  const lobeShape = Geometry.polygonShape(spec.lobeProfile(240));
  spec.cylinderX.forEach((cylinderX, cylinder) => {
    const lobeAngle = spec.lobeAngle(cylinder, side);
    for (const valve of [-1, 1]) {
      const x = cylinderX + valve * spec.valveOffsetX;
      const lobe = new THREE.ExtrudeGeometry(lobeShape, { depth: spec.lobeWidth, bevelEnabled: false, curveSegments: 1 });
      lobe.rotateZ(lobeAngle);
      lobe.translate(0, 0, x - spec.lobeWidth / 2);
      Geometry.shapeToYZ(lobe);
      polished.push(lobe);
    }
  });

  [new THREE.Mesh(Geometry.mergeGeometries(core), solid.camshaft), new THREE.Mesh(Geometry.mergeGeometries(polished), solid.camLobe)]
    .forEach(mesh => {
      tag(mesh, 'camshaft', 'valvetrain');
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    });

  const radius = spec.pitchRadius(spec.teeth.cam);
  const rim = Geometry.timingPulleyShape(spec.teeth.cam, radius, { phase: toothPhase, holes: [Geometry.circleHole(0, 0, radius - 9, true)] });
  const web = new THREE.Shape();
  web.absarc(0, 0, radius - 7, 0, Math.PI * 2, false);
  web.holes.push(Geometry.circleHole(0, 0, 10, true));
  for (let k = 0; k < 5; k++) {
    const angle = k / 5 * Math.PI * 2 + 0.3;
    web.holes.push(Geometry.circleHole(31 * Math.cos(angle), 31 * Math.sin(angle), 10.5, true));
  }
  const beltX = spec.beltX;
  const pulley = new THREE.Mesh(Geometry.mergeGeometries([
    Geometry.extrudeAlongX(rim, beltX - 13, beltX + 13, { curveSegments: 40 }),
    Geometry.extrudeAlongX(web, beltX - 4, beltX + 4, { curveSegments: 28 }),
    Geometry.tubeAlongX(10, 18, beltX - 10, beltX + 15, 40),
  ]), solid.camPulley);
  tag(pulley, 'camPulley', 'timing');
  pulley.castShadow = pulley.receiveShadow = true;
  group.add(pulley);

  const boltHead = Geometry.hexPrism(17, 8);
  Geometry.rotateToX(boltHead);
  boltHead.translate(beltX - 22, 0, 0);
  const bolt = new THREE.Mesh(Geometry.mergeGeometries([boltHead, Geometry.tubeAlongX(0, 15, beltX - 14, beltX - 10, 36)]), solid.camBolt);
  tag(bolt, 'camPulley', 'timing');
  group.add(bolt);
  return group;
}

function bearingCaps(spec) {
  const parts = [];
  for (const side of [INTAKE, EXHAUST]) {
    CAM_JOURNAL_X.forEach((x, journal) => {
      const width = journal === 0 ? 28 : 18;
      const shift = journal === 0 ? 4 : 0;
      const outline = new THREE.Shape();
      outline.moveTo(0, -25);
      outline.lineTo(0, -12.6);
      outline.absarc(0, 0, 12.6, -Math.PI / 2, Math.PI / 2, false);
      outline.lineTo(0, 25);
      outline.lineTo(17, 25);
      outline.quadraticCurveTo(23, 25, 23, 19);
      outline.lineTo(23, -19);
      outline.quadraticCurveTo(23, -25, 17, -25);
      outline.closePath();
      const cap = Geometry.extrudeAlongX(outline, x - width / 2 - shift, x + width / 2 - shift, { curveSegments: 14 });
      cap.translate(0, spec.camY, side * spec.camZ);
      parts.push(cap);
      for (const boltZ of [-17, 17]) {
        const bolt = Geometry.hexPrism(10, 6);
        bolt.translate(x - shift, spec.camY + 23, side * spec.camZ + boltZ);
        parts.push(bolt);
      }
    });
  }
  return Geometry.mergeGeometries(parts);
}

function valveGeometry(spec, side) {
  const headRadius = spec.valveHeadRadius[side], length = spec.valveLength, stem = spec.stemRadius;
  const profile = [[0, 0], [headRadius, 0], [headRadius, 1.2], [headRadius - 2.4, 3.6]];
  for (let k = 1; k <= 8; k++) {
    const t = k / 8;
    const radius = (headRadius - 2.4) + (stem - (headRadius - 2.4)) * (1 - Math.pow(1 - t, 2.2));
    profile.push([radius, 3.6 + 13 * t]);
  }
  profile.push([stem, length - 7], [stem - 0.55, length - 6.4], [stem - 0.55, length - 5.4], [stem, length - 4.8],
    [stem, length - 0.4], [stem - 0.4, length], [0, length]);
  return Geometry.lathe(profile, 32);
}

function valveParts(spec) {
  const { tappetRadius: R, tappetHeight: H } = spec;
  const springHeight = spec.springTopDistance - spec.springSeatDistance;
  return {
    tappet: Geometry.lathe([[0, 0], [R - 0.7, 0], [R, -0.7], [R, -H], [R - 1.3, -H], [R - 1.3, -4.2], [0, -4.2]], 40, 0, undefined, true),
    shim: Geometry.lathe([[0, 0.02], [12.2, 0.02], [12.2, 0.32], [0, 0.32]], 40, 0, undefined, true),
    outerSpring: Geometry.coilSpring(11.4, 1.65, 5.2, springHeight, 1, 7),
    innerSpring: Geometry.coilSpring(7.7, 1.2, 6.4, springHeight, -1, 6),
    retainer: Geometry.lathe([[2.4, -4.2], [3.6, -4.2], [5.6, 0], [13.4, 0], [13.4, 1.4], [10.8, 2.0],
      [6.6, 5.8], [3.3, 5.8], [2.4, -4.2]], 36, 0, undefined, true),
    springSeat: Geometry.lathe([[5.6, -1.2], [13.6, -1.2], [13.6, 0], [5.6, 0], [5.6, -1.2]], 36, 0, undefined, true),
    guide: Geometry.lathe([[spec.stemRadius + 0.05, 0], [5.4, 0], [5.4, 26], [spec.stemRadius + 0.05, 26]], 24, 0, undefined, true),
    seal: Geometry.lathe([[3.0, 0], [6.4, 0], [6.4, 5], [4.2, 6.5], [3.0, 6.5], [3.0, 0]], 24, 0, undefined, true),
  };
}

function portCurves(spec) {
  const curves = { [INTAKE]: [], [EXHAUST]: [] };
  const geometries = [];
  for (const side of [INTAKE, EXHAUST]) {
    const radius = side === INTAKE ? 11.5 : 10;
    const axis = spec.valveAxis(side);
    spec.cylinderX.forEach(x => {
      const pair = [];
      for (const valve of [-1, 1]) {
        const throat = new Vector3(x + valve * spec.valveOffsetX, spec.valveSeatY + 4.5 * axis.y, side * spec.valveSeatZ + 4.5 * axis.z);
        const curve = new THREE.CatmullRomCurve3([
          new Vector3(x + valve * 5, spec.headFaceY + 34, side * 112),
          new Vector3(x + valve * 7, spec.headFaceY + 33, side * 84),
          new Vector3(x + valve * 12, spec.headFaceY + 30, side * 58),
          new Vector3(x + valve * 17.5, spec.headFaceY + 24, side * 36),
          throat,
        ], false, 'centripetal');
        pair.push(curve);
        geometries.push(new THREE.TubeGeometry(curve, 36, radius, 14, false));
      }
      curves[side].push(pair);
    });
  }
  return { curves, geometry: Geometry.mergeGeometries(geometries) };
}

function valvetrain({ spec, materials, tag }, belt) {
  const solid = materials.solid;
  const camshafts = [INTAKE, EXHAUST].map(side =>
    camshaft(spec, materials, tag, side, belt.toothPhase[side === INTAKE ? 'camIntake' : 'camExhaust']));

  const caps = new THREE.Mesh(bearingCaps(spec), solid.camCap);
  tag(caps, 'head', 'housing');
  caps.castShadow = caps.receiveShadow = true;

  const shapes = valveParts(spec);
  const instanced = (geometry, material, part, count) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tag(mesh, part, 'valvetrain');
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  };
  const valves = {
    [INTAKE]: instanced(valveGeometry(spec, INTAKE), solid.valveIn, 'valveIn', 8),
    [EXHAUST]: instanced(valveGeometry(spec, EXHAUST), solid.valveEx, 'valveEx', 8),
  };
  const tappets = instanced(shapes.tappet, solid.tappet, 'tappet', 16);
  const shims = instanced(shapes.shim, solid.shim, 'tappet', 16);
  const outerSprings = instanced(shapes.outerSpring, solid.spring, 'springs', 16);
  const innerSprings = instanced(shapes.innerSpring, solid.spring, 'springs', 16);
  const retainers = instanced(shapes.retainer, solid.retainer, 'springs', 16);
  const rubber = new THREE.MeshStandardMaterial({ color: materials.srgb('#17191c'), roughness: 0.65, metalness: 0 });

  const valveList = [];
  const seats = [], guides = [], seals = [];
  for (const side of [INTAKE, EXHAUST]) {
    const axisDirection = spec.valveAxis(side);
    const axis = new Vector3(0, axisDirection.y, axisDirection.z);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), side * spec.valveTilt);
    spec.cylinderX.forEach((x, cylinder) => {
      for (const valve of [-1, 1]) {
        const seat = new Vector3(x + valve * spec.valveOffsetX, spec.valveSeatY, side * spec.valveSeatZ);
        const indexOnSide = cylinder * 2 + (valve > 0 ? 1 : 0);
        valveList.push({ side, cylinder, seat, axis, tilt, indexOnSide, index: (side === INTAKE ? 0 : 8) + indexOnSide });
        const placed = (geometry, distanceAlongAxis) => {
          const copy = geometry.clone();
          Geometry.applyQuaternion(copy, tilt);
          const point = seat.clone().addScaledVector(axis, distanceAlongAxis);
          copy.translate(point.x, point.y, point.z);
          return copy;
        };
        seats.push(placed(shapes.springSeat, spec.springSeatDistance));
        guides.push(placed(shapes.guide, spec.springSeatDistance - 24));
        seals.push(placed(shapes.seal, spec.springSeatDistance + 0.2));
      }
    });
  }
  const fixed = [
    tag(new THREE.Mesh(Geometry.mergeGeometries(seats), solid.retainer), 'springs', 'valvetrain'),
    tag(new THREE.Mesh(Geometry.mergeGeometries(guides), solid.guide), 'head', 'valvetrain'),
    tag(new THREE.Mesh(Geometry.mergeGeometries(seals), rubber), 'head', 'valvetrain'),
  ];

  const ports = portCurves(spec);
  const portMesh = new THREE.Mesh(ports.geometry, materials.ghost.ports);
  tag(portMesh, 'head', 'housing');
  portMesh.renderOrder = 2;

  const moving = [valves[INTAKE], valves[EXHAUST], tappets, shims, outerSprings, innerSprings, retainers];
  const springHeight = spec.springTopDistance - spec.springSeatDistance;
  const matrix = new THREE.Matrix4(), position = new Vector3(), springScale = new Vector3(1, 1, 1), noScale = new Vector3(1, 1, 1);
  const lifts = new Float32Array(16);

  function update(crankAngle) {
    camshafts.forEach(group => { group.rotation.x = crankAngle / 2; });
    for (const valve of valveList) {
      const lift = spec.valveLift(valve.cylinder, valve.side, crankAngle);
      lifts[valve.index] = lift;
      const placeAt = (distanceAlongAxis, scale) => {
        position.copy(valve.seat).addScaledVector(valve.axis, distanceAlongAxis);
        matrix.compose(position, valve.tilt, scale);
      };
      placeAt(-lift, noScale);
      valves[valve.side].setMatrixAt(valve.indexOnSide, matrix);
      placeAt(spec.tappetTopDistance - lift, noScale);
      tappets.setMatrixAt(valve.index, matrix);
      shims.setMatrixAt(valve.index, matrix);
      springScale.set(1, (springHeight - lift) / springHeight, 1);
      placeAt(spec.springSeatDistance, springScale);
      outerSprings.setMatrixAt(valve.index, matrix);
      innerSprings.setMatrixAt(valve.index, matrix);
      placeAt(spec.springTopDistance - lift, noScale);
      retainers.setMatrixAt(valve.index, matrix);
    }
    moving.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
  }

  return {
    camshafts, bearingCaps: caps, portMesh, fixed, lifts, update,
    instanced: moving,
    ports: { intake: ports.curves[INTAKE], exhaust: ports.curves[EXHAUST] },
  };
}

window.EngineBuilders.i4.valvetrain = valvetrain;
})();
