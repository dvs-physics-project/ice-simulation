/*
 * V-образный дизель: коленчатый вал с шестернями, шкивом, гасителем крутильных колебаний и маховиком,
 * коренные вкладыши и упорные полукольца.
 *
 *   halfShell(innerRadius, outerRadius, x0, x1, upper) — верхняя или нижняя половина вкладыша
 *   gearGeometry(teeth, module, phase, x0, x1, options) — эвольвентная шестерня с отверстиями и ступицей;
 *                                                          phase поворачивает зубья для зацепления
 *   crankshaft(context) → { group, fixed, update(crankAngle) }
 *     group — всё, что вращается с валом (в том числе шестерня масляного насоса и шкив ремня);
 *     fixed — вкладыши, они неподвижны.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const DEG = window.EngineMath.DEG;

function webOutline(spec) {
  const bossRadius = 52, counterweightRadius = 128, halfAngle = 62 * DEG;
  const points = [];
  for (let degrees = -80; degrees <= 80; degrees += 5) {
    const angle = degrees * DEG;
    points.push([spec.crankRadius + bossRadius * Math.cos(angle), bossRadius * Math.sin(angle)]);
  }
  points.push([30, 64], [-10, 84]);
  for (let k = 0; k <= 26; k++) {
    const angle = Math.PI - halfAngle + 2 * halfAngle * k / 26;
    points.push([counterweightRadius * Math.cos(angle), counterweightRadius * Math.sin(angle)]);
  }
  points.push([-10, -84], [30, -64]);
  return Geometry.smoothClosedShape(points, 220);
}

function halfShell(innerRadius, outerRadius, x0, x1, upper) {
  const gap = 0.02;
  const geometry = Geometry.lathe([[innerRadius, 0], [outerRadius, 0], [outerRadius, x1 - x0], [innerRadius, x1 - x0], [innerRadius, 0]],
    44, upper ? Math.PI + gap : gap, Math.PI - 2 * gap, true);
  Geometry.rotateToX(geometry);
  return geometry.translate(x0, 0, 0);
}

function gearGeometry(teeth, module, phase, x0, x1, options) {
  const { bore = 14, hub = 0, holes = 0, holeRadius = 0, holeCircle = 0 } = options || {};
  const cutouts = [Geometry.circleHole(0, 0, bore, true)];
  for (let k = 0; k < holes; k++) {
    const angle = k / holes * Math.PI * 2 + 0.3;
    cutouts.push(Geometry.circleHole(holeCircle * Math.cos(angle), holeCircle * Math.sin(angle), holeRadius, true));
  }
  const parts = [Geometry.extrudeAlongX(Geometry.involuteGearShape(teeth, module, { phase, holes: cutouts }), x0, x1, { curveSegments: 24 })];
  if (hub) parts.push(Geometry.tubeAlongX(bore, hub, x0 - 6, x1 + 6, 48));
  return Geometry.mergeGeometries(parts);
}

function forgedBody(spec) {
  const outline = webOutline(spec);
  const parts = [];
  spec.crankpinX.forEach((pinX, index) => {
    const halfPin = spec.crankpinWidth / 2;
    for (const webStart of [pinX - halfPin - spec.webThickness, pinX + halfPin]) {
      const web = new THREE.ExtrudeGeometry(outline, {
        depth: spec.webThickness - 3, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.5, bevelSegments: 2, curveSegments: 6,
      });
      web.rotateZ(spec.crankpinAngle[index]);
      web.translate(0, 0, webStart + 1.5);
      Geometry.shapeToYZ(web);
      parts.push(web);
    }
  });
  const front = spec.mainJournalX[0] - spec.mainJournalWidth / 2, rear = spec.mainJournalX[4] + spec.mainJournalWidth / 2;
  parts.push(
    Geometry.cylinderAlongX(40, front - 30, front, 48),
    Geometry.cylinderAlongX(36, front - 120, front - 30, 44),
    Geometry.cylinderAlongX(30, front - 182, front - 120, 40),
    Geometry.cylinderAlongX(42, rear, rear + 28, 48));
  return parts;
}

function polishedJournals(spec) {
  const parts = spec.mainJournalX.map(x =>
    Geometry.cylinderAlongX(spec.mainJournalDiameter / 2, x - spec.mainJournalWidth / 2, x + spec.mainJournalWidth / 2, 56));
  spec.crankpinX.forEach((pinX, index) => {
    const crankpin = Geometry.cylinderAlongX(spec.crankpinDiameter / 2, pinX - spec.crankpinWidth / 2, pinX + spec.crankpinWidth / 2, 52);
    crankpin.translate(0, spec.crankRadius * Math.cos(spec.crankpinAngle[index]), spec.crankRadius * Math.sin(spec.crankpinAngle[index]));
    parts.push(crankpin);
  });
  return parts;
}

function oilHoles(spec) {
  const holes = spec.mainJournalX.map(x => {
    const hole = Geometry.cylinderAlongX(3.6, -0.5, 0.5, 12);
    hole.rotateZ(Math.PI / 2);
    return hole.translate(x, spec.mainJournalDiameter / 2, 0);
  });
  spec.crankpinX.forEach((pinX, index) => {
    const angle = spec.crankpinAngle[index];
    for (const offset of [-18.5, 18.5]) {
      const hole = Geometry.cylinderAlongX(3.4, -0.5, 0.5, 12);
      hole.rotateZ(Math.PI / 2);
      hole.translate(0, spec.crankpinDiameter / 2, 0);
      hole.rotateX(angle + 0.9 * Math.PI);
      holes.push(hole.translate(pinX + offset, spec.crankRadius * Math.cos(angle), spec.crankRadius * Math.sin(angle)));
    }
  });
  return Geometry.mergeGeometries(holes);
}

function vBeltPulley(spec) {
  const profile = [[36, 0], [36, 40], [62, 40], [62, 36], [84, 34], [101, 34]];
  for (const grooveCenter of [26, 10]) profile.push([101, grooveCenter + 7.5], [90, grooveCenter + 2.5], [90, grooveCenter - 2.5], [101, grooveCenter - 7.5]);
  profile.push([101, 2], [84, 2], [62, 4], [62, 0], [36, 0]);
  const pulley = Geometry.lathe(profile, 80, 0, undefined, true);
  Geometry.rotateToX(pulley);
  return pulley.translate(spec.beltX - 18, 0, 0);
}

function noseParts(front) {
  const damper = Geometry.lathe([[30, 0], [140, 0], [140, 34], [30, 34], [30, 0]], 96, 0, undefined, true);
  Geometry.rotateToX(damper);
  damper.translate(front - 180, 0, 0);
  const bolts = [];
  for (let k = 0; k < 12; k++) {
    const angle = k / 12 * Math.PI * 2, bolt = Geometry.hexPrism(14, 7);
    Geometry.rotateToX(bolt);
    bolts.push(bolt.translate(front - 186, 95 * Math.cos(angle), 95 * Math.sin(angle)));
  }
  const noseBolt = Geometry.hexPrism(36, 14);
  Geometry.rotateToX(noseBolt);
  bolts.push(noseBolt.translate(front - 196, 0, 0));
  return { damper, bolts: Geometry.mergeGeometries(bolts) };
}

function flywheelParts(x) {
  const disc = Geometry.lathe([[44, 0], [96, 0], [104, 8], [200, 8], [206, 0], [240, 0], [240, 62], [226, 62], [226, 60],
    [128, 60], [120, 54], [96, 54], [96, 40], [44, 40], [44, 0]], 112, 0, undefined, true);
  Geometry.rotateToX(disc);
  disc.translate(x, 0, 0);
  const face = Geometry.lathe([[128, 60.2], [225, 60.2], [225, 61], [128, 61], [128, 60.2]], 112, 0, undefined, true);
  Geometry.rotateToX(face);
  face.translate(x, 0, 0);
  const ringGear = Geometry.extrudeAlongX(Geometry.ringGearShape(150, 241, 248, 236), x + 2, x + 20, { curveSegments: 64 });
  const bolts = [];
  for (let k = 0; k < 8; k++) {
    const angle = k / 8 * Math.PI * 2 + Math.PI / 8, bolt = Geometry.hexPrism(16, 8);
    Geometry.rotateToX(bolt);
    bolts.push(bolt.translate(x + 62, 58 * Math.cos(angle), 58 * Math.sin(angle)));
  }
  return { disc, face, ringGear, bolts: Geometry.mergeGeometries(bolts) };
}

function crankshaft({ spec, materials, tag }) {
  const solid = materials.solid;
  const group = new THREE.Group();
  const add = (geometry, material, part, layer) => group.add(tag(new THREE.Mesh(geometry, material), part, layer));
  const front = spec.mainJournalX[0] - spec.mainJournalWidth / 2, rear = spec.mainJournalX[4] + spec.mainJournalWidth / 2;

  add(Geometry.cylinderAlongX(72, rear + 28, rear + 40, 64), solid.crankForged, 'crank', 'flywheel');
  add(Geometry.mergeGeometries(forgedBody(spec)), solid.crankForged, 'crank', 'crank');
  add(Geometry.mergeGeometries(polishedJournals(spec)), solid.crankJournal, 'crank', 'crank');
  add(oilHoles(spec), new THREE.MeshBasicMaterial({ color: 0x0b0c0e }), 'crank', 'crank');

  const crankGear = spec.gears.crank;
  add(gearGeometry(crankGear.teeth, spec.gearModule, crankGear.phase, spec.gearX - spec.gearWidth / 2, spec.gearX + spec.gearWidth / 2, { bore: 42 }),
    solid.crankGear, 'crankGear', 'gears');
  const oilDrive = spec.frontGear;
  add(gearGeometry(oilDrive.teeth, spec.gearModule, 0, oilDrive.x - 10, oilDrive.x + 10, { bore: 40, holes: 5, holeRadius: 16, holeCircle: 64 }),
    solid.oilGear, 'oilPump', 'aux');

  add(vBeltPulley(spec), solid.crankPulley, 'pulley', 'aux');
  const nose = noseParts(front);
  add(nose.damper, solid.damper, 'pulley', 'aux');
  add(nose.bolts, solid.noseBolt, 'crank', 'crank');

  const flywheel = flywheelParts(rear + 40);
  add(flywheel.disc, solid.flywheel, 'flywheel', 'flywheel');
  add(flywheel.face, solid.flywheelFace, 'flywheel', 'flywheel');
  add(flywheel.ringGear, solid.ringGear, 'flywheel', 'flywheel');
  add(flywheel.bolts, solid.noseBolt, 'flywheel', 'flywheel');
  group.traverse(object => { if (object.isMesh) object.castShadow = object.receiveShadow = true; });

  const fixed = new THREE.Group();
  const mainShells = [];
  spec.mainJournalX.forEach(x => {
    for (const upper of [true, false]) mainShells.push(halfShell(spec.mainJournalDiameter / 2 + 0.05, spec.mainJournalDiameter / 2 + 2.4, x - 18, x + 18, upper));
  });
  fixed.add(tag(new THREE.Mesh(Geometry.mergeGeometries(mainShells), solid.bearingMain), 'bearingMain', 'crank'));
  const thrustX = spec.mainJournalX[4], halfWidth = spec.mainJournalWidth / 2, thrustRings = [];
  for (const upper of [true, false]) {
    thrustRings.push(halfShell(49, 66, thrustX - halfWidth - 0.2, thrustX - halfWidth + 2.4, upper));
    thrustRings.push(halfShell(49, 66, thrustX + halfWidth - 2.4, thrustX + halfWidth + 0.2, upper));
  }
  fixed.add(tag(new THREE.Mesh(Geometry.mergeGeometries(thrustRings), solid.thrust), 'thrust', 'crank'));
  fixed.traverse(object => { if (object.isMesh) object.castShadow = object.receiveShadow = true; });

  return { group, fixed, update(crankAngle) { group.rotation.x = crankAngle; } };
}

window.EngineBuilders = window.EngineBuilders || {};
window.EngineBuilders.v8 = Object.assign(window.EngineBuilders.v8 || {}, { halfShell, gearGeometry, crankshaft });
})();
