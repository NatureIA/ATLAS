/* Theme preference is local to this browser; it does not affect financial data. */
(() => {
  'use strict';
  const key = 'atlas-ui-theme';
  const root = document.documentElement;
  const getCurrent = () => root.getAttribute('data-atlas-theme') === 'dark' ? 'dark' : 'light';
  const toggle = document.getElementById('atlasThemeToggle');
  if (!toggle) return;

  const apply = (value) => {
    const theme = value === 'dark' ? 'dark' : 'light';
    if (theme === 'dark') root.setAttribute('data-atlas-theme', 'dark');
    else root.removeAttribute('data-atlas-theme');
    toggle.setAttribute('aria-pressed', String(theme === 'dark'));
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
    const text = toggle.querySelector('.theme-toggle-text');
    const icon = toggle.querySelector('.theme-toggle-icon');
    const state = toggle.querySelector('.theme-toggle-state');
    if (text) text.textContent = theme === 'dark' ? 'Tema claro' : 'Tema escuro';
    if (icon) icon.textContent = theme === 'dark' ? '☀' : '☾';
    if (state) state.textContent = theme === 'dark' ? 'ESCURO' : 'CLARO';
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#030407' : '#6350e8');
  };
  apply(getCurrent());
  toggle.addEventListener('click', () => {
    const next = getCurrent() === 'dark' ? 'light' : 'dark';
    apply(next);
    try { window.localStorage.setItem(key, next); } catch (_) {}
  });
})();
