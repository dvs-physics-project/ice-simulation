/*
 * V-образный дизель: поршни с камерой сгорания в днище и выточками под клапаны, кольца, пальцы,
 * шатуны с косым разъёмом крышки, «мокрые» гильзы цилиндров с уплотнительными кольцами.
 *
 *   pistonsAndRods(context) → { pistons, rods, liners, update(crankAngle) }
 *     Поршень и гильза каждого цилиндра повёрнуты на ось своего ряда; update ставит поршень на расстояние
 *     crownDistance от оси вала и поворачивает шатун на угол rodAngle.
 *
 * Выточки под клапаны (valvePocketGeometries) — плоские кольца и круги на днище; часть, попадающая
 * в чашу камеры сгорания или за край поршня, отбрасывается.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Banks = window.CylinderBanks;
const builders = window.EngineBuilders.v8;

function flatGeometry(positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function valvePocketGeometries(spec) {
  const R = spec.pistonRadius, segments = 96;
  const floor = [], rim = [];
  const onFlatCrown = ([u, v]) => { const d = Math.hypot(u, v); return d > 41.8 && d < R - 1.2; };
  for (const [offsetX, radius] of [[-spec.valveOffsetX, spec.valveHeadRadius.intake + 2], [spec.valveOffsetX, spec.valveHeadRadius.exhaust + 2]]) {
    const at = (r, angle) => [offsetX + r * Math.cos(angle), spec.valveSide + r * Math.sin(angle)];
    for (let k = 0; k < segments; k++) {
      const a0 = k / segments * Math.PI * 2, a1 = (k + 1) / segments * Math.PI * 2;
      const outer0 = at(radius, a0), outer1 = at(radius, a1), inner0 = at(radius - 1.6, a0), inner1 = at(radius - 1.6, a1);
      if ([outer0, outer1, inner0, inner1].every(onFlatCrown)) {
        const lift = p => [p[0], 0.08, p[1]];
        rim.push(...lift(inner0), ...lift(outer0), ...lift(outer1), ...lift(inner0), ...lift(outer1), ...lift(inner1));
      }
      for (let ring = 0; ring < 6; ring++) {
        const r0 = (radius - 1.6) * ring / 6, r1 = (radius - 1.6) * (ring + 1) / 6;
        const quad = [at(r0, a0), at(r1, a0), at(r1, a1), at(r0, a1)];
        if (quad.every(onFlatCrown)) {
          const [a, b, c, d] = quad.map(p => [p[0], 0.05, p[1]]);
          floor.push(...a, ...b, ...c, ...a, ...c, ...d);
        }
      }
    }
  }
  return { floor: flatGeometry(floor), rim: flatGeometry(rim) };
}

function pistonGeometries(spec) {
  const R = spec.pistonRadius, H = spec.pistonHeight;
  const bowl = [[0, -10], [4, -11.5], [10, -16], [17, -21.5], [24, -23], [30, -21], [34.5, -15.5], [37, -8], [39, -2.5], [41.5, 0]];
  const skirt = [[R - 0.8, 0], [R, -0.8], [R, -11], [58.2, -11], [58.2, -14], [R, -14], [R, -21], [58.2, -21], [58.2, -24], [R, -24],
    [R, -31], [58.2, -31], [58.2, -37], [R, -37], [R, -138], [R - 1.2, -H], [57, -H], [57, -62], [46, -52], [34, -44], [0, -44]];

  const bosses = [];
  for (const side of [-1, 1]) {
    bosses.push(Geometry.cylinderAlongX(31, side < 0 ? -57 : 21, side < 0 ? -21 : 57, 32).translate(0, -spec.compressionHeight, 0));
    bosses.push(new THREE.BoxGeometry(30, 40, 26).translate(side * 39, -64, 0));
  }
  const ring = (top, bottom, gapAngle) => Geometry.lathe([[58.4, top], [R + 0.15, top], [R + 0.15, bottom], [58.4, bottom], [58.4, top]],
    56, gapAngle, Math.PI * 2 - 2 * gapAngle, true);

  const pin = Geometry.lathe([[spec.pinInnerDiameter / 2, 0], [spec.pinOuterDiameter / 2, 0], [spec.pinOuterDiameter / 2, 104],
    [spec.pinInnerDiameter / 2, 104], [spec.pinInnerDiameter / 2, 0]], 36, 0, undefined, true);
  Geometry.rotateToX(pin);
  pin.translate(-52, -spec.compressionHeight, 0);
  const frontClip = new THREE.TorusGeometry(22.5, 1.2, 6, 32);
  frontClip.rotateY(Math.PI / 2);
  frontClip.translate(-52.6, -spec.compressionHeight, 0);
  const rearClip = frontClip.clone().translate(105.2, 0, 0);

  const pockets = valvePocketGeometries(spec);
  return {
    body: Geometry.lathe(bowl.concat(skirt), 56, 0, undefined, true),
    bosses: Geometry.mergeGeometries(bosses),
    rings: Geometry.mergeGeometries([ring(-13.8, -11.2, 0.01), ring(-23.8, -21.2, 0.01), ring(-36.8, -31.2, 0.006)]),
    pin: Geometry.mergeGeometries([pin, frontClip, rearClip]),
    pocketFloor: pockets.floor,
    pocketRim: pockets.rim,
  };
}

const BEAM_HALF_WIDTH = [[42, 48], [58, 30], [78, 23], [110, 20], [170, 17.5], [212, 16]];

function beamHalfWidth(y) {
  const table = BEAM_HALF_WIDTH;
  if (y <= table[0][0]) return table[0][1];
  for (let k = 0; k < table.length - 1; k++) {
    if (y <= table[k + 1][0]) {
      const t = (y - table[k][0]) / (table[k + 1][0] - table[k][0]);
      return table[k][1] + (table[k + 1][1] - table[k][1]) * t;
    }
  }
  return table[table.length - 1][1];
}

function bigEndBore(boreRadius, fromAngle, direction) {
  const points = [];
  for (let k = 1; k < 28; k++) {
    const angle = fromAngle + direction * Math.PI * k / 28;
    points.push([boreRadius * Math.cos(angle), boreRadius * Math.sin(angle)]);
  }
  return points;
}

function rodGeometries(spec) {
  const L = spec.rodLength, boreRadius = spec.rodBigEndBore / 2;
  const eyeRadius = 35, eyeAngle = Math.PI - Math.asin(16 / eyeRadius);
  const bore = bigEndBore(boreRadius, -Math.PI / 2, 1);
  const bevel = { bevelEnabled: true, bevelThickness: 1, bevelSize: 0.8, bevelSegments: 1, curveSegments: 12 };

  const outline = [[0, 66], [16, 66], [30, 61]];
  for (let y = 42; y <= 212; y += 5) outline.push([y, beamHalfWidth(y)]);
  for (let k = 0; k <= 28; k++) {
    const angle = eyeAngle - (2 * eyeAngle) * k / 28;
    outline.push([L + eyeRadius * Math.cos(angle), eyeRadius * Math.sin(angle)]);
  }
  for (let y = 212; y >= 42; y -= 5) outline.push([y, -beamHalfWidth(y)]);
  outline.push([30, -61], [16, -66], [0, -66], [0, -boreRadius], ...bore, [0, boreRadius]);
  const web = Geometry.polygonShape(outline);
  web.holes.push(Geometry.circleHole(L, 0, 27.5, true));
  const parts = [Geometry.extrudeAlongX(web, -7, 7, { curveSegments: 24 })];

  const bigEnd = [[0, 66], [16, 66], [30, 61], [42, 48], [52, 36], [58, 0], [52, -36], [42, -48], [30, -61], [16, -66], [0, -66], [0, -boreRadius],
    ...bore, [0, boreRadius]];
  parts.push(Geometry.extrudeAlongX(Geometry.polygonShape(bigEnd), -spec.rodWidth / 2, spec.rodWidth / 2, bevel));
  const eye = new THREE.Shape();
  eye.absarc(L, 0, eyeRadius, 0, Math.PI * 2, false);
  eye.holes.push(Geometry.circleHole(L, 0, 27.5, true));
  parts.push(Geometry.extrudeAlongX(eye, -17, 17, { bevelEnabled: true, bevelThickness: 1, bevelSize: 0.7, bevelSegments: 1, curveSegments: 40 }));
  for (const side of [-1, 1]) {
    const flange = [];
    for (let y = 46; y <= 214; y += 4) flange.push([y, side * beamHalfWidth(y)]);
    for (let y = 214; y >= 46; y -= 4) flange.push([y, side * (beamHalfWidth(y) - 5.5)]);
    parts.push(Geometry.extrudeAlongX(Geometry.polygonShape(flange), -13, 13));
  }

  const cap = [[0, 66], [-26, 66], [-26, 46]];
  for (let k = 0; k <= 22; k++) {
    const angle = Math.PI * 0.742 + Math.PI * 0.516 * k / 22;
    cap.push([57 * Math.cos(angle), 57 * Math.sin(angle)]);
  }
  cap.push([-26, -46], [-26, -66], [0, -66], [0, -boreRadius], ...bigEndBore(boreRadius, -Math.PI / 2, -1), [0, boreRadius]);

  const bolts = [];
  for (const z of [-53, 53]) {
    bolts.push(new THREE.CylinderGeometry(6.5, 6.5, 66, 14).translate(0, 2, z));
    bolts.push(Geometry.hexPrism(19, 9).translate(0, -36, z));
  }
  const bush = Geometry.lathe([[25.05, 0], [27.5, 0], [27.5, 34], [25.05, 34], [25.05, 0]], 40, 0, undefined, true);
  Geometry.rotateToX(bush);
  bush.translate(-17, L, 0);
  const shellEdge = spec.rodWidth / 2 - 0.6;

  return {
    rod: Geometry.mergeGeometries(parts),
    cap: Geometry.extrudeAlongX(Geometry.polygonShape(cap), -spec.rodWidth / 2, spec.rodWidth / 2, bevel),
    bolts: Geometry.mergeGeometries(bolts),
    bush,
    shells: Geometry.mergeGeometries([
      builders.halfShell(40.05, boreRadius, -shellEdge, shellEdge, true), builders.halfShell(40.05, boreRadius, -shellEdge, shellEdge, false),
    ]),
  };
}

function linerGeometries(spec) {
  const top = spec.deckDistance, bottom = 160;
  const wall = Geometry.lathe([[62.6, bottom], [70, bottom], [70, 166], [73, 168], [73, 200], [70, 202], [70, top - 12], [76, top - 10],
    [76, top], [62.6, top], [62.6, bottom]], 56, 0, undefined, true);
  const lowerRing = new THREE.TorusGeometry(73.2, 2.4, 8, 56);
  lowerRing.rotateX(Math.PI / 2);
  lowerRing.translate(0, 178, 0);
  const upperRing = lowerRing.clone().translate(0, 13, 0);
  return { wall, sealRings: Geometry.mergeGeometries([lowerRing, upperRing]) };
}

function pistonsAndRods({ spec, materials, tag }) {
  const solid = materials.solid;
  const piston = pistonGeometries(spec), rod = rodGeometries(spec), liner = linerGeometries(spec);
  const pocketMaterial = new THREE.MeshStandardMaterial({ color: materials.srgb('#57534c'), metalness: 0.5, roughness: 0.7, side: THREE.DoubleSide });
  const pocketRimMaterial = new THREE.MeshBasicMaterial({ color: 0x2a2826, side: THREE.DoubleSide });
  const add = (group, geometry, material, part) => {
    const mesh = tag(new THREE.Mesh(geometry, material), part, 'pistons');
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const pistons = [], rods = [], liners = [];
  spec.cylinders.forEach((cylinder, index) => {
    const pistonGroup = new THREE.Group();
    add(pistonGroup, piston.body, solid.piston, 'piston');
    add(pistonGroup, piston.bosses, solid.piston, 'piston');
    add(pistonGroup, piston.pocketFloor, pocketMaterial, 'piston');
    add(pistonGroup, piston.pocketRim, pocketRimMaterial, 'piston');
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
    rodGroup.position.x = cylinder.x;
    rods.push(rodGroup);

    const linerGroup = new THREE.Group();
    const wall = add(linerGroup, liner.wall, solid.liner, 'liner');
    wall.castShadow = false;
    wall.renderOrder = 2;
    add(linerGroup, liner.sealRings, solid.oring, 'liner');
    linerGroup.position.set(cylinder.x, 0, 0);
    linerGroup.quaternion.copy(Banks.rotation(spec, index));
    liners.push(linerGroup);
  });

  return {
    pistons, rods, liners,
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
