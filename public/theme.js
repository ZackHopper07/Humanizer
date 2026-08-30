/*
  NEUTRALIZE.AI — shared light/dark theme toggle
  ------------------------------------------------
  • Reads/writes the chosen theme from localStorage ('neutralize-theme').
  • Renders a moon/sun segmented control.
      – Mounts inside #themeToggle if that element exists (e.g. the nav).
      – Otherwise floats it in the top-right corner.
  • Pages set data-theme on <html> synchronously in <head> to avoid a flash;
    this script only builds the control and reacts to clicks.
*/
(function () {
  var STORAGE_KEY = 'neutralize-theme';

  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SUN  = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
    reflect(theme);
  }

  function reflect(theme) {
    var opts = document.querySelectorAll('.theme-toggle [data-set-theme]');
    for (var i = 0; i < opts.length; i++) {
      var active = opts[i].getAttribute('data-set-theme') === theme;
      opts[i].classList.toggle('is-active', active);
      opts[i].setAttribute('aria-pressed', String(active));
    }
  }

  function buildControl() {
    var wrap = document.createElement('div');
    wrap.className = 'theme-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Color theme');
    wrap.innerHTML =
      '<button type="button" class="theme-opt" data-set-theme="dark" aria-label="Dark mode" title="Dark mode">' + MOON + '</button>' +
      '<button type="button" class="theme-opt" data-set-theme="light" aria-label="Light mode" title="Light mode">' + SUN + '</button>';
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-set-theme]');
      if (btn) applyTheme(btn.getAttribute('data-set-theme'));
    });
    return wrap;
  }

  function injectStyle() {
    if (document.getElementById('theme-toggle-style')) return;
    var css =
      '.theme-toggle{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:10px;' +
        'background:var(--surface2,var(--surface-2,rgba(120,120,140,0.14)));' +
        'border:1px solid var(--border,rgba(120,120,140,0.3));line-height:0;box-sizing:border-box;}' +
      '.theme-toggle--floating{position:fixed;top:16px;right:16px;z-index:1000;' +
        'background:var(--surface,#13131a);box-shadow:0 6px 20px rgba(0,0,0,0.28);}' +
      '.theme-toggle .theme-opt{display:inline-flex;align-items:center;justify-content:center;' +
        'width:32px;height:26px;padding:0;border:none;background:transparent;border-radius:7px;cursor:pointer;' +
        'color:var(--text3,var(--muted,#9ca3af));transition:background .15s,color .15s;}' +
      '.theme-toggle .theme-opt svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;' +
        'stroke-linecap:round;stroke-linejoin:round;}' +
      '.theme-toggle .theme-opt:hover{color:var(--text,#e5e7eb);}' +
      '.theme-toggle .theme-opt.is-active{background:var(--surface,#fff);color:var(--accent,#7c6ef2);' +
        'box-shadow:0 1px 3px rgba(0,0,0,0.18);}';
    var style = document.createElement('style');
    style.id = 'theme-toggle-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function mount() {
    injectStyle();
    var control = buildControl();
    var target = document.getElementById('themeToggle');
    if (target) {
      target.appendChild(control);
    } else {
      control.classList.add('theme-toggle--floating');
      document.body.appendChild(control);
    }
    reflect(currentTheme());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
