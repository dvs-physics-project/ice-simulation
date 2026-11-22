/*
 * Помощники для двигателей с рядами цилиндров под углом (оппозитный B4, V-образный V8).
 * Каждый цилиндр в spec.cylinders знает угол своей оси axisAngle (поворот вокруг вала) и сторону ряда sign.
 * Детали строятся «стоя» — вдоль оси Y, как для вертикального цилиндра, — и затем поворачиваются на ось ряда.
 *
 *   rotation(spec, cylinder, extraTilt)            — поворот вертикальной детали на ось цилиндра;
 *                                                    extraTilt — дополнительный наклон вокруг X (клапан, свеча);
 *                                                    левый ряд дополнительно разворачивается на 180°, чтобы
 *                                                    «впуск» и «выпуск» обоих рядов смотрели в одну сторону
 *   point(spec, cylinder, localX, along, side, target) — точка ряда: localX вдоль вала от оси цилиндра
 *                                                    (зеркально для левого ряда), along — по оси, side — вбок
 */
(function () {
'use strict';

function rotation(spec, cylinder, extraTilt) {
  const { axisAngle, sign } = spec.cylinders[cylinder];
  const matrix = new THREE.Matrix4().makeRotationX(axisAngle);
  if (sign < 0) matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  if (extraTilt) matrix.multiply(new THREE.Matrix4().makeRotationX(extraTilt));
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function point(spec, cylinder, localX, along, side, target) {
  const { x, sign } = spec.cylinders[cylinder];
  const [px, py, pz] = spec.pointInBank(cylinder, x + (sign > 0 ? localX : -localX), along, side);
  return (target || new THREE.Vector3()).set(px, py, pz);
}

window.CylinderBanks = { rotation, point };
})();
