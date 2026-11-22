/*
 * Оппозитный двигатель: коленчатый вал с маховиком и шестернёй ремня, коренные вкладыши.
 * Здесь же общие помощники для деталей, стоящих в рядах цилиндров:
 *
 *   sectionPoint(bank, along, side)            — точка ряда в плоскости сечения (y, z) для контуров Shape
 *                                                (поворот и точки в ряду — js/shared/banks.js)
 *   halfShellLeftRight(...), halfShellUpperLower(...) — половинки тонкостенного вкладыша
 *   markMaterial()                             — яркая метка установки ГРМ на шестерне
 *   crankshaft(context, belt) → { group, fixed, update(crankAngle) }
 */
(function () {
'use strict';

const Geometry = window.Geometry;

const sectionPoint = (bank, along, side) => [side, bank === 'right' ? -along : along];

function halfShell(innerRadius, outerRadius, x0, x1, segments, startAngle) {
  const gap = 0.02;
  const width = x1 - x0;
  const profile = [[innerRadius, 0], [outerRadius, 0], [outerRadius, width], [innerRadius, width], [innerRadius, 0]];
  const geometry = Geometry.lathe(profile, segments, startAngle + gap, Math.PI - 2 * gap, true);
  Geometry.rotateToX(geometry);
  geometry.translate(x0, 0, 0);
  return geometry;
}

const halfShellLeftRight = (innerRadius, outerRadius, x0, x1, side) =>
  halfShell(innerRadius, outerRadius, x0, x1, 44, side > 0 ? -Math.PI / 2 : Math.PI / 2);
const halfShellUpperLower = (innerRadius, outerRadius, x0, x1, upper) =>
  halfShell(innerRadius, outerRadius, x0, x1, 40, upper ? Math.PI : 0);
const markMaterial = () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a2a').convertSRGBToLinear() });

function webOutline(spec) {
  const bossRadius = 31, counterweightRadius = 64, halfAngle = 56 * Math.PI / 180;
  const points = [];
  for (let degrees = -80; degrees <= 80; degrees += 5) {
    const angle = degrees * Math.PI / 180;
    points.push([spec.crankRadius + bossRadius * Math.cos(angle), bossRadius * Math.sin(angle)]);
  }
  points.push([16, 34], [-6, 41]);
  for (let k = 0; k <= 22; k++) {
    const angle = Math.PI - halfAngle + 2 * halfAngle * k / 22;
    points.push([counterweightRadius * Math.cos(angle), counterweightRadius * Math.sin(angle)]);
  }
  points.push([-6, -41], [16, -34]);
  return Geometry.smoothClosedShape(points, 200);
}

function forgedBody(spec) {
  const shape = webOutline(spec), bevel = 1.2;
  const parts = [];
  spec.crankpinX.forEach((pinX, index) => {
    for (const webStart of [pinX - spec.crankpinWidth / 2 - spec.webThickness, pinX + spec.crankpinWidth / 2]) {
      const web = new THREE.ExtrudeGeometry(shape, {
        depth: spec.webThickness - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6,
      });
      web.rotateZ(spec.crankpinAngle[index]);
      web.translate(0, 0, webStart + bevel);
      Geometry.shapeToYZ(web);
      parts.push(web);
    }
  });
  const frontJournalEnd = spec.mainJournalX[0] - spec.mainJournalWidth / 2;
  const rearJournalEnd = spec.mainJournalX[4] + spec.mainJournalWidth / 2;
  parts.push(Geometry.cylinderAlongX(22, -137, frontJournalEnd, 44));
  parts.push(Geometry.cylinderAlongX(20, -151, -137, 44));
  parts.push(Geometry.cylinderAlongX(17, -179.5, -151, 40));
  parts.push(Geometry.cylinderAlongX(50, rearJournalEnd, 140, 56));
  parts.push(Geometry.cylinderAlongX(62, 140, spec.flywheelX, 64));
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
    const hole = Geometry.cylinderAlongX(2.8, -0.4, 0.4, 12);
    hole.rotateZ(Math.PI / 2);
    hole.translate(x, spec.mainJournalDiameter / 2, 0);
    return hole;
  });
  spec.crankpinX.forEach((pinX, index) => {
    const angle = spec.crankpinAngle[index];
    const hole = Geometry.cylinderAlongX(2.6, -0.4, 0.4, 12);
    hole.rotateZ(Math.PI / 2);
    hole.translate(0, spec.crankpinDiameter / 2, 0);
    hole.rotateX(angle + 0.62 * Math.PI);
    hole.translate(pinX, spec.crankRadius * Math.cos(angle), spec.crankRadius * Math.sin(angle));
    holes.push(hole);
  });
  return Geometry.mergeGeometries(holes);
}

