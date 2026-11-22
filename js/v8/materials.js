/*
 * Материалы и спецификация V-образного дизеля.
 *
 *   colors — цвет, металличность и шероховатость каждого типа детали: [hex, metalness, roughness]
 *   parts  — спецификация модели: на чертеже есть номера позиций, но нет таблицы, поэтому нумерация своя;
 *            у каждой детали — слой модели, описание и материалы для подсветки
 *
 * Сами материалы создаёт общая функция createMaterialLibrary (js/shared/materials.js).
 */
(function () {
'use strict';

const colors = {
  crankForged:  ['#6f757e', 0.92, 0.44], crankJournal: ['#e0e4e9', 1.0, 0.12], noseBolt: ['#8a9097', 1.0, 0.35],
  flywheel:     ['#4e535a', 0.85, 0.55], flywheelFace: ['#c4c9ce', 1.0, 0.22], ringGear: ['#9aa0a7', 1.0, 0.3],
  damper:       ['#2b2e33', 0.55, 0.5],  crankPulley:  ['#9ea4ab', 0.95, 0.32],
  rod:          ['#7e8a9b', 0.9, 0.36],  rodBolt:      ['#3b3f45', 0.9, 0.4],   rodBush: ['#c79a55', 1.0, 0.3],
  bearingMain:  ['#cfae78', 1.0, 0.28],  bearingRod:   ['#cfae78', 1.0, 0.28],  thrust:  ['#b98f55', 1.0, 0.3],
  piston:       ['#c7c3bb', 0.7, 0.42],  ring:         ['#2c2f34', 0.9, 0.35],  pin:     ['#e3e6ea', 1.0, 0.12],
  liner:        ['#8d9298', 0.85, 0.5],  linerBore:    ['#c9ced3', 1.0, 0.2],   oring:   ['#1b1d20', 0.0, 0.6],
  camshaft:     ['#6d7279', 0.9, 0.45],  camLobe:      ['#d9dde1', 1.0, 0.13],
  crankGear:    ['#a9afb6', 1.0, 0.26],  idlerGear:    ['#a2a8af', 1.0, 0.28],  camGear: ['#b4bac1', 1.0, 0.24], pumpGear: ['#a9afb6', 1.0, 0.26],
  tappet:       ['#d4d8dd', 1.0, 0.16],  pushrod:      ['#9aa1a9', 1.0, 0.25],
  rocker:       ['#7b828b', 0.9, 0.38],  rockerShaft:  ['#d0d4d9', 1.0, 0.16],  adjScrew: ['#5a6068', 1.0, 0.3],
  valveIn:      ['#c3c7cc', 1.0, 0.2],   valveEx:      ['#a28b72', 0.95, 0.32],
  spring:       ['#3d6b55', 0.6, 0.38],  retainer:     ['#9ea4ab', 1.0, 0.28],
  injector:     ['#b7bcc2', 0.9, 0.3],   hpLine:       ['#c8ccd1', 1.0, 0.22],
  pumpCam:      ['#d0d4d9', 1.0, 0.16],  plunger:      ['#e6e9ec', 1.0, 0.1],
  turbineWheel: ['#5b5550', 0.9, 0.42],  compWheel:    ['#d8dbdf', 1.0, 0.16],  turboCore: ['#6a6f76', 0.85, 0.5],
  fanBlade:     ['#26292e', 0.15, 0.55], fanHub:       ['#3b3f45', 0.6, 0.45],  coupling: ['#8c939b', 0.85, 0.42],
  vbelt:        ['#1e2024', 0.0, 0.85],  altBody:      ['#b8bdc2', 0.8, 0.42],  altPulley: ['#8f959c', 1.0, 0.32],
  oilGear:      ['#9aa0a7', 1.0, 0.3],   pickup:       ['#7f858c', 0.9, 0.45],  strainer: ['#5a5f66', 0.8, 0.6],
  starterBody:  ['#2f3338', 0.5, 0.45],  gasket:       ['#a3a7ad', 0.85, 0.42],
};

const parts = {
  block:      { pos: '1',  name: 'Блок цилиндров', qty: '1', layer: 'housing', ghost: ['block'],
                desc: 'Блок V-образный с развалом 90°. Гильзы мокрые, распредвал — в развале над коленвалом. Показан прозрачным.' },
  head:       { pos: '2',  name: 'Головка цилиндра', qty: '8', layer: 'housing', ghost: ['head', 'ports'],
                desc: 'Отдельная головка на каждый цилиндр: два клапана, форсунка, впускной канал со стороны развала, выпускной — снаружи. Обе стороны ставятся одинаковые головки, развёрнутые на 180°.' },
  crank:      { pos: '3',  name: 'Вал коленчатый', qty: '1', layer: 'crank', materials: ['crankForged', 'crankJournal', 'noseBolt'],
                desc: 'Пять коренных и четыре шатунные шейки Ø80, радиус кривошипа 65 мм (ход 130). Кривошипы в двух плоскостях под 90°: 1 и 4 напротив друг друга, 2 и 3 тоже. На каждой шейке — два шатуна.' },
  rod:        { pos: '4',  name: 'Шатун', qty: '8', layer: 'pistons', materials: ['rod', 'rodBolt', 'rodBush'],
                desc: 'Межосевое расстояние 250 мм. Шатуны левого и правого ряда сидят рядом на одной шейке — поэтому ряды сдвинуты вдоль вала на 37 мм.' },
  piston:     { pos: '5',  name: 'Поршень', qty: '8', layer: 'pistons', materials: ['piston'],
                desc: 'Ø125, камера сгорания в днище (тороидальная, «ω»), выточки под клапаны глубиной 4 мм — в перекрытии клапаны не касаются поршня (запас не менее 4,4 мм).' },
  flywheel:   { pos: '6',  name: 'Маховик с венцом', qty: '1', layer: 'flywheel', materials: ['flywheel', 'flywheelFace', 'ringGear'],
                desc: 'Ø480 с зубчатым венцом стартера. Стоит за задним торцом блока, за шестернями привода.' },
  turbo:      { pos: '7',  name: 'Турбокомпрессор', qty: '2', layer: 'air', ghost: ['turbo'], materials: ['turbineWheel', 'compWheel', 'turboCore'],
                desc: 'По одному на ряд. Отработавшие газы крутят колесо турбины, на одном валу с ним — колесо компрессора, которое нагнетает воздух во впускной трубопровод. На экране ротор замедлен сильнее всего: на деле он вращается в 40–50 раз быстрее коленвала.' },
  injPump:    { pos: '8',  name: 'Насос топливный высокого давления', qty: '1', layer: 'fuel', ghost: ['pump'], materials: ['pumpCam', 'plunger'],
                desc: 'V-образный, 8 секций. Вал насоса вращается вдвое медленнее коленвала; каждый плунжер подаёт топливо к своей форсунке за 16° до ВМТ такта сжатия.' },
  oilPump:    { pos: '9',  name: 'Насос масляный', qty: '1', layer: 'aux', ghost: ['oilpump'], materials: ['oilGear'],
                desc: 'Шестерённый, внизу у переднего торца. Приводится шестернёй на носке коленвала 1 : 1.' },
  fan:        { pos: '10', name: 'Вентилятор с гидромуфтой', qty: '1', layer: 'aux', materials: ['fanBlade', 'fanHub', 'coupling'],
                desc: 'Вентилятор Ø600 на выходном валу гидромуфты. Входной шкив вращается ремнём, сам вентилятор отстаёт на 3 % — это проскальзывание муфты.' },
  alternator: { pos: '11', name: 'Генератор', qty: '1', layer: 'aux', materials: ['altBody', 'altPulley'],
                desc: 'Шкив Ø80 против Ø190 у коленвала — генератор вращается в 2,4 раза быстрее.' },
  starter:    { pos: '12', name: 'Стартер', qty: '1', layer: 'aux', materials: ['starterBody'],
                desc: 'На картере маховика; при пуске шестерня стартера входит в венец маховика.' },
  camshaft:   { pos: '13', name: 'Вал распределительный', qty: '1', layer: 'valvetrain', materials: ['camshaft', 'camLobe'],
                desc: 'Один вал на оба ряда, 16 кулачков, 5 опор. Подъём кулачка 8,5 мм; профиль рассчитан под плоский толкатель. Фазы: впуск 13° до ВМТ — 49° после НМТ, выпуск 66° до НМТ — 10° после ВМТ.' },
  crankGear:  { pos: '14', name: 'Шестерня коленчатого вала', qty: '1', layer: 'gears', materials: ['crankGear'],
                desc: 'z = 24, модуль 4. Начало цепочки шестерён на заднем торце блока.' },
  idlerGear:  { pos: '15', name: 'Шестерня промежуточная', qty: '1', layer: 'gears', materials: ['idlerGear'],
                desc: 'z = 30. Меняет направление вращения, так что распредвал крутится в ту же сторону, что и коленвал.' },
  camGear:    { pos: '16', name: 'Шестерня распределительного вала', qty: '1', layer: 'gears', materials: ['camGear'],
                desc: 'z = 48 — вдвое больше шестерни коленвала, отсюда передаточное отношение 2 : 1.' },
  pumpGear:   { pos: '17', name: 'Шестерня привода ТНВД', qty: '1', layer: 'gears', materials: ['pumpGear'],
                desc: 'z = 48, в зацеплении с шестернёй распредвала: вал насоса делает пол-оборота на оборот коленвала.' },
  tappet:     { pos: '18', name: 'Толкатель', qty: '16', layer: 'valvetrain', materials: ['tappet'],
                desc: 'Грибовидный, с плоской тарелкой. Ось толкателя параллельна оси цилиндра своего ряда.' },
  pushrod:    { pos: '19', name: 'Штанга толкателя', qty: '16', layer: 'valvetrain', materials: ['pushrod'],
                desc: 'Длина 363 мм между центрами сфер. Положение коромысла рассчитывается из условия, что длина штанги не меняется.' },
  rocker:     { pos: '20', name: 'Коромысло с осью', qty: '16', layer: 'valvetrain', materials: ['rocker', 'rockerShaft', 'adjScrew'],
                desc: 'Плечи 40 и 59 мм: подъём клапана в 1,47 раза больше подъёма кулачка (12,5 мм против 8,5).' },
  valveIn:    { pos: '21', name: 'Клапан впускной', qty: '8', layer: 'valvetrain', materials: ['valveIn'],
                desc: 'Тарелка Ø46.' },
  valveEx:    { pos: '22', name: 'Клапан выпускной', qty: '8', layer: 'valvetrain', materials: ['valveEx'],
                desc: 'Тарелка Ø40, работает горячее впускного.' },
  springs:    { pos: '23', name: 'Пружины клапанов', qty: '32', layer: 'valvetrain', materials: ['spring', 'retainer'],
                desc: 'Наружная и внутренняя на каждом клапане, сверху тарелка с сухарями.' },
  liner:      { pos: '24', name: 'Гильза цилиндра', qty: '8', layer: 'pistons', materials: ['liner', 'linerBore', 'oring'],
                desc: '«Мокрая» гильза Ø125: снаружи омывается охлаждающей жидкостью, внизу уплотнена резиновыми кольцами.' },
  pin:        { pos: '25', name: 'Палец поршневой', qty: '8', layer: 'pistons', materials: ['pin'],
                desc: 'Плавающий, Ø50, со стопорными кольцами.' },
  cover:      { pos: '26', name: 'Крышка головки цилиндра', qty: '8', layer: 'housing', ghost: ['cover'],
                desc: 'Закрывает коромысла и пружины своего цилиндра.' },
  pan:        { pos: '27', name: 'Поддон картера', qty: '1', layer: 'housing', ghost: ['pan'],
                desc: 'Глубокая часть впереди, под маслоприёмником.' },
  flyhousing: { pos: '28', name: 'Картер маховика', qty: '1', layer: 'housing', ghost: ['flyhousing'],
                desc: 'Закрывает шестерни привода и маховик; на нём стоит стартер.' },
  intake:     { pos: '29', name: 'Трубопровод впускной', qty: '1', layer: 'air', ghost: ['intake'],
                desc: 'Ресивер в развале блока с патрубками к каждой головке; воздух в него нагнетают турбокомпрессоры.' },
  exhaust:    { pos: '30', name: 'Коллектор выпускной', qty: '2', layer: 'air', ghost: ['exhaust'],
                desc: 'По наружной стороне каждого ряда, ведёт газы к турбине своего ряда.' },
  pickup:     { pos: '31', name: 'Маслоприёмник', qty: '1', layer: 'aux', materials: ['pickup', 'strainer'],
                desc: 'Трубка с сеткой в глубокой части поддона.' },
  pulley:     { pos: '32', name: 'Шкив коленвала с гасителем', qty: '1', layer: 'aux', materials: ['crankPulley', 'damper'],
                desc: 'Двухручьевой шкив Ø190 и гаситель крутильных колебаний на носке вала.' },
  belt:       { pos: '33', name: 'Ремни привода', qty: '2', layer: 'aux', materials: ['vbelt'],
                desc: 'Два клиновых ремня: коленвал → генератор → гидромуфта вентилятора. Длина по расчёту 1288 мм.' },
  bearingMain:{ pos: '34', name: 'Вкладыши коренные', qty: '5 компл.', layer: 'crank', materials: ['bearingMain'],
                desc: 'Пять пар вкладышей коренных опор.' },
  bearingRod: { pos: '35', name: 'Вкладыши шатунные', qty: '8 компл.', layer: 'pistons', materials: ['bearingRod'],
                desc: 'По паре на каждый шатун; на одной шейке работают два шатуна.' },
  thrust:     { pos: '36', name: 'Полукольца упорные', qty: '4', layer: 'crank', materials: ['thrust'],
                desc: 'У задней коренной опоры, держат вал от осевого смещения.' },
  rings:      { pos: '37', name: 'Кольца поршневые', qty: '8 компл.', layer: 'pistons', materials: ['ring'],
                desc: 'Два компрессионных и маслосъёмное на каждом поршне.' },
  injector:   { pos: '38', name: 'Форсунка', qty: '8', layer: 'fuel', materials: ['injector'],
                desc: 'Распылитель с четырьмя отверстиями направлен в камеру в днище поршня.' },
  hpLines:    { pos: '39', name: 'Трубки высокого давления', qty: '8', layer: 'fuel', materials: ['hpLine'],
                desc: 'От секций ТНВД к форсункам. Подсвечиваются в момент подачи топлива в свой цилиндр.' },
  gasket:     { pos: '40', name: 'Прокладка головки', qty: '8', layer: 'housing', materials: ['gasket'],
                desc: 'Под каждой головкой своя металлоасбестовая прокладка с окантовкой отверстия под гильзу.' },
};

const library = createMaterialLibrary({
    colors,
    parts,
    doubleSided: ['bearingMain', 'bearingRod', 'thrust', 'piston', 'ring', 'strainer', 'gasket', 'rodBush', 'oring', 'liner', 'linerBore'],
    ghosts: ['block', 'head', 'cover', 'pan', 'flyhousing', 'frontcover', 'intake', 'exhaust', 'turbo', 'pump', 'oilpump', 'ports'],
    ghostOpacity: 0.06,
    ghostOpacityOverrides: { ports: 0.11, turbo: 0.16, pump: 0.2, oilpump: 0.24, intake: 0.08, exhaust: 0.12 },
    edgeOpacity: { light: 0.45, dark: 0.38 },
    highlightOpacityFactor: 3.4,
});

for (const [name, opacity] of [['liner', 0.2], ['linerBore', 0.14]]) {
  Object.assign(library.solid[name], { transparent: true, depthWrite: false, opacity });
}

window.EngineMaterials = Object.assign(window.EngineMaterials || {}, { v8: library });
})();
