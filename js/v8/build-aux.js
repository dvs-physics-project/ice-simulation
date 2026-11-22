/*
 * V-образный дизель: навесные агрегаты — вентилятор с вязкостной муфтой, генератор, клиновой ремень
 * (два ручья), стартер, шестерённый масляный насос с приводом от носка вала, маслоприёмник.
 *
 *   auxiliaries(context) → { objects, update(crankAngle) }
 *     При повороте вала на θ ремень сдвигается на θ·R шкива коленвала; шкивы вентилятора и генератора
 *     поворачиваются на этот сдвиг, делённый на свой радиус. Крыльчатка вентилятора отстаёт от шкива
 *     на проскальзывание муфты (spec.fanSlip). Белые метки на ремне показывают его движение.
 *
 *   vBeltPulley(radius, hubRadius, boreRadius)  — двухручьевой шкив клинового ремня
 *   vBeltGeometry(path, x)                       — один клиновой ремень трапециевидного сечения по пути
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Belt = window.Belt;
const Vector3 = THREE.Vector3;
const builders = window.EngineBuilders.v8;
const BELT_MARKS_PER_RIB = 12;

function vBeltPulley(radius, hubRadius, boreRadius) {
  const top = radius + 6, bottom = radius - 5;
  const profile = [[boreRadius, -22], [hubRadius, -22], [hubRadius, -18], [top - 4, -18], [top, -17], [top, -15.5]];
  for (const grooveCenter of [-8, 8]) profile.push([top, grooveCenter - 7.5], [bottom, grooveCenter - 2.5], [bottom, grooveCenter + 2.5], [top, grooveCenter + 7.5]);
  profile.push([top, 15.5], [top, 17], [top - 4, 18], [hubRadius, 18], [hubRadius, 22], [boreRadius, 22], [boreRadius, -22]);
  return Geometry.rotateToX(Geometry.lathe(profile, 72, 0, undefined, true));
}

function vBeltGeometry(path, x) {
  const samples = Math.round(path.length / 3);
  const section = [[-3, -3.4], [-3, 3.4], [5.5, 7.3], [5.5, -7.3]];
  const rings = [];
  for (let k = 0; k < samples; k++) {
    const point = Belt.pointAt(path, k / samples * path.length);
    const outwardU = point.tangentV, outwardV = -point.tangentU;
    rings.push(section.map(([depth, across]) => [x + across, point.u + outwardU * depth, point.v + outwardV * depth]));
  }
  const positions = [], indices = [];
  for (let face = 0; face < 4; face++) {
    const base = positions.length / 3, a = face, b = (face + 1) % 4;
    for (let k = 0; k < samples; k++) positions.push(...rings[k][a], ...rings[k][b]);
    for (let k = 0; k < samples; k++) {
      const i0 = base + k * 2, i1 = base + ((k + 1) % samples) * 2;
      indices.push(i0, i0 + 1, i1, i0 + 1, i1 + 1, i1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function fanBlades() {
  const outline = new THREE.Shape();
  outline.moveTo(-44, 70);
  outline.lineTo(52, 70);
  outline.quadraticCurveTo(80, 180, 92, 280);
  outline.quadraticCurveTo(40, 304, -40, 286);
  outline.quadraticCurveTo(-58, 180, -44, 70);
  const blades = [];
  for (let k = 0; k < 8; k++) {
    const blade = new THREE.ExtrudeGeometry(outline, { depth: 3, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 1, curveSegments: 12 });
    const vertices = blade.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      const chord = vertices.getX(i), radius = vertices.getY(i), thickness = vertices.getZ(i) - 1.5;
      const pitch = (30 - 13 * (radius - 70) / 230) * Math.PI / 180;
      vertices.setXYZ(i, thickness * Math.cos(pitch) - chord * Math.sin(pitch) - 592, radius, chord * Math.cos(pitch) + thickness * Math.sin(pitch));
    }
    blade.computeVertexNormals();
    blade.rotateX(k / 8 * Math.PI * 2);
    blades.push(blade);
  }
  return blades;
}

function fan(spec, materials, mesh, pulley) {
  const solid = materials.solid;
  const driven = new THREE.Group(), blades = new THREE.Group(), coupling = new THREE.Group();
  [driven, blades, coupling].forEach(group => group.position.set(0, pulley.u, pulley.v));
  driven.add(mesh(vBeltPulley(pulley.radius, 34, 18).translate(spec.beltX, 0, 0), solid.coupling, 'fan'));
  driven.add(mesh(Geometry.tubeAlongX(18, 30, spec.beltX + 22, -420, 32), solid.coupling, 'fan'));

  const body = Geometry.lathe([[30, 0], [96, 0], [110, 10], [110, 62], [96, 72], [30, 72], [30, 0]], 72, 0, undefined, true);
  Geometry.rotateToX(body);
  body.translate(-446, 0, 0);
  const ribs = Array.from({ length: 18 }, (_, k) => new THREE.BoxGeometry(52, 6, 4).translate(-410, 113, 0).rotateX(k / 18 * Math.PI * 2));
  coupling.add(mesh(Geometry.mergeGeometries([body, ...ribs]), solid.coupling, 'fan'));

  const hub = Geometry.lathe([[0, 0], [62, 0], [66, 6], [66, 26], [40, 30], [0, 30]], 48).rotateZ(-Math.PI / 2).translate(-606, 0, 0);
  blades.add(mesh(Geometry.mergeGeometries([Geometry.cylinderAlongX(16, -580, spec.beltX - 22, 24), hub]), solid.fanHub, 'fan'));
  const spider = Geometry.lathe([[60, 0], [96, 0], [96, 3], [60, 3]], 48, 0, undefined, true);
  Geometry.rotateToX(spider);
  spider.translate(-578, 0, 0);
  blades.add(mesh(Geometry.mergeGeometries([...fanBlades(), spider]), solid.fanBlade, 'fan'));
  return { driven, blades, coupling };
}

function alternator(spec, materials, mesh, pulley) {
  const solid = materials.solid, x = spec.beltX;
  const rotor = new THREE.Group(), body = new THREE.Group();
  rotor.position.set(0, pulley.u, pulley.v);
  body.position.copy(rotor.position);
  const nut = Geometry.hexPrism(19, 8);
  Geometry.rotateToX(nut);
  nut.translate(x - 30, 0, 0);
  const coolingFan = Array.from({ length: 12 }, (_, k) => new THREE.BoxGeometry(10, 26, 2.2).translate(x + 34, 50, 0).rotateX(k / 12 * Math.PI * 2));
  coolingFan.push(Geometry.tubeAlongX(14, 66, x + 28, x + 30, 48));
  rotor.add(mesh(Geometry.mergeGeometries([vBeltPulley(pulley.radius, 16, 8).translate(x, 0, 0), nut]), solid.altPulley, 'alternator'),
    mesh(Geometry.mergeGeometries(coolingFan), solid.altBody, 'alternator'));

  const housing = Geometry.lathe([[0, 0], [60, 0], [70, 8], [72, 20], [72, 66], [66, 76], [20, 80], [0, 80]], 64, 0, undefined, true);
  Geometry.rotateToX(housing);
  housing.translate(x + 40, 0, 0);
  const fins = Array.from({ length: 24 }, (_, k) => new THREE.BoxGeometry(46, 4, 3).translate(x + 72, 72.5, 0).rotateX(k / 24 * Math.PI * 2));
  const terminal = Geometry.lathe([[0, 0], [5, 0], [5, 12], [0, 12]], 12);
  Geometry.rotateToX(terminal);
  terminal.translate(x + 120, 30, 20);
  body.add(mesh(Geometry.mergeGeometries([housing, ...fins, new THREE.BoxGeometry(24, 30, 40).translate(x + 60, 82, 0), terminal]), solid.altBody, 'alternator'));
  return { rotor, body };
}

function starter(materials, mesh) {
  const y = -120, z = -237;
  const motor = Geometry.lathe([[0, 0], [52, 0], [55, 4], [55, 150], [50, 156], [0, 156]], 48);
  Geometry.rotateToX(motor);
  const nose = Geometry.lathe([[0, 0], [44, 0], [44, 30], [30, 34], [22, 34], [0, 34]], 40);
  Geometry.rotateToX(nose);
  const pinion = Geometry.extrudeAlongX(Geometry.involuteGearShape(11, 3.25, { phase: 0, holes: [Geometry.circleHole(0, 0, 8, true)] }), 384, 398,
    { curveSegments: 12 }).translate(0, y, z);
  return [
    mesh(Geometry.mergeGeometries([
      motor.translate(195, y, z), nose.translate(350, y, z),
      Geometry.cylinderAlongX(29, 214, 330, 36).translate(0, y + 78, z),
      new THREE.BoxGeometry(18, 120, 40).translate(360, y + 40, z + 30),
    ]), materials.solid.starterBody, 'starter'),
    mesh(pinion, materials.hardware.steel, 'starter'),
  ];
}

function oilPumpAndPickup(spec, materials, mesh, tag) {
  const solid = materials.solid, front = spec.frontGear, pumpY = front.oilPumpY;
  const drivenPhase = spec.meshPhase(0, front.teeth, { y: 0, z: 0 }, { y: pumpY, z: 0 }, front.teeth);
  const pumpTeeth = 10, pumpModule = 3, pumpPitchRadius = pumpModule * pumpTeeth / 2;

  const drive = new THREE.Group();
  drive.position.set(0, pumpY, 0);
  drive.add(mesh(builders.gearGeometry(front.teeth, spec.gearModule, drivenPhase, front.x - 10, front.x + 10,
    { bore: 10, holes: 5, holeRadius: 16, holeCircle: 60 }), solid.oilGear, 'oilPump'));
  drive.add(mesh(Geometry.mergeGeometries([
    Geometry.cylinderAlongX(10, front.x - 14, -316, 20),
    Geometry.extrudeAlongX(Geometry.involuteGearShape(pumpTeeth, pumpModule, { phase: 0, holes: [Geometry.circleHole(0, 0, 9.9, true)] }), -352, -322, { curveSegments: 10 }),
  ]), solid.oilGear, 'oilPump'));
  const idle = new THREE.Group();
  idle.position.set(0, pumpY, 2 * pumpPitchRadius);
  const idlePhase = spec.meshPhase(0, pumpTeeth, { y: 0, z: 0 }, { y: 0, z: 2 * pumpPitchRadius }, pumpTeeth);
  idle.add(mesh(Geometry.extrudeAlongX(Geometry.involuteGearShape(pumpTeeth, pumpModule, { phase: idlePhase, holes: [Geometry.circleHole(0, 0, 6, true)] }),
    -352, -322, { curveSegments: 10 }), solid.oilGear, 'oilPump'));

  const bodyGeometry = new THREE.ExtrudeGeometry(Geometry.roundedRect(84, 56, 16), { depth: 38, bevelEnabled: false, curveSegments: 8 });
  bodyGeometry.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  bodyGeometry.translate(-356, pumpY, pumpPitchRadius);
  const body = tag(new THREE.Mesh(bodyGeometry, materials.ghost.oilpump), 'oilPump', 'aux');
  body.renderOrder = 2;
  const edges = tag(new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeometry, 28), materials.ghostEdges.oilpump), 'oilPump', 'aux');
  edges.renderOrder = 3;
  edges.userData.pickable = false;

  const pickupTube = new THREE.CatmullRomCurve3([new Vector3(-337, pumpY - 33, pumpPitchRadius), new Vector3(-337, pumpY - 80, pumpPitchRadius),
    new Vector3(-318, -320, 8), new Vector3(-260, -338, 0), new Vector3(-200, -338, 0), new Vector3(-175, -338, 0)], false, 'centripetal');
  const strainer = Geometry.lathe([[10, 0], [16, -4], [52, -10], [55, -14], [55, -18], [0, -18]], 56, 0, undefined, true).translate(-175, -334, 0);
  const screen = Geometry.lathe([[0, 0], [54, 0], [54, 0.8], [0, 0.8]], 56, 0, undefined, true).translate(-175, -352.6, 0);
  return {
    drive, idle,
    objects: [body, edges, mesh(new THREE.TubeGeometry(pickupTube, 64, 11, 14, false), solid.pickup, 'pickup'),
      mesh(Geometry.mergeGeometries([strainer, screen]), solid.strainer, 'pickup')],
  };
}

function auxiliaries({ spec, materials, tag }) {
  const mesh = (geometry, material, part) => {
    const result = tag(new THREE.Mesh(geometry, material), part, 'aux');
    result.castShadow = result.receiveShadow = true;
    return result;
  };
  const pulley = name => spec.vBeltPulleys.find(item => item.name === name);
  const fanPulley = pulley('fan'), alternatorPulley = pulley('alternator'), crankPulley = pulley('crank');
  const fanParts = fan(spec, materials, mesh, fanPulley);
  const alternatorParts = alternator(spec, materials, mesh, alternatorPulley);
  const oil = oilPumpAndPickup(spec, materials, mesh, tag);

  const path = spec.vBeltPath();
  const belt = mesh(Geometry.mergeGeometries([vBeltGeometry(path, spec.beltX - 8), vBeltGeometry(path, spec.beltX + 8)]), materials.solid.vbelt, 'belt');
  const marks = new THREE.InstancedMesh(new THREE.BoxGeometry(11, 1.2, 9),
    new THREE.MeshStandardMaterial({ color: materials.srgb('#c9cdd2'), roughness: 0.7, metalness: 0 }), 2 * BELT_MARKS_PER_RIB);
  marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tag(marks, 'belt', 'aux');

  const objects = [fanParts.driven, fanParts.blades, fanParts.coupling, belt, marks, alternatorParts.rotor, alternatorParts.body,
    ...starter(materials, mesh), oil.drive, oil.idle, ...oil.objects];

  const matrix = new THREE.Matrix4(), axisX = new Vector3(1, 0, 0), axisY = new Vector3(), axisZ = new Vector3(), position = new Vector3();
  function update(crankAngle) {
    const beltShift = crankAngle * crankPulley.radius;
    fanParts.driven.rotation.x = beltShift / fanPulley.radius;
    fanParts.blades.rotation.x = spec.fanSlip * beltShift / fanPulley.radius;
    alternatorParts.rotor.rotation.x = beltShift / alternatorPulley.radius;
    oil.drive.rotation.x = -crankAngle;
    oil.idle.rotation.x = crankAngle;
    for (let j = 0; j < 2 * BELT_MARKS_PER_RIB; j++) {
      const rib = j % 2, point = Belt.pointAt(path, (j >> 1) / BELT_MARKS_PER_RIB * path.length + beltShift);
      axisY.set(0, point.tangentV, -point.tangentU);
      axisZ.set(0, point.tangentU, point.tangentV);
      matrix.makeBasis(axisX, axisY, axisZ);
      position.set(spec.beltX + (rib ? 8 : -8), point.u + point.tangentV * 5.6, point.v - point.tangentU * 5.6);
      matrix.setPosition(position);
      marks.setMatrixAt(j, matrix);
    }
    marks.instanceMatrix.needsUpdate = true;
  }

  return { objects, update };
}

builders.auxiliaries = auxiliaries;
})();