function beltSprocket(spec, toothPhase) {
  const radius = spec.pitchRadius(spec.teeth.crank), x = spec.beltX;
  const outline = Geometry.timingPulleyShape(spec.teeth.crank, radius, { phase: toothPhase, holes: [Geometry.circleHole(0, 0, 17, true)] });
  const sprocket = Geometry.mergeGeometries([
    Geometry.extrudeAlongX(outline, x - 13, x + 13, { curveSegments: 20 }),
    Geometry.tubeAlongX(17, radius + 4.5, x - 14.6, x - 13, 56),
    Geometry.tubeAlongX(17, radius + 4.5, x + 13, x + 14.6, 56),
  ]);
  const arrow = new THREE.Shape();
  arrow.moveTo(radius + 4.2, -2.4);
  arrow.lineTo(radius + 4.2, 2.4);
  arrow.lineTo(radius - 1.5, 0);
  arrow.closePath();
  return { sprocket, timingMark: Geometry.extrudeAlongX(arrow, x - 15.1, x - 14.5) };
}

function noseBolt() {
  const head = Geometry.hexPrism(22, 9);
  Geometry.rotateToX(head);
  head.translate(-191.5, 0, 0);
  return Geometry.mergeGeometries([Geometry.tubeAlongX(0, 17, -182.5, -179.5, 40), head]);
}

function flywheelParts(spec) {
  const x = spec.flywheelX, R = 168;
  const disc = Geometry.lathe([[22, 0], [70, 0], [74, 4], [140, 4], [146, 0], [R - 4, 0], [R, 4], [R, 28], [R - 3, 30],
    [92, 30], [88, 26], [70, 26], [66, 22], [22, 22], [22, 0]], 112, 0, undefined, true);
  Geometry.rotateToX(disc);
  disc.translate(x, 0, 0);
  const face = Geometry.lathe([[92.5, 30.05], [R - 3.5, 30.05], [R - 3.5, 30.7], [92.5, 30.7], [92.5, 30.05]], 112, 0, undefined, true);
  Geometry.rotateToX(face);
  face.translate(x, 0, 0);
  const ringGear = Geometry.extrudeAlongX(Geometry.ringGearShape(132, R + 0.4, R + 5.6, R - 3), x + 15, x + 29, { curveSegments: 64 });
  const bolts = [];
  for (let k = 0; k < 8; k++) {
    const angle = (k + 0.5) / 8 * Math.PI * 2;
    const bolt = Geometry.hexPrism(14, 7);
    Geometry.rotateToX(bolt);
    bolt.translate(x + 22, 45 * Math.cos(angle), 45 * Math.sin(angle));
    bolts.push(bolt);
  }
  return { disc, face, ringGear, bolts: Geometry.mergeGeometries(bolts) };
}

function crankshaft({ spec, materials, tag }, belt) {
  const solid = materials.solid;
  const group = new THREE.Group();
  group.name = 'crankshaft';
  const add = (geometry, material, part, layer) => {
    const mesh = tag(new THREE.Mesh(geometry, material), part, layer);
    group.add(mesh);
    return mesh;
  };

  const forged = forgedBody(spec), polished = polishedJournals(spec);
  add(Geometry.mergeGeometries(forged), solid.crankForged, 'crank', 'crank');
  add(Geometry.mergeGeometries(polished), solid.crankJournal, 'crank', 'crank');
  add(oilHoles(spec), new THREE.MeshBasicMaterial({ color: 0x0b0c0e }), 'crank', 'crank');
  const sprocket = beltSprocket(spec, belt.toothPhase.crank);
  add(sprocket.sprocket, solid.crankSprocket, 'crankSprocket', 'timing');
  add(sprocket.timingMark, markMaterial(), 'crankSprocket', 'timing');
  add(noseBolt(), solid.noseBolt, 'crank', 'crank');
  const flywheel = flywheelParts(spec);
  add(flywheel.disc, solid.flywheel, 'flywheel', 'crank');
  add(flywheel.face, solid.flywheelFace, 'flywheel', 'crank');
  add(flywheel.ringGear, solid.ringGear, 'flywheel', 'crank');
  add(flywheel.bolts, solid.noseBolt, 'flywheel', 'crank');
  group.traverse(object => {
    if (object.isMesh && !(object.material && object.material.isMeshBasicMaterial)) object.castShadow = object.receiveShadow = true;
  });

  const fixed = new THREE.Group();
  const shells = [];
  spec.mainJournalX.forEach(x => {
    const halfWidth = x === 0 ? 6.8 : 9;
    for (const side of [1, -1]) {
      shells.push(halfShellLeftRight(spec.mainJournalDiameter / 2 + 0.05, spec.mainJournalDiameter / 2 + 2.2, x - halfWidth, x + halfWidth, side));
    }
  });
  fixed.add(tag(new THREE.Mesh(Geometry.mergeGeometries(shells), solid.bearingMain), 'bearingMain', 'crank'));
  fixed.add(tag(new THREE.Mesh(Geometry.mergeGeometries([
    halfShellLeftRight(31, 44, 7, 9.35, -1), halfShellLeftRight(31, 44, -9.35, -7, -1),
  ]), solid.thrust), 'thrust', 'crank'));
  fixed.traverse(object => { if (object.isMesh) object.castShadow = object.receiveShadow = true; });

  return { group, fixed, update(crankAngle) { group.rotation.x = crankAngle; } };
}

window.EngineBuilders = window.EngineBuilders || {};
window.EngineBuilders.b4 = Object.assign(window.EngineBuilders.b4 || {}, {
  sectionPoint, halfShellLeftRight, halfShellUpperLower, markMaterial, crankshaft,
});
})();
