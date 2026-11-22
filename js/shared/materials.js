/*
 * Общая часть материалов всех двигателей.
 *
 * createMaterialLibrary(config) собирает для двигателя:
 *   solid[key]          — металлические и прочие материалы деталей; у каждого типа детали свой материал,
 *                         поэтому любую деталь можно подсветить отдельно;
 *   hardware            — общие материалы крепежа (алюминий, сталь, тёмный металл);
 *   ghost[key], ghostEdges[key] — полупрозрачные «чертёжные» материалы корпусов и их контурные линии;
 *   parts               — спецификация: позиция, название, количество, слой, описание, материалы детали;
 *   setDarkTheme(dark)  — цвет корпусов под светлую или тёмную тему страницы;
 *   highlight(partId) / clearHighlight() / pulseHighlight(seconds) — подсветка выбранной детали.
 *
 * config: { colors: { key: [hex, metalness, roughness] }, doubleSided: [key...],
 *           ghosts: [key...], ghostOpacity, ghostOpacityOverrides: { key: opacity },
 *           edgeOpacity: { light, dark }, highlightOpacityFactor, parts }
 */
(function () {
'use strict';

const srgb = hex => new THREE.Color(hex).convertSRGBToLinear();
const HIGHLIGHT_COLOR = '#ff7a1a';
const GHOST_FILL = { light: '#4a66cc', dark: '#5b7fe0' };
const GHOST_EDGE = { light: '#2235b0', dark: '#9fbcff' };

function createMaterialLibrary(config) {
  const doubleSided = new Set(config.doubleSided);

  const solid = {};
  Object.entries(config.colors).forEach(([key, [hex, metalness, roughness]]) => {
    solid[key] = new THREE.MeshStandardMaterial({
      color: srgb(hex), metalness, roughness,
      side: doubleSided.has(key) ? THREE.DoubleSide : THREE.FrontSide,
      envMapIntensity: 1.0,
    });
  });

  const hardware = {
    aluminium: new THREE.MeshStandardMaterial({ color: srgb('#b9bec4'), metalness: 0.75, roughness: 0.45 }),
    steel: new THREE.MeshStandardMaterial({ color: srgb('#8c9299'), metalness: 1.0, roughness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: srgb('#2c3036'), metalness: 0.6, roughness: 0.5 }),
  };

  const ghost = {}, ghostEdges = {};
  config.ghosts.forEach(key => {
    const opacity = (config.ghostOpacityOverrides || {})[key] || config.ghostOpacity;
    ghost[key] = new THREE.MeshStandardMaterial({
      color: srgb('#5d78d9'), metalness: 0.1, roughness: 0.6,
      transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.6,
    });
    ghost[key].userData.baseOpacity = opacity;
    ghostEdges[key] = new THREE.LineBasicMaterial({
      color: srgb('#2638b8'), transparent: true, opacity: config.edgeOpacity.light, depthWrite: false,
    });
    ghostEdges[key].userData.baseOpacity = config.edgeOpacity.light;
  });

  function setDarkTheme(dark) {
    const fill = srgb(dark ? GHOST_FILL.dark : GHOST_FILL.light);
    const edge = srgb(dark ? GHOST_EDGE.dark : GHOST_EDGE.light);
    const edgeOpacity = dark ? config.edgeOpacity.dark : config.edgeOpacity.light;
    config.ghosts.forEach(key => {
      ghost[key].color.copy(fill);
      ghostEdges[key].color.copy(edge);
      ghostEdges[key].userData.baseOpacity = edgeOpacity;
      ghostEdges[key].opacity = edgeOpacity;
    });
  }

  const parts = config.parts;
  let highlighted = null;

  function highlight(partId) {
    clearHighlight();
    const part = parts[partId];
    if (!part) return;
    const color = srgb(HIGHLIGHT_COLOR);
    highlighted = { partId, solids: [], ghosts: [] };
    (part.materials || []).forEach(key => {
      solid[key].emissive.copy(color);
      solid[key].emissiveIntensity = 0.45;
      highlighted.solids.push(solid[key]);
    });
    (part.ghost || []).forEach(key => {
      ghost[key].emissive.copy(color);
      ghost[key].emissiveIntensity = 0.6;
      ghost[key].opacity = Math.min(0.5, ghost[key].userData.baseOpacity * config.highlightOpacityFactor);
      ghostEdges[key].opacity = 0.95;
      highlighted.ghosts.push(ghost[key]);
    });
  }

  function clearHighlight() {
    if (!highlighted) return;
    highlighted.solids.forEach(material => {
      material.emissive.setRGB(0, 0, 0);
      material.emissiveIntensity = 1;
    });
    highlighted.ghosts.forEach(material => {
      material.emissive.setRGB(0, 0, 0);
      material.opacity = material.userData.baseOpacity * (material.userData.sectionBoost || 1);
    });
    (parts[highlighted.partId].ghost || []).forEach(key => {
      ghostEdges[key].opacity = ghostEdges[key].userData.baseOpacity;
    });
    highlighted = null;
  }

  function pulseHighlight(seconds) {
    if (!highlighted) return;
    const intensity = 0.32 + 0.18 * Math.sin(seconds * 4);
    highlighted.solids.forEach(material => { material.emissiveIntensity = intensity; });
  }

  return { srgb, solid, hardware, ghost, ghostEdges, parts, setDarkTheme, highlight, clearHighlight, pulseHighlight };
}

window.createMaterialLibrary = createMaterialLibrary;
})();
