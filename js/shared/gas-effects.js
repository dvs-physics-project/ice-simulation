/*
 * Общие эффекты газа для всех трёх моделей.
 *
 *   temperatureColor(T)            — цвет газа по температуре (К): холодный синий → голубой → жёлтый → оранжевый → белый
 *   glowTexture(stops)             — круглая текстура свечения для спрайтов искры и пламени
 *   SPARK_GLOW, FLAME_GLOW         — градиенты искры (бело-голубой) и пламени (жёлто-оранжевый)
 *   flowParticleMaterial(size)     — материал частиц потока: размер точки уменьшается с расстоянием,
 *                                    у каждой частицы свои цвет и прозрачность (атрибуты color и alpha)
 *   createParticleCloud(count)     — облако из count частиц: { points, positions, colors, alphas, markChanged() }
 *   INTAKE_COLOR, EXHAUST_COLOR, EXHAUST_IDLE_COLOR — цвета свежего заряда, горячих и остывших газов
 */
(function () {
'use strict';

const TEMPERATURE_COLORS = [[300, [60, 110, 210]], [700, [70, 200, 255]], [1200, [255, 220, 90]],
  [1800, [255, 130, 40]], [2600, [255, 246, 232]]];

function temperatureColor(temperature) {
  const first = TEMPERATURE_COLORS[0], last = TEMPERATURE_COLORS[TEMPERATURE_COLORS.length - 1];
  const T = Math.max(first[0], Math.min(last[0], temperature));
  for (let k = 0; k < TEMPERATURE_COLORS.length - 1; k++) {
    const [t0, c0] = TEMPERATURE_COLORS[k], [t1, c1] = TEMPERATURE_COLORS[k + 1];
    if (T <= t1) {
      const f = (T - t0) / (t1 - t0);
      return c0.map((channel, i) => (channel + (c1[i] - channel) * f) / 255);
    }
  }
  return last[1].map(channel => channel / 255);
}

function glowTexture(stops) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const SPARK_GLOW = [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(190,220,255,0.9)'], [0.6, 'rgba(120,160,255,0.25)'], [1, 'rgba(120,160,255,0)']];
const FLAME_GLOW = [[0, 'rgba(255,250,220,1)'], [0.3, 'rgba(255,190,90,0.85)'], [0.7, 'rgba(255,110,40,0.3)'], [1, 'rgba(255,90,30,0)']];

function flowParticleMaterial(size) {
  return new THREE.ShaderMaterial({
    uniforms: { size: { value: size }, scale: { value: 400 } },
    vertexShader: `attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float size; uniform float scale;
      void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard;
        gl_FragColor = vec4(vC, vA * (1.0 - r * 3.2)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function createParticleCloud(count, size) {
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), alphas = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  const points = new THREE.Points(geometry, flowParticleMaterial(size));
  points.renderOrder = 5;
  points.frustumCulled = false;
  points.userData.pickable = false;
  return {
    points, positions, colors, alphas,
    markChanged() {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.attributes.alpha.needsUpdate = true;
    },
  };
}

window.GasEffects = {
  temperatureColor, glowTexture, SPARK_GLOW, FLAME_GLOW, flowParticleMaterial, createParticleCloud,
  INTAKE_COLOR: [0.45, 0.78, 1.0], EXHAUST_COLOR: [1.0, 0.55, 0.2], EXHAUST_IDLE_COLOR: [0.55, 0.5, 0.5],
};
})();
