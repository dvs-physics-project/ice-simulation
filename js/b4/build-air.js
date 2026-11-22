/*
 * Оппозитный двигатель: впуск, топливо и выпуск.
 *
 *   airAndFuel(context) → { objects, flows }
 *     ресивер над двигателем с дроссельной заслонкой, четыре впускных патрубка к головкам;
 *     форсунки в патрубках и топливная рампа на каждом ряду, соединённые трубкой;
 *     выпускные трубы под двигателем, сходящиеся в два коллектора.
 *     flows — средние линии потоков для частиц газа: intake[цилиндр], exhaust[цилиндр], throttle.
 *
 * Точки патрубков у головки задаются в координатах ряда (spec.pointInBank), остальные — в координатах двигателя.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Vector3 = THREE.Vector3;
const builders = window.EngineBuilders.b4;
const Banks = window.CylinderBanks;
const PLENUM_Y = 158, PLENUM_X = [-112, 128];
const INJECTOR_TILT = 40 * Math.PI / 180;

const smoothCurve = points => new THREE.CatmullRomCurve3(points, false, 'centripetal');

function intakeSystem(spec, materials, ghost, solid, flows) {
  const inBank = (cylinder, along, side) => Banks.point(spec, cylinder, 0, along, side);
  const plenum = Geometry.extrudeAlongX(Geometry.roundedRect(76, 116, 24), PLENUM_X[0], PLENUM_X[1], { curveSegments: 6 }).translate(0, PLENUM_Y, 0);
  const throttleBody = Geometry.mergeGeometries([
    Geometry.tubeAlongX(27, 31, -152, PLENUM_X[0], 40), Geometry.tubeAlongX(27, 38, -158, -152, 40),
  ]).translate(0, PLENUM_Y + 2, 0);

  const runners = [], flanges = [];
  spec.cylinders.forEach((cylinder, index) => {
    const points = [inBank(index, 30, PLENUM_Y), inBank(index, 88, PLENUM_Y + 8), inBank(index, 160, PLENUM_Y + 26), inBank(index, 228, PLENUM_Y + 18),
      inBank(index, 268, PLENUM_Y - 10), inBank(index, 284, 116), inBank(index, 287, 92)];
    runners.push(new THREE.TubeGeometry(smoothCurve(points.slice(1)), 48, 20, 16, false));
    const flange = Geometry.lathe([[0, 0], [27, 0], [27, 6], [0, 6]], 28);
    Geometry.applyQuaternion(flange, Banks.rotation(spec, index, Math.PI / 2));
    const flangePoint = inBank(index, 287, 86);
    flanges.push(flange.translate(flangePoint.x, flangePoint.y, flangePoint.z));
    flows.intake.push(smoothCurve([new Vector3(cylinder.x, PLENUM_Y + 4, 0), ...points.slice(1)]));
  });
  ghost(Geometry.mergeGeometries([plenum, throttleBody]), 'intake', 'intake', 24);
  ghost(Geometry.mergeGeometries(runners.concat(flanges)), 'intake', 'intake', 40);

  const throttlePlate = new THREE.CylinderGeometry(26.6, 26.6, 1.6, 40);
  throttlePlate.rotateZ(Math.PI / 2);
  throttlePlate.rotateY(0.6);
  throttlePlate.translate(-136, PLENUM_Y + 2, 0);
  const spindle = Geometry.cylinderBetween(2.6, new Vector3(-136, PLENUM_Y + 2, -36), new Vector3(-136, PLENUM_Y + 2, 36), 10);
  solid(Geometry.mergeGeometries([throttlePlate, spindle]), materials.hardware.aluminium, 'intake');
  flows.throttle = smoothCurve([new Vector3(-190, PLENUM_Y + 2, 0), new Vector3(-150, PLENUM_Y + 2, 0), new Vector3(-100, PLENUM_Y, 0),
    new Vector3(0, PLENUM_Y, 0), new Vector3(PLENUM_X[1] - 12, PLENUM_Y, 0)]);
}

function fuelSystem(spec, materials, solid) {
  const bodies = [], seals = [], rails = [], railEnds = { right: [], left: [] };
  spec.cylinders.forEach((cylinder, index) => {
    const tip = Banks.point(spec, index, 0, 292, 100);
    const rotation = Banks.rotation(spec, index, INJECTOR_TILT);
    const axis = new Vector3(0, 1, 0).applyQuaternion(rotation);
    const place = geometry => {
      Geometry.applyQuaternion(geometry, rotation);
      return geometry.translate(tip.x, tip.y, tip.z);
    };
    bodies.push(place(Geometry.mergeGeometries([
      Geometry.lathe([[0, 0], [3.2, 0], [3.2, 7], [7.6, 9], [7.6, 46], [5.2, 48], [5.2, 62], [0, 62]], 28),
      new THREE.BoxGeometry(12, 10, 9).translate(0, 38, 9),
    ])));
    const oRing = new THREE.TorusGeometry(5.6, 1.3, 8, 24);
    oRing.rotateX(Math.PI / 2);
    oRing.translate(0, 8, 0);
    seals.push(place(Geometry.mergeGeometries([oRing, new THREE.CylinderGeometry(9, 9, 14, 24).translate(0, 58, 0)])));
    railEnds[cylinder.bank].push(tip.clone().addScaledVector(axis, 58));
  });

  const railFarEnd = {};
  for (const bank of ['right', 'left']) {
    const [front, rear] = railEnds[bank].sort((a, b) => a.x - b.x);
    rails.push(Geometry.cylinderAlongX(8, front.x - 34, rear.x + 30, 20).translate(0, front.y, front.z));
    rails.push(Geometry.cylinderAlongX(10.5, front.x - 52, front.x - 34, 20).translate(0, front.y, front.z));
    railFarEnd[bank] = new Vector3(rear.x + 30, front.y, front.z);
  }
  const right = railFarEnd.right, left = railFarEnd.left, crossX = PLENUM_X[1] + 26;
  const crossover = smoothCurve([right, new Vector3(right.x + 30, right.y + 4, right.z * 0.9), new Vector3(crossX, PLENUM_Y + 4, -120),
    new Vector3(crossX + 4, PLENUM_Y + 8, 0), new Vector3(crossX, PLENUM_Y + 4, 120), new Vector3(left.x + 24, left.y + 4, left.z * 0.9), left]);
  rails.push(new THREE.TubeGeometry(crossover, 64, 3.6, 10, false));
  solid(Geometry.mergeGeometries(bodies), materials.solid.injector, 'injector');
  solid(Geometry.mergeGeometries(seals.concat(rails)), materials.solid.fuelRail, 'injector');
}

function exhaustSystem(spec, ghost, flows) {
  const inBank = (cylinder, along, side) => Banks.point(spec, cylinder, 0, along, side);
  const tubes = [];
  for (const bank of ['right', 'left']) {
    const z = bank === 'right' ? -1 : 1;
    const bankCylinders = spec.cylinders.filter(cylinder => cylinder.bank === bank);
    const frontX = bankCylinders[0].x, rearX = bankCylinders[1].x;
    const collector = [new Vector3(frontX - 10, -214, z * 250), new Vector3(rearX + 20, -216, z * 248), new Vector3(140, -224, z * 214),
      new Vector3(186, -234, z * 150), new Vector3(232, -238, z * 126), new Vector3(300, -238, z * 126)];
    tubes.push(new THREE.TubeGeometry(smoothCurve(collector), 80, 22, 16, false));
    for (const cylinder of bankCylinders) {
      const pipe = [inBank(cylinder.index, 266, -97), inBank(cylinder.index, 265, -128), inBank(cylinder.index, 260, -162),
        inBank(cylinder.index, 254, -190), new Vector3(cylinder.x + 16, -212, z * 249)];
      tubes.push(new THREE.TubeGeometry(smoothCurve(pipe), 40, 17, 14, false));
      const flange = Geometry.lathe([[0, 0], [26, 0], [26, 6], [0, 6]], 28);
      Geometry.applyQuaternion(flange, Banks.rotation(spec, cylinder.index, -Math.PI / 2));
      const flangePoint = inBank(cylinder.index, 266, -96);
      tubes.push(flange.translate(flangePoint.x, flangePoint.y, flangePoint.z));
      flows.exhaust[cylinder.index] = smoothCurve(pipe.concat(collector.filter(point => point.x > cylinder.x + 16)));
    }
  }
  ghost(Geometry.mergeGeometries(tubes), 'exhaust', 'exhaust', 40);
}

function airAndFuel({ spec, materials, tag }) {
  const objects = [];
  const flows = { intake: [], exhaust: [], throttle: null };
  const ghost = (geometry, materialKey, part, edgeAngle) => {
    const mesh = tag(new THREE.Mesh(geometry, materials.ghost[materialKey]), part, 'air');
    mesh.renderOrder = 2;
    const edges = tag(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle || 30), materials.ghostEdges[materialKey]), part, 'air');
    edges.renderOrder = 3;
    edges.userData.pickable = false;
    objects.push(mesh, edges);
  };
  const solid = (geometry, material, part) => {
    const mesh = tag(new THREE.Mesh(geometry, material), part, 'air');
    mesh.castShadow = mesh.receiveShadow = true;
    objects.push(mesh);
  };
  intakeSystem(spec, materials, ghost, solid, flows);
  fuelSystem(spec, materials, solid);
  exhaustSystem(spec, ghost, flows);
  return { objects, flows };
}

builders.airAndFuel = airAndFuel;
})();
