/*
 * Построители геометрии деталей поверх three.js. Все размеры — в миллиметрах.
 * Ось X — вдоль коленчатого вала; плоские контуры (Shape) рисуются в координатах (y, z) сечения.
 *
 *   rotateToX(geometry)                       — повернуть геометрию, построенную вдоль Y, на ось X
 *   applyQuaternion(geometry, quaternion)     — повернуть геометрию
 *   shapeToYZ(geometry)                       — перенести выдавленный контур из плоскости XY в сечение YZ
 *   extrudeAlongX(shape, x0, x1, options)     — выдавить контур сечения вдоль вала от x0 до x1
 *   lathe(points, segments, ...)              — тело вращения по профилю [[радиус, высота], ...]
 *   cylinderAlongX(r, x0, x1), tubeAlongX(rInner, rOuter, x0, x1) — цилиндр и труба по оси вала
 *   cylinderBetween(r, a, b)                  — цилиндр между двумя точками
 *   hexPrism(acrossFlats, height)             — шестигранник (головка болта, гайка)
 *   roundedRect, circleHole, polygonShape, smoothClosedShape — плоские контуры
 *   convexHull(points), circlePoints(center, r, n) — выпуклая оболочка точек и точки окружности (контуры рычагов, кожухов)
 *   coilSpring(...)                           — винтовая пружина с поджатыми концевыми витками
 *   timingPulleyShape, ringGearShape, lobedShape, involuteGearShape — контуры шкивов и зубчатых колёс
 *   gerotorProfiles(innerTeeth, eccentricity, pinCircleRadius, pinRadius) — роторы героторного насоса: внутренний
 *                                             находится как огибающая зубьев наружного за оборот (лучи из центра)
 *   placeAlong(geometry, origin, direction)  — поставить деталь, построенную вдоль Y, в точку origin по направлению
 *   mergeGeometries(list)                     — объединить геометрии в одну (одна отрисовка вместо многих)
 */
(function () {
'use strict';

const Vector3 = THREE.Vector3;

function rotateToX(geometry) {
  geometry.rotateZ(-Math.PI / 2);
  return geometry;
}

function applyQuaternion(geometry, quaternion) {
  return geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quaternion));
}

const XY_TO_YZ = new THREE.Matrix4().set(
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 0, 1);

function shapeToYZ(geometry) {
  return geometry.applyMatrix4(XY_TO_YZ);
}

function extrudeAlongX(shape, x0, x1, options) {
  const settings = Object.assign({ depth: x1 - x0, bevelEnabled: false, curveSegments: 24 }, options || {});
  const bevel = settings.bevelEnabled ? (settings.bevelThickness || 0) : 0;
  if (settings.bevelEnabled) settings.depth = Math.max(0.01, (x1 - x0) - 2 * bevel);
  const geometry = new THREE.ExtrudeGeometry(shape, settings);
  geometry.translate(0, 0, x0 + bevel);
  return shapeToYZ(geometry);
}

function lathe(points, segments, phiStart, phiLength, sharpCorners) {
  let profile = points;
  if (sharpCorners) {
    profile = [];
    points.forEach((point, index) => {
      profile.push(point);
      if (index > 0 && index < points.length - 1) profile.push([point[0], point[1]]);
    });
  }
  return new THREE.LatheGeometry(
    profile.map(([radius, height]) => new THREE.Vector2(radius, height)),
    segments || 48,
    phiStart || 0,
    phiLength === undefined ? Math.PI * 2 : phiLength);
}

function cylinderAlongX(radius, x0, x1, segments, openEnded) {
  const geometry = new THREE.CylinderGeometry(radius, radius, x1 - x0, segments || 32, 1, !!openEnded);
  rotateToX(geometry);
  geometry.translate((x0 + x1) / 2, 0, 0);
  return geometry;
}

