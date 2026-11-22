/*
 * Рядный двигатель: коленчатый вал с маховиком, шкивами и коренными вкладышами.
 *
 *   crankshaft(context) → { group, fixed, update(crankAngle) }
 *     group — всё, что вращается с валом: щёки с противовесами, шейки, масляные отверстия,
 *             шкив ремня ГРМ, шкив генератора, болт носка, маховик с венцом;
 *     fixed — неподвижные детали на опорах вала: коренные вкладыши и упорные полукольца.
 *   halfShell(...) — половина тонкостенного вкладыша (нужна и для шатунов).
 */
(function () {
'use strict';

const Geometry = window.Geometry;

function webOutline(spec) {
  const points = [];
  for (let degrees = -78; degrees <= 78; degrees += 6) {
    const angle = degrees * Math.PI / 180;
    points.push([spec.crankRadius + spec.pinBossRadius * Math.cos(angle), spec.pinBossRadius * Math.sin(angle)]);
  }
  points.push([16, 33.5]);
  points.push([-6, 44]);
  const half = spec.counterweightHalfAngle;
  for (let angle = Math.PI - half; angle <= Math.PI + half + 1e-6; angle += (2 * half) / 22) {
    points.push([spec.counterweightRadius * Math.cos(angle), spec.counterweightRadius * Math.sin(angle)]);
  }
  points.push([-6, -44]);
  points.push([16, -33.5]);
  return Geometry.smoothClosedShape(points, 200);
}

function halfShell(innerRadius, outerRadius, x0, x1, upper) {
  const gap = 0.025;
  const width = x1 - x0;
  const profile = [[innerRadius, 0], [outerRadius, 0], [outerRadius, width], [innerRadius, width], [innerRadius, 0]];
  const geometry = Geometry.lathe(profile, 40, upper ? Math.PI + gap : gap, Math.PI - 2 * gap, true);
  Geometry.rotateToX(geometry);
  geometry.translate(x0, 0, 0);
  return geometry;
}

function forgedBody(spec) {
  const shape = webOutline(spec);
  const parts = [];
  spec.cylinderX.forEach((x, cylinder) => {
    for (const side of [-1, 1]) {
      const webStart = side < 0 ? x - spec.webInnerOffset - spec.webThickness : x + spec.webInnerOffset;
      const web = new THREE.ExtrudeGeometry(shape, {
        depth: spec.webThickness - 2.4, bevelEnabled: true, bevelThickness: 1.2,
        bevelSize: 1.2, bevelSegments: 2, curveSegments: 6,
      });
      web.rotateZ(spec.crankThrowAngle[cylinder]);
      web.translate(0, 0, webStart + 1.2);
      Geometry.shapeToYZ(web);
      parts.push(web);
    }
  });
  parts.push(Geometry.cylinderAlongX(20, -202, -182, 36));
  parts.push(Geometry.cylinderAlongX(17, -233, -202, 36));
  parts.push(Geometry.cylinderAlongX(15, -268, -233, 32));
  parts.push(Geometry.cylinderAlongX(38, 187, 193, 48));
  parts.push(Geometry.cylinderAlongX(42, 193, 197, 48));
  return Geometry.mergeGeometries(parts);
}

function polishedJournals(spec) {
  const { cylinderX, webInnerOffset, webThickness } = spec;
  const mainSpans = [[-182, cylinderX[0] - webInnerOffset - webThickness]];
  for (let k = 1; k <= 3; k++) {
    mainSpans.push([cylinderX[k - 1] + webInnerOffset + webThickness, cylinderX[k] - webInnerOffset - webThickness]);
  }
  mainSpans.push([cylinderX[3] + webInnerOffset + webThickness, 187]);

  const parts = mainSpans.map(([x0, x1]) => Geometry.cylinderAlongX(spec.mainJournalDiameter / 2, x0, x1, 48));
  cylinderX.forEach((x, cylinder) => {
    const crankpin = Geometry.cylinderAlongX(spec.crankpinDiameter / 2, x - webInnerOffset, x + webInnerOffset, 44);
    const throwAngle = spec.crankThrowAngle[cylinder];
    crankpin.translate(0, spec.crankRadius * Math.cos(throwAngle), spec.crankRadius * Math.sin(throwAngle));
    parts.push(crankpin);
  });
  return Geometry.mergeGeometries(parts);
}

function oilHoles(spec) {
  const holes = [];
  spec.mainJournalX.forEach((x, journal) => {
    const hole = Geometry.cylinderAlongX(2.6, -0.4, 0.4, 12);
    hole.rotateZ(Math.PI / 2);
    hole.translate(x + (journal === 0 ? -4 : 0), spec.mainJournalDiameter / 2, 0);
    holes.push(hole);
  });
  spec.cylinderX.forEach((x, cylinder) => {
    const throwAngle = spec.crankThrowAngle[cylinder];
    const hole = Geometry.cylinderAlongX(2.4, -0.4, 0.4, 12);
    hole.rotateZ(Math.PI / 2);
    hole.translate(0, spec.crankpinDiameter / 2, 0);
    hole.rotateX(throwAngle + Math.PI * 0.62);
    hole.translate(x, spec.crankRadius * Math.cos(throwAngle), spec.crankRadius * Math.sin(throwAngle));
    holes.push(hole);
  });
  return Geometry.mergeGeometries(holes);
}

function timingPulley(spec, toothPhase) {
  const radius = spec.pitchRadius(spec.teeth.crank);
  const x = spec.beltX;
  const outline = Geometry.timingPulleyShape(spec.teeth.crank, radius, {
    phase: toothPhase, holes: [Geometry.circleHole(0, 0, 17, true)],
  });
  return Geometry.mergeGeometries([
    Geometry.extrudeAlongX(outline, x - 13, x + 13, { curveSegments: 20 }),
    Geometry.tubeAlongX(17, radius + 4.5, x - 14.6, x - 13, 56),
    Geometry.tubeAlongX(17, radius + 4.5, x + 13, x + 14.6, 56),
  ]);
}

function alternatorPulley() {
  const ribs = 6, firstRib = 3, lastRib = 27, ribPitch = (lastRib - firstRib) / ribs;
  const profile = [[15, 0], [15, 31], [30, 31], [30, 27], [52, 25], [52, lastRib + 1.5], [63.5, lastRib + 1.5]];
  for (let rib = ribs; rib >= 0; rib--) {
    const ribX = firstRib + rib * ribPitch;
    profile.push([65, ribX]);
    if (rib > 0) profile.push([62.4, ribX - ribPitch / 2]);
  }
  profile.push([63.5, firstRib - 1.5], [52, firstRib - 1.5], [52, 6], [26, 4], [26, 0], [15, 0]);
  const geometry = Geometry.lathe(profile.map(([radius, x]) => [radius, x]), 72, 0, undefined, true);
  Geometry.rotateToX(geometry);
  geometry.translate(-264, 0, 0);
  return geometry;
}

function noseBolt() {
  const head = Geometry.hexPrism(22, 9);
  Geometry.rotateToX(head);
  head.translate(-277, 0, 0);
  return Geometry.mergeGeometries([head, Geometry.tubeAlongX(0, 17, -268, -264, 40)]);
}

const FLYWHEEL_X = 197;

function flywheelDisc() {
  const profile = [[18, 4], [45, 4], [52, 10], [110, 10], [116, 0], [128.6, 0], [128.6, 27],
    [120, 27], [120, 26], [75, 26], [70, 22], [45, 22], [45, 16], [18, 16], [18, 4]];
  const geometry = Geometry.lathe(profile, 96, 0, undefined, true);
  Geometry.rotateToX(geometry);
  geometry.translate(FLYWHEEL_X, 0, 0);
  return geometry;
}

function flywheelFrictionFace() {
  const geometry = Geometry.lathe([[75.5, 25.9], [119.5, 25.9], [119.5, 26.5], [75.5, 26.5], [75.5, 25.9]], 96, 0, undefined, true);
  Geometry.rotateToX(geometry);
  geometry.translate(FLYWHEEL_X, 0, 0);
  return geometry;
}

function flywheelBolts() {
  const bolts = [];
  for (let k = 0; k < 6; k++) {
    const angle = k / 6 * Math.PI * 2 + Math.PI / 6;
    const bolt = Geometry.hexPrism(12, 6);
    Geometry.rotateToX(bolt);
    bolt.translate(FLYWHEEL_X + 16, 30 * Math.cos(angle), 30 * Math.sin(angle));
    bolts.push(bolt);
  }
  return Geometry.mergeGeometries(bolts);
}

function crankshaft({ spec, materials, tag }, belt) {
  const solid = materials.solid;
  const group = new THREE.Group();
  group.name = 'crankshaft';
  const add = (geometry, material, part, layer) => {
    const mesh = new THREE.Mesh(geometry, material);
    tag(mesh, part, layer);
    group.add(mesh);
    return mesh;
  };

  add(forgedBody(spec), solid.crankForged, 'crank', 'crank');
  add(polishedJournals(spec), solid.crankJournal, 'crank', 'crank');
  add(oilHoles(spec), new THREE.MeshBasicMaterial({ color: 0x0b0c0e }), 'crank', 'crank');
  add(timingPulley(spec, belt.toothPhase.crank), solid.crankPulley, 'crankPulley', 'timing');
  add(alternatorPulley(), solid.accPulley, 'accPulley', 'aux');
  add(noseBolt(), solid.noseBolt, 'crank', 'crank');
  add(flywheelDisc(), solid.flywheel, 'flywheel', 'crank');
  add(flywheelFrictionFace(), solid.flywheelFace, 'flywheel', 'crank');
  add(Geometry.extrudeAlongX(Geometry.ringGearShape(104, 129.2, 133.5, 127.5), FLYWHEEL_X + 2, FLYWHEEL_X + 15, { curveSegments: 48 }),
    solid.ringGear, 'flywheel', 'crank');
  add(flywheelBolts(), solid.noseBolt, 'flywheel', 'crank');
  group.traverse(object => { if (object.isMesh) object.castShadow = object.receiveShadow = true; });

  const fixed = new THREE.Group();
  const shells = [];
  spec.mainJournalX.forEach(x => {
    for (const upper of [true, false]) {
      shells.push(halfShell(spec.mainJournalDiameter / 2 + 0.05, spec.mainJournalDiameter / 2 + 1.7, x - 9, x + 9, upper));
    }
  });
  const mainBearings = tag(new THREE.Mesh(Geometry.mergeGeometries(shells), solid.bearingMain), 'bearingMain', 'crank');
  const thrustWashers = tag(new THREE.Mesh(Geometry.mergeGeometries([
    halfShell(25, 36, 9.6, 12.1, true), halfShell(25, 36, -12.1, -9.6, true),
  ]), solid.thrust), 'thrust', 'crank');
  fixed.add(mainBearings, thrustWashers);
  fixed.traverse(object => { if (object.isMesh) object.castShadow = object.receiveShadow = true; });

  return {
    group, fixed,
    update(crankAngle) { group.rotation.x = crankAngle; },
  };
}

window.EngineBuilders = window.EngineBuilders || {};
window.EngineBuilders.i4 = Object.assign(window.EngineBuilders.i4 || {}, { crankshaft, halfShell });
})();
