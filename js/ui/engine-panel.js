/*
 * Панель одного двигателя: 3D-сцена и боковая панель с режимом работы, показаниями цилиндра,
 * графиками, спецификацией и слоями.
 *
 *   createEnginePanel(engineId, root) → { frame(nowMs), onKeyDown(event), setDarkTheme(dark), resume() }
 *     frame       — шаг анимации: поворачивает вал на угол, соответствующий прошедшему времени
 *                   (с учётом замедления показа), обновляет сцену, показания и графики;
 *     onKeyDown   — пробел: пауза, ←/→: шаг 5° (с Shift — 30°), Esc: снять выделение;
 *     resume      — вызывается при возврате на вкладку.
 *
 * Выбор детали: клик по модели или по строке спецификации подсвечивает деталь и показывает карточку;
 * из спецификации камера ещё и приближается к детали. Клик по газу в цилиндре выбирает этот цилиндр.
 */
(function () {
'use strict';

const DEG = Math.PI / 180;
const FULL_CYCLE = 4 * Math.PI;
const formatNumber = (value, digits) => value.toFixed(digits).replace('.', ',');

function fillTemplate(profile, spec, root) {
  root.appendChild(document.getElementById('engineTemplate').content.cloneNode(true));
  const field = role => root.querySelector(`[data-role="${role}"]`);
  field('title').textContent = profile.title;
  field('specLine').innerHTML = profile.specLine(spec);
  field('footer').textContent = profile.footer;
  return field;
}

function segmentedButtons(container, items, attribute) {
  container.innerHTML = items
    .map(([value, label]) => `<button type="button" data-${attribute}="${value}" aria-pressed="false">${label}</button>`)
    .join('');
}

function bindSegmented(container, attribute, onPick) {
  const buttons = () => container.querySelectorAll('button');
  container.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    buttons().forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    onPick(button.dataset[attribute]);
  });
  return value => buttons().forEach(button => button.setAttribute('aria-pressed', String(button.dataset[attribute] === String(value))));
}

