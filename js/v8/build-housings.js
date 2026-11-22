/*
 * V-образный дизель: корпусные детали — блок-картер с крышками коренных подшипников, восемь отдельных
 * головок с крышками, прокладки, поддон, картер маховика, передняя крышка. Корпуса полупрозрачные,
 * с контурными рёбрами; прокладки — непрозрачные.
 *
 *   housings(context) → { meshes, edges, gaskets }
 * Сечение блока задаётся в плоскости (y, z) и зеркалится относительно вертикали; головка и крышка
 * строятся в координатах ряда (вдоль оси цилиндра, вбок) и поворачиваются на ось каждого цилиндра.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Banks = window.CylinderBanks;
const builders = window.EngineBuilders.v8;
const BLOCK_FRONT_X = -362, BLOCK_REAR_X = 360;

function blockSection(spec) {
  const deckInner = spec.pointInBank(0, 0, spec.deckDistance, 140), deckOuter = spec.pointInBank(0, 0, spec.deckDistance, -95);
  const half = [[-119, 0], [-119, -157], [22.6, -157], [deckOuter[1], deckOuter[2]], [deckInner[1], deckInner[2]], [260, -62]];
  return half.concat(half.slice(1).reverse().map(([y, z]) => [y, -z]));
}

function mainBearingCaps(spec) {
  const parts = [];
  spec.mainJournalX.forEach(x => {
    const cap = new THREE.Shape();
    cap.moveTo(0, -150);
    cap.lineTo(0, -51);
    cap.absarc(0, 0, 51, -Math.PI / 2, -Math.PI * 1.5, true);
    cap.lineTo(0, 150);
    cap.lineTo(-62, 150);
    cap.lineTo(-62, -150);
    cap.closePath();
    parts.push(Geometry.extrudeAlongX(cap, x - 18, x + 18, { curveSegments: 16 }));
    for (const z of [-58, 58]) {
      const bolt = Geometry.hexPrism(22, 12);
      bolt.rotateX(Math.PI);
      parts.push(bolt.translate(x, -62, z));
    }
    for (const z of [-157, 157]) {
      const bolt = Geometry.hexPrism(19, 10);
      bolt.rotateX(z > 0 ? Math.PI / 2 : -Math.PI / 2);
      parts.push(bolt.translate(x, -36, z));
    }
  });
  return Geometry.mergeGeometries(parts);
}

function cylinderHeadParts(spec) {
  const face = spec.combustionFace, top = spec.headTop;
  const head = Geometry.extrudeAlongX(Geometry.polygonShape([[face, -95], [face, 140], [top - 14, 140], [top, 126], [top, -80], [top - 15, -95]]),
    -82, 82, { curveSegments: 1 });

  const coverSection = [[top + 1.5, -55]];
  for (let k = 0; k <= 8; k++) {
    const t = Math.PI / 2 * k / 8;
    coverSection.push([596 + 22 * Math.sin(t), -33 - 22 * Math.cos(t)]);
  }
  for (let k = 0; k <= 8; k++) {
    const t = Math.PI / 2 * k / 8;
    coverSection.push([596 + 22 * Math.cos(t), 118 + 22 * Math.sin(t)]);
  }
  coverSection.push([top + 1.5, 140]);
  const cover = Geometry.extrudeAlongX(Geometry.polygonShape(coverSection), -76, 76, { curveSegments: 1 });
  const fillerCap = Geometry.lathe([[0, 0], [26, 0], [28, 4], [28, 14], [0, 14]], 32).translate(30, 617, 40);

  const gasketOutline = Geometry.roundedRect(164, 235, 10);
  gasketOutline.holes.push(Geometry.circleHole(0, -22.5, 64.5, true));
  for (const x of [-30, 30]) gasketOutline.holes.push(Geometry.circleHole(x, spec.camSide - 22.5, 9.5, true));
  const gasket = new THREE.ExtrudeGeometry(gasketOutline, { depth: spec.gasketThickness, bevelEnabled: false, curveSegments: 24 });
  gasket.rotateX(Math.PI / 2);
  gasket.translate(0, spec.deckDistance + spec.gasketThickness, 22.5);

  const channels = [-30, 30].map(x => new THREE.CylinderGeometry(10, 10, top - face, 20, 1, true).translate(x, (top + face) / 2, spec.camSide));
  const injectorBore = new THREE.CylinderGeometry(15, 15, 112, 24, 1, true).translate(0, 56, 0);
  Geometry.applyQuaternion(injectorBore, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 15 * Math.PI / 180));
  channels.push(injectorBore.translate(0, face - 2, -2));
  return { head, cover, fillerCap, gasket, channels: Geometry.mergeGeometries(channels) };
}

function flywheelHousing() {
  const plateOutline = Geometry.convexHull(Geometry.circlePoints([0, 0], 282, 64).concat([[478, -118], [478, 118], [430, -150], [430, 150]]));
  const plate = Geometry.extrudeAlongX(Geometry.polygonShape(plateOutline), BLOCK_REAR_X, BLOCK_REAR_X + 35, { curveSegments: 1 });
  const bell = Geometry.lathe([[282, 0], [282, 100], [300, 100], [300, 108], [270, 108]], 96);
  Geometry.rotateToX(bell);
  bell.translate(BLOCK_REAR_X + 35, 0, 0);
  const starterBoss = new THREE.CylinderGeometry(60, 60, 30, 32, 1, true);
  starterBoss.rotateZ(Math.PI / 2);
  starterBoss.translate(BLOCK_REAR_X + 4, -120, -237);
  return Geometry.mergeGeometries([plate, bell, starterBoss]);
}

function housings({ spec, materials, tag }) {
  const meshes = [], edges = [];
  const ghost = (geometry, materialKey, part, edgeAngle) => {
    const mesh = tag(new THREE.Mesh(geometry, materials.ghost[materialKey]), part, 'housing');
    mesh.renderOrder = 2;
    const outline = tag(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle || 24), materials.ghostEdges[materialKey]), part, 'housing');
    outline.renderOrder = 3;
    outline.userData.pickable = false;
    meshes.push(mesh);
    edges.push(outline);
  };

  ghost(Geometry.extrudeAlongX(Geometry.polygonShape(blockSection(spec)), BLOCK_FRONT_X, BLOCK_REAR_X), 'block', 'block', 20);
  const bores = spec.cylinders.map((cylinder, index) => {
    const bore = new THREE.CylinderGeometry(76.5, 76.5, spec.deckDistance - 160, 48, 1, true).translate(0, (spec.deckDistance + 160) / 2, 0);
    Geometry.applyQuaternion(bore, Banks.rotation(spec, index));
    return bore.translate(cylinder.x, 0, 0);
  });
  ghost(Geometry.mergeGeometries(bores), 'block', 'block', 40);
  ghost(mainBearingCaps(spec), 'block', 'block', 30);

  const parts = cylinderHeadParts(spec);
  const heads = [], covers = [], channels = [], gaskets = [];
  spec.cylinders.forEach((cylinder, index) => {
    const rotation = Banks.rotation(spec, index);
    const placed = geometry => {
      const copy = geometry.clone();
      Geometry.applyQuaternion(copy, rotation);
      return copy.translate(cylinder.x, 0, 0);
    };
    heads.push(placed(parts.head));
    covers.push(placed(parts.cover), placed(parts.fillerCap));
    channels.push(placed(parts.channels));
    gaskets.push(placed(parts.gasket));
  });
  ghost(Geometry.mergeGeometries(heads), 'head', 'head', 20);
  ghost(Geometry.mergeGeometries(channels), 'head', 'head', 50);
  ghost(Geometry.mergeGeometries(covers), 'cover', 'cover', 22);
  const gasketMesh = tag(new THREE.Mesh(Geometry.mergeGeometries(gaskets), materials.solid.gasket), 'gasket', 'housing');
  gasketMesh.receiveShadow = true;

  const panSide = [[BLOCK_FRONT_X, -119], [BLOCK_FRONT_X, -360], [BLOCK_FRONT_X + 17, -377], [-100, -377], [-80, -360], [-40, -250], [300, -232],
    [338, -205], [BLOCK_REAR_X, -160], [BLOCK_REAR_X, -119]];
  const pan = new THREE.ExtrudeGeometry(Geometry.polygonShape(panSide), { depth: 300, bevelEnabled: false });
  pan.translate(0, 0, -150);
  ghost(pan, 'pan', 'pan', 20);
  const drainPlug = Geometry.hexPrism(24, 12);
  drainPlug.rotateX(Math.PI);
  drainPlug.translate(-200, -377, 60);
  meshes.push(tag(new THREE.Mesh(drainPlug, materials.hardware.steel), 'pan', 'housing'));

  ghost(flywheelHousing(), 'flyhousing', 'flyhousing', 24);
  const frontCover = Geometry.polygonShape(Geometry.convexHull(
    Geometry.circlePoints([0, 0], 108, 48).concat(Geometry.circlePoints([spec.frontGear.oilPumpY, 0], 106, 48))));
  frontCover.holes.push(Geometry.circleHole(0, 0, 41, true));
  ghost(Geometry.extrudeAlongX(frontCover, -396, BLOCK_FRONT_X, { curveSegments: 1 }), 'frontcover', 'frontcover', 24);
  return { meshes, edges, gaskets: gasketMesh };
}

builders.housings = housings;
})();
