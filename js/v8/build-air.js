/*
 * V-образный дизель: наддув и газовые тракты — два турбокомпрессора за маховиком (по одному на ряд),
 * впускные и выпускные коллекторы рядов, общий воздухозаборник.
 *
 *   airSystem(context) → { objects, flows, update(crankAngle) }
 *     flows — средние линии потоков для частиц: intake[ряд] — от заборника через компрессор в коллектор,
 *             exhaust[ряд] — из коллектора через турбину в приёмную трубу;
 *     update вращает роторы турбин. Скорость условная — 6 оборотов на оборот вала: настоящий ротор
 *     крутится в десятки раз быстрее вала, и на экране его вращение было бы неразличимо.
 *
 *   turboWheel(blades, hubProfile, bladeOutline, twist, height) — колесо с закрученными лопатками
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Vector3 = THREE.Vector3;
const Banks = window.CylinderBanks;
const builders = window.EngineBuilders.v8;
const TURBO_X = 585, TURBO_Y = 470, COMPRESSOR_Z = 135, TURBINE_WHEEL_Z = 230, TURBINE_Z = 238;
const ROTOR_TURNS_PER_CRANK_TURN = 6;

const smoothCurve = points => new THREE.CatmullRomCurve3(points, false, 'centripetal');
const tubeAlong = (points, radius, segments) => new THREE.TubeGeometry(smoothCurve(points), segments || 48, radius, 16, false);
const onTurboAxis = (geometry, z) => geometry.rotateX(Math.PI / 2).translate(TURBO_X, TURBO_Y, z);

function turboWheel(blades, hubProfile, bladeOutline, twist, height) {
  const parts = [Geometry.lathe(hubProfile, 48)];
  const shape = Geometry.polygonShape(bladeOutline);
  for (let k = 0; k < blades; k++) {
    const blade = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false, curveSegments: 1 });
    blade.translate(0, 0, -0.8);
    const vertices = blade.attributes.position, baseAngle = k / blades * Math.PI * 2;
    for (let i = 0; i < vertices.count; i++) {
      const r = vertices.getX(i), y = vertices.getY(i), t = vertices.getZ(i), angle = baseAngle + twist * (y / height);
      vertices.setXYZ(i, r * Math.cos(angle) - t * Math.sin(angle), y, r * Math.sin(angle) + t * Math.cos(angle));
    }
    blade.computeVertexNormals();
    parts.push(blade);
  }
  return Geometry.mergeGeometries(parts);
}

function manifoldFlanges(spec, firstCylinder, size, center) {
  return [0, 1, 2, 3].map(k => {
    const cylinder = firstCylinder + k;
    const flange = new THREE.BoxGeometry(size, size, 6).translate(...center);
    Geometry.applyQuaternion(flange, Banks.rotation(spec, cylinder));
    return flange.translate(spec.cylinders[cylinder].x, 0, 0);
  });
}

function turboRotor(materials, mesh, side) {
  const holder = new THREE.Group();
  holder.position.set(TURBO_X, TURBO_Y, side * COMPRESSOR_Z);
  holder.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0, 0, side));
  const spin = new THREE.Group();
  holder.add(spin);
  const compressorWheel = turboWheel(11, [[0, 0], [44, 0], [44, 3], [26, 10], [13, 25], [9, 34], [0, 34]],
    [[42, 3], [42, 11], [33, 21], [27, 34], [10, 34], [13, 25.5], [25, 10.5]], -0.7, 34);
  compressorWheel.rotateX(Math.PI);
  const turbineWheel = turboWheel(12, [[0, 0], [40, 0], [40, 3], [22, 12], [11, 26], [9, 30], [0, 30]],
    [[38, 3], [38, 10], [30, 20], [26, 30], [10, 30], [12, 25], [22, 11.5]], 0.45, 30);
  turbineWheel.translate(0, TURBINE_WHEEL_Z - COMPRESSOR_Z, 0);
  const shaft = new THREE.CylinderGeometry(6, 6, TURBINE_WHEEL_Z - COMPRESSOR_Z + 30, 16).translate(0, (TURBINE_WHEEL_Z - COMPRESSOR_Z) / 2, 0);
  const nut = Geometry.hexPrism(12, 8);
  nut.rotateX(Math.PI);
  nut.translate(0, -34, 0);
  spin.add(mesh(compressorWheel, materials.solid.compWheel, 'turbo'), mesh(turbineWheel, materials.solid.turbineWheel, 'turbo'));
  spin.add(mesh(Geometry.mergeGeometries([shaft, nut]), materials.hardware.steel, 'turbo'));
  return { holder, spin };
}

function airSystem({ spec, materials, tag }) {
  const objects = [], spins = [];
  const flows = { intake: [], exhaust: [] };
  const ghost = (geometry, materialKey, part, edgeAngle) => {
    const body = tag(new THREE.Mesh(geometry, materials.ghost[materialKey]), part, 'air');
    body.renderOrder = 2;
    const edges = tag(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle || 30), materials.ghostEdges[materialKey]), part, 'air');
    edges.renderOrder = 3;
    edges.userData.pickable = false;
    objects.push(body, edges);
  };
  const mesh = (geometry, material, part) => {
    const result = tag(new THREE.Mesh(geometry, material), part, 'air');
    result.castShadow = result.receiveShadow = true;
    return result;
  };

  for (const bank of ['right', 'left']) {
    const side = bank === 'right' ? -1 : 1, firstCylinder = bank === 'right' ? 0 : 4;
    const [, intakeY, intakeZ] = spec.pointInBank(firstCylinder, 0, 468, 172);
    const [, exhaustY, exhaustZ] = spec.pointInBank(firstCylinder, 0, 466, -128);

    const intakeManifold = Geometry.mergeGeometries([Geometry.cylinderAlongX(30, -350, 350, 32, true), Geometry.cylinderAlongX(30, -356, -350, 32)])
      .translate(0, intakeY, intakeZ);
    ghost(Geometry.mergeGeometries([intakeManifold, ...manifoldFlanges(spec, firstCylinder, 46, [-54, 468, 143])]), 'intake', 'intake', 35);

    const exhaustManifold = Geometry.cylinderAlongX(28, -320, 330, 32, true).translate(0, exhaustY, exhaustZ);
    const exhaustCap = Geometry.cylinderAlongX(28, -326, -320, 32).translate(0, exhaustY, exhaustZ);
    const toTurbine = [new Vector3(320, exhaustY, exhaustZ), new Vector3(372, exhaustY + 12, exhaustZ - side * 6), new Vector3(450, 300, side * 380),
      new Vector3(520, 360, side * 320), new Vector3(556, 392, side * (TURBINE_Z + 8)), new Vector3(TURBO_X - 8, TURBO_Y - 60, side * TURBINE_Z)];
    ghost(Geometry.mergeGeometries([exhaustManifold, exhaustCap, ...manifoldFlanges(spec, firstCylinder, 40, [34, 466, -97]), tubeAlong(toTurbine, 26, 64)]),
      'exhaust', 'exhaust', 35);
    const downpipe = [new Vector3(TURBO_X, TURBO_Y, side * 312), new Vector3(TURBO_X, TURBO_Y - 30, side * 334), new Vector3(TURBO_X + 40, TURBO_Y - 130, side * 346)];
    ghost(tubeAlong(downpipe, 30, 24), 'exhaust', 'exhaust', 40);

    const compressorVolute = new THREE.TorusGeometry(66, 25, 14, 48).translate(TURBO_X, TURBO_Y, side * (COMPRESSOR_Z + 2));
    const compressorBack = onTurboAxis(Geometry.lathe([[0, -5], [72, -5], [72, 5], [0, 5]], 48), side * (COMPRESSOR_Z + 9));
    const compressorInlet = onTurboAxis(new THREE.CylinderGeometry(36, 36, 52, 32, 1, true), side * (COMPRESSOR_Z - 34));
    const turbineVolute = new THREE.TorusGeometry(60, 27, 14, 48).translate(TURBO_X, TURBO_Y, side * TURBINE_Z);
    const turbineOutlet = onTurboAxis(new THREE.CylinderGeometry(34, 34, 50, 32, 1, true), side * 287);
    const toManifold = [new Vector3(TURBO_X + 6, TURBO_Y + 66, side * (COMPRESSOR_Z + 2)), new Vector3(TURBO_X - 50, TURBO_Y + 74, side * (COMPRESSOR_Z + 10)),
      new Vector3(470, intakeY + 50, side * 190), new Vector3(380, intakeY + 6, intakeZ), new Vector3(352, intakeY, intakeZ)];
    ghost(Geometry.mergeGeometries([compressorVolute, compressorBack, compressorInlet, turbineVolute, turbineOutlet, tubeAlong(toManifold, 25, 56)]),
      'turbo', 'turbo', 40);
    objects.push(mesh(Geometry.mergeGeometries([
      onTurboAxis(new THREE.CylinderGeometry(34, 34, 47, 32), side * 186.5),
      new THREE.CylinderGeometry(9, 9, 60, 12).translate(TURBO_X, TURBO_Y - 54, side * 186.5),
      new THREE.CylinderGeometry(5, 5, 50, 12).translate(TURBO_X + 18, TURBO_Y + 50, side * 186.5),
    ]), materials.solid.turboCore, 'turbo'));

    const rotor = turboRotor(materials, mesh, side);
    objects.push(rotor.holder);
    spins.push(rotor.spin);

    flows.intake.push(smoothCurve([new Vector3(TURBO_X - 150, TURBO_Y + 150, 0), new Vector3(TURBO_X - 60, TURBO_Y + 138, 0), new Vector3(TURBO_X, TURBO_Y + 96, 0),
      new Vector3(TURBO_X, TURBO_Y + 22, side * 12), new Vector3(TURBO_X, TURBO_Y, side * 64), new Vector3(TURBO_X, TURBO_Y, side * (COMPRESSOR_Z - 30)),
      new Vector3(TURBO_X, TURBO_Y + 34, side * (COMPRESSOR_Z - 2)), ...toManifold, new Vector3(250, intakeY, intakeZ), new Vector3(-340, intakeY, intakeZ)]));
    flows.exhaust.push(smoothCurve([new Vector3(-310, exhaustY, exhaustZ), new Vector3(200, exhaustY, exhaustZ), ...toTurbine,
      new Vector3(TURBO_X, TURBO_Y - 22, side * TURBINE_Z), new Vector3(TURBO_X, TURBO_Y, side * 262), ...downpipe]));
  }

  ghost(Geometry.mergeGeometries([
    onTurboAxis(new THREE.CylinderGeometry(36, 36, 2 * (COMPRESSOR_Z - 60), 32, 1, true), 0),
    tubeAlong([new Vector3(TURBO_X, TURBO_Y + 20, 0), new Vector3(TURBO_X, TURBO_Y + 96, 0), new Vector3(TURBO_X - 60, TURBO_Y + 138, 0),
      new Vector3(TURBO_X - 150, TURBO_Y + 150, 0)], 38, 32),
  ]), 'intake', 'intake', 40);

  return {
    objects, flows,
    update(crankAngle) { spins.forEach(spin => { spin.rotation.y = ROTOR_TURNS_PER_CRANK_TURN * crankAngle; }); },
  };
}

builders.airSystem = airSystem;
})();
