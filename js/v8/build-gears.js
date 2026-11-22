/*
 * V-образный дизель: задний шестерённый привод — прямозубые эвольвентные шестерни модуля 4.
 * Шестерня коленвала (24 зуба) строится вместе с валом, здесь — паразитная (30), распредвала (48)
 * и привода ТНВД (48).
 *
 *   gearTrain(context) → { objects, camGear, pumpGear, update(crankAngle) }
 *     camGear и pumpGear потом крепятся к распредвалу и ротору ТНВД и вращаются вместе с ними;
 *     паразитная шестерня вращается с отношением −24/30 к коленвалу.
 * Фазы зубьев (spec.gears[...].phase) подобраны так, что зуб каждой шестерни стоит во впадине соседней.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const builders = window.EngineBuilders.v8;

function gearTrain({ spec, materials, tag }) {
  const solid = materials.solid, gears = spec.gears, halfWidth = spec.gearWidth / 2;
  const mesh = (geometry, material, part) => {
    const result = tag(new THREE.Mesh(geometry, material), part, 'gears');
    result.castShadow = result.receiveShadow = true;
    return result;
  };

  const idler = new THREE.Group();
  idler.position.set(spec.gearX, gears.idler.y, gears.idler.z);
  idler.add(mesh(builders.gearGeometry(gears.idler.teeth, spec.gearModule, gears.idler.phase, -halfWidth, halfWidth,
    { bore: 22, holes: 5, holeRadius: 11, holeCircle: 36 }), solid.idlerGear, 'idlerGear'));
  idler.add(mesh(Geometry.tubeAlongX(22, 30, -halfWidth - 2, halfWidth + 2, 40), solid.idlerGear, 'idlerGear'));

  const axle = new THREE.Group();
  axle.position.copy(idler.position);
  const axleNut = Geometry.hexPrism(17, 7);
  Geometry.rotateToX(axleNut);
  axleNut.translate(halfWidth + 7, 0, 0);
  axle.add(mesh(Geometry.mergeGeometries([
    Geometry.cylinderAlongX(21.9, 360 - spec.gearX, halfWidth + 3, 32), Geometry.tubeAlongX(8, 30, halfWidth + 3, halfWidth + 7, 40), axleNut,
  ]), materials.hardware.steel, 'idlerGear'));

  const x0 = spec.gearX - halfWidth, x1 = spec.gearX + halfWidth;
  const camGear = mesh(builders.gearGeometry(gears.cam.teeth, spec.gearModule, gears.cam.phase, x0, x1,
    { bore: 20, holes: 6, holeRadius: 17, holeCircle: 58 }), solid.camGear, 'camGear');
  camGear.add(mesh(Geometry.tubeAlongX(20, 34, x0 - 3, x1 + 1.5, 48), solid.camGear, 'camGear'));

  const pumpGear = mesh(builders.gearGeometry(gears.pump.teeth, spec.gearModule, gears.pump.phase, x0, x1,
    { bore: 16, holes: 6, holeRadius: 17, holeCircle: 58 }), solid.pumpGear, 'pumpGear');
  const pumpNut = Geometry.hexPrism(22, 8);
  Geometry.rotateToX(pumpNut);
  pumpNut.translate(x1 + 1.5, 0, 0);
  pumpGear.add(mesh(Geometry.mergeGeometries([Geometry.tubeAlongX(16, 34, x0 - 6, x1 + 1.5, 48), pumpNut]), solid.pumpGear, 'pumpGear'));

  return {
    objects: [idler, axle], camGear, pumpGear,
    update(crankAngle) { idler.rotation.x = spec.gearSpeedRatio.idler * crankAngle; },
  };
}

builders.gearTrain = gearTrain;
})();
