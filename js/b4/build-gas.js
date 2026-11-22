/*
 * Оппозитный двигатель: газ в цилиндрах, искра, пламя и потоки в каналах, патрубках и выпуске.
 *
 *   gas(context, ports, flows, sparkTips) → { chambers, objects, points, update(crankAngle, angleStep, valveLifts) }
 *     chambers — объём над поршнем (крыша по форме камеры сгорания), строится вдоль оси Y и поворачивается
 *                на ось цилиндра. Нижняя грань ездит с поршнем; цвет — температура, прозрачность — давление
 *                (из spec.physics.stateAt);
 *     частицы  — бегут по каналам головки (ports), впускным патрубкам и выпускным трубам (flows) со скоростью,
 *                пропорциональной подъёму клапана, и через дроссель — со скоростью, растущей с наполнением.
 */
(function () {
'use strict';

const Vector3 = THREE.Vector3;
const builders = window.EngineBuilders.b4;
const Banks = window.CylinderBanks;
const { temperatureColor, glowTexture, SPARK_GLOW, FLAME_GLOW, createParticleCloud, INTAKE_COLOR, EXHAUST_COLOR, EXHAUST_IDLE_COLOR } = window.GasEffects;
const SPARK_DURATION_DEG = 14;

function chamberGeometry(spec) {
  const radius = spec.bore / 2 - 0.4, segments = 56, rings = 6;
  const intakeSlope = Math.tan(spec.valves.intake.tilt), exhaustSlope = Math.tan(spec.valves.exhaust.tilt);
  const roofHeight = side => Math.max(spec.combustionFace, spec.roofRidgeDistance - (side >= 0 ? side * intakeSlope : -side * exhaustSlope));
  const floorHeight = spec.combustionFace - 20;
  const positions = [], indices = [], floorVertices = [];
  const vertex = (x, y, z) => { positions.push(x, y, z); return positions.length / 3 - 1; };

  const roofCenter = vertex(0, roofHeight(0), 0);
  const roofRings = [];
  for (let ring = 1; ring <= rings; ring++) {
    const row = [];
    for (let k = 0; k < segments; k++) {
      const angle = k / segments * Math.PI * 2, r = radius * ring / rings, side = r * Math.sin(angle);
      row.push(vertex(r * Math.cos(angle), roofHeight(side), side));
    }
    roofRings.push(row);
  }
  for (let k = 0; k < segments; k++) indices.push(roofCenter, roofRings[0][k], roofRings[0][(k + 1) % segments]);
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let k = 0; k < segments; k++) {
      const a = roofRings[ring][k], b = roofRings[ring][(k + 1) % segments];
      const c = roofRings[ring + 1][k], d = roofRings[ring + 1][(k + 1) % segments];
      indices.push(a, c, d, a, d, b);
    }
  }
  const wallTop = roofRings[rings - 1], wallBottom = [];
  for (let k = 0; k < segments; k++) {
    const angle = k / segments * Math.PI * 2;
    const bottom = vertex(radius * Math.cos(angle), floorHeight, radius * Math.sin(angle));
    wallBottom.push(bottom);
    floorVertices.push(bottom);
  }
  for (let k = 0; k < segments; k++) {
    const a = wallTop[k], b = wallTop[(k + 1) % segments], c = wallBottom[k], d = wallBottom[(k + 1) % segments];
    indices.push(a, d, c, a, b, d);
  }
  const floorCenter = vertex(0, floorHeight, 0);
  floorVertices.push(floorCenter);
  for (let k = 0; k < segments; k++) indices.push(floorCenter, wallBottom[(k + 1) % segments], wallBottom[k]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, floorVertices };
}

function glowSprite(texture, position, cylinder, tag) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0,
    depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  sprite.position.copy(position);
  sprite.renderOrder = 6;
  sprite.userData.pickable = false;
  return tag(sprite, 'gas:' + cylinder, 'gas');
}

function flowParticles(spec, ports, flows) {
  const particles = [];
  const add = (kind, cylinder, valve, curve, count, spread, gap) => {
    for (let k = 0; k < count; k++) {
      const jitter = () => (Math.random() - 0.5) * spread;
      particles.push({ kind, cylinder, valve, curve, progress: (k + Math.random() * gap) / count,
        jitter: kind === 'throttle' ? new Vector3(jitter(), jitter(), (Math.random() - 0.5) * 46) : new Vector3(jitter(), jitter(), jitter()) });
    }
  };
  spec.cylinders.forEach((cylinder, index) => {
    for (const valve of [0, 1]) {
      add('port-intake', index, valve, ports.intake[index][valve], 9, 7, 0.6);
      add('port-exhaust', index, valve, ports.exhaust[index][valve], 8, 6, 0.6);
    }
  });
  spec.cylinders.forEach((cylinder, index) => {
    add('runner', index, 0, flows.intake[index], 22, 16, 0.7);
    add('pipe', index, 0, flows.exhaust[index], 36, 16, 0.7);
  });
  add('throttle', null, 0, flows.throttle, 40, 30, 0.7);
  const lengths = new Map();
  particles.forEach(particle => {
    if (!lengths.has(particle.curve)) lengths.set(particle.curve, particle.curve.getLength());
    particle.curveLength = lengths.get(particle.curve);
  });
  return particles;
}