function createEnginePanel(engineId, root) {
  const profile = window.EngineProfiles[engineId];
  const spec = window.EngineSpecs[engineId];
  const materials = window.EngineMaterials[engineId];
  const physics = spec.physics;
  const field = fillTemplate(profile, spec, root);
  const stage = field('stage');

  ['angle', 'rpm'].forEach(role => {
    field(role).id = `${engineId}-${role}`;
    field(role + 'Label').htmlFor = `${engineId}-${role}`;
  });
  const rpmInput = field('rpm');
  Object.assign(rpmInput, { min: profile.rpm.min, max: profile.rpm.max, step: profile.rpm.step });
  segmentedButtons(field('views'), profile.views, 'view');
  segmentedButtons(field('housing'), profile.housingModes, 'mode');
  segmentedButtons(field('slow'), profile.slowdowns.map(factor => [factor, '×' + factor]), 'slow');
  segmentedButtons(field('cylSel'), spec.firingOrder.map((_, cylinder) => [cylinder, '№' + (cylinder + 1)]), 'cyl');
  field('layers').innerHTML = profile.layers
    .map(([layer, label]) => `<label><input type="checkbox" id="${engineId}-layer-${layer}" data-layer="${layer}" checked>${label}</label>`)
    .join('') + (profile.coverToggle ? `<label><input type="checkbox" id="${engineId}-cover" data-role="cover">${profile.coverToggle}</label>` : '');

  let engine;
  try {
    engine = window.EngineScenes[engineId](field('viewport'));
  } catch (error) {
    field('loading').textContent = 'Не удалось запустить 3D: ' + (error && error.message);
    console.error(error);
    return null;
  }
  field('loading').hidden = true;

  const cylinderCount = spec.firingOrder.length;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = {
    rpm: profile.rpm.initial, slowdown: profile.initialSlowdown, crankAngle: 0, playing: !reducedMotion,
    cylinder: 0, housing: 'ghost', view: 'iso',
  };
  let pendingCrankAngle = null;

  const setLayer = (layer, visible) => {
    engine.setLayer(layer, visible);
    const checkbox = root.querySelector(`[data-layer="${layer}"]`);
    if (checkbox) checkbox.checked = visible;
    refreshSpecRows();
  };

  const markView = bindSegmented(field('views'), 'view', view => {
    state.view = view;
    engine.view(view);
    if (profile.onView) profile.onView(view, { setLayer });
  });
  engine.controls.addEventListener('start', () => markView(null));
  const markHousing = bindSegmented(field('housing'), 'mode', mode => {
    state.housing = mode;
    engine.setHousing(mode);
    refreshSpecRows();
  });
  const markSlowdown = bindSegmented(field('slow'), 'slow', factor => {
    state.slowdown = Number(factor);
    showOnScreenSpeed();
  });
  const markCylinder = bindSegmented(field('cylSel'), 'cyl', cylinder => selectCylinder(Number(cylinder)));

  const showOnScreenSpeed = () => {
    field('realSpeed').textContent = `на экране ${Math.round(state.rpm / state.slowdown)} об/мин`;
  };

  function setRpm(rpm) {
    state.rpm = rpm;
    rpmInput.value = rpm;
    physics.setRpm(rpm);
    drawCharts(true);
    field('rpmOut').firstChild.nodeValue = String(rpm);
    const power = physics.effectivePower(rpm);
    const horsepower = document.createElement('small');
    horsepower.textContent = `${Math.round(power / 735.5)} л.с.`;
    field('powOut').replaceChildren(formatNumber(power / 1000, 1), horsepower);
    field('trqOut').textContent = formatNumber(physics.effectiveTorque(rpm), 0);
    showOnScreenSpeed();
  }
  rpmInput.addEventListener('input', () => setRpm(Number(rpmInput.value)));

  const playButton = field('playBtn'), angleInput = field('angle');
  function setPlaying(playing) {
    state.playing = playing;
    playButton.textContent = playing ? '❚❚' : '▶';
    playButton.setAttribute('aria-label', playing ? 'Пауза' : 'Пуск');
  }
  playButton.addEventListener('click', () => setPlaying(!state.playing));

  function stepBy(degrees) {
    setPlaying(false);
    pendingCrankAngle = (pendingCrankAngle === null ? state.crankAngle : pendingCrankAngle) + degrees * DEG;
  }
  field('stepBack').addEventListener('click', () => stepBy(-5));
  field('stepFwd').addEventListener('click', () => stepBy(5));
  angleInput.addEventListener('input', () => {
    setPlaying(false);
    const cycleStart = Math.floor(state.crankAngle / FULL_CYCLE) * FULL_CYCLE;
    pendingCrankAngle = cycleStart + Number(angleInput.value) * DEG;
  });

  function onKeyDown(event) {
    if (event.target.closest('input, select, textarea')) return;
    if (event.code === 'Space') { event.preventDefault(); setPlaying(!state.playing); }
    else if (event.key === 'ArrowRight') stepBy(event.shiftKey ? 30 : 5);
    else if (event.key === 'ArrowLeft') stepBy(event.shiftKey ? -30 : -5);
    else if (event.key === 'Escape') selectPart(null);
  }

  const cylinderStrip = field('firing');
  cylinderStrip.classList.toggle('compact', profile.compactCylinderStrip);
  for (let cylinder = 0; cylinder < cylinderCount; cylinder++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.cyl = cylinder;
    const name = profile.compactCylinderStrip ? cylinder + 1 : `Цил. ${cylinder + 1}`;
    button.innerHTML = `<b>${name}</b><span>—</span><i></i>`;
    button.addEventListener('click', () => selectCylinder(cylinder));
    cylinderStrip.appendChild(button);
  }

  function selectCylinder(cylinder) {
    state.cylinder = cylinder;
    markCylinder(cylinder);
    cylinderStrip.querySelectorAll('button').forEach(button =>
      button.setAttribute('aria-pressed', String(Number(button.dataset.cyl) === cylinder)));
    drawCharts(true);
  }

  const specBody = field('spec').querySelector('tbody');
  profile.specGroups.forEach(([groupTitle, partIds]) => {
    const groupRow = document.createElement('tr');
    groupRow.className = 'group';
    groupRow.innerHTML = `<td colspan="3">${groupTitle}</td>`;
    specBody.appendChild(groupRow);
    partIds.forEach(partId => {
      const part = materials.parts[partId];
      const row = document.createElement('tr');
      row.className = 'row';
      row.dataset.part = partId;
      row.tabIndex = 0;
      row.innerHTML = `<td class="pos">${part.pos}</td><td>${part.name}</td><td class="qty">${part.qty}</td>`;
      row.addEventListener('click', () => selectPart(engine.selectedPart === partId ? null : partId, true));
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); }
      });
      specBody.appendChild(row);
    });
  });

  function refreshSpecRows() {
    specBody.querySelectorAll('tr.row').forEach(row => {
      const partId = row.dataset.part, part = materials.parts[partId];
      const hidden = engine.layerVisible[part.layer] === false || (part.layer === 'housing' && engine.housingMode === 'off');
      row.classList.toggle('off', hidden);
      row.classList.toggle('on', engine.selectedPart === partId);
    });
  }

  const partCard = field('partCard');
  const transportBar = field('transport');
  function placePartCard() {
    const stageBox = stage.getBoundingClientRect(), transportBox = transportBar.getBoundingClientRect();
    partCard.style.bottom = Math.max(12, stageBox.bottom - transportBox.top + 12) + 'px';
  }

  function selectPart(partId, fromSpecTable) {
    if (partId && fromSpecTable) {
      const part = materials.parts[partId];
      if (engine.layerVisible[part.layer] === false) setLayer(part.layer, true);
      if (part.layer === 'housing' && engine.housingMode === 'off') {
        engine.setHousing('ghost');
        state.housing = 'ghost';
        markHousing('ghost');
      }
    }
    engine.select(partId || null);
    field('pcIsolate').setAttribute('aria-pressed', 'false');
    if (partId) {
      const part = materials.parts[partId];
      field('pcPos').textContent = part.pos === '—' ? '·' : part.pos;
      field('pcName').textContent = part.name;
      field('pcQty').textContent = /компл/.test(part.qty) ? part.qty : `${part.qty} шт.`;
      field('pcDesc').textContent = part.desc;
      partCard.hidden = false;
      placePartCard();
      if (fromSpecTable) engine.focus(partId);
    } else {
      partCard.hidden = true;
    }
    refreshSpecRows();
    const row = specBody.querySelector(`tr[data-part="${partId}"]`);
    if (row && !fromSpecTable) row.scrollIntoView({ block: 'nearest' });
  }

  new ResizeObserver(() => { if (!partCard.hidden) placePartCard(); }).observe(stage);
  field('pcClose').addEventListener('click', () => selectPart(null));
  field('pcFocus').addEventListener('click', () => engine.selectedPart && engine.focus(engine.selectedPart));
  field('pcIsolate').addEventListener('click', event => {
    const on = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    event.currentTarget.setAttribute('aria-pressed', String(on));
    engine.isolate(on);
    if (on) engine.focus(engine.selectedPart);
  });

  root.querySelectorAll('[data-layer]').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      engine.setLayer(checkbox.dataset.layer, checkbox.checked);
      refreshSpecRows();
    });
  });
  if (profile.coverToggle) {
    const coverCheckbox = field('cover');
    coverCheckbox.addEventListener('change', () => engine.setCoverVisible(coverCheckbox.checked));
  }

  const canvas = engine.renderer.domElement, tooltip = field('tip');
  let pointerDown = null, lastHoverMs = 0, hoverEvent = null;
  const pointerPosition = event => {
    const box = canvas.getBoundingClientRect();
    return {
      ndcX: ((event.clientX - box.left) / box.width) * 2 - 1,
      ndcY: -((event.clientY - box.top) / box.height) * 2 + 1,
      x: event.clientX - box.left, y: event.clientY - box.top,
    };
  };
  const tooltipHtml = partId => {
    if (partId.startsWith('gas:')) return `<b>Цил. ${Number(partId.slice(4)) + 1}</b>рабочее тело`;
    const part = materials.parts[partId];
    if (!part) return null;
    return `<b>${part.pos === '—' ? '' : 'поз. ' + part.pos}</b>${part.name}`;
  };

  canvas.addEventListener('pointerdown', event => {
    pointerDown = { x: event.clientX, y: event.clientY };
    tooltip.hidden = true;
  });
  canvas.addEventListener('pointerup', event => {
    if (!pointerDown) return;
    const dragged = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6;
    pointerDown = null;
    if (dragged) return;
    const { ndcX, ndcY } = pointerPosition(event);
    const hit = engine.pick(ndcX, ndcY);
    if (hit && hit.part.startsWith('gas:')) { selectCylinder(Number(hit.part.slice(4))); return; }
    selectPart(hit && materials.parts[hit.part] ? (engine.selectedPart === hit.part ? null : hit.part) : null);
  });
  canvas.addEventListener('pointermove', event => {
    if (event.buttons) { tooltip.hidden = true; return; }
    hoverEvent = event;
  });
  canvas.addEventListener('pointerleave', () => {
    hoverEvent = null;
    tooltip.hidden = true;
    canvas.style.cursor = '';
  });

  function showHoverTooltip(nowMs) {
    if (!hoverEvent || nowMs - lastHoverMs < 90) return;
    lastHoverMs = nowMs;
    const { ndcX, ndcY, x, y } = pointerPosition(hoverEvent);
    hoverEvent = null;
    const hit = engine.pick(ndcX, ndcY);
    const html = hit && tooltipHtml(hit.part);
    if (html) {
      tooltip.innerHTML = html;
      tooltip.style.left = x + 'px';
      tooltip.style.top = y + 'px';
      tooltip.hidden = false;
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.hidden = true;
      canvas.style.cursor = '';
    }
  }

  const liftChartOptions = {
    spec, liftAt: profile.liftChart.liftAt(spec), yMax: profile.liftChart.yMax, yTicks: profile.liftChart.yTicks,
    marker: profile.liftChart.marker(spec),
  };
  const pvChartOptions = Object.assign({ physics }, profile.pvChart);
  let lastChartPhase = -1;
  function drawCharts(force) {
    if (!engine) return;
    const phase = spec.cyclePhaseDeg(state.cylinder, engine.crankAngle / DEG);
    if (!force && Math.abs(phase - lastChartPhase) < 0.4) return;
    lastChartPhase = phase;
    liftChartOptions.marker = profile.liftChart.marker(spec);
    window.Charts.drawValveLift(field('liftChart'), phase, liftChartOptions);
    window.Charts.drawIndicatorDiagram(field('pvChart'), engine.chambers[state.cylinder].state, pvChartOptions);
  }

  const strokeColor = stroke => `var(${window.Charts.STROKE_COLOR_VARIABLE[stroke]})`;
  function showReadouts() {
    const degrees = ((engine.crankAngle / DEG) % 720 + 720) % 720;
    field('angleOut').textContent = `${Math.round(degrees)}°`;
    if (document.activeElement !== angleInput) angleInput.value = Math.round(degrees);

    cylinderStrip.querySelectorAll('button').forEach((button, cylinder) => {
      const gasState = engine.chambers[cylinder].state;
      if (!gasState) return;
      const strokeName = physics.strokeNames[gasState.stroke];
      button.querySelector('span').textContent = strokeName;
      button.querySelector('i').style.background = strokeColor(gasState.stroke);
      button.title = `Цилиндр ${cylinder + 1}: ${strokeName.toLowerCase()}`;
    });

    const gasState = engine.chambers[state.cylinder].state;
    if (!gasState) return;
    field('strokeMark').style.background = strokeColor(gasState.stroke);
    field('strokeName').textContent = physics.strokeNames[gasState.stroke];
    field('pOut').textContent = formatNumber(gasState.P / 1e5, gasState.P > 1e6 ? 0 : 1);
    field('tOut').textContent = Math.round(gasState.T);
    field('vOut').textContent = formatNumber(gasState.V * 1e6, 0);
    field('xOut').textContent = formatNumber(spec.pistonPosition(state.cylinder, engine.crankAngle).travel, 1);
    const [intakeLift, exhaustLift] = engine.valveLifts(state.cylinder);
    field('liOut').textContent = formatNumber(Math.max(0, intakeLift), 2);
    field('leOut').textContent = formatNumber(Math.max(0, exhaustLift), 2);
  }

  function setDarkTheme(dark) {
    engine.setDarkTheme(dark);
    drawCharts(true);
  }

  setRpm(state.rpm);
  markSlowdown(state.slowdown);
  setPlaying(state.playing);
  markHousing(state.housing);
  engine.setHousing(state.housing);
  markView(state.view);
  engine.view(state.view, true);
  selectCylinder(state.cylinder);
  refreshSpecRows();
  engine.update(state.crankAngle, 0);
  showReadouts();
  drawCharts(true);

  let lastFrameMs = performance.now(), sinceReadouts = 1, sinceCharts = 0;
  function frame(nowMs) {
    const seconds = Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;
    let angleStep = 0;
    if (state.playing) {
      angleStep = state.rpm * 2 * Math.PI / 60 / state.slowdown * seconds;
      state.crankAngle += angleStep;
    }
    if (pendingCrankAngle !== null) {
      angleStep += pendingCrankAngle - state.crankAngle;
      state.crankAngle = pendingCrankAngle;
      pendingCrankAngle = null;
    }
    const wrapAfter = FULL_CYCLE * 400;
    if (state.crankAngle > wrapAfter) state.crankAngle -= wrapAfter;
    if (state.crankAngle < 0) state.crankAngle += wrapAfter;
    if (angleStep !== 0) engine.update(state.crankAngle, angleStep);
    engine.render(nowMs);
    showHoverTooltip(nowMs);
    sinceReadouts += seconds;
    sinceCharts += seconds;
    if (sinceReadouts > 0.07) { sinceReadouts = 0; showReadouts(); }
    if (sinceCharts > 0.09) { sinceCharts = 0; drawCharts(false); }
  }

  return {
    frame, onKeyDown, setDarkTheme,
    resume() {
      lastFrameMs = performance.now();
      engine.resize();
      engine.invalidate();
      if (!partCard.hidden) placePartCard();
    },
  };
}

window.createEnginePanel = createEnginePanel;
})();
