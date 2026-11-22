/*
 * Рядный двигатель: вспомогательные узлы — героторный масляный насос, маслоприёмник, масляный фильтр,
 * датчик детонации, щуп, патрубок охлаждения, свечи зажигания, форсунки с топливной рампой.
 *
 *   auxiliaries(context) → { fixed, onCrankshaft, sparkTips, update(crankAngle) }
 *     onCrankshaft — внутренний ротор насоса, он сидит на носке коленвала и вращается вместе с ним;
 *     sparkTips    — точки искры каждого цилиндра (там рисуется вспышка);
 *     update       — наружный ротор героторного насоса (7 зубьев) обкатывается вокруг внутреннего (6 зубьев)
 *                    и вращается со скоростью 6/7 от скорости вала.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Vector3 = THREE.Vector3;
const { DEG } = window.EngineMath;

function translated(geometry, x, y, z) {
  geometry.translate(x, y, z);
  return geometry;
}

function oilPump(materials, tag, solid) {
  const fixed = [];
  const housingOutline = Geometry.smoothClosedShape(
    [[50, -46], [58, 0], [50, 46], [10, 64], [-44, 60], [-70, 30], [-74, -6], [-58, -50], [-8, -64]], 120);
  housingOutline.holes.push(Geometry.circleHole(0, 0, 21.5, true));
  const housing = Geometry.extrudeAlongX(housingOutline, -202, -182, { curveSegments: 20 });
  const housingMesh = new THREE.Mesh(housing, materials.ghost.oilpump);
  housingMesh.renderOrder = 2;
  tag(housingMesh, 'oilPump', 'aux');
  const housingEdges = new THREE.LineSegments(new THREE.EdgesGeometry(housing, 30), materials.ghostEdges.oilpump);
  housingEdges.renderOrder = 3;
  housingEdges.userData.pickable = false;
  tag(housingEdges, 'oilPump', 'aux');
  fixed.push(housingMesh, housingEdges);

  const eccentricity = 3.2;
  const rotors = Geometry.gerotorProfiles(6, eccentricity, 33, 7);
  const innerOutline = Geometry.polygonShape(rotors.inner);
  innerOutline.holes.push(Geometry.circleHole(0, 0, 20.05, true));
  const innerRotor = solidMesh(Geometry.extrudeAlongX(innerOutline, -197, -187, { curveSegments: 20 }), solid.oilRotor, 'oilPump', tag);

  const outerOutline = new THREE.Shape();
  outerOutline.absarc(0, 0, 44, 0, Math.PI * 2, false);
  const pocket = new THREE.Path();
  rotors.outer.forEach(([u, v], k) => (k ? pocket.lineTo(u, v) : pocket.moveTo(u, v)));
  pocket.closePath();
  outerOutline.holes.push(pocket);
  const outerRotor = solidMesh(Geometry.extrudeAlongX(outerOutline, -197, -187, { curveSegments: 48 }), solid.oilRotor, 'oilPump', tag);
  const outerRotorHolder = new THREE.Group();
  outerRotorHolder.position.set(0, -eccentricity, 0);
  outerRotorHolder.add(outerRotor);
  fixed.push(outerRotorHolder);
  return { fixed, innerRotor, outerRotor };
}

function solidMesh(geometry, material, part, tag, layer) {
  const mesh = new THREE.Mesh(geometry, material);
  tag(mesh, part, layer || 'aux');
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function oilPickup(solid, tag) {
  const pipe = new THREE.CatmullRomCurve3([
    new Vector3(-192, -54, 4), new Vector3(-190, -84, 4), new Vector3(-172, -114, 2), new Vector3(-140, -128, 0),
    new Vector3(-116, -132, 0), new Vector3(-108, -146, 0)], false, 'centripetal');
  const tube = solidMesh(Geometry.mergeGeometries([
    new THREE.TubeGeometry(pipe, 64, 7, 14, false),
    Geometry.cylinderBetween(3, new Vector3(-150, -126, 0), new Vector3(-150, -60, 34), 10),
  ]), solid.pickup, 'pickup', tag);
  const cup = Geometry.mergeGeometries([
    Geometry.lathe([[7, 0], [12, -2.5], [42, -10], [42, -13.5], [7.5, -13.5]], 56, 0, undefined, true),
  ]);
  cup.translate(-108, -146, 0);
  const screen = Geometry.lathe([[0, 0], [40.5, 0], [40.5, 0.6], [0, 0.6]], 56, 0, undefined, true);
  screen.translate(-108, -160.2, 0);
  const strainer = solidMesh(Geometry.mergeGeometries([cup, screen]), solid.strainer, 'pickup', tag);
  return [tube, strainer];
}

function oilFilter(materials, solid, tag) {
  const direction = new Vector3(0, -Math.sin(22 * DEG), Math.cos(22 * DEG));
  const base = new Vector3(-40, 35, 79);
  const can = Geometry.lathe([[0, 8], [33, 8], [37.5, 10], [38, 12], [38, 84], [36.5, 90], [24, 94], [0, 95]], 56);
  const flutes = [];
  for (let k = 0; k < 12; k++) {
    const angle = k / 12 * Math.PI * 2;
    flutes.push(translated(new THREE.BoxGeometry(5, 7, 5), 24 * Math.cos(angle), 94.5, 24 * Math.sin(angle)));
  }
  const boss = Geometry.lathe([[0, 0], [30, 0], [30, 8], [0, 8]], 40, 0, undefined, true);
  return [
    solidMesh(Geometry.placeAlong(Geometry.mergeGeometries([can, ...flutes]), base, direction), solid.oilFilter, 'oilFilter', tag),
    solidMesh(Geometry.placeAlong(boss, base, direction), materials.hardware.aluminium, 'oilFilter', tag),
  ];
}

function knockSensor(solid, tag) {
  const body = Geometry.mergeGeometries([
    Geometry.lathe([[0, 0], [13, 0], [13, 12], [9, 15], [0, 15]], 40),
    translated(new THREE.BoxGeometry(14, 10, 22), 0, 8, 18),
    translated(Geometry.hexPrism(12, 6), 0, 15, 0),
  ]);
  return solidMesh(Geometry.placeAlong(body, new Vector3(0, 120, -71), new Vector3(0, 0, -1)), solid.knock, 'knock', tag);
}

function dipstick(solid, tag) {
  const path = new THREE.CatmullRomCurve3([new Vector3(58, -150, -54), new Vector3(58, -60, -76), new Vector3(60, 40, -88),
    new Vector3(62, 112, -96)], false, 'centripetal');
  const handle = new THREE.TorusGeometry(9, 2.4, 10, 28);
  handle.rotateY(Math.PI / 2);
  handle.translate(62, 127, -97);
  return solidMesh(Geometry.mergeGeometries([
    new THREE.TubeGeometry(path, 48, 3.4, 10, false),
    handle,
    translated(new THREE.CylinderGeometry(4.6, 4.6, 10, 16), 62, 114, -96),
  ]), solid.dipstick, 'dipstick', tag);
}

function coolantOutlet(solid, tag) {
  const hose = new THREE.CatmullRomCurve3([new Vector3(196, 262, -20), new Vector3(226, 262, -24), new Vector3(252, 250, -30),
    new Vector3(266, 226, -34)]);
  const sensor = Geometry.lathe([[0, 0], [8, 0], [8, 12], [5, 14], [0, 14]], 24);
  sensor.translate(214, 276, -20);
  return solidMesh(Geometry.mergeGeometries([
    translated(new THREE.BoxGeometry(14, 46, 40), 197, 260, -20),
    new THREE.TubeGeometry(hose, 40, 15, 20, false),
    sensor,
    translated(Geometry.hexPrism(14, 6), 214, 272, -20),
  ]), solid.outlet, 'outlet', tag);
}

function sparkPlugs(spec, solid, tag) {
  const tipY = spec.headFaceY + 20.5;
  const metal = [], ceramic = [], boots = [];
  spec.cylinderX.forEach(x => {
    const shell = [
      translated(new THREE.CylinderGeometry(1.1, 1.1, 2.6, 10), 0, 1.3, 0),
      translated(new THREE.BoxGeometry(1.6, 6, 2.6), 4.6, 1.5, 0),
      translated(new THREE.BoxGeometry(5, 1.3, 2.6), 2.6, -1.0, 0),
      Geometry.lathe([[2.2, 4], [7, 4], [7, 23], [5, 23]], 32, 0, undefined, true),
    ];
    for (let k = 0; k < 9; k++) {
      const thread = new THREE.TorusGeometry(7, 0.45, 5, 28);
      thread.rotateX(Math.PI / 2);
      thread.translate(0, 6 + k * 1.9, 0);
      shell.push(thread);
    }
    shell.push(translated(Geometry.hexPrism(16, 7), 0, 24, 0));
    shell.push(translated(new THREE.CylinderGeometry(2.8, 2.8, 6, 12), 0, 63, 0));
    metal.push(translated(Geometry.mergeGeometries(shell), x, tipY, 0));

    const insulator = [[0, 1.6], [2.4, 1.8], [4.0, 6], [4.6, 31]];
    for (let k = 0; k < 6; k++) {
      const y = 33 + k * 4.4;
      insulator.push([5.2, y], [5.9, y + 1.2], [5.9, y + 2.4], [5.2, y + 3.6]);
    }
    insulator.push([5.2, 60], [3, 60.5], [0, 60.5]);
    ceramic.push(translated(Geometry.lathe(insulator, 32), x, tipY, 0));

    const bootHeight = 368 - (tipY + 50);
    boots.push(translated(Geometry.lathe([[8, 0], [10.5, 3], [10.5, bootHeight], [0, bootHeight]], 32), x, tipY + 50, 0));
    const coil = new THREE.ExtrudeGeometry(Geometry.roundedRect(30, 44, 7),
      { depth: 16, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 2, curveSegments: 6 });
    coil.rotateX(-Math.PI / 2);
    coil.translate(x, 368, 0);
    boots.push(coil);
    boots.push(translated(new THREE.BoxGeometry(14, 10, 12), x, 378, -27));
  });
  return {
    meshes: [
      solidMesh(Geometry.mergeGeometries(metal), solid.sparkMetal, 'spark', tag),
      solidMesh(Geometry.mergeGeometries(ceramic), solid.sparkCeramic, 'spark', tag),
      solidMesh(Geometry.mergeGeometries(boots), solid.sparkBoot, 'spark', tag),
    ],
    tips: spec.cylinderX.map(x => new Vector3(x, tipY - 0.4, 0)),
  };
}

function fuelInjection(spec, solid, tag) {
  const direction = new Vector3(0, Math.cos(38 * DEG), -Math.sin(38 * DEG));
  const railCenter = new Vector3(0, 232, -68).addScaledVector(direction, 76);
  const bodies = [], seals = [];
  spec.cylinderX.forEach(x => {
    const tip = new Vector3(x, 232, -68);
    bodies.push(Geometry.placeAlong(Geometry.mergeGeometries([
      Geometry.lathe([[0, 0], [3.2, 0], [3.2, 7], [7.6, 9], [7.6, 46], [5.2, 48], [5.2, 60], [0, 60]], 28),
      translated(new THREE.BoxGeometry(12, 10, 9), 9, 38, 0),
    ]), tip, direction));
    const lowerRing = new THREE.TorusGeometry(5.6, 1.3, 8, 24);
    lowerRing.rotateX(Math.PI / 2);
    lowerRing.translate(0, 8, 0);
    const upperRing = new THREE.TorusGeometry(5.4, 1.2, 8, 24);
    upperRing.rotateX(Math.PI / 2);
    upperRing.translate(0, 50, 0);
    seals.push(Geometry.placeAlong(Geometry.mergeGeometries([lowerRing, upperRing]), tip, direction));
    seals.push(Geometry.placeAlong(translated(new THREE.CylinderGeometry(8.4, 8.4, 16, 24, 1), 0, -8, 0),
      new Vector3(x, railCenter.y, railCenter.z), direction));
  });
  const rail = Geometry.mergeGeometries([
    Geometry.cylinderAlongX(9.5, -182, 168, 28).translate(0, railCenter.y, railCenter.z),
    Geometry.cylinderAlongX(12.5, -198, -182, 28).translate(0, railCenter.y, railCenter.z),
    Geometry.cylinderAlongX(5.5, 168, 190, 16).translate(0, railCenter.y, railCenter.z),
    ...seals,
  ]);
  return [solidMesh(Geometry.mergeGeometries(bodies), solid.injector, 'fuel', tag), solidMesh(rail, solid.fuelRail, 'fuel', tag)];
}

function auxiliaries({ spec, materials, tag }) {
  const solid = materials.solid;
  const pump = oilPump(materials, tag, solid);
  const plugs = sparkPlugs(spec, solid, tag);
  const fixed = [
    ...pump.fixed,
    ...oilPickup(solid, tag),
    ...oilFilter(materials, solid, tag),
    knockSensor(solid, tag),
    dipstick(solid, tag),
    coolantOutlet(solid, tag),
    ...plugs.meshes,
    ...fuelInjection(spec, solid, tag),
  ];
  return {
    fixed,
    onCrankshaft: [pump.innerRotor],
    sparkTips: plugs.tips,
    update(crankAngle) { pump.outerRotor.rotation.x = crankAngle * 6 / 7; },
  };
}

window.EngineBuilders.i4.auxiliaries = auxiliaries;
})();
