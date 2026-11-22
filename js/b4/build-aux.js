/*
 * Оппозитный двигатель: вспомогательные узлы — героторный масляный насос на носке вала, маслоприёмник,
 * масляный фильтр, датчик давления масла, опоры двигателя, свечи зажигания.
 *
 *   auxiliaries(context) → { fixed, onCrankshaft, sparkTips, update(crankAngle) }
 *     onCrankshaft — внутренний ротор насоса, вращается вместе с коленвалом;
 *     sparkTips    — точки искры каждого цилиндра;
 *     update       — наружный ротор (7 зубьев) обкатывается вокруг внутреннего (6 зубьев) со скоростью 6/7 вала.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Vector3 = THREE.Vector3;
const builders = window.EngineBuilders.b4;
const Banks = window.CylinderBanks;

function oilPump(spec, materials, tag, mesh) {
  const [x0, x1] = spec.oilPumpSpanX;
  const housingOutline = Geometry.smoothClosedShape([[56, 0], [50, 40], [22, 60], [-30, 64], [-78, 56], [-104, 30], [-110, -18],
    [-96, -58], [-44, -70], [12, -62], [46, -36]], 140);
  housingOutline.holes.push(Geometry.circleHole(0, 0, 22.5, true));
  const housing = Geometry.extrudeAlongX(housingOutline, x0, x1, { curveSegments: 24 });
  const housingMesh = tag(new THREE.Mesh(housing, materials.ghost.oilpump), 'oilPump', 'aux');
  housingMesh.renderOrder = 2;
  const housingEdges = tag(new THREE.LineSegments(new THREE.EdgesGeometry(housing, 30), materials.ghostEdges.oilpump), 'oilPump', 'aux');
  housingEdges.renderOrder = 3;
  housingEdges.userData.pickable = false;

  const eccentricity = 3.2;
  const rotors = Geometry.gerotorProfiles(6, eccentricity, 33, 7);
  const innerOutline = Geometry.polygonShape(rotors.inner);
  innerOutline.holes.push(Geometry.circleHole(0, 0, 20.05, true));
  const innerRotor = mesh(Geometry.extrudeAlongX(innerOutline, x0 + 3, x1 - 3, { curveSegments: 20 }), materials.solid.oilRotor, 'oilPump');

  const outerOutline = new THREE.Shape();
  outerOutline.absarc(0, 0, 44, 0, Math.PI * 2, false);
  const pocket = new THREE.Path();
  rotors.outer.forEach(([u, v], k) => (k ? pocket.lineTo(u, v) : pocket.moveTo(u, v)));
  pocket.closePath();
  outerOutline.holes.push(pocket);
  const outerRotor = mesh(Geometry.extrudeAlongX(outerOutline, x0 + 3, x1 - 3, { curveSegments: 48 }), materials.solid.oilRotor, 'oilPump');
  const outerRotorHolder = new THREE.Group();
  outerRotorHolder.position.set(0, -eccentricity, 0);
  outerRotorHolder.add(outerRotor);

  const arrow = new THREE.Shape();
  arrow.moveTo(52, -3);
  arrow.lineTo(52, 3);
  arrow.lineTo(44.5, 0);
  arrow.closePath();
  const coverMark = tag(new THREE.Mesh(Geometry.extrudeAlongX(arrow, x0 - 0.8, x0), builders.markMaterial()), 'oilPump', 'aux');
  return { fixed: [housingMesh, housingEdges, outerRotorHolder, coverMark], innerRotor, outerRotor };
}

function oilPickup(materials, mesh) {
  const tube = new THREE.CatmullRomCurve3([new Vector3(-96, -110, 32), new Vector3(-92, -140, 30), new Vector3(-78, -182, 20),
    new Vector3(-58, -222, 6), new Vector3(-46, -236, 0)], false, 'centripetal');
  const flange = Geometry.lathe([[0, 0], [16, 0], [16, 3], [0, 3]], 24).translate(-96, -112, 32);
  const strainer = Geometry.lathe([[7, 0], [12, -2], [40, -9], [40, -12.5], [7.5, -12.5]], 56, 0, undefined, true).translate(-46, -236, 0);
  const screen = Geometry.lathe([[0, 0], [39.5, 0], [39.5, 0.6], [0, 0.6]], 56, 0, undefined, true).translate(-46, -249.2, 0);
  return [
    mesh(Geometry.mergeGeometries([new THREE.TubeGeometry(tube, 48, 7, 14, false), flange]), materials.solid.pickup, 'pickup'),
    mesh(Geometry.mergeGeometries([strainer, screen]), materials.solid.strainer, 'pickup'),
  ];
}

function oilFilterAndSensor(materials, mesh) {
  const filterTop = new Vector3(-108, -85, -200), down = new Vector3(0, -1, 0);
  const can = Geometry.lathe([[0, 10], [31, 10], [34, 12.5], [34, 80], [32.5, 86], [21, 90], [0, 91]], 56);
  const flutes = Array.from({ length: 12 }, (_, k) => {
    const angle = k / 12 * Math.PI * 2;
    return new THREE.BoxGeometry(5, 7, 5).translate(21 * Math.cos(angle), 90.5, 21 * Math.sin(angle));
  });
  const hexBody = Geometry.hexPrism(22, 7).translate(0, 9, 0);
  const terminal = new THREE.CylinderGeometry(3, 3, 8, 12).translate(0, 42, 0);
  const sensor = Geometry.mergeGeometries([
    Geometry.lathe([[0, 0], [6, 0], [6, 9], [0, 9]], 20), hexBody, Geometry.lathe([[0, 16], [13, 16], [13, 34], [10, 38], [0, 38]], 32), terminal,
  ]);
  return [
    mesh(Geometry.placeAlong(Geometry.mergeGeometries([can, ...flutes]), filterTop, down), materials.solid.oilFilter, 'oilFilter'),
    mesh(Geometry.placeAlong(Geometry.lathe([[0, 0], [30, 0], [30, 10], [0, 10]], 40, 0, undefined, true), filterTop, down),
      materials.hardware.aluminium, 'oilFilter'),
    mesh(Geometry.placeAlong(sensor, new Vector3(-108, -85, -146), down), materials.solid.sensor, 'sensor'),
  ];
}

function engineMounts(materials, mesh) {
  const metal = [], rubber = [];
  for (const side of [-1, 1]) {
    const x = 20, z = side * 167;
    metal.push(
      new THREE.BoxGeometry(56, 34, 52).translate(x, -102, z),
      new THREE.BoxGeometry(8, 30, 70).translate(x, -100, side * 132),
      new THREE.BoxGeometry(64, 5, 64).translate(x, -121.5, z),
      new THREE.BoxGeometry(72, 6, 72).translate(x, -181, z),
      new THREE.CylinderGeometry(6, 6, 22, 12).translate(x, -195, z));
    rubber.push(Geometry.lathe([[0, 0], [24, 0], [29, 6], [29, 20], [24, 26], [27, 30], [29, 38], [29, 48], [24, 54], [0, 54]], 40).translate(x, -178, z));
  }
  return [mesh(Geometry.mergeGeometries(metal), materials.solid.mount, 'mount'), mesh(Geometry.mergeGeometries(rubber), materials.solid.mountRubber, 'mount')];
}

function sparkPlugs(spec, materials, mesh) {
  const metal = [], ceramic = [], boots = [], tips = [];
  spec.cylinders.forEach((cylinder, index) => {
    const rotation = Banks.rotation(spec, index, spec.sparkPlugAngle);
    const tip = Banks.point(spec, index, 0, spec.sparkPlugTip[0], spec.sparkPlugTip[1]);
    const place = geometry => {
      Geometry.applyQuaternion(geometry, rotation);
      return geometry.translate(tip.x, tip.y, tip.z);
    };
    const shell = [
      new THREE.CylinderGeometry(1.1, 1.1, 2.6, 10).translate(0, 1.3, 0),
      new THREE.BoxGeometry(1.6, 5.4, 2.6).translate(4.4, 1.8, 0),
      new THREE.BoxGeometry(5, 1.3, 2.6).translate(2.4, -0.6, 0),
      Geometry.lathe([[2.2, 4], [7, 4], [7, 21], [5, 21]], 32, 0, undefined, true),
      Geometry.hexPrism(16, 8).translate(0, 21, 0),
      new THREE.CylinderGeometry(2.8, 2.8, 6, 12).translate(0, 62, 0),
    ];
    for (let k = 0; k < 8; k++) {
      const thread = new THREE.TorusGeometry(7, 0.45, 5, 28);
      thread.rotateX(Math.PI / 2);
      shell.push(thread.translate(0, 5.5 + k * 1.9, 0));
    }
    metal.push(place(Geometry.mergeGeometries(shell)));
    const insulator = [[0, 1.6], [2.4, 1.8], [4.0, 6], [4.6, 29]];
    for (let k = 0; k < 6; k++) {
      const y = 31 + k * 4.4;
      insulator.push([5.2, y], [5.9, y + 1.2], [5.9, y + 2.4], [5.2, y + 3.6]);
    }
    insulator.push([5.2, 58], [3, 58.6], [0, 58.6]);
    ceramic.push(place(Geometry.lathe(insulator, 32)));
    boots.push(place(Geometry.lathe([[7, 46], [9, 49], [9, 160], [11.5, 164], [11.5, 178], [8, 182], [0, 182]], 32)));
    tips.push(Banks.point(spec, index, 0, spec.sparkPlugTip[0] - 0.5, spec.sparkPlugTip[1]));
  });
  return {
    meshes: [
      mesh(Geometry.mergeGeometries(metal), materials.solid.sparkMetal, 'spark'),
      mesh(Geometry.mergeGeometries(ceramic), materials.solid.sparkCeramic, 'spark'),
      mesh(Geometry.mergeGeometries(boots), materials.solid.sparkBoot, 'spark'),
    ],
    tips,
  };
}

function auxiliaries({ spec, materials, tag }) {
  const mesh = (geometry, material, part) => {
    const result = tag(new THREE.Mesh(geometry, material), part, 'aux');
    result.castShadow = result.receiveShadow = true;
    return result;
  };
  const pump = oilPump(spec, materials, tag, mesh);
  const plugs = sparkPlugs(spec, materials, mesh);
  return {
    fixed: [...pump.fixed, ...oilPickup(materials, mesh), ...oilFilterAndSensor(materials, mesh), ...engineMounts(materials, mesh), ...plugs.meshes],
    onCrankshaft: [pump.innerRotor],
    sparkTips: plugs.tips,
    update(crankAngle) { pump.outerRotor.rotation.x = crankAngle * 6 / 7; },
  };
}

builders.auxiliaries = auxiliaries;
})();
