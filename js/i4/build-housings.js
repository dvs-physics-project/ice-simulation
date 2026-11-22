/*
 * Рядный двигатель: корпусные детали — блок, крышки коренных опор, головка, крышки распредвалов,
 * поддон и прокладки. Корпуса показаны полупрозрачными «чертёжными» материалами с контурными линиями,
 * чтобы сквозь них был виден механизм.
 *
 *   housings(context) → { meshes, edges, gaskets }
 *
 * Сечения корпусов заданы списками точек (z, y) — так они сняты с поперечного разреза чертежа.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Vector3 = THREE.Vector3;

const BLOCK_SECTION = [[72, 190], [72, 140], [70, 100], [72, 60], [78, 20], [82, -20], [84, -59],
  [-84, -59], [-82, -20], [-78, 20], [-72, 60], [-70, 100], [-72, 140], [-72, 190]];
const COVER_SECTION = [[112, 340], [112, 352], [104, 368], [88, 380], [50, 382], [34, 376], [28, 362], [28, 340]];
const PAN_SIDE_VIEW = [[-211.6, -59], [-206.6, -82], [-183.3, -141], [-164.2, -165], [-152, -168],
  [-72.4, -168], [-18, -141], [19.5, -127], [76, -98.5], [146.7, -87], [170, -75], [182, -59]];

const sectionShape = points => Geometry.polygonShape(points.map(([z, y]) => [y, z]));

function headSection(headFaceY) {
  return [[84, headFaceY], [84, 246], [90, 254], [101, 286], [108, 300], [110, 318], [110, 340],
    [-110, 340], [-110, 316], [-106, 300], [-98, 284], [-90, 266], [-86, 252], [-86, headFaceY]];
}

function mainBearingCaps(spec) {
  const parts = [];
  spec.mainJournalX.forEach((x, journal) => {
    const width = (journal === 0 || journal === 4) ? 22 : 20;
    const outline = new THREE.Shape();
    outline.moveTo(0, -46);
    outline.lineTo(0, -25.8);
    outline.absarc(0, 0, 25.8, -Math.PI / 2, -Math.PI * 1.5, true);
    outline.lineTo(0, 46);
    outline.lineTo(-40, 46);
    outline.quadraticCurveTo(-52, 46, -52, 34);
    outline.lineTo(-52, -34);
    outline.quadraticCurveTo(-52, -46, -40, -46);
    outline.closePath();
    parts.push(Geometry.extrudeAlongX(outline, x - width / 2, x + width / 2, { curveSegments: 16 }));
    for (const z of [-36, 36]) {
      const bolt = Geometry.hexPrism(14, 8);
      bolt.rotateX(Math.PI);
      bolt.translate(x, -52, z);
      parts.push(bolt);
    }
  });
  return Geometry.mergeGeometries(parts);
}

function oilFillerNeck() {
  const neck = new THREE.CylinderGeometry(25, 25, 12, 40, 1, true);
  neck.translate(90, 387, 68);
  const cap = new THREE.CylinderGeometry(30, 30, 7, 40);
  cap.translate(90, 396.5, 68);
  return Geometry.mergeGeometries([neck, cap]);
}

function gaskets(spec) {
  const parts = [];
  const head = Geometry.roundedRect(372, 168, 14);
  spec.cylinderX.forEach(x => head.holes.push(Geometry.circleHole(x, 0, 37, true)));
  spec.mainJournalX.forEach(x => { for (const z of [-58, 58]) head.holes.push(Geometry.circleHole(x, z, 5.5, true)); });
  const headGasket = new THREE.ExtrudeGeometry(head, { depth: spec.gasketThickness, bevelEnabled: false, curveSegments: 20 });
  headGasket.rotateX(Math.PI / 2);
  headGasket.translate(0, spec.headFaceY, 0);
  parts.push(headGasket);

  for (const side of [1, -1]) {
    const frame = Geometry.roundedRect(383, 84, 8);
    frame.holes.push(Geometry.roundedRect(371, 72, 4));
    const coverGasket = new THREE.ExtrudeGeometry(frame, { depth: 1.4, bevelEnabled: false, curveSegments: 6 });
    coverGasket.rotateX(Math.PI / 2);
    coverGasket.translate(-3.5, 341.4, side * 70);
    parts.push(coverGasket);
  }

  const pan = Geometry.roundedRect(394, 168, 10);
  pan.holes.push(Geometry.roundedRect(372, 146, 6));
  const panGasket = new THREE.ExtrudeGeometry(pan, { depth: 1.4, bevelEnabled: false, curveSegments: 6 });
  panGasket.rotateX(Math.PI / 2);
  panGasket.translate(-14.8, -57.6, 0);
  parts.push(panGasket);
  return Geometry.mergeGeometries(parts);
}

function housings({ spec, materials, tag }) {
  const meshes = [], edges = [];
  const addOutline = (line, part) => {
    line.renderOrder = 3;
    tag(line, part, 'housing');
    line.userData.pickable = false;
    edges.push(line);
  };
  const ghost = (geometry, material, part, edgeAngle) => {
    const mesh = new THREE.Mesh(geometry, materials.ghost[material]);
    mesh.renderOrder = 2;
    tag(mesh, part, 'housing');
    meshes.push(mesh);
    addOutline(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle || 24), materials.ghostEdges[material]), part);
    return mesh;
  };

  ghost(Geometry.extrudeAlongX(sectionShape(BLOCK_SECTION), spec.blockFrontX, spec.blockRearX), 'block', 'block', 20);
  spec.cylinderX.forEach(x => {
    const bore = new THREE.CylinderGeometry(spec.bore / 2 + 0.2, spec.bore / 2 + 0.2, 120, 64, 1, true);
    bore.translate(x, spec.deckY - 60, 0);
    const boreMesh = new THREE.Mesh(bore, materials.ghost.block);
    boreMesh.renderOrder = 2;
    tag(boreMesh, 'block', 'housing');
    meshes.push(boreMesh);
    for (const y of [spec.deckY, spec.deckY - 120]) {
      const circle = [];
      for (let k = 0; k <= 72; k++) {
        const angle = k / 72 * Math.PI * 2;
        circle.push(new Vector3(x + 36.2 * Math.cos(angle), y, 36.2 * Math.sin(angle)));
      }
      addOutline(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circle), materials.ghostEdges.block), 'block');
    }
  });
  ghost(mainBearingCaps(spec), 'caps', 'block', 30);

  ghost(Geometry.extrudeAlongX(sectionShape(headSection(spec.headFaceY)), -195, 190), 'head', 'head', 20);
  const sparkPlugWells = spec.cylinderX.map(x => {
    const well = new THREE.CylinderGeometry(13, 13, 136, 40, 1, true);
    well.translate(x, 228 + 68, 0);
    return well;
  });
  ghost(Geometry.mergeGeometries(sparkPlugWells), 'head', 'head', 40);

  for (const side of [1, -1]) {
    const section = COVER_SECTION.map(([z, y]) => [side * z, y]);
    ghost(Geometry.extrudeAlongX(sectionShape(side > 0 ? section : section.reverse()), -195, 188), 'cover', 'cover', 22);
  }
  ghost(oilFillerNeck(), 'cover', 'cover', 30);

  const pan = new THREE.ExtrudeGeometry(Geometry.polygonShape(PAN_SIDE_VIEW), { depth: 160, bevelEnabled: false });
  pan.translate(0, 0, -80);
  ghost(pan, 'pan', 'pan', 20);
  const drainPlug = Geometry.hexPrism(17, 9);
  drainPlug.rotateX(Math.PI);
  drainPlug.translate(-110, -168, -40);
  const drainMesh = new THREE.Mesh(drainPlug, materials.hardware.steel);
  tag(drainMesh, 'pan', 'housing');
  meshes.push(drainMesh);

  const gasketMesh = new THREE.Mesh(gaskets(spec), materials.solid.gasket);
  tag(gasketMesh, 'gasket', 'housing');
  gasketMesh.receiveShadow = true;
  return { meshes, edges, gaskets: gasketMesh };
}

window.EngineBuilders.i4.housings = housings;
})();
