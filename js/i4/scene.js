/*
 * Рядный двигатель: сборка 3D-сцены из деталей.
 *
 * createScene(viewport) решает ремень ГРМ (spec.solveBelt), строит все узлы через EngineBuilders.i4
 * и передаёт их общей сцене createEngineScene вместе с настройками света, камеры и готовых видов.
 * update двигает узлы в порядке: вал → поршни → клапаны → ремень → насосы → газ.
 */
(function () {
'use strict';

const spec = window.EngineSpecs.i4;
const materials = window.EngineMaterials.i4;
const builders = window.EngineBuilders.i4;

function build(context) {
  const solution = spec.solveBelt();
  const belt = Object.assign({ solution }, builders.beltToothPhases(spec, solution));

  const crank = builders.crankshaft(context, belt);
  const pistons = builders.pistonsAndRods(context);
  const valvetrain = builders.valvetrain(context, belt);
  const timing = builders.timingBelt(context, belt);
  const housings = builders.housings(context);
  const auxiliaries = builders.auxiliaries(context);
  const gas = builders.gas(context, valvetrain.ports, auxiliaries.sparkTips);
  auxiliaries.onCrankshaft.forEach(mesh => crank.group.add(mesh));

  return {
    addTo(scene) {
      scene.add(crank.group, crank.fixed);
      pistons.pistons.forEach(piston => scene.add(piston));
      pistons.rods.forEach(rod => scene.add(rod));
      valvetrain.camshafts.forEach(camshaft => scene.add(camshaft));
      scene.add(valvetrain.bearingCaps, valvetrain.portMesh);
      valvetrain.instanced.forEach(mesh => scene.add(mesh));
      valvetrain.fixed.forEach(mesh => { mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); });
      [...timing.objects, ...timing.cover, ...housings.meshes, ...housings.edges].forEach(object => scene.add(object));
      scene.add(housings.gaskets);
      auxiliaries.fixed.forEach(object => scene.add(object));
      gas.objects.forEach(object => scene.add(object));
    },
    update(crankAngle, angleStep) {
      crank.update(crankAngle);
      pistons.update(crankAngle);
      valvetrain.update(crankAngle);
      timing.update(crankAngle);
      auxiliaries.update(crankAngle);
      gas.update(crankAngle, angleStep, valvetrain.lifts);
    },
    clipMaterials: [materials.solid.gasket, materials.solid.camCap, materials.hardware.steel],
    chambers: gas.chambers,
    valveLifts: cylinder => [valvetrain.lifts[cylinder * 2], valvetrain.lifts[8 + cylinder * 2]],
    onResize: height => { gas.points.material.uniforms.scale.value = height * 0.5; },
  };
}

function createScene(viewport) {
  return window.createEngineScene(viewport, {
    spec, materials, build,
    ariaLabel: '3D-модель двигателя',
    lighting: {
      keyPosition: [-420, 760, 520],
      shadowBox: { left: -420, right: 420, top: 460, bottom: -330, near: 200, far: 2200 },
      normalBias: 0.6,
      keyTarget: [0, 90, 0],
      fillPosition: [620, 240, -480],
    },
    camera: { near: 5, far: 9000, minDistance: 160, maxDistance: 3200 },
    layers: ['crank', 'pistons', 'valvetrain', 'timing', 'housing', 'aux', 'gas'],
    views: {
      iso: { direction: [-0.62, 0.42, 0.66], target: [-12, 112, 0], radius: 395 },
      front: { direction: [-1, 0.06, 0.0001], target: [-215, 140, 0], radius: 262 },
      side: { direction: [0.0001, 0.04, 1], target: [-6, 112, 0], radius: 330 },
      top: { direction: [0.0001, 1, 0.0001], target: [-6, 112, 0], radius: 290 },
      head: { direction: [-0.6, 0.55, 0.58], target: [-90, 262, 0], radius: 235 },
    },
    focusMinDistance: 240,
    longSectionNormal: camera => [0, 0, camera.z >= 0 ? -1 : 1],
    hideNearSideInTransverseSection: false,
    coverPart: 'tcover',
  });
}

window.EngineScenes = Object.assign(window.EngineScenes || {}, { i4: createScene });
})();