function tubeAlongX(innerRadius, outerRadius, x0, x1, segments) {
  const length = x1 - x0;
  const profile = [[innerRadius, 0], [outerRadius, 0], [outerRadius, length], [innerRadius, length], [innerRadius, 0]];
  const geometry = lathe(profile, segments || 40, 0, undefined, true);
  rotateToX(geometry);
  geometry.translate(x0, 0, 0);
  return geometry;
}

function cylinderBetween(radius, from, to, segments) {
  const direction = new Vector3().subVectors(to, from);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), segments || 16);
  applyQuaternion(geometry, new THREE.Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()));
  geometry.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return geometry;
}

function hexPrism(acrossFlats, height) {
  const radius = acrossFlats / Math.sqrt(3);
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 6, 1);
  geometry.translate(0, height / 2, 0);
  return geometry;
}

function roundedRect(width, height, cornerRadius) {
  const shape = new THREE.Shape();
  const left = -width / 2, bottom = -height / 2, right = left + width, top = bottom + height, r = cornerRadius;
  shape.moveTo(left + r, bottom);
  shape.lineTo(right - r, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + r);
  shape.lineTo(right, top - r);
  shape.quadraticCurveTo(right, top, right - r, top);
  shape.lineTo(left + r, top);
  shape.quadraticCurveTo(left, top, left, top - r);
  shape.lineTo(left, bottom + r);
  shape.quadraticCurveTo(left, bottom, left + r, bottom);
  return shape;
}

function circleHole(centerX, centerY, radius, clockwise) {
  const path = new THREE.Path();
  path.absarc(centerX, centerY, radius, 0, Math.PI * 2, !!clockwise);
  return path;
}

function polygonShape(points) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => (index ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return shape;
}

function smoothClosedShape(points, samples) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new Vector3(x, y, 0)), true, 'centripetal');
  const spaced = curve.getSpacedPoints(samples || 160);
  spaced.pop();
  return polygonShape(spaced.map(point => [point.x, point.y]));
}

function coilSpring(meanRadius, wireRadius, activeTurns, height, handedness, radialSegments, segmentsPerTurn) {
  const endTurns = 0.85;
  const totalTurns = activeTurns + 2 * endTurns;
  const hand = handedness || 1;
  const endHeight = endTurns * wireRadius * 2 * 1.05;
  const coilHeight = height - 2 * wireRadius;

  const heightAtTurn = turn => {
    if (turn < endTurns) return turn / endTurns * endHeight;
    if (turn > totalTurns - endTurns) return coilHeight - (totalTurns - turn) / endTurns * endHeight;
    return endHeight + (turn - endTurns) / activeTurns * (coilHeight - 2 * endHeight);
  };

  const curve = new THREE.Curve();
  curve.getPoint = function (t, target) {
    const turn = t * totalTurns;
    const angle = turn * Math.PI * 2;
    return (target || new Vector3()).set(
      meanRadius * Math.cos(angle), heightAtTurn(turn) + wireRadius, hand * meanRadius * Math.sin(angle));
  };
  return new THREE.TubeGeometry(curve, Math.round(totalTurns * (segmentsPerTurn || 24)), wireRadius,
    radialSegments || 7, false);
}

function timingPulleyShape(teeth, pitchRadius, options) {
  const settings = Object.assign({ backOff: 0.7, grooveDepth: 3.6, grooveWidth: 5.4, holes: [], phase: 0 }, options || {});
  const outerRadius = pitchRadius - settings.backOff;
  const rootRadius = outerRadius - settings.grooveDepth;
  const toothStep = Math.PI * 2 / teeth;
  const halfGroove = (settings.grooveWidth / 2) / outerRadius;
  const points = [];
  const at = (radius, angle) => [radius * Math.cos(angle), radius * Math.sin(angle)];

  for (let tooth = 0; tooth < teeth; tooth++) {
    const center = settings.phase + tooth * toothStep;
    const grooveStart = center - halfGroove, grooveEnd = center + halfGroove;
    points.push(at(outerRadius, grooveStart - 0.04 * toothStep));
    for (let step = 0; step <= 6; step++) {
      const t = step / 6;
      const depth = Math.pow(Math.sin(Math.PI * t), 0.55);
      points.push(at(outerRadius - (outerRadius - rootRadius) * depth, grooveStart + (grooveEnd - grooveStart) * t));
    }
    points.push(at(outerRadius, grooveEnd + 0.04 * toothStep));
  }
  const shape = polygonShape(points);
  settings.holes.forEach(hole => shape.holes.push(hole));
  return shape;
}

