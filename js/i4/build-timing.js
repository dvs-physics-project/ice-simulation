/*
 * Рядный двигатель: зубчатый ремень ГРМ, натяжитель, насос охлаждения и кожух ремня.
 *
 *   beltToothPhases(spec, solution) — где на ремне стоит первый зуб и как повернуть зубья каждого шкива,
 *                                     чтобы они попадали между зубьями ремня;
 *   timingBelt(context, belt) → { objects, cover, update(crankAngle) }
 *     Ремень — лента по пути из Belt.layout плюс 137 зубьев (InstancedMesh). При повороте вала на угол θ
 *     ремень сдвигается на дугу θ·R шкива коленвала; ролик натяжителя и шкив насоса вращаются
 *     в отношении радиусов.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Belt = window.Belt;
const Vector3 = THREE.Vector3;

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
  for (const name of ['camIntake', 'camExhaust', 'pump']) {
    const arc = arcOf(name);
    const middle = arc.startDistance + arc.length / 2;
    const nearestTooth = Math.round((middle - firstToothDistance) / spec.beltPitch);
    toothPhase[name] = angleOnPulley(arc, firstToothDistance + nearestTooth * spec.beltPitch);
  }
  return { firstToothDistance, toothPhase };
}

function beltBand(spec, path) {
  const length = path.length;
  const x0 = spec.beltX - spec.beltWidth / 2, x1 = spec.beltX + spec.beltWidth / 2;
  const samples = Math.round(length / 2);
  const ring = [];
  for (let k = 0; k < samples; k++) {
    const point = Belt.pointAt(path, k / samples * length);
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

function tensionerAssembly(spec, solid, tag, solution) {
  const roller = solution.pulleys.find(pulley => pulley.name === 'tensioner');
  const { pivot, rollerRadius: R } = spec.tensioner;
  const assembly = new THREE.Group();
  assembly.position.set(spec.beltX, roller.u, roller.v);

  const rollerBody = Geometry.lathe([[8.5, -13], [R - 1.2, -13], [R, -11.8], [R, 11.8], [R - 1.2, 13], [8.5, 13], [8.5, -13]],
    64, 0, undefined, true);
  Geometry.rotateToX(rollerBody);
  const rivets = Array.from({ length: 6 }, (_, k) => {
    const angle = k / 6 * Math.PI * 2;
    const rivet = Geometry.cylinderAlongX(2.2, -13.7, -12.6, 12);
    rivet.translate(0, 18 * Math.cos(angle), 18 * Math.sin(angle));
    return rivet;
  });
  const rollerMesh = tag(new THREE.Mesh(Geometry.mergeGeometries([rollerBody, ...rivets]), solid.tensRoller), 'tensioner', 'timing');
  const spinning = new THREE.Group();
  spinning.add(rollerMesh);
  assembly.add(spinning);

  const hubNut = Geometry.hexPrism(13, 7);
  Geometry.rotateToX(hubNut);
  hubNut.translate(-22.5, 0, 0);
  const hub = tag(new THREE.Mesh(Geometry.mergeGeometries([
    Geometry.tubeAlongX(5, 8.5, -13, 13, 32), Geometry.tubeAlongX(5, 12, -15.5, -13, 32), hubNut,
  ]), solid.tensArm), 'tensioner', 'timing');
  assembly.add(hub);

  const armLength = Math.hypot(roller.u - pivot.u, roller.v - pivot.v);
  const armAngle = Math.atan2(roller.v - pivot.v, roller.u - pivot.u);
  const armOutline = new THREE.Shape();
  armOutline.absarc(0, 0, 13, Math.PI / 2, Math.PI * 1.5, false);
  armOutline.lineTo(armLength, -11);
  armOutline.absarc(armLength, 0, 11, -Math.PI / 2, Math.PI / 2, false);
  armOutline.lineTo(0, 13);
  armOutline.holes.push(Geometry.circleHole(0, 0, 5, true));
  const arm = new THREE.ExtrudeGeometry(armOutline,
    { depth: 6, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 1, curveSegments: 16 });
  arm.rotateZ(armAngle);
  arm.translate(pivot.u, pivot.v, spec.beltX + spec.beltWidth / 2 + 2.2);
  Geometry.shapeToYZ(arm);

  const pivotNut = Geometry.hexPrism(14, 7);
  Geometry.rotateToX(pivotNut);
  pivotNut.translate(-211, 0, 0);
  pivotNut.translate(0, pivot.u, pivot.v);
  const pivotPin = Geometry.cylinderAlongX(5, -204, -182, 16);
  pivotPin.translate(0, pivot.u, pivot.v);
  const armMesh = tag(new THREE.Mesh(Geometry.mergeGeometries([arm, Geometry.mergeGeometries([pivotNut, pivotPin])]), solid.tensArm),
    'tensioner', 'timing');
  [rollerMesh, hub, armMesh].forEach(mesh => { mesh.castShadow = mesh.receiveShadow = true; });
  return { assembly, spinning, armMesh };
}

function coolantPump(spec, solid, tag, solution, toothPhase) {
  const pulleyPosition = solution.pulleys.find(pulley => pulley.name === 'pump');
  const x0 = spec.beltX - spec.beltWidth / 2, x1 = spec.beltX + spec.beltWidth / 2;
  const radius = spec.pitchRadius(spec.teeth.pump);
  const pump = new THREE.Group();
  pump.position.set(0, pulleyPosition.u, pulleyPosition.v);

  const nut = Geometry.hexPrism(10, 5);
  Geometry.rotateToX(nut);
  nut.translate(x0 - 7, 0, 0);
  const outline = Geometry.timingPulleyShape(spec.teeth.pump, radius, { phase: toothPhase, holes: [Geometry.circleHole(0, 0, 8, true)] });
  const pulley = tag(new THREE.Mesh(Geometry.mergeGeometries([
    Geometry.extrudeAlongX(outline, x0 - 0.5, x1 + 0.5, { curveSegments: 16 }),
    Geometry.tubeAlongX(8, radius + 3.6, x0 - 2, x0 - 0.5, 40),
    Geometry.tubeAlongX(8, radius + 3.6, x1 + 0.5, x1 + 2, 40),
    nut,
  ]), solid.pumpPulley), 'coolantPump', 'timing');
  pulley.castShadow = pulley.receiveShadow = true;
  const spinning = new THREE.Group();
  spinning.add(pulley);
  pump.add(spinning);

  const body = tag(new THREE.Mesh(Geometry.mergeGeometries([
    Geometry.tubeAlongX(0, 50, -203, -184, 64),
    Geometry.tubeAlongX(0, 30, -207, -203, 48),
    Geometry.cylinderBetween(13, new Vector3(-193, 0, 40), new Vector3(-193, -38, 74), 24),
  ]), solid.pumpBody), 'coolantPump', 'aux');
  body.castShadow = body.receiveShadow = true;
  pump.add(body);
  return { pump, spinning, radius };
}

function beltCover(spec, materials, tag, solution) {
  const outlinePoints = [];
  solution.pulleys.forEach(pulley => {
    for (let k = 0; k < 48; k++) {
      const angle = k / 48 * Math.PI * 2;
      outlinePoints.push([pulley.u + (pulley.radius + 14) * Math.cos(angle), pulley.v + (pulley.radius + 14) * Math.sin(angle)]);
    }
  });
  const geometry = Geometry.extrudeAlongX(Geometry.polygonShape(Geometry.convexHull(outlinePoints)), spec.beltX - 26, spec.beltX + 18, { curveSegments: 1 });
  const cover = new THREE.Mesh(geometry, materials.ghost.tcover);
  cover.renderOrder = 2;
  tag(cover, 'tcover', 'housing');
  const edges = tag(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), materials.ghostEdges.tcover), 'tcover', 'housing');
  return [cover, edges];
}

function timingBelt({ spec, materials, tag }, belt) {
  const solid = materials.solid;
  const { solution, toothPhase, firstToothDistance } = belt;

  const bandMaterial = solid.belt.clone();
  bandMaterial.side = THREE.DoubleSide;
  const band = tag(new THREE.Mesh(beltBand(spec, solution.path), bandMaterial), 'belt', 'timing');
  band.castShadow = band.receiveShadow = true;

  const teeth = new THREE.InstancedMesh(beltTooth(spec), solid.beltTooth, solution.teethCount);
  teeth.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tag(teeth, 'belt', 'timing');
  teeth.castShadow = teeth.receiveShadow = true;

  const tensioner = tensionerAssembly(spec, solid, tag, solution);
  const pump = coolantPump(spec, solid, tag, solution, toothPhase.pump);
  const cover = beltCover(spec, materials, tag, solution);

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
    tensioner.spinning.rotation.x = -crankAngle * crankPulleyRadius / spec.tensioner.rollerRadius;
    pump.spinning.rotation.x = crankAngle * crankPulleyRadius / pump.radius;
  }

  return { objects: [band, teeth, tensioner.assembly, tensioner.armMesh, pump.pump], cover, update };
}

window.EngineBuilders.i4.beltToothPhases = beltToothPhases;
window.EngineBuilders.i4.timingBelt = timingBelt;
})();
