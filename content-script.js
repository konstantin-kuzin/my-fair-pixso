const USER_PLUGINS_WRAP =
  '.user-plugins-wrap.el-scrollbar__wrap.el-scrollbar__wrap--hidden-default';

const EXPORT_PIX_SEL = '[command="export_pix"]';
const EXPORT_FILE_MENU_SEL = '[command="export_file_menu"]';

/** Классы вида plugin-dropdown-li-N-user, где N от 0 до 8 включительно */
function isTargetPluginRow(el) {
  if (!(el instanceof Element)) return false;
  if (!el.classList.contains('plugin-item')) return false;
  for (const c of el.classList) {
    const m = c.match(/^plugin-dropdown-li-(\d+)-user$/);
    if (m) {
      const n = Number(m[1], 10);
      return n >= 0 && n <= 8;
    }
  }
  return false;
}

function getUserPluginsWrap(root = document) {
  return (
    root.querySelector(USER_PLUGINS_WRAP) ||
    root.querySelector('.user-plugins-wrap.el-scrollbar__wrap') ||
    root.querySelector('.user-plugins-wrap')
  );
}

function removePinnedPluginItems(root = document) {
  const wrap = getUserPluginsWrap(root);
  if (!wrap) return;

  wrap.querySelectorAll('.plugin-item').forEach((el) => {
    if (isTargetPluginRow(el)) el.remove();
  });
}

let trimPluginsListEnabled = true;
let exportPixButtonEnabled = true;

async function loadFeatureFlags() {
  const d = await chrome.storage.local.get({
    trimPluginsListEnabled: true,
    exportPixButtonEnabled: true
  });
  trimPluginsListEnabled = d.trimPluginsListEnabled !== false;
  exportPixButtonEnabled = d.exportPixButtonEnabled !== false;
}

