/*
 * Рядный двигатель: поршни с кольцами и пальцами, шатуны с крышками, болтами, втулкой и вкладышами.
 *
 *   pistonsAndRods(context) → { pistons, rods, update(crankAngle) }
 *     update ставит каждый поршень на высоту из spec.pistonPosition и поворачивает шатун
 *     вокруг шатунной шейки на угол rodAngle.
 *
 * Внутри: pistonGeometries — днище с канавками, юбка, бобышки, кольца, палец, выточки под клапаны;
 *         rodGeometries    — двутавровый стержень, кривошипная и поршневая головки, крышка, болты.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const { INTAKE, EXHAUST } = window.EngineSpecs.i4;

function pistonCrown(spec) {
  const R = spec.pistonRadius;
  return Geometry.lathe([
    [0, -7], [29.5, -7], [29.5, -19.5], [R, -19.5],
    [R, -17.2], [32.9, -17.2], [32.9, -14.0], [R, -14.0],
    [R, -11.3], [32.9, -11.3], [32.9, -9.7], [R, -9.7],
    [R, -6.6], [32.9, -6.6], [32.9, -5.0], [R, -5.0],
    [R, -0.9], [R - 0.9, 0], [0, 0]], 64, 0, undefined, true);
}

function pistonSkirt(spec) {
  const R = spec.pistonRadius;
  const profile = [[33.3, -19.5], [R - 0.05, -19.5], [R - 0.05, -40], [R - 0.3, -52], [33.3, -52], [33.3, -19.5]];
  const span = 100 * Math.PI / 180;
  return Geometry.mergeGeometries([
    Geometry.lathe(profile, 28, -span / 2, span, true),
    Geometry.lathe(profile, 28, Math.PI - span / 2, span, true)]);
}

function pinBosses(spec) {
  const parts = [];
  for (const side of [-1, 1]) {
    const boss = Geometry.cylinderAlongX(12.6, side < 0 ? -29.2 : 10.8, side < 0 ? -10.8 : 29.2, 28);
    boss.translate(0, -spec.compressionHeight, 0);
    parts.push(boss);
    const strut = new THREE.BoxGeometry(18.4, 24, 11);
    strut.translate(side * 20, -21, 0);
    parts.push(strut);
  }
  return Geometry.mergeGeometries(parts);
}

function pistonRings() {
  const ring = (top, bottom, innerRadius, gapAngle) => Geometry.lathe(
    [[innerRadius, top], [36, top], [36, bottom], [innerRadius, bottom], [innerRadius, top]],
    64, gapAngle, Math.PI * 2 - 2 * gapAngle, true);
  return Geometry.mergeGeometries([
    ring(-6.5, -5.1, 33.0, 0.012), ring(-11.2, -9.8, 33.0, 0.012),
    ring(-17.1, -16.3, 33.0, 0.01), ring(-14.9, -14.1, 33.0, 0.01),
  ]);
}

function oilRingExpander() {
  return Geometry.lathe([[33.05, -16.3], [35.2, -16.3], [35.2, -14.9], [33.05, -14.9], [33.05, -16.3]], 64, 0, undefined, true);
}

function pistonPin(spec) {
  const pinLength = 59;
  const pin = Geometry.lathe([[4.6, 0], [spec.pinDiameter / 2, 0], [spec.pinDiameter / 2, pinLength], [4.6, pinLength], [4.6, 0]],
    32, 0, undefined, true);
  Geometry.rotateToX(pin);
  pin.translate(-29.5, -spec.compressionHeight, 0);
  const leftClip = new THREE.TorusGeometry(8.0, 0.75, 6, 28);
  leftClip.rotateY(Math.PI / 2);
  leftClip.translate(-29.6, -spec.compressionHeight, 0);
  const rightClip = leftClip.clone();
  rightClip.translate(59.2, 0, 0);
  return Geometry.mergeGeometries([pin, leftClip, rightClip]);
}

function valveReliefRings(spec) {
  const vertices = [];
  const segments = 64;
  for (const side of [INTAKE, EXHAUST]) {
    for (const offsetX of [-spec.valveOffsetX, spec.valveOffsetX]) {
      const outer = spec.valveHeadRadius[side] + 1.5;
      const inner = outer - 1.6;
      const centerZ = side * (spec.valveSeatZ + 3.5);
      const pointAt = (radius, angle) => [offsetX + radius * Math.cos(angle), 0.06, centerZ + radius * Math.sin(angle)];
      const insideCrown = angle =>
        Math.hypot(offsetX + outer * Math.cos(angle), centerZ + outer * Math.sin(angle)) < spec.pistonRadius - 1.6;
      for (let k = 0; k < segments; k++) {
        const a0 = k / segments * Math.PI * 2, a1 = (k + 1) / segments * Math.PI * 2;
        if (!insideCrown(a0) || !insideCrown(a1)) continue;
        const quad = [pointAt(inner, a0), pointAt(outer, a0), pointAt(outer, a1), pointAt(inner, a1)];
        vertices.push(...quad[0], ...quad[1], ...quad[2], ...quad[0], ...quad[2], ...quad[3]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

const BEAM_HALF_WIDTH = [[24, 26], [32, 15.5], [44, 12.2], [62, 10.4], [90, 8.9], [111, 8.0]];

function beamHalfWidth(x) {
  for (let k = 0; k < BEAM_HALF_WIDTH.length - 1; k++) {
    const [x0, w0] = BEAM_HALF_WIDTH[k], [x1, w1] = BEAM_HALF_WIDTH[k + 1];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return w0 + (w1 - w0) * t;
    }
  }
  return 8.0;
}

function bigEndArc(points, boreRadius, direction) {
  for (let k = 1; k < 24; k++) {
    const angle = -Math.PI / 2 + direction * Math.PI * k / 24;
    points.push([boreRadius * Math.cos(angle), boreRadius * Math.sin(angle)]);
  }
}

function rodWebOutline(rodLength, boreRadius) {
  const eyeRadius = 13.5;
  const eyeAngle = Math.PI - Math.asin(8.0 / eyeRadius);
  const points = [[0, 36], [9, 36], [17, 33.5]];
  for (let x = 24; x <= 111; x += 3) points.push([x, beamHalfWidth(x)]);
  for (let k = 0; k <= 24; k++) {
    const angle = eyeAngle - (2 * eyeAngle) * k / 24;
    points.push([rodLength + eyeRadius * Math.cos(angle), eyeRadius * Math.sin(angle)]);
  }
  for (let x = 111; x >= 24; x -= 3) points.push([x, -beamHalfWidth(x)]);
  points.push([17, -33.5], [9, -36], [0, -36], [0, -boreRadius]);
  bigEndArc(points, boreRadius, 1);
  points.push([0, boreRadius]);
  return points;
}

function rodGeometries(spec) {
  const rodLength = spec.rodLength;
  const boreRadius = spec.rodBigEndBore / 2;
  const bevel = { bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.6, bevelSegments: 1, curveSegments: 12 };

  const webShape = Geometry.polygonShape(rodWebOutline(rodLength, boreRadius));
  webShape.holes.push(Geometry.circleHole(rodLength, 0, 10.45, true));
  const web = Geometry.extrudeAlongX(webShape, -3.6, 3.6, { curveSegments: 20 });

  const bigEndPoints = [[0, 36], [9, 36], [17, 33.5], [24, 26], [30, 16], [32, 0], [30, -16], [24, -26],
    [17, -33.5], [9, -36], [0, -36], [0, -boreRadius]];
  bigEndArc(bigEndPoints, boreRadius, 1);
  bigEndPoints.push([0, boreRadius]);
  const bigEnd = Geometry.extrudeAlongX(Geometry.polygonShape(bigEndPoints), -10.5, 10.5, bevel);

  const eye = new THREE.Shape();
  eye.absarc(rodLength, 0, 13.5, 0, Math.PI * 2, false);
  eye.holes.push(Geometry.circleHole(rodLength, 0, 10.45, true));
  const smallEnd = Geometry.extrudeAlongX(eye, -9.5, 9.5,
    { bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.5, bevelSegments: 1, curveSegments: 32 });

  const flanges = [];
  for (const side of [-1, 1]) {
    const points = [];
    for (let x = 27; x <= 112; x += 3) points.push([x, side * beamHalfWidth(x)]);
    for (let x = 112; x >= 27; x -= 3) points.push([x, side * (beamHalfWidth(x) - 3.4)]);
    flanges.push(Geometry.extrudeAlongX(Geometry.polygonShape(points), -8.5, 8.5));
  }

  const capPoints = [[0, 36], [-15, 36], [-15, 24.5]];
  for (let k = 0; k <= 20; k++) {
    const angle = Math.PI * 0.739 + (Math.PI * 0.522) * k / 20;
    capPoints.push([31 * Math.cos(angle), 31 * Math.sin(angle)]);
  }
  capPoints.push([-15, -24.5], [-15, -36], [0, -36], [0, -boreRadius]);
  bigEndArc(capPoints, boreRadius, -1);
  capPoints.push([0, boreRadius]);

  const bolts = [];
  for (const z of [-29, 29]) {
    const shank = new THREE.CylinderGeometry(4, 4, 46, 14);
    shank.translate(0, -1, z);
    const head = Geometry.hexPrism(12, 6);
    head.translate(0, 20.5, z);
    const nut = Geometry.hexPrism(13, 7);
    nut.translate(0, -22, z);
    bolts.push(shank, head, nut);
  }

  const bush = Geometry.lathe([[9.05, 0], [10.45, 0], [10.45, 19], [9.05, 19], [9.05, 0]], 32, 0, undefined, true);
  Geometry.rotateToX(bush);
  bush.translate(-9.5, rodLength, 0);

  const { halfShell } = window.EngineBuilders.i4;
  return {
    rod: Geometry.mergeGeometries([web, bigEnd, smallEnd, ...flanges]),
    cap: Geometry.extrudeAlongX(Geometry.polygonShape(capPoints), -10.5, 10.5, bevel),
    bolts: Geometry.mergeGeometries(bolts),
    bush,
    shells: Geometry.mergeGeometries([halfShell(21.05, 22.45, -9.8, 9.8, true), halfShell(21.05, 22.45, -9.8, 9.8, false)]),
  };
}

function pistonsAndRods({ spec, materials, tag }) {
  const solid = materials.solid;
  const piston = {
    crown: pistonCrown(spec), skirt: pistonSkirt(spec), bosses: pinBosses(spec), reliefs: valveReliefRings(spec),
    rings: pistonRings(), expander: oilRingExpander(), pin: pistonPin(spec),
  };
  const rod = rodGeometries(spec);
  const reliefMaterial = new THREE.MeshStandardMaterial({
    color: materials.srgb('#5b5852'), metalness: 0.5, roughness: 0.7, side: THREE.DoubleSide,
  });

  const groupOf = (x, parts) => {
    const group = new THREE.Group();
    parts.forEach(([geometry, material, part]) => {
      const mesh = new THREE.Mesh(geometry, material);
      tag(mesh, part, 'pistons');
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    });
    group.position.x = x;
    return group;
  };

  const pistons = [], rods = [];
  spec.cylinderX.forEach(x => {
    pistons.push(groupOf(x, [
      [piston.crown, solid.piston, 'piston'],
      [piston.skirt, solid.piston, 'piston'],
      [piston.bosses, solid.piston, 'piston'],
      [piston.reliefs, reliefMaterial, 'piston'],
      [piston.rings, solid.ring, 'rings'],
      [piston.expander, solid.ring, 'rings'],
      [piston.pin, solid.pin, 'pin'],
    ]));
    rods.push(groupOf(x, [
      [rod.rod, solid.rod, 'rod'],
      [rod.cap, solid.rod, 'rod'],
      [rod.bolts, solid.rodBolt, 'rod'],
      [rod.bush, solid.rodBush, 'rod'],
      [rod.shells, solid.bearingRod, 'bearingRod'],
    ]));
  });

  return {
    pistons, rods,
    update(crankAngle) {
      spec.cylinderX.forEach((x, cylinder) => {
        const position = spec.pistonPosition(cylinder, crankAngle);
        pistons[cylinder].position.y = position.crownY;
        rods[cylinder].position.set(x, position.crankpinY, position.crankpinZ);
        rods[cylinder].rotation.x = position.rodAngle;
      });
    },
  };
}

window.EngineBuilders.i4.pistonsAndRods = pistonsAndRods;
})();
