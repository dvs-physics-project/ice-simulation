/*
 * Что показывает панель каждого двигателя: заголовок, строка характеристик, диапазон оборотов,
 * готовые виды камеры, режимы корпуса, слои, спецификация по группам, настройки графиков и подпись.
 *
 *   EngineProfiles[id] = {
 *     title, specLine(spec), rpm: { min, max, step, initial }, slowdowns, initialSlowdown,
 *     compactCylinderStrip, views, housingModes, layers, coverToggle, onView(view, panel),
 *     specGroups: [[название группы, [id деталей]]],
 *     liftChart: { yMax, yTicks, marker(spec), liftAt(spec) }, pvChart: { vMax, vTicks, pLow, pHigh, pTicks },
 *     footer
 *   }
 */
(function () {
'use strict';

const HOUSING_MODES = [['ghost', 'Прозрачный корпус'], ['long', 'Разрез А–А'], ['trans', 'Разрез Б–Б'], ['off', 'Без корпуса']];
const PETROL_PV = { pLow: 0.5, pHigh: 100, pTicks: [0.5, 1, 2, 5, 10, 20, 50, 100] };
const sparkMarker = spec => ({ at: spec.physics.sparkDeg, label: 'искра' });
const thousands = value => Math.round(value).toLocaleString('ru-RU');

const PHYSICS_NOTE_PETROL = 'Давление и температура газа, мощность и момент рассчитаны ядром ice-core: пошаговый расчёт цикла по первому закону термодинамики, сгорание по закону Вибе, теплоотдача по Вошни, давление впуска зависит от оборотов. Мощность и момент — эффективные, за вычетом механических потерь.';

window.EngineProfiles = {
  i4: {
    title: 'Рядный 4-цилиндровый, 16 клапанов',
    specLine: spec => `<span><b>Ø72 × 69</b> мм</span><span><b>${Math.round(spec.displacementCm3)}</b> см³</span><span>ε <b>10,5</b></span><span><b>DOHC 16V</b></span><span>порядок <b>1-3-4-2</b></span>`,
    rpm: { min: 700, max: 6500, step: 50, initial: 2400 },
    slowdowns: [200, 60, 20], initialSlowdown: 60,
    compactCylinderStrip: false,
    views: [['iso', 'Общий'], ['front', 'Привод ГРМ'], ['side', 'Продольный'], ['head', 'Головка'], ['top', 'Сверху']],
    housingModes: HOUSING_MODES,
    layers: [['crank', 'Коленвал, маховик'], ['pistons', 'Поршни, шатуны'], ['valvetrain', 'Распредвалы, клапаны'],
      ['timing', 'Ремень ГРМ, шкивы'], ['aux', 'Смазка, охлаждение, топливо'], ['gas', 'Газы и потоки']],
    coverToggle: 'Кожух ремня ГРМ',
    specGroups: [
      ['Сборочные единицы', ['block', 'crank', 'rod', 'head', 'flywheel', 'pickup', 'oilPump', 'pan']],
      ['Детали', ['camPulley', 'crankPulley', 'camshaft', 'pin', 'cover', 'gasket']],
      ['Прочие изделия', ['outlet', 'bearingRod', 'bearingMain', 'thrust', 'tensioner', 'belt', 'accPulley', 'rings', 'coolantPump', 'oilFilter', 'knock']],
      ['Без позиции, в составе сборок', ['piston', 'valveIn', 'valveEx', 'springs', 'tappet', 'spark', 'fuel', 'dipstick']],
    ],
    liftChart: {
      yMax: 9, yTicks: [0, 2, 4, 6, 8], marker: sparkMarker,
      liftAt: spec => (side, phase) => spec.liftAtCyclePhase(side === 'intake' ? spec.INTAKE : spec.EXHAUST, phase),
    },
    pvChart: Object.assign({ vMax: 330, vTicks: [0, 100, 200, 300] }, PETROL_PV),
    footer: 'Размеры сняты со сборочного чертежа. Кинематика точная: профиль кулачков задаёт подъём клапанов, ремень длиной ровно 137 зубьев. ' + PHYSICS_NOTE_PETROL,
  },

  v8: {
    title: 'V-образный 8-цилиндровый дизель',
    specLine: spec => `<span><b>Ø125 × 130</b> мм</span><span><b>${thousands(spec.displacementCm3)}</b> см³</span><span>ε <b>17</b></span><span><b>V8 90°, OHV 16V</b></span><span>порядок <b>1-5-4-2-6-3-7-8</b></span>`,
    rpm: { min: 600, max: 2600, step: 50, initial: 1400 },
    slowdowns: [60, 30, 10], initialSlowdown: 30,
    compactCylinderStrip: true,
    views: [['iso', 'Общий'], ['front', 'Спереди'], ['gears', 'Шестерни'], ['side', 'Сбоку'], ['top', 'Сверху']],
    onView: (view, panel) => { if (view === 'gears') panel.setLayer('flywheel', false); },
    housingModes: HOUSING_MODES,
    layers: [['crank', 'Коленвал, вкладыши'], ['flywheel', 'Маховик'], ['pistons', 'Поршни, шатуны, гильзы'], ['valvetrain', 'Распредвал, клапаны'],
      ['gears', 'Шестерни привода'], ['fuel', 'ТНВД, форсунки'], ['air', 'Наддув, коллекторы'], ['aux', 'Вентилятор, генератор, смазка'], ['gas', 'Газы и потоки']],
    specGroups: [
      ['Сборочные единицы', ['block', 'head', 'crank', 'rod', 'piston', 'flywheel', 'turbo', 'injPump', 'oilPump', 'fan', 'alternator', 'starter']],
      ['Детали', ['camshaft', 'crankGear', 'idlerGear', 'camGear', 'pumpGear', 'tappet', 'pushrod', 'rocker', 'valveIn', 'valveEx', 'springs',
        'liner', 'pin', 'cover', 'pan', 'flyhousing', 'intake', 'exhaust', 'pickup', 'pulley']],
      ['Прочие изделия', ['belt', 'bearingMain', 'bearingRod', 'thrust', 'rings', 'injector', 'hpLines', 'gasket']],
    ],
    liftChart: {
      yMax: 14, yTicks: [0, 4, 8, 12],
      marker: spec => ({ from: spec.injection.start, to: spec.injection.end, label: 'впрыск' }),
      liftAt: spec => (side, phase) => spec.liftAtCyclePhase(side, phase),
    },
    pvChart: { vMax: 1800, vTicks: [0, 500, 1000, 1500], pLow: 1, pHigh: 160, pTicks: [1, 2, 5, 10, 20, 50, 100] },
    footer: 'Размеры сняты со сборочного чертежа. Кинематика точная: профиль кулачков задаёт подъём толкателей, угол коромысла — из постоянной длины штанги, все шестерни в зацеплении, ремни на точной касательной. Газ рассчитан ядром ice-core: смешанный цикл с наддувом 1,55 бар, проверенный по расходу топлива, и пошаговый расчёт со сгоранием после задержки воспламенения 6°. Мощность и момент — эффективные. Вращение турбин показано условно медленно.',
  },

  b4: {
    title: 'Оппозитный 4-цилиндровый, 16 клапанов',
    specLine: spec => `<span><b>Ø83 × 83</b> мм</span><span><b>${thousands(spec.displacementCm3)}</b> см³</span><span>ε <b>10</b></span><span><b>SOHC 16V</b></span><span>порядок <b>1-3-2-4</b></span>`,
    rpm: { min: 700, max: 6500, step: 50, initial: 2400 },
    slowdowns: [200, 60, 20], initialSlowdown: 60,
    compactCylinderStrip: false,
    views: [['iso', 'Общий'], ['front', 'Привод ГРМ'], ['head', 'Головка'], ['top', 'Сверху'], ['low', 'Снизу']],
    housingModes: HOUSING_MODES,
    layers: [['crank', 'Коленвал, маховик'], ['pistons', 'Поршни, шатуны'], ['valvetrain', 'Распредвалы, коромысла, клапаны'],
      ['timing', 'Ремень ГРМ, ролики, насос'], ['air', 'Впуск, выпуск, форсунки'], ['aux', 'Смазка, свечи, опоры'], ['gas', 'Газы и потоки']],
    coverToggle: 'Крышка ремня ГРМ (поз. 17)',
    specGroups: [
      ['Позиции с выносок чертежа', ['crank', 'block', 'headGasket', 'piston', 'flywheel', 'mount', 'sensor', 'crankSprocket', 'headL', 'headR', 'belt',
        'oilPump', 'tcover', 'idler', 'pickup', 'pan', 'oilFilter', 'intake', 'injector', 'pump', 'caseBolt', 'headBolt']],
      ['Без позиции, в составе сборок', ['rod', 'pin', 'rings', 'bearingRod', 'bearingMain', 'thrust', 'camshaft', 'camPulley', 'rocker', 'rockerShaft',
        'valveIn', 'valveEx', 'springs', 'tensioner', 'spark', 'exhaust', 'cover']],
    ],
    liftChart: {
      yMax: 11, yTicks: [0, 2, 4, 6, 8, 10], marker: sparkMarker,
      liftAt: spec => (side, phase) => spec.liftAtCyclePhase(side, phase),
    },
    pvChart: Object.assign({ vMax: 550, vTicks: [0, 100, 200, 300, 400, 500] }, PETROL_PV),
    footer: 'Размеры сняты с четырёх листов сборочного чертежа (М 1:1): вид на привод ГРМ, поперечный и продольный разрезы, вид на головку. Спецификации на чертеже нет: номера взяты с выносок, названия деталей — по их виду и месту. Кинематика точная: каждый кулачок построен как огибающая площадки своего коромысла, ремень — ровно 201 зуб на касательных. ' + PHYSICS_NOTE_PETROL,
  },
};
})();
