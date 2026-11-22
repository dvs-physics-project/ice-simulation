/*
 * Оппозитный двигатель: сборка 3D-сцены из деталей.
 *
 * createScene(viewport) решает ремень ГРМ (spec.solveBelt), строит все узлы через EngineBuilders.b4
 * и передаёт их общей сцене createEngineScene вместе с настройками света, камеры и готовых видов.
 * Продольный разрез идёт горизонтальной плоскостью через ось вала (цилиндры лежат), поперечный — через
 * цилиндр 1; при поперечном разрезе детали по ту сторону плоскости, что ближе к камере, скрываются.
 */
(function () {
'use strict';

const spec = window.EngineSpecs.b4;
const materials = window.EngineMaterials.b4;
const builders = window.EngineBuilders.b4;

function build(context) {
  const solution = spec.solveBelt();
  const belt = Object.assign({ solution }, builders.beltToothPhases(spec, solution));

  const crank = builders.crankshaft(context, belt);
  const pistons = builders.pistonsAndRods(context);
  const valvetrain = builders.valvetrain(context, belt);
  const timing = builders.timingBelt(context, belt);
  const housings = builders.housings(context);
  const auxiliaries = builders.auxiliaries(context);
  const air = builders.airAndFuel(context);
  const gas = builders.gas(context, valvetrain.ports, air.flows, auxiliaries.sparkTips);
  auxiliaries.onCrankshaft.forEach(mesh => crank.group.add(mesh));

  return {
    addTo(scene) {
      scene.add(crank.group, crank.fixed);
      [...pistons.pistons, ...pistons.rods, ...valvetrain.camshafts, ...valvetrain.instanced, ...valvetrain.fixed, ...valvetrain.portMeshes,
        ...timing.objects, ...timing.cover, ...housings.meshes, ...housings.edges, ...housings.solids,
        ...auxiliaries.fixed, ...air.objects, ...gas.objects].forEach(object => scene.add(object));
    },
    update(crankAngle, angleStep) {
      crank.update(crankAngle);
      pistons.update(crankAngle);
      valvetrain.update(crankAngle);
      timing.update(crankAngle);
      auxiliaries.update(crankAngle);
      gas.update(crankAngle, angleStep, valvetrain.lifts);
    },
    clipMaterials: [materials.solid.gasket, materials.solid.headBolt, materials.solid.caseBolt],
    chambers: gas.chambers,
    valveLifts: cylinder => [valvetrain.lifts[cylinder * 2], valvetrain.lifts[8 + cylinder * 2]],
    onResize: height => { gas.points.material.uniforms.scale.value = height * 0.5; },
  };
}

function createScene(viewport) {
  return window.createEngineScene(viewport, {
    spec, materials, build,
    ariaLabel: '3D-модель оппозитного двигателя',
    lighting: {
      keyPosition: [-700, 1250, 900],
      shadowBox: { left: -640, right: 640, top: 600, bottom: -560, near: 300, far: 3400 },
      normalBias: 0.7,
      keyTarget: [0, -20, 0],
      fillPosition: [900, 300, -800],
    },
    camera: { near: 6, far: 12000, minDistance: 180, maxDistance: 4800 },
    layers: ['crank', 'pistons', 'valvetrain', 'timing', 'air', 'aux', 'gas', 'housing'],
    views: {
      iso: { direction: [-0.62, 0.5, 0.6], target: [-10, -10, 0], radius: 440 },
      front: { direction: [-1, 0.05, 0.0001], target: [-170, -5, 0], radius: 400 },
      head: { direction: [0.04, 0.16, -1], target: [-12, -14, -300], radius: 245 },
      top: { direction: [-0.0001, 1, 0], target: [-5, 0, 0], radius: 400 },
      low: { direction: [-0.3, -1, 0.0001], target: [0, -60, 0], radius: 410 },
    },
    focusMinDistance: 220,
    longSectionNormal: camera => [0, camera.y >= 0 ? -1 : 1, 0],
    hideNearSideInTransverseSection: true,
    coverPart: 'tcover',
  });
}

window.EngineScenes = Object.assign(window.EngineScenes || {}, { b4: createScene });
})();