/** querySelector с обходом открытых shadowRoot (меню часто внутри веб-компонентов) */
function querySelectorDeep(root, selector) {
  if (!(root instanceof Node)) return null;
  const tryRoot = (r) => {
    if (
      !r ||
      (r.nodeType !== Node.ELEMENT_NODE &&
        r.nodeType !== Node.DOCUMENT_FRAGMENT_NODE)
    ) {
      return null;
    }
    if (
      r.nodeType === Node.ELEMENT_NODE &&
      r.matches &&
      r.matches(selector)
    ) {
      return r;
    }
    const el =
      r.nodeType === Node.ELEMENT_NODE
        ? r.querySelector(selector)
        : r.querySelector?.(selector);
    if (el) return el;
    const scope = r.querySelectorAll ? r : null;
    if (!scope) return null;
    const all = scope.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const node = all[i];
      if (node.shadowRoot) {
        const found = tryRoot(node.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  };
  return tryRoot(root);
}

/** Пункт .pix в разметке есть всегда, но скрыт до наведения на Export — смотрим видимость */
function isElementUsableForPointer(el) {
  if (!el || !(el instanceof Element)) return false;
  if (!el.getClientRects || el.getClientRects().length === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function hasExportPixVisible() {
  const el = querySelectorDeep(document.documentElement, EXPORT_PIX_SEL);
  if (!el || !(el instanceof Element) || el.closest('.px-cascader-item__disabled')) {
    return false;
  }
  return isElementUsableForPointer(el);
}

function getExportPixEl() {
  const el = querySelectorDeep(document.documentElement, EXPORT_PIX_SEL);
  if (!el || !(el instanceof Element)) return null;
  if (el.classList.contains('px-cascader-item__disabled')) return null;
  if (el.closest('.px-cascader-item__disabled')) return null;
  if (!isElementUsableForPointer(el)) return null;
  return el;
}

/** Цепочка pointer + mouse, как у реального клика (Vue/Canvas часто ожидают её) */
function simulateClickOnElement(el) {
  if (!(el instanceof Element)) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
  const ptrOpts = {
    ...opts,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1
  };
  try {
    el.dispatchEvent(new PointerEvent('pointerover', ptrOpts));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', ptrOpts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...ptrOpts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  } catch (_) {
    el.dispatchEvent(new MouseEvent('click', opts));
  }
  if (typeof el.click === 'function') el.click();
  return true;
}

/** Клик / hover в MAIN world через export.js */
function requestPageBridgeExportPix() {
  const send = () =>
    window.postMessage(
      { source: 'pixso-tuner', action: 'click-export-pix' },
      '*'
    );
  send();
  window.setTimeout(send, 0);
  window.setTimeout(send, 35);
  window.setTimeout(send, 90);
}

function requestPageBridgeHoverExportFileMenu() {
  const send = () =>
    window.postMessage(
      { source: 'pixso-tuner', action: 'hover-export-file-menu' },
      '*'
    );
  send();
  window.setTimeout(send, 0);
  window.setTimeout(send, 40);
}

function tryClickExportPix() {
  const el = getExportPixEl();
  if (el) simulateClickOnElement(el);
  requestPageBridgeExportPix();
  return !!el;
}

function ensureExportBridge() {
  if (document.querySelector('script[data-pixso-tuner-bridge]')) return;
  const s = document.createElement('script');
  s.dataset.pixsoTunerBridge = '1';
  s.src = chrome.runtime.getURL('export.js');
  (document.head || document.documentElement).appendChild(s);
}

/** Каскад Export открывается с наведения на строку с command="export_file_menu" */
function hoverExportFileMenuRow(row) {
  if (!row || row.classList.contains('px-cascader-item__disabled')) return false;
  const r = row.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const base = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
  row.dispatchEvent(new MouseEvent('mouseenter', { ...base, relatedTarget: document.body }));
  row.dispatchEvent(new MouseEvent('mouseover', base));
  row.dispatchEvent(new MouseEvent('mousemove', base));
  try {
    row.dispatchEvent(
      new PointerEvent('pointermove', {
        ...base,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      })
    );
  } catch (_) {}
  return true;
}

function tryOpenExportSubmenu() {
  const byFileMenu = querySelectorDeep(
    document.documentElement,
    `${EXPORT_FILE_MENU_SEL}:not(.px-cascader-item__disabled)`
  );
  if (byFileMenu && hoverExportFileMenuRow(byFileMenu)) {
    requestPageBridgeHoverExportFileMenu();
    return true;
  }

  const labels = document.querySelectorAll('.px-cascader-menu--label');
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const t = label.textContent.trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (
      lower === 'export' ||
      lower === 'экспорт' ||
      lower === '导出' ||
      lower === '匯出'
    ) {
      const row = label.closest('.px-cascader-item');
      if (row && hoverExportFileMenuRow(row)) {
        requestPageBridgeHoverExportFileMenu();
        return true;
      }
    }
  }
  return false;
}

/** Левый блок top bar: гамбургер / меню файла — только узкие селекторы, без «первой кнопки» в mid */
function tryOpenMainFileMenu() {
  const leftSelectors = [
    '.top-menu--left .px-icon-button',
    '.top-menu--left [class*="icon-button"]',
    '.editor-top-menu .top-menu--left .px-icon-button'
  ];
  for (let s = 0; s < leftSelectors.length; s++) {
    const el = document.querySelector(leftSelectors[s]);
    if (el && !el.closest('[data-pixso-tuner="export-pix"]')) {
      simulateClickOnElement(el);
      return true;
    }
  }
  const left = document.querySelector('.top-menu--left');
  if (left) {
    const btn = left.querySelector('button, [role="button"], .px-icon-button');
    if (btn && !btn.closest('[data-pixso-tuner="export-pix"]')) {
      simulateClickOnElement(btn);
      return true;
    }
  }
  return false;
}

function runExportPixFlow() {
  tryClickExportPix();

  if (!hasExportPixVisible()) {
    tryOpenMainFileMenu();
  }

  window.setTimeout(() => {
    tryClickExportPix();
    if (!hasExportPixVisible()) {
      tryOpenExportSubmenu();
    }

    window.setTimeout(() => {
      tryClickExportPix();
      tryOpenExportSubmenu();

      window.setTimeout(() => {
        let n = 0;
        const max = 90;
        const id = window.setInterval(() => {
          if (!hasExportPixVisible()) {
            tryOpenExportSubmenu();
            if (n % 14 === 7) {
              const row = querySelectorDeep(
                document.documentElement,
                `${EXPORT_FILE_MENU_SEL}:not(.px-cascader-item__disabled)`
              );
              if (row && typeof row.click === 'function') row.click();
              requestPageBridgeHoverExportFileMenu();
            }
          }
          tryClickExportPix();
          n += 1;
          if (n >= max) window.clearInterval(id);
        }, 50);
      }, 120);
    }, 180);
  }, 160);
}

const SAVE_SVG =
  '<svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path id="Vector 1" d="M22.6667 12.0027C25.5667 12.0187 27.1374 12.148 28.1614 13.172C29.3334 14.344 29.3334 16.2294 29.3334 20L29.3334 21.3334C29.3334 25.1054 29.3334 26.9907 28.1614 28.1627C26.9907 29.3334 25.1041 29.3334 21.3334 29.3334L10.6667 29.3334C6.89608 29.3334 5.00941 29.3334 3.83875 28.1627C2.66675 26.9894 2.66675 25.1054 2.66675 21.3334L2.66675 20C2.66675 16.2294 2.66675 14.344 3.83875 13.172C4.86275 12.148 6.43341 12.0187 9.33342 12.0027" fill-rule="nonzero" stroke="#000000" stroke-linecap="round" stroke-width="2.000000" /><path id="Vector 2" d="M16 2.66663L16 20M20 15.3333L16 20L12 15.3333" stroke="#000000" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.000000" />' +
  '</svg>';


function buildExportPixButton() {
  const wrap = document.createElement('div');
  wrap.className = 'top-menu--toolbar-item pixso-tuner-export-pix-wrap';
  wrap.setAttribute('data-pixso-tuner', 'export-pix');

  const toolbarItem = document.createElement('div');
  toolbarItem.className =
    'toolbar-item toolbar-item__left top-menu--toolbar-item__short';

  const inner = document.createElement('div');
  const pxBtn = document.createElement('div');
  pxBtn.className = 'px-icon-button flx__center';
  pxBtn.style.setProperty('--71dd7c8a', '32px');

  const iconWrap = document.createElement('div');
  iconWrap.className = 'px-icon-button-icon pixso-tuner-export-pix-btn';
  iconWrap.setAttribute('svg-inline', '');
  iconWrap.setAttribute(
    'content',
    '<span>Экспорт Pixso (.pix)</span>'
  );
  iconWrap.setAttribute('data-testid', 'pixso-tuner-export-pix');
  iconWrap.setAttribute('tabindex', '0');
  iconWrap.setAttribute('role', 'button');
  iconWrap.style.width = '32px';
  iconWrap.style.height = '32px';
  iconWrap.style.cursor = 'pointer';
  iconWrap.style.display = 'flex';
  iconWrap.style.alignItems = 'center';
  iconWrap.style.justifyContent = 'center';
  iconWrap.style.boxSizing = 'border-box';
  iconWrap.setAttribute(
    'title',
    'Экспорт: Pixso Design File (.pix). Если не сработало — откройте меню файла → Export, затем снова нажмите.'
  );
  iconWrap.innerHTML = SAVE_SVG;

  const onActivate = (e) => {
    e.preventDefault();
    e.stopPropagation();
    runExportPixFlow();
  };

  iconWrap.addEventListener('click', onActivate);
  iconWrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') onActivate(e);
  });

  pxBtn.appendChild(iconWrap);
  inner.appendChild(pxBtn);
  toolbarItem.appendChild(inner);
  wrap.appendChild(toolbarItem);
  return wrap;
}

function ensureExportPixButton() {
  const existing = document.querySelector('[data-pixso-tuner="export-pix"]');
  if (!exportPixButtonEnabled) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const slot = document.querySelector('.top-menu--center--tools');
  if (!slot) return;

  slot.appendChild(buildExportPixButton());
}

function onDomMutation() {
  if (trimPluginsListEnabled) {
    removePinnedPluginItems();
  }
  ensureExportPixButton();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'pixso-tuner-auto-export-pix') {
    runExportPixFlow();
    sendResponse({ ok: true });
  }
});

const EXPORT_PIX_ICON_STYLE_ID = 'pixso-tuner-export-pix-icon-style';

/** Центрирование иконки 20×20 в зоне 32×32: у Pixso у .px-icon-button-icon/svg часто absolute — сбивает выравнивание */
function ensureExportPixIconStyles() {
  if (document.getElementById(EXPORT_PIX_ICON_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = EXPORT_PIX_ICON_STYLE_ID;
  el.textContent =
    '.pixso-tuner-export-pix-btn{display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important}' +
    '.pixso-tuner-export-pix-btn svg{position:static!important;inset:auto!important;margin:0!important;flex-shrink:0}';
  document.documentElement.appendChild(el);
}

async function init() {
  await loadFeatureFlags();
  ensureExportBridge();
  ensureExportPixIconStyles();
  onDomMutation();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes.trimPluginsListEnabled && !changes.exportPixButtonEnabled) return;
    void loadFeatureFlags().then(() => onDomMutation());
  });

  const observer = new MutationObserver(() => {
    onDomMutation();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}