function ringGearShape(teeth, rootRadius, tipRadius, innerRadius) {
  const toothStep = Math.PI * 2 / teeth;
  const points = [];
  const at = (radius, angle) => [radius * Math.cos(angle), radius * Math.sin(angle)];
  for (let tooth = 0; tooth < teeth; tooth++) {
    const start = tooth * toothStep;
    points.push(at(rootRadius, start));
    points.push(at(rootRadius, start + toothStep * 0.18));
    points.push(at(tipRadius, start + toothStep * 0.34));
    points.push(at(tipRadius, start + toothStep * 0.62));
    points.push(at(rootRadius, start + toothStep * 0.78));
  }
  const shape = polygonShape(points);
  shape.holes.push(circleHole(0, 0, innerRadius, true));
  return shape;
}

function lobedShape(lobes, baseRadius, amplitude, samples, holeRadius) {
  const count = samples || 240;
  const points = [];
  for (let k = 0; k < count; k++) {
    const t = k / count * Math.PI * 2;
    const wave = Math.cos(lobes * t);
    const radius = baseRadius + amplitude * (wave >= 0 ? Math.pow(wave, 0.7) : -Math.pow(-wave, 1.4));
    points.push([radius * Math.cos(t), radius * Math.sin(t)]);
  }
  const shape = polygonShape(points);
  if (holeRadius) shape.holes.push(circleHole(0, 0, holeRadius, true));
  return shape;
}

function involuteGearShape(teeth, module, options) {
  const settings = Object.assign({ pressureAngle: 20 * Math.PI / 180, phase: 0, holes: [], backlash: 0.05 }, options || {});
  const pitchRadius = module * teeth / 2;
  const baseRadius = pitchRadius * Math.cos(settings.pressureAngle);
  const tipRadius = pitchRadius + module;
  const rootRadius = pitchRadius - 1.25 * module;
  const involute = angle => Math.tan(angle) - angle;
  const halfToothAngle = Math.PI / (2 * teeth) - settings.backlash / pitchRadius;
  const flankStart = Math.max(baseRadius, rootRadius);
  const flankSteps = 7;

  const flank = [];
  for (let step = 0; step <= flankSteps; step++) {
    const radius = flankStart + (tipRadius - flankStart) * step / flankSteps;
    const pressure = Math.acos(Math.min(1, baseRadius / radius));
    flank.push([radius, halfToothAngle + involute(settings.pressureAngle) - involute(pressure)]);
  }

  const at = (radius, angle) => [radius * Math.cos(angle), radius * Math.sin(angle)];
  const hasUndercut = rootRadius < flankStart - 0.01;
  const points = [];
  for (let tooth = 0; tooth < teeth; tooth++) {
    const center = settings.phase + tooth * 2 * Math.PI / teeth;
    if (hasUndercut) points.push(at(rootRadius, center - flank[0][1]));
    for (let step = 0; step <= flankSteps; step++) points.push(at(flank[step][0], center - flank[step][1]));
    for (let step = flankSteps; step >= 0; step--) points.push(at(flank[step][0], center + flank[step][1]));
    if (hasUndercut) points.push(at(rootRadius, center + flank[0][1]));
    const gapStart = center + flank[0][1];
    const gapEnd = center + 2 * Math.PI / teeth - flank[0][1];
    for (let j = 1; j < 4; j++) points.push(at(rootRadius, gapStart + (gapEnd - gapStart) * j / 4));
  }
  const shape = polygonShape(points);
  settings.holes.forEach(hole => shape.holes.push(hole));
  return shape;
}

