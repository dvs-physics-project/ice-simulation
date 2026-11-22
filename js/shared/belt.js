/*
 * Геометрия ремённой передачи на плоскости (u, v) — плоскости, перпендикулярной коленчатому валу.
 *
 * Шкив описывается объектом { name, u, v, radius, side }:
 *   side = +1 — шкив внутри петли ремня (ремень огибает его зубьями),
 *   side = −1 — ролик снаружи петли (давит на спинку ремня: натяжитель, обводной ролик).
 *
 *   layout(pulleys)          — путь ремня: дуги на шкивах и прямые участки между ними, полная длина.
 *                              Возвращает null, если такая укладка невозможна.
 *   pointAt(path, distance)  — точка ремня на расстоянии distance от начала пути, касательная и нормаль.
 *   findTensionerAngle(...)  — угол рычага натяжителя, при котором длина ремня равна заданной
 *                              (целое число зубьев); из найденных корней берётся ближайший к желаемому углу.
 */
(function (root) {
'use strict';

const { DEG, TAU, positiveModulo, wrapToPi } = typeof require === 'function'
  ? require('./math.js') : root.EngineMath;

function tangentBetween(from, to) {
  const r1 = from.side * from.radius;
  const r2 = to.side * to.radius;
  const du = to.u - from.u, dv = to.v - from.v;
  const ratio = (r1 - r2) / Math.hypot(du, dv);
  if (Math.abs(ratio) >= 1) return null;

  const normalAngle = Math.atan2(dv, du) - Math.acos(ratio);
  const nu = Math.cos(normalAngle), nv = Math.sin(normalAngle);
  const start = { u: from.u + r1 * nu, v: from.v + r1 * nv };
  const end = { u: to.u + r2 * nu, v: to.v + r2 * nv };
  const length = Math.hypot(end.u - start.u, end.v - start.v);
  return {
    start, length,
    directionU: (end.u - start.u) / length,
    directionV: (end.v - start.v) / length,
    leaveAngle: Math.atan2(from.side * nv, from.side * nu),
    arriveAngle: Math.atan2(to.side * nv, to.side * nu),
  };
}

function layout(pulleys) {
  const count = pulleys.length;
  const tangents = [];
  for (let k = 0; k < count; k++) {
    const tangent = tangentBetween(pulleys[k], pulleys[(k + 1) % count]);
    if (!tangent) return null;
    tangents.push(tangent);
  }

  const pieces = [];
  let length = 0;
  for (let k = 0; k < count; k++) {
    const pulley = pulleys[k];
    const incoming = tangents[(k - 1 + count) % count];
    const outgoing = tangents[k];
    const wrapAngle = pulley.side > 0
      ? positiveModulo(outgoing.leaveAngle - incoming.arriveAngle, TAU)
      : positiveModulo(incoming.arriveAngle - outgoing.leaveAngle, TAU);
    if (pulley.side < 0 && wrapAngle > Math.PI * 0.75) return null;
    if (pulley.side > 0 && wrapAngle < 2 * DEG) return null;

    const arcLength = pulley.radius * wrapAngle;
    pieces.push({ type: 'arc', pulley, startAngle: incoming.arriveAngle, direction: pulley.side,
      wrapAngle, length: arcLength, startDistance: length });
    length += arcLength;
    pieces.push({ type: 'straight', start: outgoing.start, directionU: outgoing.directionU,
      directionV: outgoing.directionV, length: outgoing.length, startDistance: length });
    length += outgoing.length;
  }
  return { pieces, length };
}

function pieceAt(path, distance) {
  let low = 0, high = path.pieces.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (path.pieces[middle].startDistance <= distance) low = middle;
    else high = middle - 1;
  }
  return path.pieces[low];
}

function pointAt(path, distance) {
  const s = positiveModulo(distance, path.length);
  const piece = pieceAt(path, s);
  const along = s - piece.startDistance;
  let u, v, tangentU, tangentV;
  if (piece.type === 'straight') {
    u = piece.start.u + piece.directionU * along;
    v = piece.start.v + piece.directionV * along;
    tangentU = piece.directionU;
    tangentV = piece.directionV;
  } else {
    const { pulley, direction } = piece;
    const angle = piece.startAngle + direction * along / pulley.radius;
    u = pulley.u + pulley.radius * Math.cos(angle);
    v = pulley.v + pulley.radius * Math.sin(angle);
    tangentU = -Math.sin(angle) * direction;
    tangentV = Math.cos(angle) * direction;
  }
  return { u, v, tangentU, tangentV, normalU: -tangentV, normalV: tangentU, piece };
}

function findTensionerAngle({ lengthAt, wantedLength, fromDeg, toDeg, stepDeg, preferredAngle }) {
  const crossesWanted = (a, b) => (a - wantedLength) * (b - wantedLength) <= 0;
  let previous = null, best = null;

  for (let degrees = fromDeg; degrees <= toDeg; degrees += stepDeg) {
    const angle = degrees * DEG;
    const length = lengthAt(angle);
    if (previous && isFinite(length) && isFinite(previous.length) && crossesWanted(previous.length, length)) {
      let low = previous.angle, high = angle, lowLength = previous.length;
      for (let iteration = 0; iteration < 60; iteration++) {
        const middle = (low + high) / 2;
        const middleLength = lengthAt(middle);
        if (!isFinite(middleLength)) break;
        if (crossesWanted(lowLength, middleLength)) high = middle;
        else { low = middle; lowLength = middleLength; }
      }
      const root = (low + high) / 2;
      const miss = Math.abs(wrapToPi(root - preferredAngle));
      if (!best || miss < best.miss) best = { angle: root, miss };
    }
    previous = { angle, length };
  }
  return best ? best.angle : null;
}

const Belt = { layout, pointAt, findTensionerAngle };

if (typeof module !== 'undefined' && module.exports) module.exports = Belt;
root.Belt = Belt;
})(typeof window !== 'undefined' ? window : globalThis);