function gas({ spec, tag }, ports, flows, sparkTips) {
  const physics = spec.physics;
  const chambers = spec.cylinders.map((cylinder, index) => {
    const { geometry, floorVertices } = chamberGeometry(spec);
    const material = new THREE.MeshBasicMaterial({ color: 0x4a7ad0, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    mesh.position.set(cylinder.x, 0, 0);
    mesh.quaternion.copy(Banks.rotation(spec, index));
    tag(mesh, 'gas:' + index, 'gas');
    return { mesh, geometry, material, floorVertices, state: null };
  });

  const sparkTexture = glowTexture(SPARK_GLOW), flameTexture = glowTexture(FLAME_GLOW);
  const sparks = sparkTips.map((tip, cylinder) => glowSprite(sparkTexture, tip, cylinder, tag));
  const flames = sparkTips.map((tip, cylinder) => {
    const axis = spec.cylinderAxis(cylinder);
    return glowSprite(flameTexture, tip.clone().add(new Vector3(0, -axis.y * 7, -axis.z * 7)), cylinder, tag);
  });
  const flashLight = new THREE.PointLight(0xffb066, 0, 340, 2);

  const particles = flowParticles(spec, ports, flows);
  const cloud = createParticleCloud(particles.length, 8.0);
  const { points, positions, colors, alphas } = cloud;
  tag(points, 'flow', 'gas');

  function updateChambers(crankAngle, crankDeg) {
    const pressureRange = physics.pressureRange;
    chambers.forEach((chamber, cylinder) => {
      const piston = spec.pistonPosition(cylinder, crankAngle);
      const state = physics.stateAt(spec.cyclePhaseDeg(cylinder, crankDeg));
      const vertices = chamber.geometry.attributes.position;
      chamber.floorVertices.forEach(index => vertices.setY(index, piston.crownDistance + 0.25));
      vertices.needsUpdate = true;
      chamber.geometry.computeBoundingSphere();
      const color = temperatureColor(state.T);
      chamber.material.color.setRGB(color[0], color[1], color[2]).convertSRGBToLinear();
      const pressureLevel = (Math.log10(state.P) - pressureRange.low) / (pressureRange.high - pressureRange.low);
      chamber.material.opacity = 0.16 + 0.5 * Math.max(0, Math.min(1, pressureLevel));
      chamber.state = state;
    });
  }

  function updateCombustion() {
    let brightest = 0, brightestCylinder = -1;
    const burn = physics.burnDeg;
    chambers.forEach((chamber, cylinder) => {
      const sinceIgnition = chamber.state.phase - physics.sparkDeg;
      const spark = sinceIgnition >= 0 && sinceIgnition < SPARK_DURATION_DEG ? Math.pow(1 - sinceIgnition / SPARK_DURATION_DEG, 1.2) : 0;
      sparks[cylinder].material.opacity = spark;
      sparks[cylinder].scale.setScalar(20 + 40 * spark);
      const flame = sinceIgnition >= 0 && sinceIgnition < burn
        ? Math.sin(Math.PI * Math.min(1, sinceIgnition / burn)) * (1 - sinceIgnition / (burn * 1.3)) : 0;
      flames[cylinder].material.opacity = Math.max(0, flame) * 0.95;
      flames[cylinder].scale.setScalar(18 + 64 * Math.min(1, Math.max(0, sinceIgnition) / 30));
      const glow = Math.max(spark, flame * 0.8);
      if (glow > brightest) { brightest = glow; brightestCylinder = cylinder; }
    });
    flashLight.intensity = brightest * 3.0;
    if (brightestCylinder >= 0) flashLight.position.copy(flames[brightestCylinder].position);
  }

  const point = new Vector3();
  function updateFlow(angleStep, valveLifts) {
    const intakeMax = spec.maxValveLift.intake, exhaustMax = spec.maxValveLift.exhaust;
    let filling = 0;
    for (let cylinder = 0; cylinder < 4; cylinder++) filling += valveLifts[cylinder * 2] / intakeMax / 4;
    particles.forEach((particle, j) => {
      let speed, opening, color;
      if (particle.kind === 'port-intake' || particle.kind === 'runner') {
        const lift = valveLifts[particle.cylinder * 2 + particle.valve] / intakeMax;
        speed = (particle.kind === 'port-intake' ? 140 : 230) * lift;
        opening = Math.min(1, lift * 5);
        color = INTAKE_COLOR;
      } else if (particle.kind === 'port-exhaust' || particle.kind === 'pipe') {
        const lift = valveLifts[8 + particle.cylinder * 2 + particle.valve] / exhaustMax;
        speed = (particle.kind === 'port-exhaust' ? 180 : 320) * lift;
        opening = Math.min(1, lift * 5);
        color = opening > 0.05 ? EXHAUST_COLOR : EXHAUST_IDLE_COLOR;
      } else {
        speed = 120 + 420 * filling;
        opening = 0.35 + 0.65 * Math.min(1, filling * 4);
        color = INTAKE_COLOR;
      }
      particle.progress += speed * angleStep / particle.curveLength * 3;
      particle.progress -= Math.floor(particle.progress);
      const t = particle.progress;
      particle.curve.getPointAt(t, point);
      positions[j * 3] = point.x + particle.jitter.x * 0.6;
      positions[j * 3 + 1] = point.y + particle.jitter.y * 0.6;
      positions[j * 3 + 2] = point.z + particle.jitter.z * 0.6;
      colors[j * 3] = color[0];
      colors[j * 3 + 1] = color[1];
      colors[j * 3 + 2] = color[2];
      alphas[j] = Math.min(1, t * 9) * Math.min(1, (1 - t) * 7) * (0.15 + 0.85 * opening);
    });
    cloud.markChanged();
  }

  return {
    chambers, points,
    objects: [...chambers.map(chamber => chamber.mesh), ...sparks, ...flames, flashLight, points],
    update(crankAngle, angleStep, valveLifts) {
      const crankDeg = crankAngle * 180 / Math.PI;
      updateChambers(crankAngle, crankDeg);
      updateCombustion();
      updateFlow(angleStep, valveLifts);
    },
  };
}

builders.gas = gas;
})();