function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  for (let k = sorted.length - 1; k >= 0; k--) {
    const point = sorted[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function circlePoints(center, radius, count) {
  return Array.from({ length: count }, (_, k) =>
    [center[0] + radius * Math.cos(k / count * Math.PI * 2), center[1] + radius * Math.sin(k / count * Math.PI * 2)]);
}

function gerotorProfiles(innerTeeth, eccentricity, pinCircleRadius, pinRadius) {
  const rays = 300, steps = 1100;
  const pinCenters = [];
  for (let step = 0; step < steps; step++) {
    const angle = step / steps * Math.PI * 2;
    const offsetU = -eccentricity * Math.cos(-angle), offsetV = -eccentricity * Math.sin(-angle);
    const outerRotation = -angle / (innerTeeth + 1);
    for (let pin = 0; pin <= innerTeeth; pin++) {
      const pinAngle = outerRotation + pin / (innerTeeth + 1) * Math.PI * 2;
      pinCenters.push(offsetU + pinCircleRadius * Math.cos(pinAngle), offsetV + pinCircleRadius * Math.sin(pinAngle));
    }
  }

  const pinRadiusSquared = pinRadius * pinRadius;
  const nearestHit = (dirU, dirV, centerU, centerV) => {
    const along = dirU * centerU + dirV * centerV;
    const discriminant = along * along - (centerU * centerU + centerV * centerV - pinRadiusSquared);
    if (discriminant < 0) return null;
    return along - Math.sqrt(discriminant);
  };

  const inner = [];
  for (let ray = 0; ray < rays; ray++) {
    const angle = ray / rays * Math.PI * 2, dirU = Math.cos(angle), dirV = Math.sin(angle);
    let best = pinCircleRadius + pinRadius;
    for (let j = 0; j < pinCenters.length; j += 2) {
      const centerU = pinCenters[j], centerV = pinCenters[j + 1];
      if (dirU * centerU + dirV * centerV <= 0) continue;
      const hit = nearestHit(dirU, dirV, centerU, centerV);
      if (hit !== null && hit > 0 && hit < best) best = hit;
    }
    inner.push([best * dirU, best * dirV]);
  }

  const outer = [];
  for (let ray = 0; ray < 420; ray++) {
    const angle = ray / 420 * Math.PI * 2, dirU = Math.cos(angle), dirV = Math.sin(angle);
    let best = pinCircleRadius + 0.6 * pinRadius;
    for (let pin = 0; pin <= innerTeeth; pin++) {
      const pinAngle = pin / (innerTeeth + 1) * Math.PI * 2;
      const hit = nearestHit(dirU, dirV, pinCircleRadius * Math.cos(pinAngle), pinCircleRadius * Math.sin(pinAngle));
      if (hit !== null && hit > 0 && hit < best) best = hit;
    }
    outer.push([(best + 0.25) * dirU, (best + 0.25) * dirV]);
  }
  return { inner, outer };
}

function placeAlong(geometry, origin, direction) {
  applyQuaternion(geometry, new THREE.Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()));
  geometry.translate(origin.x, origin.y, origin.z);
  return geometry;
}

function mergeGeometries(list) {
  const prepared = list.filter(Boolean).map(source => {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    if (!geometry.attributes.uv) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    }
    Object.keys(geometry.attributes)
      .filter(name => name !== 'position' && name !== 'normal' && name !== 'uv')
      .forEach(name => geometry.deleteAttribute(name));
    geometry.clearGroups();
    return geometry;
  });
  return THREE.BufferGeometryUtils.mergeBufferGeometries(prepared, false);
}

window.Geometry = {
  rotateToX, applyQuaternion, shapeToYZ, extrudeAlongX, lathe, cylinderAlongX, tubeAlongX, cylinderBetween,
  hexPrism, roundedRect, circleHole, polygonShape, smoothClosedShape, convexHull, circlePoints, coilSpring,
  timingPulleyShape, ringGearShape, lobedShape, involuteGearShape, gerotorProfiles, placeAlong, mergeGeometries,
};
})();
