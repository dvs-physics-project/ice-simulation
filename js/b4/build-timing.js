/*
 * Оппозитный двигатель: зубчатый ремень ГРМ на восьми шкивах, три обводных ролика, натяжитель
 * с гидроупором, насос охлаждения, метки установки распредвалов и кожух ремня.
 *
 *   beltToothPhases(spec, solution) — где на ремне стоит первый зуб и как повернуть зубья шкивов,
 *                                     чтобы они попадали между зубьями ремня;
 *   timingBelt(context, belt) → { objects, cover, update(crankAngle) }
 *     При повороте вала на угол θ ремень сдвигается на дугу θ·R шкива коленвала; ролики и шкив насоса
 *     вращаются в отношении радиусов (ролики, которые ремень огибает спиной, — в обратную сторону).
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Belt = window.Belt;
const Vector3 = THREE.Vector3;
const builders = window.EngineBuilders.b4;

function beltToothPhases(spec, solution) {
  const path = solution.path;
  const arcOf = name => path.pieces.find(piece => piece.type === 'arc' && piece.pulley.name === name);
  const angleOnPulley = (arc, distance) => {
    const point = Belt.pointAt(path, distance);
    return Math.atan2(point.v - arc.pulley.v, point.u - arc.pulley.u);
  };
  const crankArc = arcOf('crank');
  const firstToothDistance = crankArc.startDistance + crankArc.length / 2;
  const toothPhase = { crank: angleOnPulley(crankArc, firstToothDistance) };
  for (const name of ['camRight', 'camLeft', 'pump']) {
    const arc = arcOf(name);
    const nearestTooth = Math.round((arc.startDistance + arc.length / 2 - firstToothDistance) / spec.beltPitch);
    toothPhase[name] = angleOnPulley(arc, firstToothDistance + nearestTooth * spec.beltPitch);
  }
  return { firstToothDistance, toothPhase };
}

function beltBand(spec, path) {
  const x0 = spec.beltX - spec.beltWidth / 2, x1 = spec.beltX + spec.beltWidth / 2;
  const samples = Math.round(path.length / 2);
  const ring = [];
  for (let k = 0; k < samples; k++) {
    const point = Belt.pointAt(path, k / samples * path.length);
    ring.push({
      inner: [point.u + point.normalU * spec.beltToothOffset, point.v + point.normalV * spec.beltToothOffset],
      outer: [point.u - point.normalU * spec.beltBackThickness, point.v - point.normalV * spec.beltBackThickness],
      normalU: point.normalU, normalV: point.normalV,
    });
  }
  const faces = [
    s => [[x0, ...s.outer], [x1, ...s.outer], [0, -s.normalU, -s.normalV]],
    s => [[x1, ...s.inner], [x0, ...s.inner], [0, s.normalU, s.normalV]],
    s => [[x0, ...s.inner], [x0, ...s.outer], [-1, 0, 0]],
    s => [[x1, ...s.outer], [x1, ...s.inner], [1, 0, 0]],
  ];
  const positions = [], normals = [], indices = [];
  faces.forEach(face => {
    const base = positions.length / 3;
    ring.forEach(sample => {
      const [a, b, normal] = face(sample);
      positions.push(...a, ...b);
      normals.push(...normal, ...normal);
    });
    for (let k = 0; k < samples; k++) {
      const a = base + k * 2, b = base + ((k + 1) % samples) * 2;
      indices.push(a, b + 1, a + 1, a, b, b + 1);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

function beltTooth(spec) {
  const height = spec.beltToothHeight;
  const outline = new THREE.Shape();
  outline.moveTo(-2.6, -0.2);
  outline.lineTo(2.6, -0.2);
  outline.lineTo(1.85, height - 0.9);
  outline.quadraticCurveTo(1.5, height, 0, height);
  outline.quadraticCurveTo(-1.5, height, -1.85, height - 0.9);
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: spec.beltWidth, bevelEnabled: false, curveSegments: 4 });
  geometry.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -spec.beltWidth / 2, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
  return geometry;
}

function roller(spec, materials, mesh, pulley, part, material, mountEndX) {
  const R = pulley.radius - spec.beltBackThickness, beltX = spec.beltX;
  const group = new THREE.Group();
  group.position.set(beltX, pulley.u, pulley.v);
  const body = Geometry.lathe([[10, -13], [R - 1.2, -13], [R, -11.8], [R, 11.8], [R - 1.2, 13], [10, 13], [10, -13]], 72, 0, undefined, true);
  Geometry.rotateToX(body);
  const spinning = new THREE.Group();
  spinning.add(mesh(Geometry.mergeGeometries([body, Geometry.tubeAlongX(14, R - 5, -4, 4, 56)]), material, part));
  group.add(spinning);
  const nut = Geometry.hexPrism(14, 7);
  Geometry.rotateToX(nut);
  nut.translate(-22, 0, 0);
  group.add(mesh(Geometry.mergeGeometries([
    Geometry.tubeAlongX(6, 10, -13, 13, 32), Geometry.tubeAlongX(6, 14, -15, -13, 32), nut, Geometry.tubeAlongX(6, 13, 13, mountEndX - beltX, 32),
  ]), materials.solid.tensArm, part));
  return { group, spinning, radius: pulley.radius, side: pulley.side };
}

function tensionerBracketAndDamper(spec, materials, mesh, rollerPosition) {
  const pivot = spec.tensioner.pivot;
  const tail = { u: rollerPosition.u - 12, v: rollerPosition.v + 48 };
  const outline = Geometry.polygonShape(Geometry.convexHull([
    ...Geometry.circlePoints([pivot.u, pivot.v], 12, 32),
    ...Geometry.circlePoints([rollerPosition.u, rollerPosition.v], 15, 40),
    ...Geometry.circlePoints([tail.u, tail.v], 8, 24),
  ]));
  outline.holes.push(Geometry.circleHole(pivot.u, pivot.v, 5.5, true));
  const pivotHead = Geometry.hexPrism(14, 1.6);
  Geometry.rotateToX(pivotHead);
  pivotHead.translate(-152.4, pivot.u, pivot.v);
  const pivotBolt = Geometry.mergeGeometries([pivotHead, Geometry.cylinderAlongX(5.5, -150.8, -136, 16).translate(0, pivot.u, pivot.v)]);
  const bracket = mesh(Geometry.mergeGeometries([Geometry.extrudeAlongX(outline, -150.5, -145, { curveSegments: 16 }), pivotBolt]),
    materials.solid.tensArm, 'tensioner');

  const rodEnd = new Vector3(-143, tail.u + 13, tail.v), top = new Vector3(-143, tail.u + 80, tail.v - 14);
  const direction = top.clone().sub(rodEnd).normalize();
  const bodyStart = rodEnd.clone().addScaledVector(direction, 12), bodyEnd = top.clone().addScaledVector(direction, -8);
  const eye = new THREE.TorusGeometry(7, 3.2, 10, 24);
  eye.rotateY(Math.PI / 2);
  eye.translate(top.x, top.y, top.z);
  const damper = mesh(Geometry.mergeGeometries([
    Geometry.cylinderBetween(10.5, bodyStart, bodyEnd, 28),
    Geometry.cylinderBetween(12, bodyEnd.clone().addScaledVector(direction, -6), bodyEnd, 28),
    eye,
  ]), materials.solid.tensBody, 'tensioner');
  const rodBall = new THREE.SphereGeometry(5, 14, 10);
  rodBall.translate(rodEnd.x, rodEnd.y, rodEnd.z);
  const rod = mesh(Geometry.mergeGeometries([Geometry.cylinderBetween(4.2, rodEnd, bodyStart.clone().addScaledVector(direction, 2), 16), rodBall]),
    materials.solid.tensArm, 'tensioner');
  return [bracket, damper, rod];
}

function coolantPump(spec, materials, mesh, pulley, toothPhase) {
  const x0 = spec.beltX - spec.beltWidth / 2, x1 = spec.beltX + spec.beltWidth / 2;
  const radius = spec.pitchRadius(spec.teeth.pump);
  const pump = new THREE.Group();
  pump.position.set(0, pulley.u, pulley.v);
  const nuts = Array.from({ length: 4 }, (_, k) => {
    const angle = (k + 0.5) / 4 * Math.PI * 2, nut = Geometry.hexPrism(8, 4);
    Geometry.rotateToX(nut);
    return nut.translate(x0 - 6.6, 13 * Math.cos(angle), 13 * Math.sin(angle));
  });
  const spinning = new THREE.Group();
  spinning.add(mesh(Geometry.mergeGeometries([
    Geometry.extrudeAlongX(Geometry.timingPulleyShape(spec.teeth.pump, radius, { phase: toothPhase, holes: [Geometry.circleHole(0, 0, 9, true)] }),
      x0 - 1, x1 + 1, { curveSegments: 16 }),
    Geometry.tubeAlongX(9, radius + 4, x0 - 2.6, x0 - 1, 48),
    Geometry.tubeAlongX(9, radius + 4, x1 + 1, x1 + 2.6, 48),
    Geometry.tubeAlongX(9, 17, x1 + 1, -144, 32),
    ...nuts,
  ]), materials.solid.pumpPulley, 'pump'));
  pump.add(spinning);
  pump.add(mesh(Geometry.mergeGeometries([
    Geometry.tubeAlongX(8, 44, -144, -136, 64),
    Geometry.cylinderAlongX(30, -150, -144, 48),
    Geometry.cylinderBetween(14, new Vector3(-142, -20, 30), new Vector3(-118, -60, 62), 24),
  ]), materials.solid.pumpBody, 'pump'));
  return { pump, spinning, radius };
}

function camTimingMarks(spec, materials, mesh, tag) {
  const pulleyRadius = spec.pitchRadius(spec.teeth.cam), x1 = spec.beltX + spec.beltWidth / 2;
  const markMaterial = builders.markMaterial();
  const objects = [];
  for (const z of [-spec.camAlong, spec.camAlong]) {
    const arrow = new THREE.Shape();
    arrow.moveTo(pulleyRadius + 16, -3.5);
    arrow.lineTo(pulleyRadius + 16, 3.5);
    arrow.lineTo(pulleyRadius + 8.5, 0);
    arrow.closePath();
    const plate = Geometry.extrudeAlongX(Geometry.roundedRect(16, 22, 3), x1 + 4, x1 + 6);
    plate.translate(0, pulleyRadius + 13, z);
    objects.push(mesh(plate, materials.hardware.aluminium, 'camPulley'));
    const mark = new THREE.Mesh(Geometry.extrudeAlongX(arrow, x1 + 3, x1 + 4).translate(0, 0, z), markMaterial);
    objects.push(tag(mark, 'camPulley', 'timing'));
  }
  return objects;
}

function beltCover(spec, materials, tag, solution) {
  const outlinePoints = [];
  solution.pulleys.forEach(pulley => {
    for (let k = 0; k < 48; k++) {
      const angle = k / 48 * Math.PI * 2;
      outlinePoints.push([pulley.u + (pulley.radius + 13) * Math.cos(angle), pulley.v + (pulley.radius + 13) * Math.sin(angle)]);
    }
  });
  const geometry = Geometry.extrudeAlongX(Geometry.polygonShape(Geometry.convexHull(outlinePoints)), -212, -147, { curveSegments: 1 });
  const cover = new THREE.Mesh(geometry, materials.ghost.tcover);
  cover.renderOrder = 2;
  tag(cover, 'tcover', 'housing');
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), materials.ghostEdges.tcover);
  edges.renderOrder = 3;
  edges.userData.pickable = false;
  tag(edges, 'tcover', 'housing');
  return [cover, edges];
}

function timingBelt({ spec, materials, tag }, belt) {
  const { solution, toothPhase, firstToothDistance } = belt;
  const mesh = (geometry, material, part) => {
    const result = tag(new THREE.Mesh(geometry, material), part, 'timing');
    result.castShadow = result.receiveShadow = true;
    return result;
  };
  const pulleyNamed = name => solution.pulleys.find(pulley => pulley.name === name);

  const bandMaterial = materials.solid.belt.clone();
  bandMaterial.side = THREE.DoubleSide;
  const band = mesh(beltBand(spec, solution.path), bandMaterial, 'belt');
  const teeth = new THREE.InstancedMesh(beltTooth(spec), materials.solid.beltTooth, solution.teethCount);
  teeth.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tag(teeth, 'belt', 'timing');
  teeth.castShadow = teeth.receiveShadow = true;

  const rollers = ['idler1', 'idler2', 'idler3'].map(name =>
    roller(spec, materials, mesh, pulleyNamed(name), 'idler', materials.solid.idler, spec.blockSpanX[0]));
  const tensionerPulley = pulleyNamed('tensioner');
  rollers.push(roller(spec, materials, mesh, tensionerPulley, 'tensioner', materials.solid.tensRoller, -150.5));
  const pump = coolantPump(spec, materials, mesh, pulleyNamed('pump'), toothPhase.pump);

  const objects = [band, teeth, ...rollers.map(item => item.group), ...tensionerBracketAndDamper(spec, materials, mesh, tensionerPulley),
    pump.pump, ...camTimingMarks(spec, materials, mesh, tag)];

  const crankPulleyRadius = spec.pitchRadius(spec.teeth.crank);
  const matrix = new THREE.Matrix4(), axisX = new Vector3(1, 0, 0), axisY = new Vector3(), axisZ = new Vector3(), position = new Vector3();

  function update(crankAngle) {
    const beltShift = crankAngle * crankPulleyRadius;
    for (let tooth = 0; tooth < solution.teethCount; tooth++) {
      const point = Belt.pointAt(solution.path, firstToothDistance + tooth * spec.beltPitch + beltShift);
      axisY.set(0, point.normalU, point.normalV);
      axisZ.set(0, -point.normalV, point.normalU);
      matrix.makeBasis(axisX, axisY, axisZ);
      position.set(spec.beltX, point.u + point.normalU * spec.beltToothOffset, point.v + point.normalV * spec.beltToothOffset);
      matrix.setPosition(position);
      teeth.setMatrixAt(tooth, matrix);
    }
    teeth.instanceMatrix.needsUpdate = true;
    rollers.forEach(item => { item.spinning.rotation.x = item.side * crankAngle * crankPulleyRadius / item.radius; });
    pump.spinning.rotation.x = crankAngle * crankPulleyRadius / pump.radius;
  }

  return { objects, cover: beltCover(spec, materials, tag, solution), update };
}

builders.beltToothPhases = beltToothPhases;
builders.timingBelt = timingBelt;
})();
