/*
 * Общая 3D-сцена двигателя: рендерер, свет, камера, слои, разрезы, выбор деталей, анимация.
 * Каждый двигатель передаёт сюда свои размеры, материалы и функцию build, которая строит детали.
 *
 * createEngineScene(viewport, config) возвращает объект сцены:
 *   update(crankAngle, angleStep)   — поставить все детали в положение для угла коленчатого вала
 *   render(nowMs)                   — нарисовать кадр, если что-то изменилось (возвращает true, если рисовал)
 *   setHousing(mode)                — корпус: 'ghost' прозрачный, 'long'/'trans' разрезы, 'off' скрыт
 *   setLayer(layer, visible), setCoverVisible(visible) — слои модели и кожух ремня
 *   select(partId), isolate(on), focus(partId) — выделить деталь, показать только её, приблизить камеру
 *   view(name, instant)             — перелёт камеры к готовому виду
 *   pick(ndcX, ndcY)                — какая деталь под курсором
 *   setDarkTheme(dark), resize(), invalidate()
 *   chambers, valveLifts(cylinder)  — состояние газа и подъём клапанов для показаний на панели
 *
 * config: { spec, materials, ariaLabel, lighting, camera, layers, views, focusMinDistance,
 *           longSectionNormal(cameraPosition), hideNearSideInTransverseSection, coverPart,
 *           build(context) → { addTo(scene), update(angle, step), clipMaterials, chambers, valveLifts, onResize } }
 */
(function () {
'use strict';

const Vector3 = THREE.Vector3;
const SECTION_GHOST_BOOST = 2.4;

function createRenderer(viewport, ariaLabel) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, smallScreen ? 1.5 : 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);
  viewport.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', ariaLabel);
  return { renderer, smallScreen };
}

function addLights(scene, renderer, lighting, smallScreen) {
  const environment = new THREE.PMREMGenerator(renderer);
  scene.environment = environment.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 0.35));

  const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.35);
  keyLight.position.set(...lighting.keyPosition);
  keyLight.castShadow = true;
  const shadowSize = smallScreen ? 1024 : 2048;
  keyLight.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(keyLight.shadow.camera, lighting.shadowBox);
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = lighting.normalBias;
  keyLight.target.position.set(...lighting.keyTarget);
  scene.add(keyLight, keyLight.target);

  const fillLight = new THREE.DirectionalLight(0xcfe0ff, 0.45);
  fillLight.position.set(...lighting.fillPosition);
  scene.add(fillLight);
}

function worldBox(object) {
  const box = new THREE.Box3();
  if (object.isInstancedMesh) {
    const matrix = new THREE.Matrix4(), instanceBox = new THREE.Box3();
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    for (let k = 0; k < object.count; k++) {
      object.getMatrixAt(k, matrix);
      instanceBox.copy(object.geometry.boundingBox).applyMatrix4(matrix).applyMatrix4(object.matrixWorld);
      box.union(instanceBox);
    }
  } else if (object.isMesh || object.isLineSegments || object.isPoints) {
    box.setFromObject(object);
  } else if (object.isSprite || object.isLight) {
    box.setFromCenterAndSize(object.getWorldPosition(new Vector3()), new Vector3(1, 1, 1));
  }
  return box;
}

