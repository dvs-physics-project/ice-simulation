/*
 * V-образный дизель: сборка 3D-сцены из деталей.
 *
 * createScene(viewport) строит все узлы через EngineBuilders.v8 и передаёт их общей сцене createEngineScene
 * вместе с настройками света, камеры и готовых видов. Шестерня распредвала крепится к распредвалу,
 * шестерня привода ТНВД — к валу насоса, поэтому они вращаются вместе с ними.
 * Продольный разрез идёт по биссектрисе развала того ряда, который ближе к камере; поперечный — через
 * цилиндр 1, при этом детали между камерой и плоскостью разреза скрываются.
 */
(function () {
'use strict';

const spec = window.EngineSpecs.v8;
const materials = window.EngineMaterials.v8;
const builders = window.EngineBuilders.v8;

function build(context) {
  const crank = builders.crankshaft(context);
  const pistons = builders.pistonsAndRods(context);
  const valvetrain = builders.valvetrain(context);
  const gears = builders.gearTrain(context);
  const fuel = builders.fuelSystem(context);
  const auxiliaries = builders.auxiliaries(context);
  const air = builders.airSystem(context);
  const housings = builders.housings(context);
  const gas = builders.gas(context, valvetrain.ports, air.flows, fuel.injectorTips);
  valvetrain.camshaft.add(gears.camGear);
  fuel.rotor.add(gears.pumpGear);

  return {
    addTo(scene) {
      scene.add(crank.group, crank.fixed, valvetrain.camshaft, valvetrain.portMesh);
      [...pistons.pistons, ...pistons.rods, ...pistons.liners, ...valvetrain.instanced, ...valvetrain.fixed,
        ...gears.objects, ...fuel.objects, ...auxiliaries.objects, ...air.objects, ...gas.objects,
        ...housings.meshes, ...housings.edges].forEach(object => scene.add(object));
      scene.add(housings.gaskets);
    },
    update(crankAngle, angleStep) {
      crank.update(crankAngle);
      pistons.update(crankAngle);
      valvetrain.update(crankAngle);
      gears.update(crankAngle);
      fuel.update(crankAngle);
      auxiliaries.update(crankAngle);
      air.update(crankAngle);
      gas.update(crankAngle, angleStep, valvetrain.lifts);
    },
    clipMaterials: [materials.solid.gasket],
    chambers: gas.chambers,
    valveLifts: cylinder => [valvetrain.lifts[cylinder], valvetrain.lifts[8 + cylinder]],
    onResize: height => { gas.points.material.uniforms.scale.value = height * 0.5; },
  };
}

function createScene(viewport) {
  return window.createEngineScene(viewport, {
    spec, materials, build,
    ariaLabel: '3D-модель V-образного двигателя',
    lighting: {
      keyPosition: [-900, 1500, 1050],
      shadowBox: { left: -820, right: 820, top: 820, bottom: -620, near: 400, far: 4200 },
      normalBias: 0.9,
      keyTarget: [0, 120, 0],
      fillPosition: [1200, 500, -900],
    },
    camera: { near: 8, far: 16000, minDistance: 260, maxDistance: 6400 },
    layers: ['crank', 'flywheel', 'pistons', 'valvetrain', 'gears', 'fuel', 'air', 'aux', 'gas', 'housing'],
    views: {
      iso: { direction: [-0.35, 0.55, 0.76], target: [20, 120, 0], radius: 660 },
      front: { direction: [-1, 0.1, 0.0001], target: [-470, 150, 0], radius: 450 },
      gears: { direction: [1, 0.16, -0.3], target: [372, 130, -30], radius: 360 },
      side: { direction: [0.0001, 0.08, -1], target: [20, 120, 0], radius: 640 },
      top: { direction: [0.0001, 1, 0.0001], target: [20, 180, 0], radius: 600 },
    },
    focusMinDistance: 300,
    longSectionNormal: camera => [0, -Math.SQRT1_2, -(camera.z >= 0 ? 1 : -1) * Math.SQRT1_2],
    hideNearSideInTransverseSection: true,
  });
}

window.EngineScenes = Object.assign(window.EngineScenes || {}, { v8: createScene });
})();
