/*
 * Небольшие математические помощники, общие для всех двигателей.
 *
 *   DEG, TAU            — градус в радианах и полный оборот 2π
 *   positiveModulo(a,m) — остаток, который всегда в [0, m): positiveModulo(-30, 720) = 690
 *   wrapToPi(angle)     — угол, приведённый к диапазону (−π, π]
 *   rotate2d([x,y], a)  — поворот точки на плоскости вокруг начала координат
 *
 * Работает и в браузере (window.EngineMath), и в Node (require).
 */
(function (root) {
'use strict';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function wrapToPi(angle) {
  return positiveModulo(angle + Math.PI, TAU) - Math.PI;
}

function rotate2d([x, y], angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
}

const EngineMath = { DEG, TAU, positiveModulo, wrapToPi, rotate2d };

if (typeof module !== 'undefined' && module.exports) module.exports = EngineMath;
root.EngineMath = EngineMath;
})(typeof window !== 'undefined' ? window : globalThis);
