/*
 * Оппозитный двигатель: поршни с карманами под клапаны, кольцами, пальцами и стрелкой «к маховику»,
 * шатуны с крышками, болтами, втулкой и вкладышами.
 *
 *   pistonsAndRods(context) → { pistons, rods, update(crankAngle) }
 *     Поршень каждого цилиндра повёрнут на ось своего ряда; update ставит его на расстояние
 *     crownDistance от оси вала и поворачивает шатун на угол rodAngle.
 *
 *   unionOfTwoCircles(...) — контур двух пересекающихся окружностей (карман под впускной и выпускной клапаны).
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const builders = window.EngineBuilders.b4;
const Banks = window.CylinderBanks;

function unionOfTwoCircles(center1, radius1, center2, radius2, segments) {
  const dx = center2[0] - center1[0], dy = center2[1] - center1[1], distance = Math.hypot(dx, dy);
  const toChord = (radius1 * radius1 - radius2 * radius2 + distance * distance) / (2 * distance);
  const chordCenter = [center1[0] + dx / distance * toChord, center1[1] + dy / distance * toChord];
  const points = [];
  const addOutside = (center, radius, otherCenter, otherRadius) => {
    for (let k = 0; k < segments; k++) {
      const angle = k / segments * Math.PI * 2;
      const point = [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
      if (Math.hypot(point[0] - otherCenter[0], point[1] - otherCenter[1]) >= otherRadius) points.push(point);
    }
  };
  addOutside(center1, radius1, center2, radius2);
  addOutside(center2, radius2, center1, radius1);
  const angleAround = point => Math.atan2(point[1] - chordCenter[1], point[0] - chordCenter[0]);
  points.sort((p, q) => angleAround(p) - angleAround(q));
  return points;
}

function pistonGeometries(spec) {
  const R = spec.pistonRadius, H = spec.pistonHeight, top = -spec.pocketDepth;
  const body = Geometry.lathe([[0, top], [R - 0.4, top], [R, top - 0.5], [R, -5.1], [R - 3.2, -5.1], [R - 3.2, -6.4], [R, -6.4],
    [R, -9.6], [R - 3.2, -9.6], [R - 3.2, -10.9], [R, -10.9], [R, -14.1], [R - 3.6, -14.1], [R - 3.6, -16.9], [R, -16.9],
    [R, -H + 0.8], [R - 0.8, -H], [R - 3.4, -H], [R - 3.4, -20], [27, -12], [0, -11]], 64, 0, undefined, true);

  const pocket = { intake: { side: 14.8, radius: 17.0 }, exhaust: { side: -14.2, radius: 14.8 } };
  const crownOutline = new THREE.Shape();
  crownOutline.absarc(0, 0, R - 0.4, 0, Math.PI * 2, false);
  for (const direction of [-1, 1]) {
    const outline = unionOfTwoCircles(
      [direction * spec.valves.intake.offsetX, pocket.intake.side], pocket.intake.radius,
      [direction * spec.valves.exhaust.offsetX, pocket.exhaust.side], pocket.exhaust.radius, 160);
    const hole = new THREE.Path();
    outline.forEach(([u, v], k) => (k ? hole.lineTo(u, v) : hole.moveTo(u, v)));
    hole.closePath();
    crownOutline.holes.push(hole);
  }
  const crown = new THREE.ExtrudeGeometry(crownOutline, { depth: spec.pocketDepth, bevelEnabled: false, curveSegments: 64 });
  crown.rotateX(Math.PI / 2);

  const bossParts = [];
  for (const side of [-1, 1]) {
    const boss = Geometry.tubeAlongX(spec.pinOuterDiameter / 2 + 0.05, 15, side < 0 ? -(R - 3.6) : 11, side < 0 ? -11 : R - 3.6, 32);
    boss.translate(0, -spec.compressionHeight, 0);
    const strut = new THREE.BoxGeometry(24, 9, 16);
    strut.translate(side * 24, -15.5, 0);
    bossParts.push(boss, strut);
  }

  const ring = (top, bottom, innerRadius, gapAngle) => Geometry.lathe(
    [[innerRadius, top], [R + 0.05, top], [R + 0.05, bottom], [innerRadius, bottom], [innerRadius, top]],
    64, gapAngle, Math.PI * 2 - 2 * gapAngle, true);

  const pinShape = Geometry.lathe([[spec.pinInnerDiameter / 2, 0], [spec.pinOuterDiameter / 2, 0], [spec.pinOuterDiameter / 2, 70],
    [spec.pinInnerDiameter / 2, 70], [spec.pinInnerDiameter / 2, 0]], 36, 0, undefined, true);
  Geometry.rotateToX(pinShape);
  pinShape.translate(-35, -spec.compressionHeight, 0);
  const clip = new THREE.TorusGeometry(11.2, 0.8, 6, 28);
  clip.rotateY(Math.PI / 2);

  const arrowRight = new THREE.ShapeGeometry(Geometry.polygonShape([[-8, 0], [-3, 3.4], [-3, 1.2], [8, 1.2], [8, -1.2], [-3, -1.2], [-3, -3.4]]));
  arrowRight.rotateX(-Math.PI / 2);
  arrowRight.translate(0, 0.06, 0);
  const arrowLeft = arrowRight.clone();
  arrowLeft.rotateY(Math.PI);

  return {
    body, crown, arrowRight, arrowLeft,
    bosses: Geometry.mergeGeometries(bossParts),
    rings: Geometry.mergeGeometries([ring(-6.35, -5.15, R - 3.1, 0.012), ring(-10.85, -9.65, R - 3.1, 0.012), ring(-16.85, -14.15, R - 3.5, 0.008)]),
    pin: Geometry.mergeGeometries([pinShape, clip.clone().translate(-35.8, -spec.compressionHeight, 0), clip.translate(35.8, -spec.compressionHeight, 0)]),
  };
}

const BEAM_HALF_WIDTH = rodLength => [[34, 14], [48, 12], [80, 10.6], [rodLength - 22, 9.4]];

function beamHalfWidth(table, y) {
  if (y <= table[0][0]) return table[0][1];
  for (let k = 0; k < table.length - 1; k++) {
    if (y <= table[k + 1][0]) {
      const t = (y - table[k][0]) / (table[k + 1][0] - table[k][0]);
      return table[k][1] + (table[k + 1][1] - table[k][1]) * t;
    }
  }
  return table[table.length - 1][1];
}

function rodGeometries(spec) {
  const L = spec.rodLength, boreRadius = spec.rodBigEndBore / 2;
  const table = BEAM_HALF_WIDTH(L);
  const halfWidth = y => beamHalfWidth(table, y);
  const eyeRadius = 17, eyeAngle = Math.PI - Math.asin(9.4 / eyeRadius);
  const bore = [];
  for (let k = 1; k < 28; k++) {
    const angle = -Math.PI / 2 + Math.PI * k / 28;
    bore.push([boreRadius * Math.cos(angle), boreRadius * Math.sin(angle)]);
  }
  const shoulders = [[0, 43], [15, 43], [17, 41], [26, 30]];
  const mirroredShoulders = shoulders.slice().reverse().map(([y, z]) => [y, -z]);

  const outline = [...shoulders];
  for (let y = 34; y <= L - 22; y += 4) outline.push([y, halfWidth(y)]);
  for (let k = 0; k <= 28; k++) {
    const angle = eyeAngle - (2 * eyeAngle) * k / 28;
    outline.push([L + eyeRadius * Math.cos(angle), eyeRadius * Math.sin(angle)]);
  }
  for (let y = L - 22; y >= 34; y -= 4) outline.push([y, -halfWidth(y)]);
  outline.push(...mirroredShoulders, [0, -boreRadius], ...bore, [0, boreRadius]);
  const web = Geometry.polygonShape(outline);
  web.holes.push(Geometry.circleHole(L, 0, 13.5, true));
  const parts = [Geometry.extrudeAlongX(web, -3.5, 3.5, { curveSegments: 20 })];

  const bigEnd = [...shoulders, [32, 18], [34, 0], [32, -18], ...mirroredShoulders, [0, -boreRadius], ...bore, [0, boreRadius]];
  const bevel = { bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.7, bevelSegments: 1, curveSegments: 12 };
  parts.push(Geometry.extrudeAlongX(Geometry.polygonShape(bigEnd), -spec.rodWidth / 2, spec.rodWidth / 2, bevel));
  const eye = new THREE.Shape();
  eye.absarc(L, 0, eyeRadius, 0, Math.PI * 2, false);
  eye.holes.push(Geometry.circleHole(L, 0, 13.5, true));
  parts.push(Geometry.extrudeAlongX(eye, -spec.rodWidth / 2, spec.rodWidth / 2,
    { bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.6, bevelSegments: 1, curveSegments: 36 }));
  for (const side of [-1, 1]) {
    const flange = [];
    for (let y = 30; y <= L - 18; y += 4) flange.push([y, side * halfWidth(y)]);
    for (let y = L - 18; y >= 30; y -= 4) flange.push([y, side * (halfWidth(y) - 3.6)]);
    parts.push(Geometry.extrudeAlongX(Geometry.polygonShape(flange), -8, 8));
  }

  const cap = [[0, 43], [-18, 43]];
  for (let k = 0; k <= 22; k++) {
    const angle = 125 * Math.PI / 180 + (110 * Math.PI / 180) * k / 22;
    cap.push([40 * Math.cos(angle), 40 * Math.sin(angle)]);
  }
  cap.push([-18, -43], [0, -43], [0, -boreRadius]);
  for (let k = 1; k < 28; k++) {
    const angle = -Math.PI / 2 - Math.PI * k / 28;
    cap.push([boreRadius * Math.cos(angle), boreRadius * Math.sin(angle)]);
  }
  cap.push([0, boreRadius]);

  const bolts = [];
  for (const z of [-35, 35]) {
    const shank = new THREE.CylinderGeometry(4.2, 4.2, 48, 14);
    shank.translate(0, -3, z);
    const head = Geometry.hexPrism(13, 6);
    head.translate(0, 15, z);
    const nut = Geometry.hexPrism(13, 7);
    nut.translate(0, -25, z);
    bolts.push(shank, head, nut);
  }
  const bush = Geometry.lathe([[11.55, 0], [13.5, 0], [13.5, 20], [11.55, 20], [11.55, 0]], 36, 0, undefined, true);
  Geometry.rotateToX(bush);
  bush.translate(-10, L, 0);

  return {
    rod: Geometry.mergeGeometries(parts),
    cap: Geometry.extrudeAlongX(Geometry.polygonShape(cap), -spec.rodWidth / 2, spec.rodWidth / 2, bevel),
    bolts: Geometry.mergeGeometries(bolts),
    bush,
    shells: Geometry.mergeGeometries([
      builders.halfShellUpperLower(spec.crankpinDiameter / 2 + 0.05, boreRadius, -9.4, 9.4, true),
      builders.halfShellUpperLower(spec.crankpinDiameter / 2 + 0.05, boreRadius, -9.4, 9.4, false),
    ]),
  };
}

function pistonsAndRods({ spec, materials, tag }) {
  const solid = materials.solid;
  const piston = pistonGeometries(spec), rod = rodGeometries(spec);
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0x3b3a37, side: THREE.DoubleSide });
  const add = (group, geometry, material, part) => {
    const mesh = tag(new THREE.Mesh(geometry, material), part, 'pistons');
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const pistons = [], rods = [];
  spec.cylinders.forEach((cylinder, index) => {
    const pistonGroup = new THREE.Group();
    add(pistonGroup, piston.body, solid.piston, 'piston');
    add(pistonGroup, piston.crown, solid.piston, 'piston');
    add(pistonGroup, piston.bosses, solid.piston, 'piston');
    add(pistonGroup, cylinder.sign > 0 ? piston.arrowRight : piston.arrowLeft, arrowMaterial, 'piston').castShadow = false;
    add(pistonGroup, piston.rings, solid.ring, 'rings');
    add(pistonGroup, piston.pin, solid.pin, 'pin');
    pistonGroup.quaternion.copy(Banks.rotation(spec, index));
    pistons.push(pistonGroup);

    const rodGroup = new THREE.Group();
    add(rodGroup, rod.rod, solid.rod, 'rod');
    add(rodGroup, rod.cap, solid.rod, 'rod');
    add(rodGroup, rod.bolts, solid.rodBolt, 'rod');
    add(rodGroup, rod.bush, solid.rodBush, 'rod');
    add(rodGroup, rod.shells, solid.bearingRod, 'bearingRod');
    rods.push(rodGroup);
  });

  return {
    pistons, rods,
    update(crankAngle) {
      spec.cylinders.forEach((cylinder, index) => {
        const position = spec.pistonPosition(index, crankAngle);
        const axis = spec.cylinderAxis(index);
        pistons[index].position.set(cylinder.x, position.crownDistance * axis.y, position.crownDistance * axis.z);
        rods[index].position.set(cylinder.x, position.crankpinY, position.crankpinZ);
        rods[index].rotation.x = position.rodAngle;
      });
    },
  };
}

builders.pistonsAndRods = pistonsAndRods;
})();
