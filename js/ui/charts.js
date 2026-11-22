/*
 * Графики на боковой панели (рисуются на <canvas>, цвета берутся из CSS-переменных темы).
 *
 *   drawValveLift(canvas, phaseDeg, options) — фазы газораспределения: подъём впускных и выпускных клапанов
 *       и ход поршня по углу цикла 0…720°, полосы тактов, метка искры или окно впрыска, текущий угол.
 *       options: { spec, liftAt(side, phaseDeg), yMax, yTicks, marker: { at | from, to, label } }
 *   drawIndicatorDiagram(canvas, state, options) — индикаторная диаграмма p–V (давление в логарифмической
 *       шкале), отрезки окрашены по тактам, точка — текущее состояние газа выбранного цилиндра.
 *       options: { physics, vMax, vTicks, pLow, pHigh, pTicks }
 */
(function () {
'use strict';

const STROKE_COLOR_VARIABLE = { intake: '--intake', compression: '--compression', power: '--power', exhaust: '--exhaust' };
const STROKE_BANDS = [['intake', 'впуск'], ['compression', 'сжатие'], ['power', 'рабочий ход'], ['exhaust', 'выпуск']];
const FONT = '500 19px "Fira Sans Extra Condensed", sans-serif';

const cssVariable = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const withComma = value => String(value).replace('.', ',');

function transparent(color, alpha) {
  if (color[0] !== '#') return color;
  const rgb = parseInt(color.slice(1), 16);
  return `rgba(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255},${alpha})`;
}

function themeColors() {
  return {
    ink: cssVariable('--ink'), muted: cssVariable('--muted'), rule: cssVariable('--rule'),
    accent: cssVariable('--accent'), text: cssVariable('--text'),
    intake: cssVariable('--intake'), exhaust: cssVariable('--power'),
  };
}

function rotatedLabel(context, text, x, y) {
  context.save();
  context.translate(x, y);
  context.rotate(-Math.PI / 2);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 0, 0);
  context.restore();
}

function drawValveLift(canvas, phaseDeg, options) {
  const { spec, liftAt, yMax, yTicks, marker } = options;
  const context = canvas.getContext('2d');
  const left = 50, right = 18, top = 30, bottom = 52;
  const plotWidth = canvas.width - left - right, plotHeight = canvas.height - top - bottom;
  const colors = themeColors();
  const inkAlpha = alpha => transparent(colors.ink.startsWith('#') ? colors.ink : '#1d2c8a', alpha);
  const x = phase => left + phase / 720 * plotWidth;
  const y = liftMm => top + plotHeight - liftMm / yMax * plotHeight;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = FONT;

  context.strokeStyle = colors.rule;
  context.lineWidth = 1;
  yTicks.forEach(mm => {
    context.beginPath();
    context.moveTo(left, y(mm));
    context.lineTo(left + plotWidth, y(mm));
    context.stroke();
    context.fillStyle = colors.muted;
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    context.fillText(mm, left - 8, y(mm));
  });

  STROKE_BANDS.forEach(([stroke, name], index) => {
    const color = cssVariable(STROKE_COLOR_VARIABLE[stroke]);
    context.fillStyle = transparent(color, 0.18);
    context.fillRect(x(index * 180), top + plotHeight + 8, plotWidth / 4, 16);
    context.fillStyle = color;
    context.fillRect(x(index * 180), top + plotHeight + 8, plotWidth / 4, 3);
    context.fillStyle = colors.text;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(name, x(index * 180 + 90), top + plotHeight + 28);
  });

  if (marker && marker.from !== undefined) {
    context.fillStyle = transparent(colors.accent.startsWith('#') ? colors.accent : '#cf4413', 0.16);
    context.fillRect(x(marker.from), top, x(marker.to) - x(marker.from), plotHeight);
  }

  context.setLineDash([4, 4]);
  context.strokeStyle = inkAlpha(0.35);
  [0, 180, 360, 540, 720].forEach((phase, index) => {
    context.beginPath();
    context.moveTo(x(phase), top - 4);
    context.lineTo(x(phase), top + plotHeight);
    context.stroke();
    context.fillStyle = colors.ink;
    context.textAlign = index === 0 ? 'left' : index === 4 ? 'right' : 'center';
    context.textBaseline = 'bottom';
    context.fillText(index % 2 ? 'НМТ' : 'ВМТ', x(phase), top - 6);
  });
  context.setLineDash([]);

  context.strokeStyle = inkAlpha(0.55);
  context.lineWidth = 1.6;
  context.beginPath();
  const { crankRadius: r, rodLength: L, stroke } = spec;
  for (let phase = 0; phase <= 720; phase += 4) {
    const angle = (phase % 360) * Math.PI / 180;
    const pinHeight = r * Math.cos(angle) + Math.sqrt(L ** 2 - (r * Math.sin(angle)) ** 2);
    const pistonY = top + (r + L - pinHeight) / stroke * plotHeight;
    if (phase) context.lineTo(x(phase), pistonY); else context.moveTo(x(phase), pistonY);
  }
  context.stroke();

  for (const [side, color] of [['intake', colors.intake], ['exhaust', colors.exhaust]]) {
    context.beginPath();
    context.moveTo(x(0), y(0));
    for (let phase = 0; phase <= 720; phase += 2) context.lineTo(x(phase), y(liftAt(side, phase)));
    context.lineTo(x(720), y(0));
    context.closePath();
    context.fillStyle = transparent(color, 0.2);
    context.fill();
    context.beginPath();
    for (let phase = 0; phase <= 720; phase += 2) {
      const liftY = y(liftAt(side, phase));
      if (phase) context.lineTo(x(phase), liftY); else context.moveTo(x(phase), liftY);
    }
    context.strokeStyle = color;
    context.lineWidth = 2.6;
    context.stroke();
  }

  if (marker) {
    context.fillStyle = colors.accent;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    if (marker.at !== undefined) {
      context.strokeStyle = colors.accent;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x(marker.at), top + plotHeight);
      context.lineTo(x(marker.at), y(yMax * 0.36));
      context.stroke();
      context.fillText(marker.label, x(marker.at), y(yMax * 0.38));
    } else {
      context.fillText(marker.label, (x(marker.from) + x(marker.to)) / 2, y(yMax * 0.38));
    }
  }

  const cursorX = x(phaseDeg);
  context.strokeStyle = colors.accent;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(cursorX, top - 2);
  context.lineTo(cursorX, top + plotHeight + 4);
  context.stroke();
  for (const [side, color] of [['intake', colors.intake], ['exhaust', colors.exhaust]]) {
    const lift = liftAt(side, phaseDeg);
    if (lift > 0.05) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(cursorX, y(lift), 6, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.fillStyle = colors.muted;
  rotatedLabel(context, 'подъём, мм', 14, top + plotHeight / 2);
}

function drawIndicatorDiagram(canvas, state, options) {
  const { physics, vMax, vTicks, pLow, pHigh, pTicks } = options;
  const context = canvas.getContext('2d');
  const left = 64, right = 18, top = 20, bottom = 50;
  const plotWidth = canvas.width - left - right, plotHeight = canvas.height - top - bottom;
  const colors = themeColors();
  const logLow = Math.log10(pLow), logHigh = Math.log10(pHigh);
  const x = volumeCm3 => left + volumeCm3 / vMax * plotWidth;
  const y = pressureBar => top + plotHeight - (Math.log10(Math.max(pressureBar, pLow)) - logLow) / (logHigh - logLow) * plotHeight;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = FONT;
  context.strokeStyle = colors.rule;
  context.lineWidth = 1;
  pTicks.forEach(bar => {
    context.beginPath();
    context.moveTo(left, y(bar));
    context.lineTo(left + plotWidth, y(bar));
    context.stroke();
    context.fillStyle = colors.muted;
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    context.fillText(withComma(bar), left - 8, y(bar));
  });
  vTicks.forEach(volume => {
    context.beginPath();
    context.moveTo(x(volume), top);
    context.lineTo(x(volume), top + plotHeight);
    context.stroke();
    context.fillStyle = colors.muted;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(volume, x(volume), top + plotHeight + 6);
  });
  context.fillStyle = colors.muted;
  context.textAlign = 'center';
  context.fillText('V, см³', left + plotWidth / 2, top + plotHeight + 26);
  context.save();
  context.translate(16, top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.textBaseline = 'middle';
  context.fillText('P, бар', 0, 0);
  context.restore();

  context.setLineDash([4, 4]);
  context.strokeStyle = transparent(colors.ink.startsWith('#') ? colors.ink : '#1d2c8a', 0.4);
  [[physics.clearanceVolume * 1e6, 'ВМТ'], [physics.maxVolume * 1e6, 'НМТ']].forEach(([volume, label]) => {
    context.beginPath();
    context.moveTo(x(volume), top);
    context.lineTo(x(volume), top + plotHeight);
    context.stroke();
    context.fillStyle = colors.ink;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText(label, x(volume) + 4, top + 2);
  });
  context.setLineDash([]);

  const points = physics.cycle;
  context.lineWidth = 3;
  for (let k = 0; k < points.length - 1; k++) {
    const from = points[k], to = points[k + 1];
    context.strokeStyle = cssVariable(STROKE_COLOR_VARIABLE[from.stroke]);
    context.beginPath();
    context.moveTo(x(from.V * 1e6), y(from.P / 1e5));
    context.lineTo(x(to.V * 1e6), y(to.P / 1e5));
    context.stroke();
  }

  if (state) {
    context.fillStyle = colors.accent;
    context.beginPath();
    context.arc(x(state.V * 1e6), y(state.P / 1e5), 8, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = cssVariable('--sheet') || '#fff';
    context.lineWidth = 2.5;
    context.stroke();
  }
}

window.Charts = { drawValveLift, drawIndicatorDiagram, STROKE_COLOR_VARIABLE };
})();
