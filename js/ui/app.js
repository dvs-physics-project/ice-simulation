/*
 * Оболочка страницы: главное меню и вкладки двигателей.
 *
 * Панель двигателя создаётся при первом открытии вкладки (построение 3D-модели занимает заметное время),
 * дальше она живёт в памяти и при возврате продолжает с того же места. Один общий цикл
 * requestAnimationFrame двигает только видимую панель.
 * Тёмная тема берётся из атрибута data-theme на <html> или из настроек системы.
 */
(function () {
'use strict';

function isDarkTheme() {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}

function start() {
  const panels = {}, created = {}, creating = {};
  document.querySelectorAll('[data-panel]').forEach(element => { panels[element.dataset.panel] = element; });
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  let activeTab = null;

  function show(tab) {
    if (!panels[tab]) tab = 'menu';
    Object.entries(panels).forEach(([name, element]) => { element.hidden = name !== tab; });
    tabs.forEach(button => {
      const selected = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected || (tab === 'menu' && button === tabs[0]) ? 0 : -1;
    });
    document.querySelector('.home').setAttribute('aria-current', tab === 'menu' ? 'page' : 'false');
    document.body.dataset.view = tab;
    activeTab = tab;
    if (tab === 'menu') return;
    if (created[tab]) { created[tab].resume(); return; }
    if (creating[tab]) return;

    creating[tab] = true;
    requestAnimationFrame(() => setTimeout(() => {
      const panel = window.createEnginePanel(tab, panels[tab]);
      creating[tab] = false;
      if (!panel) return;
      panel.setDarkTheme(isDarkTheme());
      created[tab] = panel;
      if (activeTab === tab) panel.resume();
    }, 30));
  }

  document.querySelectorAll('[data-tab]').forEach(element => element.addEventListener('click', () => show(element.dataset.tab)));
  document.querySelector('.tabs').addEventListener('keydown', event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    show(next.dataset.tab);
    event.preventDefault();
  });
  addEventListener('keydown', event => {
    const panel = created[activeTab];
    if (panel && !event.target.closest('.topbar')) panel.onKeyDown(event);
  });

  const applyTheme = () => Object.values(created).forEach(panel => panel.setDarkTheme(isDarkTheme()));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function loop(nowMs) {
    requestAnimationFrame(loop);
    const panel = created[activeTab];
    if (panel) panel.frame(nowMs);
  }
  show('menu');
  requestAnimationFrame(loop);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
