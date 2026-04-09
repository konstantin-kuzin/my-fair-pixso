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
let autosaveFileKey = '';
let autosaveEnabledForFile = false;

async function loadFeatureFlags() {
  const d = await chrome.storage.local.get({
    trimPluginsListEnabled: true,
    exportPixButtonEnabled: true
  });
  trimPluginsListEnabled = d.trimPluginsListEnabled !== false;
  exportPixButtonEnabled = d.exportPixButtonEnabled !== false;
}

function extractFileKeyFromUrl(url) {
  if (typeof url !== 'string') return '';
  const m = url.match(/\/design\/([^/?#]+)/i);
  return m && m[1] ? m[1] : '';
}

function getCurrentFileKey() {
  return extractFileKeyFromUrl(String(location.href || ''));
}

function paintAutosaveToggleState() {
  const el = document.querySelector('[data-pixso-tuner="autosave-toggle"]');
  if (!(el instanceof HTMLElement)) return;
  el.setAttribute('aria-pressed', autosaveEnabledForFile ? 'true' : 'false');
  el.classList.toggle('pixso-tuner-autosave-enabled', autosaveEnabledForFile);
  el.setAttribute(
    'title',
    autosaveEnabledForFile
      ? 'Автосохранение включено для этого файла'
      : 'Автосохранение выключено для этого файла'
  );
}

async function refreshAutosaveStateFromStorage(force) {
  const nextKey = getCurrentFileKey();
  if (!nextKey) {
    autosaveFileKey = '';
    autosaveEnabledForFile = false;
    paintAutosaveToggleState();
    return;
  }
  if (!force && nextKey === autosaveFileKey) return;
  autosaveFileKey = nextKey;
  const data = await chrome.storage.local.get({ autosaveByFile: {} });
  const map =
    data && data.autosaveByFile && typeof data.autosaveByFile === 'object'
      ? data.autosaveByFile
      : {};
  autosaveEnabledForFile = map[autosaveFileKey] === true;
  paintAutosaveToggleState();
}

async function setAutosaveEnabledForCurrentFile(enabled) {
  const fileKey = getCurrentFileKey();
  if (!fileKey) return;
  const data = await chrome.storage.local.get({ autosaveByFile: {} });
  const map =
    data && data.autosaveByFile && typeof data.autosaveByFile === 'object'
      ? data.autosaveByFile
      : {};
  map[fileKey] = !!enabled;
  autosaveFileKey = fileKey;
  autosaveEnabledForFile = !!enabled;
  await chrome.storage.local.set({ autosaveByFile: map });
  paintAutosaveToggleState();
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

/** querySelectorAll с обходом открытых shadowRoot (модалки часто внутри веб-компонентов) */
function querySelectorAllDeep(root, selector) {
  const results = [];
  const seen = new Set();
  const visit = (r) => {
    if (!r || !r.querySelectorAll) return;
    let list;
    try {
      list = r.querySelectorAll(selector);
    } catch (_) {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (!seen.has(el)) {
        seen.add(el);
        results.push(el);
      }
    }
    const all = r.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const node = all[i];
      if (node.shadowRoot) visit(node.shadowRoot);
    }
  };
  visit(root);
  return results;
}

/**
 * Составной селектор `.library-publish-container .wrapper` не находит `.wrapper` внутри open shadow
 * (узлы за границей shadow не считаются потомками для querySelector снаружи).
 */
function collectLibraryPublishWrappers() {
  const containers = querySelectorAllDeep(
    document.documentElement,
    '.library-publish-container'
  );
  const wrappers = [];
  const seen = new Set();
  for (let i = 0; i < containers.length; i++) {
    const w = querySelectorDeep(containers[i], '.wrapper');
    if (
      w instanceof Element &&
      w.classList.contains('wrapper') &&
      !seen.has(w)
    ) {
      seen.add(w);
      wrappers.push(w);
    }
  }
  return wrappers;
}

/** closest() не переходит из shadow к host в некоторых цепочках — поднимаемся через getRootNode().host */
function closestLibraryPublishContainer(el) {
  if (!(el instanceof Element)) return null;
  const direct = el.closest('.library-publish-container');
  if (direct) return direct;
  let n = el;
  for (let d = 0; d < 32; d++) {
    const r = n.getRootNode();
    if (!r || r === document) return null;
    if (r instanceof ShadowRoot && r.host) {
      n = r.host;
      if (n.matches && n.matches('.library-publish-container')) return n;
      const up = n.closest && n.closest('.library-publish-container');
      if (up) return up;
      continue;
    }
    return null;
  }
  return null;
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

function requestPageBridgeClickExportFileMenu() {
  const send = () =>
    window.postMessage(
      { source: 'pixso-tuner', action: 'click-export-file-menu' },
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

function ensureExportBridge(onReady) {
  const cb = typeof onReady === 'function' ? onReady : null;
  let s = document.querySelector('script[data-pixso-tuner-bridge]');
  if (!s) {
    s = document.createElement('script');
    s.dataset.pixsoTunerBridge = '1';
    s.src = chrome.runtime.getURL('export.js');
    if (cb) s.addEventListener('load', cb, { once: true });
    (document.head || document.documentElement).appendChild(s);
    return;
  }
  if (cb) {
    let fired = false;
    const run = () => {
      if (fired) return;
      fired = true;
      cb();
    };
    if (s.getAttribute('data-pixso-bridge-loaded') === '1') {
      queueMicrotask(run);
    } else {
      s.addEventListener('load', run, { once: true });
      window.setTimeout(run, 1500);
    }
  }
}

/**
 * Клик по узлу модалки Publish в MAIN world (export.js). postMessage до load скрипта теряется;
 * проверка ev.source === window в мосте отсекала сообщения из isolated content script.
 */
function requestPageBridgeClickPublishCheckbox(el) {
  return new Promise((resolve) => {
    if (!(el instanceof Element)) {
      resolve();
      return;
    }
    const token =
      'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    el.setAttribute('data-pixso-tuner-pub', token);
    const origin =
      typeof location !== 'undefined' && location.origin ? location.origin : '*';
    const payload = {
      source: 'pixso-tuner',
      action: 'click-publish-checkbox',
      token
    };
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const burst = () => {
      const send = () => {
        try {
          window.postMessage(payload, origin);
        } catch (_) {
          window.postMessage(payload, '*');
        }
      };
      send();
      window.setTimeout(send, 0);
      window.setTimeout(send, 45);
      window.setTimeout(send, 160);
      window.setTimeout(done, 280);
    };
    ensureExportBridge(burst);
    window.setTimeout(done, 1200);
    window.setTimeout(() => {
      try {
        if (el.getAttribute('data-pixso-tuner-pub') === token) {
          el.removeAttribute('data-pixso-tuner-pub');
        }
      } catch (_) {}
    }, 1300);
  });
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

function clickExportFileMenuRow(row) {
  if (!row || row.classList.contains('px-cascader-item__disabled')) return false;
  let ok = simulateClickOnElement(row);
  const grid = row.querySelector('.px-cascader-menu--grid-container');
  if (grid instanceof Element) ok = simulateClickOnElement(grid) || ok;
  const label = row.querySelector('.px-cascader-menu--label-container');
  if (label instanceof Element) ok = simulateClickOnElement(label) || ok;
  if (typeof row.click === 'function') {
    row.click();
    ok = true;
  }
  return ok;
}

function tryOpenExportSubmenu() {
  const byFileMenu = querySelectorDeep(
    document.documentElement,
    `${EXPORT_FILE_MENU_SEL}:not(.px-cascader-item__disabled)`
  );
  if (byFileMenu) {
    const hovered = hoverExportFileMenuRow(byFileMenu);
    if (hovered) requestPageBridgeHoverExportFileMenu();
    const clicked = clickExportFileMenuRow(byFileMenu);
    if (clicked) requestPageBridgeClickExportFileMenu();
    return hovered || clicked;
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
      if (row) {
        const hovered = hoverExportFileMenuRow(row);
        if (hovered) requestPageBridgeHoverExportFileMenu();
        const clicked = clickExportFileMenuRow(row);
        if (clicked) requestPageBridgeClickExportFileMenu();
        return hovered || clicked;
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
  '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32.000000" height="32.000000" fill="none" aria-hidden="true">' +
  '<rect id="svg" width="32.000000" height="32.000000" x="0.000000" y="0.000000" />' +
  '<path id="Vector 25" d="M23.826 12.6626L18.2911 7.17236C18.2362 7.11768 18.1708 7.07471 18.0989 7.04492C18.027 7.01514 17.9499 7 17.8721 7L10.3837 7C10.1409 7 9.90222 7.06348 9.69189 7.18408C9.48157 7.3042 9.30688 7.47754 9.18542 7.68604C9.06396 7.89502 9 8.13184 9 8.37256L9 15.9512L10.186 15.9512L10.186 8.37256C10.186 8.33789 10.1952 8.3042 10.2125 8.27441C10.2299 8.24463 10.2549 8.21973 10.2849 8.20264C10.3149 8.18555 10.349 8.17627 10.3837 8.17627L17.279 8.17627L17.279 13.0786C17.279 13.1816 17.3065 13.2832 17.3585 13.3726C17.4105 13.4619 17.4855 13.5361 17.5756 13.5879C17.6658 13.6396 17.7679 13.6665 17.8721 13.6665L22.814 13.6665L22.814 23.6274C22.814 23.6621 22.8048 23.6958 22.7875 23.7256C22.7701 23.7554 22.7451 23.7803 22.7151 23.7974C22.685 23.8145 22.651 23.8237 22.6163 23.8237L17.6772 23.8237L17.6772 25L22.6163 25C22.8591 25 23.0978 24.9365 23.3081 24.8159C23.5184 24.6958 23.6931 24.5225 23.8146 24.314C23.936 24.105 24 23.8682 24 23.6274L24 13.0786C23.9999 13.001 23.9845 12.9248 23.9547 12.8535C23.9248 12.7822 23.8811 12.7173 23.826 12.6626ZM18.4651 9.00781L21.9758 12.4902L18.4651 12.4902L18.4651 9.00781ZM12.2374 16.7368C12.5175 16.7368 12.7374 16.957 12.7374 17.2368L12.7374 24.0896L15.0316 21.7949C15.279 21.5474 15.668 21.5474 15.9155 21.7949C16.163 22.0425 16.1631 22.4316 15.9155 22.6787L12.6793 25.9155Q12.5877 26.0071 12.4771 26.0529Q12.3667 26.0986 12.2373 26.0986C12.0648 26.0986 11.9175 26.0381 11.7954 25.916L8.55811 22.6787C8.31055 22.4312 8.31055 22.0425 8.55798 21.7949C8.80554 21.5474 9.19433 21.5474 9.44189 21.7949L11.7374 24.0901L11.7374 17.2368C11.7374 16.957 11.9574 16.7368 12.2374 16.7368Z" fill="#000000" fill-rule="evenodd" />' +
  '</svg>';


const AUTOSAVE_TOGGLE_SVG =
  '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32.000000" height="32.000000" fill="none" aria-hidden="true">' +
  '<rect id="svg" width="32.000000" height="32.000000" x="0.000000" y="0.000000" />' +
  '<path id="Vector 26" d="M23.826 12.6626L18.2911 7.17236C18.2362 7.11768 18.1708 7.07471 18.0989 7.04492C18.027 7.01514 17.95 7 17.8721 7L10.3837 7C10.1409 7 9.90222 7.06348 9.69189 7.18408C9.48157 7.3042 9.30688 7.47754 9.18542 7.68604C9.06396 7.89502 9 8.13184 9 8.37256L9 12.9512L10.186 12.9512L10.186 8.37256C10.186 8.33789 10.1952 8.3042 10.2125 8.27441C10.2299 8.24463 10.2549 8.21973 10.2849 8.20264C10.3149 8.18555 10.349 8.17627 10.3837 8.17627L17.2791 8.17627L17.2791 13.0786C17.2791 13.1816 17.3065 13.2832 17.3585 13.3726C17.4105 13.4619 17.4855 13.5361 17.5756 13.5879C17.6658 13.6396 17.7679 13.6665 17.8721 13.6665L22.814 13.6665L22.814 23.6274C22.814 23.6621 22.8048 23.6958 22.7875 23.7256C22.7701 23.7554 22.7451 23.7803 22.7151 23.7974C22.6851 23.8145 22.651 23.8237 22.6163 23.8237L20.6772 23.8237L20.6772 25L22.6163 25C22.8591 25 23.0978 24.9365 23.3081 24.8159C23.5184 24.6958 23.6931 24.5225 23.8146 24.314C23.936 24.105 24 23.8682 24 23.6274L24 13.0786C23.9999 13.001 23.9845 12.9248 23.9547 12.8535C23.9248 12.7822 23.8811 12.7173 23.826 12.6626ZM18.4651 9.00781L21.9758 12.4902L18.4651 12.4902L18.4651 9.00781ZM13.9261 24.4062C13.4255 24.4688 12.9357 24.4629 12.4564 24.3882Q11.5999 24.2549 10.7887 23.8286C10.2815 23.5625 9.83545 23.2358 9.45032 22.8481C9.08191 22.4771 8.76929 22.0508 8.5127 21.5684C8.22314 21.0244 8.03418 20.4648 7.9458 19.8901C7.87354 19.4194 7.86865 18.9385 7.93127 18.4473C8.00403 17.876 8.16077 17.3457 8.40173 16.8569C8.62305 16.4082 8.91528 15.9941 9.27856 15.6152C9.63171 15.2471 10.0211 14.9438 10.4469 14.7056C10.9353 14.4326 11.4716 14.2451 12.0558 14.1431C12.5498 14.0566 13.0365 14.0391 13.516 14.0898C14.0924 14.1509 14.6584 14.3105 15.214 14.5698C15.8413 14.8628 16.3811 15.2412 16.8331 15.7051C17.2458 16.1284 17.5854 16.623 17.8522 17.1885C18.158 17.8369 18.3269 18.4917 18.359 19.1533C18.3815 19.6163 18.3369 20.0823 18.2254 20.5516L19.7614 19.4185C20.0431 19.2109 20.4271 19.269 20.6343 19.5513C20.8413 19.8335 20.7828 20.2183 20.5012 20.4263L17.6919 22.4985C17.5543 22.6001 17.4011 22.6387 17.2322 22.6143C17.0632 22.5894 16.9272 22.5093 16.8242 22.373L14.7174 19.5845C14.5065 19.3057 14.5597 18.9199 14.8385 18.708C15.1172 18.4966 15.5021 18.5498 15.713 18.8286L16.9542 20.4712Q17.1331 19.8558 17.1091 19.249C17.0889 18.7358 16.9597 18.2266 16.7217 17.7217C16.5186 17.291 16.2603 16.9141 15.9469 16.5898C15.5957 16.2271 15.1753 15.9316 14.6857 15.7026C14.2488 15.499 13.8041 15.375 13.3517 15.3306C12.9962 15.2959 12.6359 15.3105 12.2708 15.3745C11.8212 15.4531 11.4095 15.5981 11.0358 15.8105C10.7245 15.9873 10.4396 16.2109 10.1809 16.4805C9.91284 16.7603 9.69629 17.0654 9.53137 17.3965C9.34668 17.7671 9.22656 18.1699 9.17126 18.605C9.12537 18.9653 9.12744 19.3184 9.17749 19.6646Q9.27509 20.3406 9.61621 20.9814C9.81238 21.3501 10.0511 21.6763 10.3326 21.9609C10.6306 22.2617 10.9762 22.5156 11.3696 22.7222C11.7948 22.9453 12.2316 23.0898 12.6801 23.1562C13.0365 23.209 13.4003 23.2124 13.7714 23.166C14.1188 23.1226 14.4257 23.3613 14.469 23.709C14.5123 24.0562 14.2736 24.3633 13.9261 24.4062Z" fill="#000000" fill-rule="evenodd" />' +
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

function buildAutosaveToggleButton() {
  const wrap = document.createElement('div');
  wrap.className = 'top-menu--toolbar-item pixso-tuner-autosave-wrap';
  wrap.setAttribute('data-pixso-tuner', 'autosave-toggle-wrap');

  const toolbarItem = document.createElement('div');
  toolbarItem.className =
    'toolbar-item toolbar-item__left top-menu--toolbar-item__short';

  const inner = document.createElement('div');
  const pxBtn = document.createElement('div');
  pxBtn.className = 'px-icon-button flx__center';
  pxBtn.style.setProperty('--71dd7c8a', '32px');

  const iconWrap = document.createElement('div');
  iconWrap.className = 'px-icon-button-icon pixso-tuner-autosave-toggle-btn';
  iconWrap.setAttribute('data-pixso-tuner', 'autosave-toggle');
  iconWrap.setAttribute('data-testid', 'pixso-tuner-autosave-toggle');
  iconWrap.setAttribute('tabindex', '0');
  iconWrap.setAttribute('role', 'button');
  iconWrap.style.width = '32px';
  iconWrap.style.height = '32px';
  iconWrap.style.cursor = 'pointer';
  iconWrap.style.display = 'flex';
  iconWrap.style.alignItems = 'center';
  iconWrap.style.justifyContent = 'center';
  iconWrap.style.boxSizing = 'border-box';
  iconWrap.innerHTML = AUTOSAVE_TOGGLE_SVG;

  const onActivate = (e) => {
    e.preventDefault();
    e.stopPropagation();
    void setAutosaveEnabledForCurrentFile(!autosaveEnabledForFile);
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

function ensureAutosaveToggleButton() {
  const existing = document.querySelector('[data-pixso-tuner="autosave-toggle-wrap"]');
  if (!exportPixButtonEnabled) {
    if (existing) existing.remove();
    return;
  }
  if (!existing) {
    const slot = document.querySelector('.top-menu--center--tools');
    const anchor = document.querySelector('[data-pixso-tuner="export-pix"]');
    if (!slot || !anchor) return;
    slot.insertBefore(buildAutosaveToggleButton(), anchor.nextSibling);
  }
  paintAutosaveToggleState();
}

function ensureExportPixButton() {
  const existing = document.querySelector('[data-pixso-tuner="export-pix"]');
  if (!exportPixButtonEnabled) {
    if (existing) existing.remove();
    const autosaveExisting = document.querySelector('[data-pixso-tuner="autosave-toggle-wrap"]');
    if (autosaveExisting) autosaveExisting.remove();
    return;
  }
  if (existing) {
    ensureAutosaveToggleButton();
    return;
  }

  const slot = document.querySelector('.top-menu--center--tools');
  if (!slot) return;

  slot.appendChild(buildExportPixButton());
  ensureAutosaveToggleButton();
}

/**
 * Раньше здесь убирали превью и поджимали строки — исходный список Pixso не трогаем.
 */
function relayoutLibraryPublishItems(_wrapper) {}

const PUBLISH_SORTED_UI_STYLE_ID = 'pixso-tuner-publish-sorted-ui';
const PUBLISH_SORTED_INLINE_ID = 'pixso-tuner-publish-sorted-inline';
const PUBLISH_SORTED_LEGACY_OVERLAY_ID = 'pixso-tuner-publish-sorted-overlay';
const PUBLISH_SORTED_HOST_CLASS = 'pixso-tuner-publish-sorted-host';
const PUBLISH_SCAN_BTN_ATTR = 'data-pixso-tuner-publish-scan';

function getLibraryPublishScrollElement(container) {
  if (!(container instanceof Element)) return null;
  return (
    container.querySelector('.container.scrollbar-s') ||
    container.querySelector('.container') ||
    container
  );
}

/** Порядок секций в панели (как в модалке Pixso) */
const LIBRARY_PUBLISH_GROUP_ORDER = ['Changes', 'Unchanged', 'Hide'];

function normalizePublishGroupTitle(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const low = s.toLowerCase();
  // Служебный заголовок списка, не группа Changes/Unchanged/Hide.
  if (
    /^components?$/i.test(s) ||
    /^компонент(ы|ов)?$/i.test(s) ||
    /^компоненты$/i.test(s)
  ) {
    return null;
  }
  if (low.includes('unchanged') || /без\s*измен|неизмен/i.test(s)) {
    return 'Unchanged';
  }
  if (/\bhide\b/i.test(s) || /\bскрыт/i.test(s)) {
    return 'Hide';
  }
  if (low.includes('change') || /^изменения$/i.test(s.trim()) || /^измен/i.test(s)) {
    return 'Changes';
  }
  return s.trim();
}

/** Только секция Changes — чекбоксы строк можно переключать; в Unchanged / Hide и пр. — заблокированы. */
function isLibraryPublishChangesSectionTitle(title) {
  return normalizePublishGroupTitle(title) === 'Changes';
}

/**
 * Заголовок секции Changes / Unchanged / Hide.
 * В Pixso группа — .item с header.publish-detail-header + .t-title-12 (не publish--detail--li__title:
 * тот класс у подписи колонки «Component»).
 */
function extractPublishSectionTitleFromItem(item) {
  if (!(item instanceof Element)) return null;
  const hdr =
    item.querySelector('header.publish-detail-header') ||
    item.querySelector('.publish-detail-header');
  if (hdr) {
    const titleEl = hdr.querySelector('.t-title-12') || hdr;
    const text = titleEl.textContent.replace(/\u200b/g, '').trim();
    const g = normalizePublishGroupTitle(text);
    if (g) return g;
  }
  const li = item.querySelector('.publish--detail--li');
  if (!li || !li.classList.contains('publish--detail--li__title')) return null;
  const inner =
    li.querySelector('.publish--deatil--li--title') ||
    li.querySelector('[class*="li--title"]') ||
    li;
  const text = (inner && inner.textContent ? inner.textContent : '').trim();
  return normalizePublishGroupTitle(text);
}

function normalizePublishComponentName(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\u200b/g, '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Для сортировки: убираем эмодзи/пиктограммы в строке (в Pixso метка «с иконкой» часто
 * задаётся символом 🛠️ в textContent), иначе localeCompare группирует все такие строки
 * отдельно от обычного текста.
 */
function normalizePublishSortKeyPlainText(s) {
  if (typeof s !== 'string') return '';
  let t = s.replace(/\p{Extended_Pictographic}/gu, '');
  t = t.replace(/[\uFE0F\u200D]/g, '');
  t = normalizePublishComponentName(t);
  if (t) return t;
  return normalizePublishComponentName(s);
}

function publishNamesEqual(a, b) {
  return normalizePublishComponentName(a) === normalizePublishComponentName(b);
}

/**
 * Текст для сортировки: из .name убираем svg/img и типичные обёртки иконок Pixso,
 * затем эмодзи в тексте — порядок только по буквенной подписи.
 */
function extractPublishSortKeyFromNameEl(nameEl) {
  if (!(nameEl instanceof Element)) return '';
  const clone = nameEl.cloneNode(true);
  clone
    .querySelectorAll(
      'svg, img, picture, canvas, .ed-svg-icon, [svg-inline], [icon-name], [class*="svg-icon"]'
    )
    .forEach((n) => {
      try {
        n.remove();
      } catch (_) {
        /* ignore */
      }
    });
  const key = normalizePublishSortKeyPlainText(clone.textContent || '');
  if (key) return key;
  return normalizePublishSortKeyPlainText(nameEl.textContent || '');
}

function extractPublishRowFromItem(item) {
  if (!(item instanceof Element)) return null;
  const li = item.querySelector('.publish--detail--li');
  if (!li || li.classList.contains('publish--detail--li__title')) return null;
  const nameEl =
    li.querySelector('.name.text__ellipsis') || li.querySelector('.name');
  const name = nameEl ? nameEl.textContent.trim() : '';
  if (!name) return null;
  const sortKey = extractPublishSortKeyFromNameEl(nameEl);
  const nameHtml = nameEl instanceof Element ? nameEl.innerHTML : '';
  const input =
    item.querySelector('input.px-checkbox--input') ||
    item.querySelector('input[type="checkbox"]');
  const checked = input ? !!input.checked : false;
  const statusEl = li.querySelector('.status');
  const status = statusEl ? statusEl.textContent.trim() : '';
  return { name, sortKey, nameHtml, checked, status };
}

function waitPublishScanFrames(n) {
  return new Promise((resolve) => {
    let i = 0;
    function tick() {
      if (i >= n) {
        resolve();
        return;
      }
      i += 1;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function mergePublishRowIntoGroup(groupsMap, groupKey, row) {
  if (!row || !groupKey) return;
  if (!groupsMap.has(groupKey)) {
    groupsMap.set(groupKey, new Map());
  }
  const g = groupsMap.get(groupKey);
  const prev = g.get(row.name);
  const sk =
    row.sortKey ||
    normalizePublishComponentName(row.name);
  if (!prev) {
    g.set(row.name, { ...row, sortKey: sk });
  } else {
    const listTop =
      typeof row.listTop === 'number' && Number.isFinite(row.listTop)
        ? row.listTop
        : prev.listTop;
    g.set(row.name, {
      name: row.name,
      sortKey: prev.sortKey || sk,
      nameHtml:
        (prev.nameHtml && String(prev.nameHtml).trim()) ||
        (row.nameHtml && String(row.nameHtml).trim()) ||
        '',
      checked: !!(prev.checked || row.checked),
      status: row.status || prev.status,
      listTop
    });
  }
}

/**
 * Виртуальный список задаёт вертикальную позицию строки через style.top (или translateY).
 * Сортируем все увиденные заголовки и строки по этому offset и применяем «последний заголовок
 * выше по списку» — иначе строки без видимого заголовка в кадре попадали в неверную группу.
 */
function parsePublishItemTopPx(item, wrapper) {
  if (!(item instanceof Element)) return NaN;
  const st = item.style && item.style.top;
  if (st && /px$/i.test(String(st).trim())) {
    const n = parseFloat(st);
    if (Number.isFinite(n)) return n;
  }
  const tr = item.style && item.style.transform;
  const m = tr && String(tr).match(/translateY\((-?[0-9.]+)p?x?\)/i);
  if (m) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n)) return n;
  }
  if (wrapper instanceof Element && item.parentElement === wrapper) {
    const n = item.offsetTop;
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/** Накапливает в recordMap записи { top, kind, group? | row } по ключам без коллизий */
function ingestPublishRecordsFromSnapshot(wrapper, recordMap) {
  const children = [...wrapper.children].filter(
    (el) => el.classList && el.classList.contains('item')
  );
  for (let i = 0; i < children.length; i++) {
    const item = children[i];
    const topPx = parsePublishItemTopPx(item, wrapper);
    if (!Number.isFinite(topPx)) continue;
    const topR = Math.round(topPx);

    const sec = extractPublishSectionTitleFromItem(item);
    if (sec) {
      recordMap.set(`s:${topR}`, { top: topR, kind: 'section', group: sec });
      continue;
    }
    const row = extractPublishRowFromItem(item);
    if (!row) continue;
    const key = `r:${topR}:${row.name}`;
    const prev = recordMap.get(key);
    if (!prev) {
      recordMap.set(key, { top: topR, kind: 'row', row: { ...row } });
    } else {
      prev.row.checked = !!(prev.row.checked || row.checked);
      if (row.status) prev.row.status = row.status;
      if (!prev.row.sortKey && row.sortKey) prev.row.sortKey = row.sortKey;
      if (
        (!prev.row.nameHtml || !String(prev.row.nameHtml).trim()) &&
        row.nameHtml &&
        String(row.nameHtml).trim()
      ) {
        prev.row.nameHtml = row.nameHtml;
      }
    }
  }
}

function finalizePublishGroupsFromRecords(recordMap) {
  const list = [...recordMap.values()].sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.kind !== b.kind) return a.kind === 'section' ? -1 : 1;
    return 0;
  });
  const groupsMap = new Map();
  let currentGroup = 'Changes';
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    if (rec.kind === 'section') {
      currentGroup = rec.group;
      continue;
    }
    mergePublishRowIntoGroup(groupsMap, currentGroup, {
      ...rec.row,
      listTop: rec.top
    });
  }
  return groupsMap;
}

function comparePublishRowsSortKey(a, b) {
  const rawA = (a && a.sortKey) || normalizePublishComponentName(a && a.name ? a.name : '');
  const rawB = (b && b.sortKey) || normalizePublishComponentName(b && b.name ? b.name : '');
  const ka = normalizePublishSortKeyPlainText(rawA);
  const kb = normalizePublishSortKeyPlainText(rawB);
  const c = ka.localeCompare(kb, undefined, { sensitivity: 'base', numeric: true });
  if (c !== 0) return c;
  const na = normalizePublishComponentName(a && a.name ? a.name : '');
  const nb = normalizePublishComponentName(b && b.name ? b.name : '');
  return na.localeCompare(nb, undefined, { sensitivity: 'base', numeric: true });
}

function publishGroupedMapsToSections(groupsMap) {
  const used = new Set();
  const sections = [];
  let total = 0;
  for (let gi = 0; gi < LIBRARY_PUBLISH_GROUP_ORDER.length; gi++) {
    const title = LIBRARY_PUBLISH_GROUP_ORDER[gi];
    if (!groupsMap.has(title)) continue;
    used.add(title);
    const rows = Array.from(groupsMap.get(title).values()).sort(comparePublishRowsSortKey);
    total += rows.length;
    sections.push({ title, rows });
  }
  for (const [title, gmap] of groupsMap) {
    if (used.has(title)) continue;
    const rows = Array.from(gmap.values()).sort(comparePublishRowsSortKey);
    total += rows.length;
    sections.push({ title, rows });
  }
  return { sections, total };
}

/**
 * Скролл + сбор строк; группа берётся из заголовков Changes / Unchanged / Hide.
 * Внутри каждой группы — сортировка по имени. Дедуп по паре (группа + имя).
 */
async function scanLibraryPublishRowsViaScroll(wrapper) {
  const empty = { sections: [], total: 0 };
  const container = closestLibraryPublishContainer(wrapper);
  if (!container || !(wrapper instanceof Element)) return empty;
  const scrollEl = getLibraryPublishScrollElement(container);
  if (!scrollEl) return empty;

  const savedTop = scrollEl.scrollTop;
  const recordMap = new Map();

  const stepPx = () =>
    Math.max(48, Math.floor(scrollEl.clientHeight * 0.75));

  const runIngest = () => ingestPublishRecordsFromSnapshot(wrapper, recordMap);

  markLibraryPublishListScrolling();
  libraryPublishScrollBusyUntil = Date.now() + 120000;

  scrollEl.scrollTop = 0;
  await waitPublishScanFrames(2);
  await new Promise((r) => setTimeout(r, 32));
  runIngest();

  for (let iter = 0; iter < 500; iter++) {
    runIngest();

    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    if (maxScroll <= 0) break;
    if (scrollEl.scrollTop >= maxScroll - 2) break;

    const before = scrollEl.scrollTop;
    const nextTop = Math.min(maxScroll, before + stepPx());
    scrollEl.scrollTop = nextTop;
    if (scrollEl.scrollTop === before) break;

    await waitPublishScanFrames(2);
    await new Promise((r) => setTimeout(r, 20));
  }

  scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  await waitPublishScanFrames(3);
  await new Promise((r) => setTimeout(r, 40));
  runIngest();

  scrollEl.scrollTop = savedTop;
  await waitPublishScanFrames(2);

  libraryPublishScrollBusyUntil = Date.now() + 400;

  const groupsMap = finalizePublishGroupsFromRecords(recordMap);
  return publishGroupedMapsToSections(groupsMap);
}

function ensurePublishSortedOverlayStyles() {
  let el = document.getElementById(PUBLISH_SORTED_UI_STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = PUBLISH_SORTED_UI_STYLE_ID;
    document.documentElement.appendChild(el);
  }
  el.textContent =
    '.' +
    PUBLISH_SORTED_HOST_CLASS +
    '{position:relative}' +
    '.library-publish-container.pixso-tuner-publish-sorted-active .' +
    PUBLISH_SORTED_HOST_CLASS +
    '>.wrapper{opacity:0!important;pointer-events:none!important}' +
    '.pixso-tuner-publish-sorted-panel{display:flex;flex-direction:column;min-height:0;font:12px/1.2 system-ui,-apple-system,sans-serif;color:#19191a;overscroll-behavior:contain;touch-action:manipulation;pointer-events:auto}' +
    '.pixso-tuner-publish-sorted-inline{position:sticky;top:0;left:0;right:0;width:100%;z-index:10;min-height:100%;max-height:100%;box-sizing:border-box;background:var(--color-bg,rgba(255,255,255,.98));flex-shrink:0}' +
    '.pixso-tuner-publish-sorted-overlay{position:fixed;z-index:2147483646;right:24px;top:80px;width:min(420px,calc(100vw - 48px));max-height:min(70vh,640px);background:var(--color-bg,rgba(255,255,255,.98));border:1px solid rgba(0,0,0,.12);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18)}' +
    '.pixso-tuner-publish-sorted-inline .pixso-tuner-publish-sorted-list{flex:1;min-height:0}' +
    '.pixso-tuner-publish-sorted-list{overflow:auto;padding:6px 0;overscroll-behavior:contain;touch-action:pan-y}' +
    '.pixso-tuner-publish-sorted-row{display:grid;grid-template-columns:12px 1fr auto;gap:8px;align-items:center;padding:4px 8px 4px 16px;}' +
    '.pixso-tuner-publish-sorted-cb{width:12px;height:12px;margin:0;cursor:pointer;flex-shrink:0}' +
    '.pixso-tuner-publish-sorted-cb:disabled{opacity:.45;cursor:not-allowed}' +
    '.pixso-tuner-publish-sorted-sec{font-size:12px;font-weight:600;padding:6px 16px;color:rgba(0,0,0,.55);}' +
    '.pixso-tuner-publish-sorted-st{font-size:12px;opacity:.65;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pixso-tuner-publish-sorted-name{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis}' +
    '.pixso-tuner-publish-sorted-name svg,.pixso-tuner-publish-sorted-name img{flex-shrink:0}' +
    '.library-publish-container .pixso-tuner-publish-scan-wrap{display:flex!important;align-items:center!important;padding:8px 16px 8px!important;box-sizing:border-box!important}' +
    '.library-publish-container .pixso-tuner-publish-scan-toggle{display:inline-flex!important;align-items:center!important;gap:8px!important;cursor:pointer!important;font:inherit!important;font-size:12px!important;color:inherit!important;user-select:none!important;margin:0!important;position:relative!important;box-sizing:border-box!important}' +
    '.library-publish-container .pixso-tuner-publish-scan-wrap input.pixso-tuner-publish-scan-toggle-input[type=checkbox]{' +
    'position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;' +
    'overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;opacity:0!important;' +
    'appearance:none!important;-webkit-appearance:none!important;pointer-events:none!important}' +
    '.library-publish-container .pixso-tuner-publish-scan-switch{' +
    'position:relative!important;display:block!important;width:24px!important;height:12px!important;flex-shrink:0!important;' +
    'border-radius:8px!important;background:rgba(0,0,0,.22)!important;transition:background .15s ease!important;' +
    'pointer-events:none!important;box-sizing:border-box!important;margin:0!important;padding:0!important;border:0!important}' +
    '.library-publish-container .pixso-tuner-publish-scan-switch-knob{' +
    'position:absolute!important;display:block!important;width:10px!important;height:10px!important;border-radius:50%!important;' +
    'background:#fff!important;top:1px!important;left:1px!important;box-shadow:0 1px 2px rgba(0,0,0,.2)!important;' +
    'transition:transform .15s ease!important;margin:0!important}' +
    '.library-publish-container .pixso-tuner-publish-scan-toggle-input:checked+.pixso-tuner-publish-scan-switch{background:var(--color-bg-switch-brand-normal)!important}' +
    '.library-publish-container .pixso-tuner-publish-scan-toggle-input:checked+.pixso-tuner-publish-scan-switch .pixso-tuner-publish-scan-switch-knob{transform:translateX(12px)!important}' +
    '.library-publish-container .pixso-tuner-publish-scan-toggle-input:disabled+.pixso-tuner-publish-scan-switch{opacity:.6!important;cursor:wait!important}' +
    '.library-publish-container .pixso-tuner-publish-scan-toggle:has(.pixso-tuner-publish-scan-toggle-input:focus-visible) .pixso-tuner-publish-scan-switch{box-shadow:0 0 0 2px var(--color-bg-switch-brand-normal)!important}' +
    '.library-publish-container .pixso-tuner-publish-scan-toggle-text{line-height:1.2!important}';
}

/**
 * Не даём wheel/touchmove уйти на canvas Pixso: всплытие режем на корне,
 * а на прокручиваемом списке — preventDefault + ручной scrollTop (иначе часть
 * приложений ловит wheel на window раньше всплытия).
 */
function attachPublishSortedOverlayScrollIsolation(root, scrollListEl) {
  if (!(root instanceof Element)) return;
  const stop = (e) => {
    e.stopPropagation();
  };
  root.addEventListener('wheel', stop, { passive: true });
  root.addEventListener('touchmove', stop, { passive: true });

  if (scrollListEl instanceof Element) {
    scrollListEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        scrollListEl.scrollTop += e.deltaY;
      },
      { passive: false }
    );
  }
}

/**
 * Среди смонтированных .item ищет строку по имени. Несколько совпадений —
 * ближайший style.top к listTopHint из скана.
 */
function findPublishRowItemForName(wrapper, name, listTopHint) {
  if (!(wrapper instanceof Element) || !name) return null;
  const want = normalizePublishComponentName(name);
  if (!want) return null;
  const children = [...wrapper.children].filter(
    (el) => el.classList && el.classList.contains('item')
  );
  const candidates = [];
  for (let i = 0; i < children.length; i++) {
    const item = children[i];
    const row = extractPublishRowFromItem(item);
    if (!row || !publishNamesEqual(row.name, name)) continue;
    const input =
      item.querySelector('input.px-checkbox--input') ||
      item.querySelector('input[type="checkbox"]');
    if (!input) continue;
    const topPx = parsePublishItemTopPx(item, wrapper);
    candidates.push({
      item,
      topPx: Number.isFinite(topPx) ? topPx : NaN
    });
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].item;
  if (
    typeof listTopHint === 'number' &&
    Number.isFinite(listTopHint) &&
    candidates.some((c) => Number.isFinite(c.topPx))
  ) {
    candidates.sort((a, b) => {
      const da = Number.isFinite(a.topPx)
        ? Math.abs(a.topPx - listTopHint)
        : 1e12;
      const db = Number.isFinite(b.topPx)
        ? Math.abs(b.topPx - listTopHint)
        : 1e12;
      return da - db;
    });
    return candidates[0].item;
  }
  return candidates[0].item;
}

/**
 * Доводим чекбокс в модалке до wantChecked: клик через MAIN world (export.js),
 * затем запасной input.click / simulate из content script.
 */
async function activatePublishRowCheckboxUntil(
  wrapper,
  name,
  listTopHint,
  wantChecked
) {
  const rowMatches = async () => {
    const item = findPublishRowItemForName(wrapper, name, listTopHint);
    if (!item) return false;
    const inp =
      item.querySelector('input.px-checkbox--input') ||
      item.querySelector('input[type="checkbox"]');
    return !!(inp && inp.checked === wantChecked);
  };

  const waitAfterClick = async () => {
    await waitPublishScanFrames(4);
    await new Promise((r) => setTimeout(r, 120));
  };

  if (await rowMatches()) return true;

  const item = findPublishRowItemForName(wrapper, name, listTopHint);
  if (!item) return false;
  const input =
    item.querySelector('input.px-checkbox--input') ||
    item.querySelector('input[type="checkbox"]');
  const wrap =
    item.querySelector('.flex-align-center.px-checkbox') ||
    item.querySelector('.px-checkbox');
  const icon = item.querySelector('.px-checkbox--icon');

  if (input instanceof HTMLElement) {
    await requestPageBridgeClickPublishCheckbox(input);
    await waitAfterClick();
    if (await rowMatches()) return true;
  }

  if (wrap instanceof Element && isElementUsableForPointer(wrap)) {
    await requestPageBridgeClickPublishCheckbox(wrap);
    await waitAfterClick();
    if (await rowMatches()) return true;
  }

  if (icon instanceof Element && isElementUsableForPointer(icon)) {
    await requestPageBridgeClickPublishCheckbox(icon);
    await waitAfterClick();
    if (await rowMatches()) return true;
  }

  if (input instanceof HTMLElement) {
    try {
      input.focus({ preventScroll: true });
    } catch (_) {}
    input.click();
    await waitAfterClick();
    if (await rowMatches()) return true;
  }

  if (wrap instanceof Element && isElementUsableForPointer(wrap)) {
    simulateClickOnElement(wrap);
    await waitAfterClick();
    if (await rowMatches()) return true;
  }

  if (icon instanceof Element && isElementUsableForPointer(icon)) {
    simulateClickOnElement(icon);
    await waitAfterClick();
    if (await rowMatches()) return true;
  }

  return false;
}

function scrollPublishListToOffset(scrollEl, listTopHint, mode) {
  if (!(scrollEl instanceof Element)) return;
  if (typeof listTopHint !== 'number' || !Number.isFinite(listTopHint)) return;
  const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  const ch = scrollEl.clientHeight || 400;
  let delta = Math.floor(ch / 4);
  if (mode === 'center') delta = Math.floor(ch / 2);
  else if (mode === 'top') delta = 8;
  else if (mode === 'exact') delta = 0;
  const target = Math.max(0, Math.min(maxScroll, listTopHint - delta));
  scrollEl.scrollTop = target;
}

async function waitForPublishScrollIdle(maxMs) {
  const cap = Math.min(typeof maxMs === 'number' ? maxMs : 2500, 2500);
  const t0 = Date.now();
  while (Date.now() - t0 < cap && isLibraryPublishListScrollBusy()) {
    await new Promise((r) => setTimeout(r, 32));
  }
}

/**
 * Включает/выключает чекбокс в модалке для той же строки, что в оверлее.
 * wantChecked — целевое состояние после клика в оверлее (проверяем по реальному input).
 */
async function togglePublishModalCheckboxByName(name, listTopHint, wantChecked) {
  const wrappers = collectLibraryPublishWrappers();
  const wrapper = wrappers[0];
  if (!(wrapper instanceof Element) || !name) return false;
  if (typeof wantChecked !== 'boolean') return false;

  await waitForPublishScrollIdle(2500);

  const container = closestLibraryPublishContainer(wrapper);
  const scrollEl = getLibraryPublishScrollElement(container || wrapper);
  if (!(scrollEl instanceof Element)) return false;

  const savedTop = scrollEl.scrollTop;
  const stepPx = () =>
    Math.max(48, Math.floor(scrollEl.clientHeight * 0.75));
  const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);

  const tryActivate = async () =>
    activatePublishRowCheckboxUntil(wrapper, name, listTopHint, wantChecked);

  // Уже смонтировано — клик без сдвига прокрутки (частый случай)
  if (await tryActivate()) {
    await waitPublishScanFrames(1);
    markLibraryPublishListScrolling();
    return true;
  }

  // Сначала прыжок к координате из скана, не к scrollTop = 0
  if (typeof listTopHint === 'number' && Number.isFinite(listTopHint)) {
    const hintModes = [undefined, 'center', 'top', 'exact'];
    for (let hi = 0; hi < hintModes.length; hi++) {
      scrollPublishListToOffset(scrollEl, listTopHint, hintModes[hi]);
      await waitPublishScanFrames(2);
      await new Promise((r) => setTimeout(r, 28));
      if (await tryActivate()) {
        scrollEl.scrollTop = savedTop;
        await waitPublishScanFrames(1);
        await new Promise((r) => setTimeout(r, 24));
        markLibraryPublishListScrolling();
        return true;
      }
    }
  }

  // Резерв: пошаговый обход (listTop неизвестен или строка ещё не в DOM)
  scrollEl.scrollTop = 0;
  await waitPublishScanFrames(1);
  await new Promise((r) => setTimeout(r, 24));

  for (let iter = 0; iter < 600; iter++) {
    if (await tryActivate()) {
      scrollEl.scrollTop = savedTop;
      await waitPublishScanFrames(1);
      await new Promise((r) => setTimeout(r, 32));
      markLibraryPublishListScrolling();
      return true;
    }
    if (maxScroll <= 0) break;
    if (scrollEl.scrollTop >= maxScroll - 1) break;
    const before = scrollEl.scrollTop;
    scrollEl.scrollTop = Math.min(maxScroll, before + stepPx());
    if (scrollEl.scrollTop === before) break;
    await waitPublishScanFrames(1);
    await new Promise((r) => setTimeout(r, 16));
  }

  scrollEl.scrollTop = savedTop;
  await waitPublishScanFrames(1);
  markLibraryPublishListScrolling();
  return false;
}

function clearPublishSortedActiveClass() {
  const nodes = querySelectorAllDeep(
    document.documentElement,
    '.library-publish-container'
  );
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].classList.remove('pixso-tuner-publish-sorted-active');
  }
}

/** Vue мог снять #inline при смене состава — иначе active гасит .wrapper без оверлея */
function clearPublishSortedActiveIfPanelMissing() {
  if (!documentHasLibraryPublishModal()) return;
  if (getPublishSortedInlinePanel()) return;
  if (
    querySelectorDeep(
      document.documentElement,
      '.library-publish-container.pixso-tuner-publish-sorted-active'
    )
  ) {
    clearPublishSortedActiveClass();
  }
}

/**
 * document.getElementById не находит узлы внутри open shadow — панель вставляется в scroll внутри модалки.
 */
function getPublishSortedInlinePanel() {
  return querySelectorDeep(
    document.documentElement,
    '#' + PUBLISH_SORTED_INLINE_ID
  );
}

/**
 * При всплытии из shadow event.target может быть retarget на host — ищем input в composedPath().
 */
function resolveFooterGroupCheckboxInputFromEvent(e) {
  if (e.target instanceof HTMLInputElement && e.target.type === 'checkbox') {
    const box = e.target.closest('.library-publish-container_checkbox');
    if (box && closestLibraryPublishContainer(e.target)) {
      return e.target;
    }
  }
  const path =
    typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    if (!(node instanceof Element)) continue;
    const box = node.closest('.library-publish-container_checkbox');
    if (!box) continue;
    if (!closestLibraryPublishContainer(node)) continue;
    const inp =
      box.querySelector('input.px-checkbox--input[type="checkbox"]') ||
      box.querySelector('input[type="checkbox"]');
    if (inp instanceof HTMLInputElement) return inp;
  }
  return null;
}

/** Синхронизация с футерным групповым чекбоксом (148/148): без вызова toggle на каждую строку */
function setPublishSortedCheckboxesAll(wantChecked) {
  const panel = getPublishSortedInlinePanel();
  if (!panel) return;
  publishSortedBulkSyncFromMaster = true;
  try {
    panel
      .querySelectorAll('input.pixso-tuner-publish-sorted-cb[type="checkbox"]')
      .forEach((inp) => {
        if (!inp.disabled) inp.checked = wantChecked;
      });
  } finally {
    queueMicrotask(() => {
      publishSortedBulkSyncFromMaster = false;
    });
  }
}

/**
 * Модалка открыта и либо панель на месте, либо «зависший» active без узла (Vue снял #inline при скролле скана).
 */
function publishSortedFooterRescanStillNeeded() {
  if (!documentHasLibraryPublishModal()) return false;
  if (getPublishSortedInlinePanel()) return true;
  return !!querySelectorDeep(
    document.documentElement,
    '.library-publish-container.pixso-tuner-publish-sorted-active'
  );
}

/**
 * Групповой чекбокс обновляет только виртуальный список Vue — данные оверлея из прошлого скана устаревают.
 * Тот же проход, что у кнопки «Нормально покажи»: скролл + ingest + render.
 */
function schedulePublishSortedOverlayFullRescanFromFooter() {
  if (!getPublishSortedInlinePanel()) return;
  const wrappers = collectLibraryPublishWrappers();
  const w = wrappers[0];
  if (!w) return;
  if (publishSortedFooterRescanTimer) {
    window.clearTimeout(publishSortedFooterRescanTimer);
  }
  publishSortedFooterRescanTimer = window.setTimeout(() => {
    publishSortedFooterRescanTimer = 0;
    if (!publishSortedFooterRescanStillNeeded()) return;
    const w2 = collectLibraryPublishWrappers()[0];
    if (!w2) {
      clearPublishSortedActiveClass();
      return;
    }
    void (async () => {
      try {
        const bundle = await scanLibraryPublishRowsViaScroll(w2);
        if (!documentHasLibraryPublishModal()) return;
        renderPublishSortedOverlay(bundle);
      } catch (_) {
        clearPublishSortedActiveClass();
      }
    })();
  }, 120);
}

function removePublishSortedOverlay() {
  if (publishSortedFooterRescanTimer) {
    window.clearTimeout(publishSortedFooterRescanTimer);
    publishSortedFooterRescanTimer = 0;
  }
  const inline = getPublishSortedInlinePanel();
  if (inline) inline.remove();
  const legacy = document.getElementById(PUBLISH_SORTED_LEGACY_OVERLAY_ID);
  if (legacy) legacy.remove();
  const hosts = querySelectorAllDeep(
    document.documentElement,
    '.' + PUBLISH_SORTED_HOST_CLASS
  );
  for (let i = 0; i < hosts.length; i++) {
    hosts[i].classList.remove(PUBLISH_SORTED_HOST_CLASS);
  }
  clearPublishSortedActiveClass();
}

function renderPublishSortedOverlay(bundle) {
  const sections = bundle && bundle.sections ? bundle.sections : [];

  ensurePublishSortedOverlayStyles();
  removePublishSortedOverlay();

  const root = document.createElement('div');
  root.className = 'pixso-tuner-publish-sorted-panel';

  const list = document.createElement('div');
  list.className = 'pixso-tuner-publish-sorted-list';
  for (let s = 0; s < sections.length; s++) {
    const block = sections[s];
    const secEl = document.createElement('div');
    secEl.className = 'pixso-tuner-publish-sorted-sec';
    secEl.textContent = block.title;
    list.appendChild(secEl);
    const rows = block.rows || [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const row = document.createElement('div');
      row.className = 'pixso-tuner-publish-sorted-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'pixso-tuner-publish-sorted-cb';
      cb.checked = !!r.checked;
      cb.disabled = !isLibraryPublishChangesSectionTitle(block.title);
      cb.setAttribute('aria-label', `Публикация: ${r.name}`);
      let syncingFromRemote = false;
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        if (publishSortedBulkSyncFromMaster) return;
        if (syncingFromRemote) return;
        const wantChecked = cb.checked;
        void togglePublishModalCheckboxByName(r.name, r.listTop, wantChecked)
          .then((ok) => {
            if (!ok) {
              syncingFromRemote = true;
              cb.checked = !wantChecked;
              queueMicrotask(() => {
                syncingFromRemote = false;
              });
            }
          })
          .catch(() => {
            syncingFromRemote = true;
            cb.checked = !wantChecked;
            queueMicrotask(() => {
              syncingFromRemote = false;
            });
          });
      });
      const name = document.createElement('span');
      name.className = 'pixso-tuner-publish-sorted-name';
      if (r.nameHtml && String(r.nameHtml).trim()) {
        name.innerHTML = r.nameHtml;
      } else {
        name.textContent = r.name;
      }
      const st = document.createElement('span');
      st.className = 'pixso-tuner-publish-sorted-st';
      st.textContent = r.status || '';
      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(st);
      list.appendChild(row);
    }
  }
  root.appendChild(list);
  attachPublishSortedOverlayScrollIsolation(root, list);

  const wrappers = collectLibraryPublishWrappers();
  const w = wrappers[0];
  const pubContainer = w ? closestLibraryPublishContainer(w) : null;
  const scrollEl =
    pubContainer instanceof Element
      ? getLibraryPublishScrollElement(pubContainer)
      : null;

  if (scrollEl instanceof Element && pubContainer instanceof Element) {
    root.id = PUBLISH_SORTED_INLINE_ID;
    root.classList.add('pixso-tuner-publish-sorted-inline');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Список компонентов по группам');
    scrollEl.classList.add(PUBLISH_SORTED_HOST_CLASS);
    scrollEl.insertBefore(root, scrollEl.firstChild);
    pubContainer.classList.add('pixso-tuner-publish-sorted-active');
  } else {
    root.id = PUBLISH_SORTED_LEGACY_OVERLAY_ID;
    root.classList.add('pixso-tuner-publish-sorted-overlay');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Список компонентов по группам');
    document.documentElement.appendChild(root);
  }
}

function getPublishScanToggleInput() {
  const wrap = document.querySelector(`[${PUBLISH_SCAN_BTN_ATTR}]`);
  if (!wrap) return null;
  return wrap.querySelector('input.pixso-tuner-publish-scan-toggle-input');
}

function setPublishScanToggleChecked(checked) {
  const inp = getPublishScanToggleInput();
  if (inp instanceof HTMLInputElement) {
    inp.checked = !!checked;
    inp.setAttribute('aria-checked', inp.checked ? 'true' : 'false');
  }
}

function removePublishScanButton() {
  const b = document.querySelector(`[${PUBLISH_SCAN_BTN_ATTR}]`);
  if (b) b.remove();
}

function ensurePublishScanButton(container) {
  if (!(container instanceof Element)) return;
  if (container.querySelector(`[${PUBLISH_SCAN_BTN_ATTR}]`)) return;
  ensurePublishSortedOverlayStyles();
  const wrap = document.createElement('div');
  wrap.className = 'pixso-tuner-publish-scan-wrap';
  wrap.setAttribute(PUBLISH_SCAN_BTN_ATTR, '');
  const label = document.createElement('label');
  label.className = 'pixso-tuner-publish-scan-toggle';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.className = 'pixso-tuner-publish-scan-toggle-input';
  toggleInput.setAttribute('role', 'switch');
  toggleInput.setAttribute('aria-label', 'Сортированный список публикации');
  const track = document.createElement('span');
  track.className = 'pixso-tuner-publish-scan-switch';
  track.setAttribute('aria-hidden', 'true');
  const knob = document.createElement('span');
  knob.className = 'pixso-tuner-publish-scan-switch-knob';
  track.appendChild(knob);
  const text = document.createElement('span');
  text.className = 'pixso-tuner-publish-scan-toggle-text';
  text.textContent = 'Pumped-up view';
  label.appendChild(toggleInput);
  label.appendChild(track);
  label.appendChild(text);

  const syncSwitchAria = () => {
    toggleInput.setAttribute('aria-checked', toggleInput.checked ? 'true' : 'false');
  };
  syncSwitchAria();
  toggleInput.addEventListener('change', syncSwitchAria);

  toggleInput.addEventListener('change', async () => {
    if (!toggleInput.checked) {
      removePublishSortedOverlay();
      return;
    }
    const wrappers = collectLibraryPublishWrappers();
    const w = wrappers[0];
    if (!w) {
      setPublishScanToggleChecked(false);
      return;
    }
    toggleInput.disabled = true;
    const prevLabel = text.textContent;
    text.textContent = 'Сканирование…';
    try {
      const rows = await scanLibraryPublishRowsViaScroll(w);
      renderPublishSortedOverlay(rows);
    } catch (_) {
      removePublishSortedOverlay();
      setPublishScanToggleChecked(false);
      text.textContent = 'Ошибка';
      window.setTimeout(() => {
        text.textContent = prevLabel;
      }, 1200);
      return;
    } finally {
      toggleInput.disabled = false;
      if (toggleInput.checked) text.textContent = prevLabel;
    }
  });

  wrap.appendChild(label);
  if (container.firstChild) {
    container.insertBefore(wrap, container.firstChild);
  } else {
    container.appendChild(wrap);
  }
}

function teardownPublishSortedUiIfModalClosed() {
  removePublishSortedOverlay();
  removePublishScanButton();
}

function ensureLibraryPublishScanUi() {
  const containers = querySelectorAllDeep(
    document.documentElement,
    '.library-publish-container'
  );
  if (containers.length === 0) return;
  ensurePublishScanButton(containers[0]);
}

let libraryPublishSortDebounce = 0;
let libraryPublishScrollIdleTimer = 0;
/** Пока идёт скролл списка, virtual list дергает childList — не запускаем проход очистки (иначе мигание) */
let libraryPublishScrollBusyUntil = 0;
let libraryPublishModalInDom = false;
/** true пока выставляем все чекбоксы оверлея по футерному «выбрать всё» */
let publishSortedBulkSyncFromMaster = false;
/** debounce полного перескана оверлея после группового чекбокса */
let publishSortedFooterRescanTimer = 0;
const libraryPublishWrapperObserved = new WeakSet();
const libraryPublishScrollObserved = new WeakSet();
const libraryPublishScrollPrevTop = new WeakMap();
let libraryPublishApplyTimeouts = [];

function documentHasLibraryPublishModal() {
  return (
    !!document.querySelector('.library-publish-container') ||
    !!querySelectorDeep(document.documentElement, '.library-publish-container')
  );
}

function cancelLibraryPublishApplyChain() {
  for (let i = 0; i < libraryPublishApplyTimeouts.length; i++) {
    window.clearTimeout(libraryPublishApplyTimeouts[i]);
  }
  libraryPublishApplyTimeouts = [];
}

function scheduleLibraryPublishApplyStep(fn, delayMs) {
  const id = window.setTimeout(() => {
    libraryPublishApplyTimeouts = libraryPublishApplyTimeouts.filter((t) => t !== id);
    fn();
  }, delayMs);
  libraryPublishApplyTimeouts.push(id);
}

/**
 * После остановки скролла: один «каркас» rAF + мало таймеров; хвост отменяется при новом скролле.
 * У верхней границы — дополнительные проходы (список дорисовывается с задержкой).
 */
function applyLibraryPublishSortAfterScrollIdle() {
  cancelLibraryPublishApplyChain();
  const run = () => sortAllLibraryPublishWrappers();

  run();
  window.requestAnimationFrame(() => {
    run();
    window.requestAnimationFrame(run);
  });
  scheduleLibraryPublishApplyStep(run, 100);
  scheduleLibraryPublishApplyStep(run, 260);

  const wraps = collectLibraryPublishWrappers();
  for (let w = 0; w < wraps.length; w++) {
    const c = closestLibraryPublishContainer(wraps[w]);
    if (!c) continue;
    const se =
      c.querySelector('.container.scrollbar-s') ||
      c.querySelector('.container') ||
      c;
    if (se instanceof Element && se.scrollTop < 18) {
      scheduleLibraryPublishApplyStep(run, 420);
      scheduleLibraryPublishApplyStep(run, 700);
      scheduleLibraryPublishApplyStep(run, 1000);
      break;
    }
  }
}

/** Явный возврат к началу списка (часто без доп. мутаций — отдельный добор проходов) */
function applyLibraryPublishSortNearTopEdge(scrollEl) {
  if (!(scrollEl instanceof Element) || scrollEl.scrollTop >= 20) return;
  cancelLibraryPublishApplyChain();
  const run = () => sortAllLibraryPublishWrappers();
  run();
  window.requestAnimationFrame(() => run());
  scheduleLibraryPublishApplyStep(run, 80);
  scheduleLibraryPublishApplyStep(run, 220);
  scheduleLibraryPublishApplyStep(run, 480);
  scheduleLibraryPublishApplyStep(run, 800);
}

function markLibraryPublishListScrolling() {
  libraryPublishScrollBusyUntil = Date.now() + 450;
}

function isLibraryPublishListScrollBusy() {
  return Date.now() < libraryPublishScrollBusyUntil;
}

/** После паузы скролла / scrollend — добор проходов удаления превью (без перестановки DOM) */
function ensureLibraryPublishScrollListener(wrapper) {
  const container = closestLibraryPublishContainer(wrapper);
  if (!container) return;
  const scrollEl =
    container.querySelector('.container.scrollbar-s') ||
    container.querySelector('.container') ||
    container;
  if (!(scrollEl instanceof Element) || libraryPublishScrollObserved.has(scrollEl)) {
    return;
  }
  libraryPublishScrollObserved.add(scrollEl);
  const onScroll = () => {
    cancelLibraryPublishApplyChain();
    markLibraryPublishListScrolling();
    const st = scrollEl.scrollTop;
    const prev = libraryPublishScrollPrevTop.get(scrollEl);
    libraryPublishScrollPrevTop.set(scrollEl, st);
    if (typeof prev === 'number' && prev >= 18 && st < 12) {
      window.requestAnimationFrame(() => applyLibraryPublishSortNearTopEdge(scrollEl));
    }
    if (libraryPublishScrollIdleTimer) {
      window.clearTimeout(libraryPublishScrollIdleTimer);
    }
    libraryPublishScrollIdleTimer = window.setTimeout(() => {
      libraryPublishScrollIdleTimer = 0;
      applyLibraryPublishSortAfterScrollIdle();
    }, 220);
  };
  scrollEl.addEventListener('scroll', onScroll, { passive: true, capture: false });
  scrollEl.addEventListener(
    'scrollend',
    () => {
      if (libraryPublishScrollIdleTimer) {
        window.clearTimeout(libraryPublishScrollIdleTimer);
        libraryPublishScrollIdleTimer = 0;
      }
      window.setTimeout(() => {
        if (scrollEl.scrollTop < 18) {
          applyLibraryPublishSortNearTopEdge(scrollEl);
        } else {
          applyLibraryPublishSortAfterScrollIdle();
        }
      }, 0);
    },
    { passive: true }
  );
}

/** Смена состава строк; во время скролла игнорируем — иначе снова дергается список */
function ensureLibraryPublishWrapperObserver(wrapper) {
  if (!(wrapper instanceof Element) || libraryPublishWrapperObserved.has(wrapper)) {
    return;
  }
  libraryPublishWrapperObserved.add(wrapper);
  const obs = new MutationObserver(() => {
    if (isLibraryPublishListScrollBusy()) return;
    scheduleSortLibraryPublishModal();
  });
  obs.observe(wrapper, { childList: true });
}

function sortAllLibraryPublishWrappers() {
  sortLibraryPublishWrappersList(collectLibraryPublishWrappers());
}

function sortLibraryPublishWrappersList(wrappers) {
  for (let i = 0; i < wrappers.length; i++) {
    const w = wrappers[i];
    ensureLibraryPublishWrapperObserver(w);
    ensureLibraryPublishScrollListener(w);
    try {
      sortLibraryPublishWrapper(w);
    } catch (_) {
      /* ignore */
    }
  }
}

function sortLibraryPublishWrapper(wrapper) {
  if (!(wrapper instanceof Element)) return;
  relayoutLibraryPublishItems(wrapper);
}

/** Отложенный проход после мутаций wrapper (удаление превью-блоков). Без проверки scrollBusy — иначе редко срабатывает. */
function scheduleSortLibraryPublishModal() {
  if (libraryPublishSortDebounce) {
    window.clearTimeout(libraryPublishSortDebounce);
  }
  libraryPublishSortDebounce = window.setTimeout(() => {
    libraryPublishSortDebounce = 0;
    const run = () => sortAllLibraryPublishWrappers();
    run();
    window.requestAnimationFrame(run);
    window.setTimeout(run, 48);
  }, 120);
}

/** Первое открытие модалки / явное обновление — несколько проходов, не блокируется скроллом */
function scheduleSortLibraryPublishModalForced() {
  if (libraryPublishSortDebounce) {
    window.clearTimeout(libraryPublishSortDebounce);
  }
  libraryPublishSortDebounce = window.setTimeout(() => {
    libraryPublishSortDebounce = 0;
    const run = () => sortAllLibraryPublishWrappers();
    run();
    window.requestAnimationFrame(() => {
      run();
      window.requestAnimationFrame(run);
    });
    window.setTimeout(run, 48);
    window.setTimeout(run, 180);
    window.setTimeout(run, 400);
  }, 40);
}

function onDomMutation() {
  if (trimPluginsListEnabled) {
    removePinnedPluginItems();
  }
  ensureExportPixButton();
  void refreshAutosaveStateFromStorage(false);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'pixso-tuner-auto-export-pix') {
    runExportPixFlow();
    sendResponse({ ok: true });
  }
});

const EXPORT_PIX_ICON_STYLE_ID = 'pixso-tuner-export-pix-icon-style';
/** Старый id стилей, скрывавших превью — удаляем узел, если остался после обновления расширения. */
const PUBLISH_HIDE_IMAGE_BOX_STYLE_ID = 'pixso-tuner-hide-publish-li-image-box';
const PUBLISH_DESCRIPTION_INPUT_STYLE_ID = 'pixso-tuner-publish-description-input-margin';

/** Центрирование иконки 20×20 в зоне 32×32: у Pixso у .px-icon-button-icon/svg часто absolute — сбивает выравнивание */
function ensureExportPixIconStyles() {
  if (document.getElementById(EXPORT_PIX_ICON_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = EXPORT_PIX_ICON_STYLE_ID;
  el.textContent =
    '.pixso-tuner-export-pix-wrap,.pixso-tuner-autosave-wrap{margin-right:6px!important}' +
    '.pixso-tuner-export-pix-btn{display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important}' +
    '.pixso-tuner-export-pix-btn svg{position:static!important;inset:auto!important;margin:0!important;flex-shrink:0}' +
    '.pixso-tuner-autosave-toggle-btn{display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;border-radius:6px!important}' +
    '.pixso-tuner-autosave-toggle-btn svg{position:static!important;inset:auto!important;margin:0!important;flex-shrink:0}' +
    '.pixso-tuner-autosave-toggle-btn.pixso-tuner-autosave-enabled{background:rgba(41,98,255,.12)!important}';
  document.documentElement.appendChild(el);
}

function removeLegacyPublishListOverrideStyles() {
  const el = document.getElementById(PUBLISH_HIDE_IMAGE_BOX_STYLE_ID);
  if (el) el.remove();
}

/** Поле Description в модалке Publish — margin как в макете. */
function ensurePublishDescriptionInputStyles() {
  let el = document.getElementById(PUBLISH_DESCRIPTION_INPUT_STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = PUBLISH_DESCRIPTION_INPUT_STYLE_ID;
    document.documentElement.appendChild(el);
  }
  el.textContent =
    '.library-publish-container textarea.publish--input{margin:4px 16px 0!important}';
}

let libraryPublishCheckboxRefreshTimer = 0;
let libraryPublishInteractionHooksInstalled = false;

/** После клика по чекбоксу Vue перерисовывает список — добор проходов сортировки обёртки */
function refreshLibraryPublishAfterListMutation() {
  clearPublishSortedActiveIfPanelMissing();
  sortAllLibraryPublishWrappers();
  window.requestAnimationFrame(() => sortAllLibraryPublishWrappers());
  scheduleSortLibraryPublishModalForced();
}

function scheduleLibraryPublishCheckboxRefresh() {
  if (libraryPublishCheckboxRefreshTimer) {
    window.clearTimeout(libraryPublishCheckboxRefreshTimer);
  }
  libraryPublishCheckboxRefreshTimer = window.setTimeout(() => {
    libraryPublishCheckboxRefreshTimer = 0;
    refreshLibraryPublishAfterListMutation();
  }, 16);
}

function ensureLibraryPublishInteractionHooks() {
  if (libraryPublishInteractionHooksInstalled) return;
  libraryPublishInteractionHooksInstalled = true;
  const inModal = (el) =>
    el instanceof Element && !!closestLibraryPublishContainer(el);
  document.addEventListener(
    'change',
    (e) => {
      const footerInp = resolveFooterGroupCheckboxInputFromEvent(e);
      if (
        footerInp &&
        getPublishSortedInlinePanel() &&
        closestLibraryPublishContainer(footerInp)
      ) {
        setPublishSortedCheckboxesAll(!!footerInp.checked);
        schedulePublishSortedOverlayFullRescanFromFooter();
      }
      const t = e.target;
      if (!(t instanceof Element) || !inModal(t)) return;
      if (t.matches('input[type="checkbox"]') || t.closest('.px-checkbox')) {
        scheduleLibraryPublishCheckboxRefresh();
      }
    },
    true
  );
  document.addEventListener(
    'input',
    (e) => {
      const footerInp = resolveFooterGroupCheckboxInputFromEvent(e);
      if (
        footerInp &&
        getPublishSortedInlinePanel() &&
        closestLibraryPublishContainer(footerInp)
      ) {
        setPublishSortedCheckboxesAll(!!footerInp.checked);
        schedulePublishSortedOverlayFullRescanFromFooter();
      }
    },
    true
  );
  document.addEventListener(
    'click',
    (e) => {
      const footerInp = resolveFooterGroupCheckboxInputFromEvent(e);
      if (
        footerInp &&
        getPublishSortedInlinePanel() &&
        closestLibraryPublishContainer(footerInp)
      ) {
        schedulePublishSortedOverlayFullRescanFromFooter();
      }
      const t = e.target;
      if (!(t instanceof Element) || !inModal(t)) return;
      if (t.closest('.px-checkbox') || t.matches('input[type="checkbox"]')) {
        scheduleLibraryPublishCheckboxRefresh();
      }
    },
    true
  );
}

async function init() {
  await loadFeatureFlags();
  await refreshAutosaveStateFromStorage(true);
  ensureExportBridge();
  ensureExportPixIconStyles();
  removeLegacyPublishListOverrideStyles();
  ensurePublishDescriptionInputStyles();
  ensureLibraryPublishInteractionHooks();
  onDomMutation();
  libraryPublishModalInDom = documentHasLibraryPublishModal();
  if (libraryPublishModalInDom) {
    scheduleSortLibraryPublishModalForced();
    ensureLibraryPublishScanUi();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.autosaveByFile) {
      void refreshAutosaveStateFromStorage(true);
    }
    if (!changes.trimPluginsListEnabled && !changes.exportPixButtonEnabled) return;
    void loadFeatureFlags().then(() => onDomMutation());
  });

  const observer = new MutationObserver(() => {
    onDomMutation();
    const has = documentHasLibraryPublishModal();
    if (has && !libraryPublishModalInDom) {
      libraryPublishModalInDom = true;
      scheduleSortLibraryPublishModalForced();
      ensureLibraryPublishScanUi();
    } else if (!has && libraryPublishModalInDom) {
      libraryPublishModalInDom = false;
      teardownPublishSortedUiIfModalClosed();
    }
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
