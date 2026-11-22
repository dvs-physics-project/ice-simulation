/*
 * Рядный двигатель: газ в цилиндрах, искра, пламя и потоки во впускных и выпускных каналах.
 *
 *   gas(context, ports, sparkTips) → { chambers, objects, points, update(crankAngle, angleStep, valveLifts) }
 *     chambers — объём над поршнем каждого цилиндра. Его нижняя грань ездит вместе с поршнем,
 *                цвет показывает температуру газа, прозрачность — давление (по логарифмической шкале).
 *                Давление и температура берутся из расчёта цикла (spec.physics.stateAt).
 *     искра    — вспышка в момент начала сгорания; пламя длится столько, сколько сгорание по закону Вибе;
 *     частицы  — бегут по средним линиям каналов со скоростью, пропорциональной подъёму клапана.
 * Цвета, текстуры свечения и материал частиц — из js/shared/gas-effects.js.
 */
(function () {
'use strict';

const Vector3 = THREE.Vector3;
const { temperatureColor, glowTexture, SPARK_GLOW, FLAME_GLOW, createParticleCloud, INTAKE_COLOR, EXHAUST_COLOR, EXHAUST_IDLE_COLOR } = window.GasEffects;

function chamberGeometry(spec, x) {
  const radius = spec.bore / 2 - 0.4, segments = 56, rings = 6;
  const roofY = z => spec.valveSeatY - (Math.abs(z) - spec.valveSeatZ) * Math.tan(spec.valveTilt);
  const positions = [], indices = [], bottomVertices = [];
  const vertex = (vx, vy, vz) => { positions.push(vx, vy, vz); return positions.length / 3 - 1; };

  const roofCenter = vertex(x, roofY(0), 0);
  const roofRings = [];
  for (let ring = 1; ring <= rings; ring++) {
    const row = [];
    for (let k = 0; k < segments; k++) {
      const angle = k / segments * Math.PI * 2, r = radius * ring / rings, z = r * Math.sin(angle);
      row.push(vertex(x + r * Math.cos(angle), roofY(z), z));
    }
    roofRings.push(row);
  }
  for (let k = 0; k < segments; k++) indices.push(roofCenter, roofRings[0][(k + 1) % segments], roofRings[0][k]);
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let k = 0; k < segments; k++) {
      const a = roofRings[ring][k], b = roofRings[ring][(k + 1) % segments];
      const c = roofRings[ring + 1][k], d = roofRings[ring + 1][(k + 1) % segments];
      indices.push(a, b, d, a, d, c);
    }
  }

  const wallTop = [], wallBottom = [];
  for (let k = 0; k < segments; k++) {
    const angle = k / segments * Math.PI * 2, z = radius * Math.sin(angle);
    wallTop.push(vertex(x + radius * Math.cos(angle), roofY(z), z));
    const bottom = vertex(x + radius * Math.cos(angle), 0, z);
    wallBottom.push(bottom);
    bottomVertices.push(bottom);
  }
  for (let k = 0; k < segments; k++) {
    const a = wallTop[k], b = wallTop[(k + 1) % segments], c = wallBottom[k], d = wallBottom[(k + 1) % segments];
    indices.push(a, c, d, a, d, b);
  }
  const bottomCenter = vertex(x, 0, 0);
  bottomVertices.push(bottomCenter);
  for (let k = 0; k < segments; k++) indices.push(bottomCenter, wallBottom[k], wallBottom[(k + 1) % segments]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, bottomVertices };
}