function isShownWithParents(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function createEngineScene(viewport, config) {
  const { spec, materials } = config;
  const { renderer, smallScreen } = createRenderer(viewport, config.ariaLabel);
  const scene = new THREE.Scene();
  addLights(scene, renderer, config.lighting, smallScreen);

  const camera = new THREE.PerspectiveCamera(30, 1, config.camera.near, config.camera.far);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.minDistance = config.camera.minDistance;
  controls.maxDistance = config.camera.maxDistance;
  controls.screenSpacePanning = true;

  const objectsByLayer = {}, objectsByPart = {};
  const tag = (object, part, layer) => {
    object.userData.part = part;
    object.userData.layer = layer;
    (objectsByLayer[layer] = objectsByLayer[layer] || []).push(object);
    (objectsByPart[part] = objectsByPart[part] || []).push(object);
    return object;
  };

  const model = config.build({ spec, materials, geometry: window.Geometry, tag });
  model.addTo(scene);

  const ghostMaterials = Object.values(materials.ghost);
  const clipMaterials = ghostMaterials.concat(Object.values(materials.ghostEdges), model.clipMaterials);

  const engine = {
    renderer, scene, camera, controls,
    chambers: model.chambers,
    valveLifts: model.valveLifts,
    objectsByPart,
    layerVisible: Object.fromEntries(config.layers.map(layer => [layer, true])),
    housingMode: 'ghost',
    coverVisible: false,
    selectedPart: null,
    isolatedPart: null,
    crankAngle: 0,
    needsRender: true,
  };

  const firstCylinderX = spec.cylinderX ? spec.cylinderX[0] : spec.cylinders[0].x;
  const sections = {
    long: new THREE.Plane(new Vector3(...config.longSectionNormal({ x: 0, y: 1, z: 1 })), 0),
    trans: new THREE.Plane(new Vector3(1, 0, 0), -firstCylinderX),
  };
  let hiddenSide = 0;

  const sideOfSection = object => {
    if (object.userData.sectionSide === undefined) {
      const box = worldBox(object);
      object.userData.sectionSide = box.isEmpty() ? 0
        : box.max.x < firstCylinderX - 1 ? -1
          : box.min.x > firstCylinderX + 1 ? 1 : 0;
    }
    return object.userData.sectionSide;
  };

  function applyVisibility() {
    const cuttingAway = config.hideNearSideInTransverseSection && engine.housingMode === 'trans';
    if (cuttingAway) scene.updateMatrixWorld(true);
    Object.entries(objectsByLayer).forEach(([layer, objects]) => {
      objects.forEach(object => {
        let visible = engine.layerVisible[layer] !== false;
        if (layer === 'housing') visible = visible && engine.housingMode !== 'off';
        if (config.coverPart && object.userData.part === config.coverPart) visible = visible && engine.coverVisible;
        if (cuttingAway && hiddenSide && sideOfSection(object) === hiddenSide) visible = false;
        if (engine.isolatedPart) visible = visible && object.userData.part === engine.isolatedPart;
        object.visible = visible;
      });
    });
  }

  engine.setHousing = function (mode) {
    engine.housingMode = mode;
    if (config.hideNearSideInTransverseSection) {
      hiddenSide = mode === 'trans' ? (camera.position.x <= firstCylinderX ? -1 : 1) : 0;
    }
    const isSection = mode === 'long' || mode === 'trans';
    clipMaterials.forEach(material => {
      material.clippingPlanes = isSection ? [sections[mode]] : null;
      material.needsUpdate = true;
    });
    ghostMaterials.forEach(material => {
      material.userData.sectionBoost = isSection ? SECTION_GHOST_BOOST : 1;
      material.opacity = material.userData.baseOpacity * material.userData.sectionBoost;
    });
    applyVisibility();
    engine.needsRender = true;
  };

  engine.setLayer = function (layer, visible) {
    engine.layerVisible[layer] = visible;
    applyVisibility();
    engine.needsRender = true;
  };

  engine.setCoverVisible = function (visible) {
    engine.coverVisible = visible;
    applyVisibility();
    engine.needsRender = true;
  };

  function keepSectionFacingCamera() {
    if (engine.housingMode === 'long') {
      sections.long.normal.set(...config.longSectionNormal(camera.position));
      sections.long.constant = 0;
    } else if (engine.housingMode === 'trans') {
      const side = camera.position.x <= firstCylinderX ? 1 : -1;
      sections.trans.normal.set(side, 0, 0);
      sections.trans.constant = -side * firstCylinderX;
      if (config.hideNearSideInTransverseSection && hiddenSide !== -side) {
        hiddenSide = -side;
        applyVisibility();
      }
    }
  }

  engine.select = function (partId) {
    engine.selectedPart = partId;
    if (partId && materials.parts[partId]) materials.highlight(partId);
    else materials.clearHighlight();
    engine.needsRender = true;
    if (!partId && engine.isolatedPart) engine.isolate(false);
  };

  engine.isolate = function (on) {
    engine.isolatedPart = on && engine.selectedPart ? engine.selectedPart : null;
    applyVisibility();
    engine.needsRender = true;
  };

  function partBox(partId) {
    const box = new THREE.Box3(), objectBox = new THREE.Box3();
    scene.updateMatrixWorld(true);
    (objectsByPart[partId] || []).forEach(object => {
      if (object.isInstancedMesh) box.union(worldBox(object));
      else if (object.isMesh || object.isLineSegments) {
        objectBox.setFromObject(object);
        box.union(objectBox);
      }
    });
    return box;
  }

  const raycaster = new THREE.Raycaster();
  engine.pick = function (ndcX, ndcY) {
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const candidates = [];
    scene.traverse(object => {
      const pickable = (object.isMesh || object.isInstancedMesh) && object.visible && object.userData.part
        && object.userData.pickable !== false && isShownWithParents(object);
      if (pickable) candidates.push(object);
    });
    const hits = raycaster.intersectObjects(candidates, false);
    if (!hits.length) return null;
    const hit = hits.find(h => !(h.object.material && h.object.material.transparent)) || hits[0];
    return { part: hit.object.userData.part, point: hit.point };
  };

  let flight = null;
  function flyTo(position, target, durationMs) {
    flight = {
      fromPosition: camera.position.clone(), fromTarget: controls.target.clone(),
      toPosition: new Vector3(...position), toTarget: new Vector3(...target),
      startMs: performance.now(), durationMs: durationMs || 800,
    };
  }

  const distanceToFit = radius => {
    const halfVertical = camera.fov * Math.PI / 360;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
    return radius / Math.sin(Math.min(halfVertical, halfHorizontal));
  };

  engine.view = function (name, instant) {
    const view = config.views[name] || config.views.iso;
    const offset = new Vector3(...view.direction).normalize().multiplyScalar(distanceToFit(view.radius));
    const position = new Vector3(...view.target).add(offset).toArray();
    if (instant) {
      camera.position.set(...position);
      controls.target.set(...view.target);
      controls.update();
    } else {
      flyTo(position, view.target);
    }
  };

  engine.focus = function (partId) {
    const box = partBox(partId);
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length();
    const direction = camera.position.clone().sub(controls.target).normalize();
    const distance = Math.max(config.focusMinDistance, distanceToFit(size * 0.62));
    flyTo(center.clone().addScaledVector(direction, distance).toArray(), center.toArray());
  };

  engine.setDarkTheme = function (dark) {
    materials.setDarkTheme(dark);
    engine.needsRender = true;
  };

  engine.resize = function () {
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    model.onResize(height);
    engine.needsRender = true;
  };

  engine.update = function (crankAngle, angleStep) {
    engine.crankAngle = crankAngle;
    engine.needsRender = true;
    model.update(crankAngle, angleStep);
  };

  engine.invalidate = () => { engine.needsRender = true; };

  engine.render = function (nowMs) {
    const flying = flight !== null;
    if (flight) {
      const t = Math.min(1, (nowMs - flight.startMs) / flight.durationMs);
      const k = easeInOutCubic(t);
      camera.position.lerpVectors(flight.fromPosition, flight.toPosition, k);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
      if (t >= 1) flight = null;
    }
    controls.update();
    if (!engine.needsRender && !flying && !engine.selectedPart) return false;
    keepSectionFacingCamera();
    materials.pulseHighlight(nowMs / 1000);
    renderer.render(scene, camera);
    engine.needsRender = false;
    return true;
  };

  engine.view('iso', true);
  new ResizeObserver(engine.resize).observe(viewport);
  engine.resize();
  controls.addEventListener('change', engine.invalidate);
  applyVisibility();
  engine.update(0, 0);
  return engine;
}

window.createEngineScene = createEngineScene;
})();
