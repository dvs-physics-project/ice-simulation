/*
 * V-образный дизель: газ в цилиндрах, струи топлива, пламя и потоки в каналах, коллекторах и турбинах.
 *
 *   gas(context, ports, flows, injectorTips) → { chambers, objects, points, update(crankAngle, angleStep, valveLifts) }
 *     chambers — газ над поршнем: плоский «столбик» от днища до головки плюс чаша камеры сгорания в поршне.
 *                Цвет — температура, прозрачность — давление (spec.physics.stateAt);
 *     струи    — четыре конуса из распылителя форсунки, видны во время впрыска (spec.injection);
 *     пламя    — начинается после задержки воспламенения (physics.sparkDeg) и длится physics.burnDeg;
 *     частицы  — в каналах головки (скорость по подъёму клапана) и в коллекторах/турбинах
 *                (скорость по среднему подъёму клапанов ряда).
 */
(function () {
'use strict';

const Geometry = window.Geometry;
const Vector3 = THREE.Vector3;
const Banks = window.CylinderBanks;
const builders = window.EngineBuilders.v8;
const DEG = window.EngineMath.DEG;
const { temperatureColor, glowTexture, FLAME_GLOW, createParticleCloud, INTAKE_COLOR, EXHAUST_COLOR, EXHAUST_IDLE_COLOR } = window.GasEffects;
const SPRAY_HOLES = 4, SPRAY_CONE_HALF_ANGLE = 72 * DEG, SPRAY_LENGTH = 40, SPRAY_FADE_DEG = 6;

function sprayDirections(axis) {
  const across = new Vector3(1, 0, 0), third = new Vector3().crossVectors(axis, across).normalize();
  return Array.from({ length: SPRAY_HOLES }, (_, k) => {
    const around = (45 + 90 * k) * DEG;
    return new Vector3()
      .addScaledVector(axis, -Math.cos(SPRAY_CONE_HALF_ANGLE))
      .addScaledVector(across, Math.sin(SPRAY_CONE_HALF_ANGLE) * Math.cos(around))
      .addScaledVector(third, Math.sin(SPRAY_CONE_HALF_ANGLE) * Math.sin(around))
      .normalize();
  });
}

function chamber(spec, tag, index, injectorTip, flameTexture, gasColumn, bowl, sprayCone) {
  const cylinder = spec.cylinders[index];
  const frame = new THREE.Group();
  frame.position.set(cylinder.x, 0, 0);
  frame.quaternion.copy(Banks.rotation(spec, index));
  const material = new THREE.MeshBasicMaterial({ color: 0x4a7ad0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const column = tag(new THREE.Mesh(gasColumn, material), 'gas:' + index, 'gas');
  const bowlMesh = tag(new THREE.Mesh(bowl, material), 'gas:' + index, 'gas');
  column.renderOrder = bowlMesh.renderOrder = 4;
  const flame = tag(new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTexture, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending })), 'gas:' + index, 'gas');
  flame.renderOrder = 6;
  flame.userData.pickable = false;
  frame.add(column, bowlMesh, flame);

  const injectorAxis = new Vector3(0, 1, 0).applyQuaternion(Banks.rotation(spec, index, 15 * DEG));
  const sprayMaterial = new THREE.MeshBasicMaterial({ color: 0xffe7a0, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const sprays = sprayDirections(injectorAxis).map(direction => {
    const spray = tag(new THREE.Mesh(sprayCone, sprayMaterial), 'gas:' + index, 'gas');
    spray.position.copy(injectorTip);
    spray.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);
    spray.scale.set(0.01, 0.01, 0.01);
    spray.renderOrder = 6;
    spray.userData.pickable = false;
    return spray;
  });
  return { frame, column, bowl: bowlMesh, material, flame, sprays, sprayMaterial, state: null };
}

function flowParticles(spec, ports, flows) {
  const particles = [];
  const add = (kind, owner, curve, count, spread, gap) => {
    for (let k = 0; k < count; k++) {
      const jitter = () => (Math.random() - 0.5) * spread;
      particles.push({ kind, owner, curve, progress: (k + Math.random() * gap) / count, jitter: new Vector3(jitter(), jitter(), jitter()) });
    }
  };
  spec.cylinders.forEach((cylinder, index) => {
    add('port-intake', index, ports.intake[index], 14, 14, 0.6);
    add('port-exhaust', index, ports.exhaust[index], 12, 12, 0.6);
  });
  for (const bank of [0, 1]) {
    add('manifold-intake', bank, flows.intake[bank], 70, 30, 0.7);
    add('manifold-exhaust', bank, flows.exhaust[bank], 70, 26, 0.7);
  }
  const lengths = new Map();
  particles.forEach(particle => {
    if (!lengths.has(particle.curve)) lengths.set(particle.curve, particle.curve.getLength());
    particle.curveLength = lengths.get(particle.curve);
  });
  return particles;
}

function gas({ spec, tag }, ports, flows, injectorTips) {
  const physics = spec.physics;
  const gasColumn = new THREE.CylinderGeometry(spec.pistonRadius - 0.3, spec.pistonRadius - 0.3, 1, 56, 1, false).translate(0, 0.5, 0);
  const bowl = Geometry.lathe([[0, -9.4], [4, -10.9], [10, -15.4], [17, -20.9], [24, -22.4], [30, -20.4], [34.2, -15], [36.5, -7.6], [38.4, -2.2],
    [40.8, 0.25], [0, 0.25]], 40);
  const sprayCone = new THREE.ConeGeometry(1, 1, 12, 1, true);
  sprayCone.rotateX(Math.PI);
  sprayCone.translate(0, 0.5, 0);
  const flameTexture = glowTexture(FLAME_GLOW);
  const chambers = spec.cylinders.map((cylinder, index) =>
    chamber(spec, tag, index, injectorTips[index], flameTexture, gasColumn, bowl, sprayCone));
  const flashLight = new THREE.PointLight(0xffb066, 0, 420, 2);

  const particles = flowParticles(spec, ports, flows);
  const cloud = createParticleCloud(particles.length, 13.0);
  const { points, positions, colors, alphas } = cloud;
  tag(points, 'flow', 'gas');

  function updateChambers(crankAngle, crankDeg) {
    const pressureRange = physics.pressureRange;
    let brightest = 0, brightestChamber = null;
    chambers.forEach((item, index) => {
      const piston = spec.pistonPosition(index, crankAngle);
      const state = physics.stateAt(spec.cyclePhaseDeg(index, crankDeg));
      item.column.position.y = piston.crownDistance + 0.3;
      item.column.scale.y = Math.max(0.05, spec.combustionFace - piston.crownDistance - 0.3);
      item.bowl.position.y = piston.crownDistance;
      const color = temperatureColor(state.T);
      item.material.color.setRGB(color[0], color[1], color[2]).convertSRGBToLinear();
      const pressureLevel = (Math.log10(state.P) - pressureRange.low) / (pressureRange.high - pressureRange.low);
      item.material.opacity = 0.16 + 0.5 * Math.max(0, Math.min(1, pressureLevel));
      item.state = state;

      const { start, end } = spec.injection;
      let sprayLength = 0, sprayOpacity = 0;
      if (state.phase >= start && state.phase <= end + SPRAY_FADE_DEG) {
        sprayLength = SPRAY_LENGTH * Math.min(1, (state.phase - start) / 8);
        sprayOpacity = state.phase <= end ? 0.75 : 0.75 * (1 - (state.phase - end) / SPRAY_FADE_DEG);
      }
      item.sprayMaterial.opacity = sprayOpacity;
      item.sprays.forEach(spray => {
        spray.scale.set(sprayLength * 0.11 + 0.01, sprayLength + 0.01, sprayLength * 0.11 + 0.01);
        spray.visible = sprayOpacity > 0.01;
      });

      const sinceIgnition = state.phase - physics.sparkDeg, burn = physics.burnDeg;
      const flame = sinceIgnition >= 0 && sinceIgnition < burn
        ? Math.sin(Math.PI * Math.min(1, sinceIgnition / burn)) * (1 - sinceIgnition / (burn * 1.25)) : 0;
      item.flame.material.opacity = Math.max(0, flame);
      item.flame.scale.setScalar(30 + 90 * Math.min(1, Math.max(0, sinceIgnition) / 26));
      item.flame.position.set(0, piston.crownDistance - 6, 0);
      if (flame > brightest) { brightest = flame; brightestChamber = item; }
    });
    flashLight.intensity = brightest * 3.2;
    if (brightestChamber) brightestChamber.flame.getWorldPosition(flashLight.position);
  }

  const point = new Vector3();
  function updateFlow(angleStep, valveLifts) {
    const maxLift = spec.maxValveLift;
    const bankIntake = [0, 0], bankExhaust = [0, 0];
    for (let cylinder = 0; cylinder < 8; cylinder++) {
      const bank = cylinder < 4 ? 0 : 1;
      bankIntake[bank] += valveLifts[cylinder] / maxLift / 4;
      bankExhaust[bank] += valveLifts[8 + cylinder] / maxLift / 4;
    }
    particles.forEach((particle, j) => {
      let speed, opening, color, fade;
      if (particle.kind === 'port-intake' || particle.kind === 'port-exhaust') {
        const intake = particle.kind === 'port-intake';
        const lift = valveLifts[(intake ? 0 : 8) + particle.owner] / maxLift;
        speed = (intake ? 160 : 210) * lift;
        opening = Math.min(1, lift * 5);
        color = intake ? INTAKE_COLOR : (opening > 0.05 ? EXHAUST_COLOR : EXHAUST_IDLE_COLOR);
      } else {
        const intake = particle.kind === 'manifold-intake';
        const flow = intake ? bankIntake[particle.owner] : bankExhaust[particle.owner];
        speed = 90 + 260 * flow;
        opening = 0.35 + 0.65 * Math.min(1, flow * 4);
        color = intake ? INTAKE_COLOR : EXHAUST_COLOR;
      }
      particle.progress += speed * angleStep / particle.curveLength * 3;
      particle.progress -= Math.floor(particle.progress);
      const t = particle.progress;
      fade = particle.kind.startsWith('port')
        ? Math.min(1, t * 8) * Math.min(1, (1 - t) * 6)
        : Math.min(1, t * 14) * Math.min(1, (1 - t) * 10);
      particle.curve.getPointAt(t, point);
      positions[j * 3] = point.x + particle.jitter.x * 0.6;
      positions[j * 3 + 1] = point.y + particle.jitter.y * 0.6;
      positions[j * 3 + 2] = point.z + particle.jitter.z * 0.6;
      colors[j * 3] = color[0];
      colors[j * 3 + 1] = color[1];
      colors[j * 3 + 2] = color[2];
      alphas[j] = fade * (0.15 + 0.85 * opening);
    });
    cloud.markChanged();
  }

  return {
    chambers, points,
    objects: [...chambers.flatMap(item => [item.frame, ...item.sprays]), flashLight, points],
    update(crankAngle, angleStep, valveLifts) {
      updateChambers(crankAngle, crankAngle * 180 / Math.PI);
      updateFlow(angleStep, valveLifts);
    },
  };
}

builders.gas = gas;
})();