function gas({ spec, tag }, ports, sparkTips) {
  const physics = spec.physics;
  const chambers = spec.cylinderX.map((x, cylinder) => {
    const { geometry, bottomVertices } = chamberGeometry(spec, x);
    const material = new THREE.MeshBasicMaterial({ color: 0x4a7ad0, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 4;
    tag(mesh, 'gas:' + cylinder, 'gas');
    return { mesh, geometry, material, bottomVertices, state: null };
  });

  const sparkTexture = glowTexture(SPARK_GLOW);
  const sparks = sparkTips.map((tip, cylinder) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTexture, color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    sprite.position.copy(tip);
    sprite.scale.set(26, 26, 1);
    sprite.renderOrder = 6;
    tag(sprite, 'gas:' + cylinder, 'gas');
    sprite.userData.pickable = false;
    return sprite;
  });
  const flameTexture = glowTexture(FLAME_GLOW);
  const flames = sparkTips.map((tip, cylinder) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTexture, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.position.copy(tip).add(new Vector3(0, -6, 0));
    sprite.renderOrder = 6;
    tag(sprite, 'gas:' + cylinder, 'gas');
    sprite.userData.pickable = false;
    return sprite;
  });
  const flashLight = new THREE.PointLight(0xffb066, 0, 300, 2);

  const particlesPerBranch = { intake: 16, exhaust: 14 };
  const particles = [];
  for (const side of ['intake', 'exhaust']) {
    spec.cylinderX.forEach((x, cylinder) => {
      for (let branch = 0; branch < 2; branch++) {
        const count = particlesPerBranch[side];
        for (let k = 0; k < count; k++) {
          particles.push({
            side, cylinder, curve: ports[side][cylinder][branch],
            progress: (k + Math.random() * 0.6) / count,
            jitter: new Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
          });
        }
      }
    });
  }
  const cloud = createParticleCloud(particles.length, 7.0);
  const { points, positions, colors, alphas } = cloud;
  tag(points, 'flow', 'gas');

  function updateChambers(crankAngle, crankDeg) {
    const pressureRange = physics.pressureRange;
    chambers.forEach((chamber, cylinder) => {
      const piston = spec.pistonPosition(cylinder, crankAngle);
      const state = physics.stateAt(spec.cyclePhaseDeg(cylinder, crankDeg));
      const vertices = chamber.geometry.attributes.position;
      chamber.bottomVertices.forEach(index => vertices.setY(index, piston.crownY + 0.25));
      vertices.needsUpdate = true;
      chamber.geometry.computeBoundingSphere();
      const color = temperatureColor(state.T);
      chamber.material.color.setRGB(color[0], color[1], color[2]).convertSRGBToLinear();
      const pressureLevel = (Math.log10(state.P) - pressureRange.low) / (pressureRange.high - pressureRange.low);
      chamber.material.opacity = 0.16 + 0.5 * Math.max(0, Math.min(1, pressureLevel));
      chamber.state = state;
    });
  }

  function updateCombustion(crankDeg) {
    let brightest = 0, brightestAt = null;
    spec.cylinderX.forEach((x, cylinder) => {
      const sinceIgnition = spec.cyclePhaseDeg(cylinder, crankDeg) - physics.sparkDeg;
      const spark = sinceIgnition >= 0 && sinceIgnition < 14 ? Math.pow(1 - sinceIgnition / 14, 1.2) : 0;
      sparks[cylinder].material.opacity = spark;
      sparks[cylinder].scale.setScalar(22 + 46 * spark);
      const burn = physics.burnDeg;
      const flame = sinceIgnition >= 0 && sinceIgnition < burn
        ? Math.sin(Math.PI * Math.min(1, sinceIgnition / burn)) * (1 - sinceIgnition / (burn * 1.3)) : 0;
      flames[cylinder].material.opacity = Math.max(0, flame) * 0.95;
      flames[cylinder].scale.setScalar(20 + 70 * Math.min(1, Math.max(0, sinceIgnition) / 30));
      const glow = Math.max(spark, flame * 0.8);
      if (glow > brightest) { brightest = glow; brightestAt = sparks[cylinder].position; }
    });
    flashLight.intensity = brightest * 3.0;
    if (brightestAt) flashLight.position.copy(brightestAt);
  }

  const point = new Vector3();
  function updateFlow(angleStep, valveLifts) {
    particles.forEach((particle, j) => {
      const intake = particle.side === 'intake';
      const lift = valveLifts[(intake ? 0 : 8) + particle.cylinder * 2];
      const speed = 0.95 * (lift / spec.camLift);
      particle.progress += intake ? speed * angleStep : speed * angleStep * 1.25;
      particle.progress -= Math.floor(particle.progress);
      const t = particle.progress;
      particle.curve.getPointAt(intake ? t : 1 - t, point);
      const fade = intake
        ? Math.min(1, (1 - t) * 6) * Math.min(1, t * 8)
        : Math.min(1, t * 8) * Math.min(1, (1 - t) * 5);
      const opening = Math.min(1, lift / 2.5);
      positions[j * 3] = point.x + particle.jitter.x * 0.6;
      positions[j * 3 + 1] = point.y + particle.jitter.y * 0.6;
      positions[j * 3 + 2] = point.z + particle.jitter.z * 0.6;
      const color = intake ? INTAKE_COLOR : (opening > 0.05 ? EXHAUST_COLOR : EXHAUST_IDLE_COLOR);
      colors[j * 3] = color[0];
      colors[j * 3 + 1] = color[1];
      colors[j * 3 + 2] = color[2];
      alphas[j] = fade * (0.18 + 0.82 * opening);
    });
    cloud.markChanged();
  }

  return {
    chambers, points,
    objects: [...chambers.map(chamber => chamber.mesh), ...sparks, ...flames, flashLight, points],
    update(crankAngle, angleStep, valveLifts) {
      const crankDeg = crankAngle * 180 / Math.PI;
      updateChambers(crankAngle, crankDeg);
      updateCombustion(crankDeg);
      updateFlow(angleStep, valveLifts);
    },
  };
}

window.EngineBuilders.i4.gas = gas;
})();
