/*
 * V-образный дизель: топливная аппаратура — рядный ТНВД в развале блока, форсунки в головках,
 * трубки высокого давления.
 *
 *   fuelSystem(context) → { objects, rotor, injectorTips, update(crankAngle) }
 *     rotor — кулачковый вал насоса (к нему крепится шестерня привода), вращается навстречу коленвалу
 *             с половиной его скорости;
 *     плунжеры стоят двумя рядами под углом ±37,5°; толкатель и плунжер поднимаются на spec.plungerLift;
 *     трубка высокого давления цилиндра вспыхивает во время впрыска (spec.injection, с опережением 6°).
 *
 *   pumpHousingOutline(spec) — сечение корпуса ТНВД: «домик» из двух рядов плунжеров над валом.
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Vector3 = THREE.Vector3;
const Banks = window.CylinderBanks;
const builders = window.EngineBuilders.v8;
const DEG = window.EngineMath.DEG;
const INJECTOR_TILT = 15 * DEG;
const PULSE_LEAD_DEG = 6;

function plungerDirection(spec, cylinder) {
  const angle = spec.plungerPosition(cylinder).rowAngle;
  return new Vector3(0, Math.cos(angle), Math.sin(angle));
}

function pointOnPlungerAxis(spec, cylinder, distance) {
  return plungerDirection(spec, cylinder).multiplyScalar(distance).add(new Vector3(spec.plungerPosition(cylinder).x, spec.gears.pump.y, 0));
}

function pumpHousingOutline(spec) {
  const rowAngle = spec.injectionPump.rowAngle;
  const along = [Math.cos(-rowAngle), Math.sin(-rowAngle)], across = [-along[1], along[0]];
  const pointInRow = (distance, offset) => [along[0] * distance + across[0] * offset, along[1] * distance + across[1] * offset];
  const top = 116, halfWidth = 23;
  const outline = [[halfWidth / Math.sin(rowAngle), 0], pointInRow(top, halfWidth), pointInRow(top, -halfWidth)];
  const bottomCorner = pointInRow(44, -halfWidth);
  const startAngle = Math.atan2(bottomCorner[1], bottomCorner[0]), radius = Math.hypot(bottomCorner[0], bottomCorner[1]);
  outline.push(bottomCorner);
  for (let k = 1; k < 24; k++) {
    const angle = startAngle - (2 * Math.PI + 2 * startAngle) * k / 24;
    outline.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  outline.push([bottomCorner[0], -bottomCorner[1]], [outline[2][0], -outline[2][1]], [outline[1][0], -outline[1][1]]);
  return outline;
}

function pumpRotor(spec, materials, mesh) {
  const pump = spec.injectionPump;
  const rotor = new THREE.Group();
  rotor.position.set(0, spec.gears.pump.y, 0);
  const shaft = [
    Geometry.cylinderAlongX(12, pump.x0 + 6, pump.x1, 24), Geometry.cylinderAlongX(14, pump.x1, spec.gearX - 10, 24),
    Geometry.cylinderAlongX(17, pump.x0 + 10, pump.x0 + 26, 32), Geometry.cylinderAlongX(17, pump.x1 - 16, pump.x1, 32),
  ];
  const coupling = [Geometry.cylinderAlongX(40, 200, 205, 40), Geometry.cylinderAlongX(40, 215, 220, 40), Geometry.cylinderAlongX(30, 205, 215, 32)];
  for (let k = 0; k < 4; k++) {
    const angle = k * Math.PI / 2 + Math.PI / 4, bolt = Geometry.hexPrism(10, 5);
    Geometry.rotateToX(bolt);
    coupling.push(bolt.translate(220, 28 * Math.cos(angle), 28 * Math.sin(angle)));
  }
  const lobeShape = Geometry.polygonShape(spec.pumpLobeProfile(200));
  const lobes = spec.cylinders.map((cylinder, index) => {
    const lobe = new THREE.ExtrudeGeometry(lobeShape, { depth: pump.lobeWidth, bevelEnabled: false, curveSegments: 1 });
    lobe.rotateZ(spec.pumpLobeAngle(index));
    lobe.translate(0, 0, spec.plungerPosition(index).x - pump.lobeWidth / 2);
    return Geometry.shapeToYZ(lobe);
  });
  rotor.add(mesh(Geometry.mergeGeometries(shaft), materials.hardware.steel, 'injPump'));
  rotor.add(mesh(Geometry.mergeGeometries(lobes), materials.solid.pumpCam, 'injPump'));
  rotor.add(mesh(Geometry.mergeGeometries(coupling), materials.hardware.steel, 'injPump'));
  return rotor;
}

function pumpHousing(spec, materials, tag) {
  const pump = spec.injectionPump;
  const housing = Geometry.extrudeAlongX(Geometry.polygonShape(pumpHousingOutline(spec)), pump.x0, pump.x1, { curveSegments: 1 });
  housing.translate(0, spec.gears.pump.y, 0);
  const governor = Geometry.lathe([[0, 0], [52, 0], [56, 6], [56, 60], [0, 60]], 48, 0, undefined, true);
  Geometry.rotateToX(governor);
  governor.translate(pump.x0 - 60, spec.gears.pump.y + 4, 0);
  const geometry = Geometry.mergeGeometries([housing, governor]);
  const body = tag(new THREE.Mesh(geometry, materials.ghost.pump), 'injPump', 'fuel');
  body.renderOrder = 2;
  const edges = tag(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), materials.ghostEdges.pump), 'injPump', 'fuel');
  edges.renderOrder = 3;
  edges.userData.pickable = false;
  return [body, edges];
}

function injectorGeometry() {
  const inlet = new THREE.CylinderGeometry(6, 6, 24, 16);
  inlet.rotateX(Math.PI / 2);
  inlet.translate(0, 128, 12);
  const inletNut = Geometry.hexPrism(17, 8);
  inletNut.rotateX(Math.PI / 2);
  inletNut.translate(0, 128, 18);
  return Geometry.mergeGeometries([
    Geometry.lathe([[0, 0], [2.2, 0.6], [3.2, 2.5], [3.6, 6], [4.6, 7], [4.6, 22], [10, 22], [11, 24], [11, 50], [10, 52], [12.5, 52],
      [12.5, 140], [11, 144], [9, 146], [9, 158], [6, 160], [0, 160]], 32, 0, undefined, true),
    Geometry.lathe([[0, 160], [3, 160], [3, 168], [0, 168]], 12),
    inlet, inletNut,
  ]);
}

function highPressureLine(spec, cylinder) {
  const { x, sign } = spec.cylinders[cylinder];
  const plungerX = spec.plungerPosition(cylinder).x;
  const fitting = (along, side) => Banks.point(spec, cylinder, 0, along, side);
  const inletAlong = spec.combustionFace - 2 + 128 * Math.cos(INJECTOR_TILT) - 26 * Math.sin(INJECTOR_TILT);
  const inletSide = -2 + 128 * Math.sin(INJECTOR_TILT) + 26 * Math.cos(INJECTOR_TILT);
  const between = t => x + (plungerX - x) * t;
  return new THREE.CatmullRomCurve3([
    fitting(inletAlong, inletSide), fitting(inletAlong + 0.5, inletSide + 20), fitting(531, 118), fitting(533, 152),
    new Vector3(between(0.3), 503, -sign * 216), new Vector3(between(0.75), 494, -sign * 140),
    pointOnPlungerAxis(spec, cylinder, 140), pointOnPlungerAxis(spec, cylinder, 124),
  ], false, 'centripetal', 0.5);
}

function fuelSystem({ spec, materials, tag }) {
  const solid = materials.solid, pump = spec.injectionPump;
  const mesh = (geometry, material, part) => {
    const result = tag(new THREE.Mesh(geometry, material), part, 'fuel');
    result.castShadow = result.receiveShadow = true;
    return result;
  };
  const rotor = pumpRotor(spec, materials, mesh);
  const objects = [rotor, ...pumpHousing(spec, materials, tag)];

  const barrel = Geometry.mergeGeometries([
    Geometry.lathe([[6.2, 74], [12, 74], [12, 104], [10, 104], [10, 112], [6.2, 112], [6.2, 74]], 28, 0, undefined, true),
    Geometry.hexPrism(19, 8).translate(0, 112, 0),
    Geometry.lathe([[0, 120], [4.5, 120], [4.5, 124], [0, 124]], 16, 0, undefined, true),
  ]);
  const plungerRotations = spec.cylinders.map((cylinder, index) =>
    new THREE.Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), plungerDirection(spec, index)));
  const barrels = spec.cylinders.map((cylinder, index) => {
    const geometry = barrel.clone();
    Geometry.applyQuaternion(geometry, plungerRotations[index]);
    const base = pointOnPlungerAxis(spec, index, 0);
    return geometry.translate(base.x, base.y, base.z);
  });
  const instances = (geometry, material) => {
    const result = new THREE.InstancedMesh(geometry, material, 8);
    result.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tag(result, 'injPump', 'fuel');
    result.castShadow = result.receiveShadow = true;
    return result;
  };
  const R = pump.tappetRadius;
  const tappets = instances(Geometry.lathe([[0, 0], [R - 0.5, 0], [R, 0.5], [R, 3], [11, 4.5], [11, 20], [0, 20]], 32, 0, undefined, true), solid.pumpCam);
  const plungers = instances(Geometry.lathe([[0, 20], [5, 20], [5, 70], [0, 70]], 16, 0, undefined, true), solid.plunger);
  const springs = instances(Geometry.coilSpring(10.5, 1.6, 4.6, 32, 1, 6), materials.hardware.dark);
  objects.push(mesh(Geometry.mergeGeometries(barrels), solid.plunger, 'injPump'), tappets, plungers, springs);

  const injector = injectorGeometry();
  const injectorTips = [];
  const injectors = spec.cylinders.map((cylinder, index) => {
    const tip = Banks.point(spec, index, 0, spec.combustionFace - 2, -2);
    injectorTips.push(tip);
    const geometry = injector.clone();
    Geometry.applyQuaternion(geometry, Banks.rotation(spec, index, INJECTOR_TILT));
    return geometry.translate(tip.x, tip.y, tip.z);
  });
  objects.push(mesh(Geometry.mergeGeometries(injectors), solid.injector, 'injector'));

  const pulseMaterials = [], lineTubes = [];
  spec.cylinders.forEach((cylinder, index) => {
    const curve = highPressureLine(spec, index);
    lineTubes.push(new THREE.TubeGeometry(curve, 96, 3.2, 8, false));
    const material = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const pulse = tag(new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 4.4, 8, false), material), 'hpLines', 'fuel');
    pulse.renderOrder = 5;
    pulse.userData.pickable = false;
    pulseMaterials.push(material);
    objects.push(pulse);
  });
  objects.push(mesh(Geometry.mergeGeometries(lineTubes), solid.hpLine, 'hpLines'));

  const matrix = new THREE.Matrix4(), unitScale = new Vector3(1, 1, 1), springScale = new Vector3(1, 1, 1);
  const pulseStart = spec.injection.start - PULSE_LEAD_DEG, pulseEnd = spec.injection.end;

  function update(crankAngle) {
    rotor.rotation.x = -spec.camSpeedRatio * crankAngle;
    const crankDeg = crankAngle * 180 / Math.PI;
    spec.cylinders.forEach((cylinder, index) => {
      const lift = spec.plungerLift(index, crankAngle);
      matrix.compose(pointOnPlungerAxis(spec, index, pump.baseRadius + lift), plungerRotations[index], unitScale);
      tappets.setMatrixAt(index, matrix);
      plungers.setMatrixAt(index, matrix);
      springScale.set(1, (32 - lift) / 32, 1);
      springs.setMatrixAt(index, matrix.compose(pointOnPlungerAxis(spec, index, pump.baseRadius + 20 + lift), plungerRotations[index], springScale));
      const phase = spec.cyclePhaseDeg(index, crankDeg);
      const pulse = phase >= pulseStart && phase <= pulseEnd ? Math.sin(Math.PI * (phase - pulseStart) / (pulseEnd - pulseStart)) : 0;
      pulseMaterials[index].opacity = 0.9 * pulse;
    });
    tappets.instanceMatrix.needsUpdate = plungers.instanceMatrix.needsUpdate = springs.instanceMatrix.needsUpdate = true;
  }

  return { objects, rotor, injectorTips, update };
}

builders.fuelSystem = fuelSystem;
})();
