/*
 * Оппозитный двигатель: корпусные детали — две половины блока, головки, клапанные крышки, поддон
 * (полупрозрачные, с контурными рёбрами), а также стяжные болты картера, болты и прокладки головок.
 *
 *   housings(context) → { meshes, edges, solids }
 *     meshes/edges — «призрачные» корпуса и их рёбра: видны насквозь, режутся секущей плоскостью;
 *     solids       — непрозрачный крепёж и прокладки.
 * Контуры головки и крышки задаются в координатах ряда (вдоль оси цилиндра, вбок) и зеркалятся на второй ряд.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const builders = window.EngineBuilders.b4;
const Banks = window.CylinderBanks;
const BANKS = ['right', 'left'];

const blockHalfSection = spec => [[0, 86], [62, 86], [92, 80], [spec.deckDistance, 80], [spec.deckDistance, -85], [112, -85], [112, -112], [0, -112]];
const headSection = spec => [[spec.combustionFace, -80], [spec.combustionFace, 80], [246, 86], [252, 92], [318, 92], [324, 86], [334, 80], [334, -74], [326, -84],
  [296, -84], [290, -96], [242, -96], [236, -84], [226, -80]];

function valveCoverSection() {
  const points = [[334, -80]];
  for (let k = 0; k <= 8; k++) {
    const t = Math.PI / 2 * k / 8;
    points.push([364 + 22 * Math.sin(t), -58 - 22 * Math.cos(t)]);
  }
  for (let k = 0; k <= 8; k++) {
    const t = Math.PI / 2 * k / 8;
    points.push([364 + 22 * Math.cos(t), 62 + 22 * Math.sin(t)]);
  }
  points.push([334, 84]);
  return points;
}

function housings({ spec, materials, tag }) {
  const meshes = [], edges = [], solids = [];
  const ghost = (geometry, materialKey, part, edgeAngle) => {
    const mesh = tag(new THREE.Mesh(geometry, materials.ghost[materialKey]), part, 'housing');
    mesh.renderOrder = 2;
    const outline = tag(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle || 24), materials.ghostEdges[materialKey]), part, 'housing');
    outline.renderOrder = 3;
    outline.userData.pickable = false;
    meshes.push(mesh);
    edges.push(outline);
    return mesh;
  };
  const solid = (geometry, material, part) => {
    const mesh = tag(new THREE.Mesh(geometry, material), part, 'housing');
    mesh.castShadow = mesh.receiveShadow = true;
    solids.push(mesh);
    return mesh;
  };
  const bankShape = (bank, points) => Geometry.polygonShape(points.map(([along, side]) => builders.sectionPoint(bank, along, side)));
  const [blockFront, blockRear] = spec.blockSpanX;
  const deck = spec.deckDistance;

  for (const bank of BANKS) {
    const half = Geometry.polygonShape(blockHalfSection(spec).map(([along, y]) => [y, bank === 'right' ? -along : along]));
    ghost(Geometry.extrudeAlongX(half, blockFront, blockRear, { curveSegments: 1 }), 'block', 'block', 20);
  }
  const barrels = spec.cylinders.map((cylinder, index) => {
    const barrel = new THREE.CylinderGeometry(spec.bore / 2 + 1, spec.bore / 2 + 1, deck - 92, 48, 1, true);
    barrel.translate(0, (deck + 92) / 2, 0);
    Geometry.applyQuaternion(barrel, Banks.rotation(spec, index));
    return barrel.translate(cylinder.x, 0, 0);
  });
  ghost(Geometry.mergeGeometries(barrels), 'block', 'block', 40);
  const bulkheads = spec.mainJournalX.map(x => {
    const shape = Geometry.polygonShape([[-112, -108], [-112, 108], [80, 108], [80, -108]]);
    shape.holes.push(Geometry.circleHole(0, 0, spec.mainJournalDiameter / 2 + 2.4, true));
    return Geometry.extrudeAlongX(shape, x - 9.4, x + 9.4, { curveSegments: 24 });
  });
  ghost(Geometry.mergeGeometries(bulkheads), 'block', 'block', 30);

  const caseBolts = [];
  spec.mainJournalX.forEach(x => {
    for (const y of [52, -52]) {
      const shank = new THREE.CylinderGeometry(5, 5, 238, 14);
      shank.rotateX(Math.PI / 2);
      const head = Geometry.hexPrism(16, 9);
      head.rotateX(Math.PI / 2);
      head.translate(0, 0, -128);
      const nut = Geometry.hexPrism(16, 10);
      nut.rotateX(Math.PI / 2);
      nut.translate(0, 0, 118);
      caseBolts.push(shank.translate(x, y, 0), head.translate(x, y, 0), nut.translate(x, y, 0));
    }
  });
  solid(Geometry.mergeGeometries(caseBolts), materials.solid.caseBolt, 'caseBolt');

  const coverSection = valveCoverSection();
  const headBolts = [];
  for (const bank of BANKS) {
    const [x0, x1] = spec.headSpanX[bank], part = bank === 'right' ? 'headR' : 'headL';
    const bankCylinders = spec.cylinders.filter(cylinder => cylinder.bank === bank);
    ghost(Geometry.extrudeAlongX(bankShape(bank, headSection(spec)), x0, x1, { curveSegments: 1 }), part, part, 20);
    const plugWells = bankCylinders.map(cylinder => {
      const well = new THREE.CylinderGeometry(10, 10, 140, 20, 1, true);
      well.translate(0, 70 + 18, 0);
      Geometry.applyQuaternion(well, Banks.rotation(spec, cylinder.index, spec.sparkPlugAngle));
      const tip = Banks.point(spec, cylinder.index, 0, spec.sparkPlugTip[0], spec.sparkPlugTip[1]);
      return well.translate(tip.x, tip.y, tip.z);
    });
    ghost(Geometry.mergeGeometries(plugWells), part, part, 60);
    ghost(Geometry.extrudeAlongX(bankShape(bank, coverSection), x0 + 3, x1 - 3, { curveSegments: 1 }), 'cover', 'cover', 22);

    const gasket = new THREE.Shape();
    gasket.moveTo(x0 + 2, -80);
    gasket.lineTo(x1 - 2, -80);
    gasket.lineTo(x1 - 2, 80);
    gasket.lineTo(x0 + 2, 80);
    gasket.closePath();
    bankCylinders.forEach(cylinder => gasket.holes.push(Geometry.circleHole(cylinder.x, 0, spec.bore / 2 + 0.6, true)));
    const middleX = (bankCylinders[0].x + bankCylinders[1].x) / 2;
    const boltX = [-1, 0, 1].map(k => middleX + k * 111);
    boltX.forEach(x => [-60, 60].forEach(side => gasket.holes.push(Geometry.circleHole(x, side, 6.5, true))));
    const gasketGeometry = new THREE.ExtrudeGeometry(gasket, { depth: spec.gasketThickness, bevelEnabled: false, curveSegments: 32 });
    const direction = bank === 'right' ? -1 : 1;
    gasketGeometry.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, direction, direction * deck, 0, 0, 0, 1));
    solid(gasketGeometry, materials.solid.gasket, 'headGasket').castShadow = false;

    boltX.forEach(x => [-60, 60].forEach(side => {
      const washer = Geometry.lathe([[5.6, 0], [11, 0], [11, 2.5], [5.6, 2.5], [5.6, 0]], 24, 0, undefined, true);
      washer.translate(0, 93, 0);
      const head = Geometry.hexPrism(14, 8);
      head.translate(0, 95.5, 0);
      const bolt = Geometry.mergeGeometries([new THREE.CylinderGeometry(5.5, 5.5, 186, 12), washer, head]);
      bolt.translate(0, 237, 0);
      bolt.rotateX(bank === 'right' ? -Math.PI / 2 : Math.PI / 2);
      headBolts.push(bolt.translate(x, side, 0));
    }));
  }
  solid(Geometry.mergeGeometries(headBolts), materials.solid.headBolt, 'headBolt');

  const panSide = [[blockFront, -112], [blockFront, -252], [blockFront + 9, -262], [-24, -262], [6, -250], [64, -176], [104, -134],
    [blockRear, -122], [blockRear, -112]];
  const pan = new THREE.ExtrudeGeometry(Geometry.polygonShape(panSide), { depth: 212, bevelEnabled: false });
  pan.translate(0, 0, -106);
  ghost(pan, 'pan', 'pan', 20);
  const drainPlug = Geometry.mergeGeometries([Geometry.hexPrism(24, 10), Geometry.lathe([[0, 0], [10, 0], [10, 3], [0, 3]], 24).translate(0, 10, 0)]);
  drainPlug.rotateX(Math.PI);
  drainPlug.translate(-90, -262, -60);
  solid(drainPlug, materials.hardware.steel, 'pan');
  return { meshes, edges, solids };
}

builders.housings = housings;
})();
