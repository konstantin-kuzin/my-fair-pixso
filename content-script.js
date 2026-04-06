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

/** Высота строки в CSS модалки публикации (стили строки, не вирт. список) */
const LIBRARY_PUBLISH_ROW_HEIGHT_PX = 24;

function removePublishLiImageBoxNodes(root) {
  if (!(root instanceof Element)) return;
  root
    .querySelectorAll(
      '.publish--detail--li-image-box, .publish-detail--li-image-box'
    )
    .forEach((node) => {
      try {
        node.remove();
      } catch (_) {
        /* ignore */
      }
    });
}

/**
 * Виртуальный список монтирует в DOM только видимое «окно» строк.
 * Перестановка .item и расчёт height wrapper как суммы детей ломали прокрутку: оставалась
 * высота лишь по видимым узлам — остальные элементы становились недоступны.
 * Алфавитная сортировка по полному списку без API Pixso здесь недоступна.
 * Оставляем безопасную часть: вырезание превью-блоков из текущего среза DOM.
 */
function relayoutLibraryPublishItems(wrapper) {
  removePublishLiImageBoxNodes(wrapper);
}

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
  if (/^component$/i.test(s)) {
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

function publishNamesEqual(a, b) {
  return normalizePublishComponentName(a) === normalizePublishComponentName(b);
}

function extractPublishRowFromItem(item) {
  if (!(item instanceof Element)) return null;
  const li = item.querySelector('.publish--detail--li');
  if (!li || li.classList.contains('publish--detail--li__title')) return null;
  const nameEl =
    li.querySelector('.name.text__ellipsis') || li.querySelector('.name');
  const name = nameEl ? nameEl.textContent.trim() : '';
  if (!name) return null;
  const input =
    item.querySelector('input.px-checkbox--input') ||
    item.querySelector('input[type="checkbox"]');
  const checked = input ? !!input.checked : false;
  const statusEl = li.querySelector('.status');
  const status = statusEl ? statusEl.textContent.trim() : '';
  return { name, checked, status };
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
  if (!prev) {
    g.set(row.name, { ...row });
  } else {
    const listTop =
      typeof row.listTop === 'number' && Number.isFinite(row.listTop)
        ? row.listTop
        : prev.listTop;
    g.set(row.name, {
      name: row.name,
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

function publishGroupedMapsToSections(groupsMap) {
  const used = new Set();
  const sections = [];
  let total = 0;
  for (let gi = 0; gi < LIBRARY_PUBLISH_GROUP_ORDER.length; gi++) {
    const title = LIBRARY_PUBLISH_GROUP_ORDER[gi];
    if (!groupsMap.has(title)) continue;
    used.add(title);
    const rows = Array.from(groupsMap.get(title).values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    );
    total += rows.length;
    sections.push({ title, rows });
  }
  for (const [title, gmap] of groupsMap) {
    if (used.has(title)) continue;
    const rows = Array.from(gmap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    );
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
    '.pixso-tuner-publish-sorted-panel{display:flex;flex-direction:column;min-height:0;font:11px/1.2 system-ui,-apple-system,sans-serif;color:#19191a;overscroll-behavior:contain;touch-action:manipulation;pointer-events:auto}' +
    '.pixso-tuner-publish-sorted-inline{position:sticky;top:0;left:0;right:0;width:100%;z-index:10;min-height:100%;max-height:100%;box-sizing:border-box;background:var(--color-bg,rgba(255,255,255,.98));flex-shrink:0}' +
    '.pixso-tuner-publish-sorted-overlay{position:fixed;z-index:2147483646;right:24px;top:80px;width:min(420px,calc(100vw - 48px));max-height:min(70vh,640px);background:var(--color-bg,rgba(255,255,255,.98));border:1px solid rgba(0,0,0,.12);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18)}' +
    '.pixso-tuner-publish-sorted-inline .pixso-tuner-publish-sorted-list{flex:1;min-height:0}' +
    '.pixso-tuner-publish-sorted-h{font-size:11px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.08);font-weight:600;flex-shrink:0}' +
    '.pixso-tuner-publish-sorted-h button{border:0;background:transparent;cursor:pointer;padding:4px 8px;border-radius:6px;font:inherit;color:inherit}' +
    '.pixso-tuner-publish-sorted-h button:hover{background:rgba(0,0,0,.06)}' +
    '.pixso-tuner-publish-sorted-list{overflow:auto;padding:6px 0;overscroll-behavior:contain;touch-action:pan-y}' +
    '.pixso-tuner-publish-sorted-row{display:grid;grid-template-columns:12px 1fr auto;gap:8px;align-items:center;padding:6px 12px;border-bottom:1px solid rgba(0,0,0,.04)}' +
    '.pixso-tuner-publish-sorted-row:last-child{border-bottom:0}' +
    '.pixso-tuner-publish-sorted-cb{width:12px;height:12px;margin:0;cursor:pointer;flex-shrink:0}' +
    '.pixso-tuner-publish-sorted-sec{font-size:11px;font-weight:600;padding:6px 12px;color:rgba(0,0,0,.55);border-bottom:1px solid rgba(0,0,0,.06)}' +
    '.pixso-tuner-publish-sorted-st{font-size:11px;opacity:.65;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pixso-tuner-publish-scan-btn{margin:8px 12px 0;font:inherit;padding:6px 12px;border-radius:8px;border:1px solid rgba(0,0,0,.15);background:var(--color-bg,rgba(255,255,255,.95));cursor:pointer;align-self:flex-start}' +
    '.pixso-tuner-publish-scan-btn:disabled{opacity:.55;cursor:wait}' +
    '.pixso-tuner-publish-scan-wrap{padding:0 12px 8px}';
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
        inp.checked = wantChecked;
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
  const total =
    bundle && typeof bundle.total === 'number'
      ? bundle.total
      : sections.reduce((n, s) => n + (s.rows ? s.rows.length : 0), 0);

  ensurePublishSortedOverlayStyles();
  removePublishSortedOverlay();

  const root = document.createElement('div');
  root.className = 'pixso-tuner-publish-sorted-panel';

  const head = document.createElement('div');
  head.className = 'pixso-tuner-publish-sorted-h';
  head.innerHTML = `<span>${total}</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Исходный вид';
  closeBtn.addEventListener('click', () => removePublishSortedOverlay());
  head.appendChild(closeBtn);
  root.appendChild(head);

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
      name.textContent = r.name;
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
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pixso-tuner-publish-scan-btn';
  btn.textContent = 'Нормально покажи';
  btn.addEventListener('click', async () => {
    const wrappers = collectLibraryPublishWrappers();
    const w = wrappers[0];
    if (!w) return;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Сканирование…';
    try {
      const rows = await scanLibraryPublishRowsViaScroll(w);
      renderPublishSortedOverlay(rows);
    } catch (_) {
      btn.textContent = 'Ошибка';
      setTimeout(() => {
        btn.textContent = prev;
        btn.disabled = false;
      }, 1200);
      return;
    }
    btn.textContent = prev;
    btn.disabled = false;
  });
  wrap.appendChild(btn);
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
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'pixso-tuner-auto-export-pix') {
    runExportPixFlow();
    sendResponse({ ok: true });
  }
});

const EXPORT_PIX_ICON_STYLE_ID = 'pixso-tuner-export-pix-icon-style';
const PUBLISH_HIDE_IMAGE_BOX_STYLE_ID = 'pixso-tuner-hide-publish-li-image-box';

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

/** Скрытие превью, сетка строк и высота — стиль перезаписываем целиком при обновлении расширения */
function ensurePublishDetailLiImageBoxHidden() {
  const id = PUBLISH_HIDE_IMAGE_BOX_STYLE_ID;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.documentElement.appendChild(el);
  }
  el.textContent =
    /** В разметке Pixso класс с префиксом publish--detail-- (два дефиса после publish), не publish-detail-- */
    '.library-publish-container .publish--detail--li-image-box,' +
    '.library-publish-container .publish-detail--li-image-box,' +
    '.library-publish-container .publish--detail--li .publish--detail--li-image-box,' +
    '.library-publish-container .publish--detail--li .publish-detail--li-image-box' +
    '{display:none!important;visibility:hidden!important;width:0!important;height:0!important;min-width:0!important;min-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;flex:0 0 0!important;pointer-events:none!important}' +
    '.library-publish-container .publish--detail--li{grid-template-columns:32px 1fr 50px!important;align-items:center!important;box-sizing:border-box!important;background:transparent!important}' +
    '.library-publish-container .flex-align-center.px-checkbox{height:' +
    LIBRARY_PUBLISH_ROW_HEIGHT_PX +
    'px!important;min-height:' +
    LIBRARY_PUBLISH_ROW_HEIGHT_PX +
    'px!important;max-height:' +
    LIBRARY_PUBLISH_ROW_HEIGHT_PX +
    'px!important;box-sizing:border-box!important}' +
    '.library-publish-container .wrapper .item{width:100%!important;position:absolute!important;left:0!important;right:0!important;border-radius:6px!important;box-sizing:border-box!important}' +
    '.library-publish-container .wrapper .item:hover{background-color:var(--color-bg-hover,rgba(0,0,0,.06))!important}' +
    '.library-publish-container .wrapper .item:has(.publish--detail--li:not(.publish--detail--li__title)){height:' +
    LIBRARY_PUBLISH_ROW_HEIGHT_PX +
    'px!important;min-height:' +
    LIBRARY_PUBLISH_ROW_HEIGHT_PX +
    'px!important;max-height:' +
    LIBRARY_PUBLISH_ROW_HEIGHT_PX +
    'px!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;overflow:visible!important}' +
    '.library-publish-container .wrapper .item:has(.publish--detail--li:not(.publish--detail--li__title)):hover{background:transparent!important}' +
    '.library-publish-container .wrapper .item:has(.publish--detail--li:not(.publish--detail--li__title)):hover .publish--detail--li{background-color:var(--color-bg-hover,rgba(0,0,0,.06))!important;border-radius:6px!important}' +
    '.library-publish-container .wrapper .item:has(.publish--detail--li:not(.publish--detail--li__title)) .publish--detail--li{margin:0!important;padding:0 8px 0 4px!important;height:100%!important;min-height:0!important;width:100%!important;box-sizing:border-box!important;border-radius:6px!important}' +
    '.library-publish-container .wrapper .item:has(.publish--detail--li:not(.publish--detail--li__title)) .name.text__ellipsis,.library-publish-container .wrapper .item:has(.publish--detail--li:not(.publish--detail--li__title)) .name{line-height:18px!important;max-height:none!important;padding:0!important;margin:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}';
  try {
    collectLibraryPublishWrappers().forEach((w) => removePublishLiImageBoxNodes(w));
  } catch (_) {
    /* ignore */
  }
}

let libraryPublishCheckboxRefreshTimer = 0;
let libraryPublishInteractionHooksInstalled = false;

/** После клика по чекбоксу Vue перерисовывает список — стили + несколько проходов очистки превью */
function refreshLibraryPublishAfterListMutation() {
  clearPublishSortedActiveIfPanelMissing();
  ensurePublishDetailLiImageBoxHidden();
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
  ensureExportBridge();
  ensureExportPixIconStyles();
  ensurePublishDetailLiImageBoxHidden();
  ensureLibraryPublishInteractionHooks();
  onDomMutation();
  libraryPublishModalInDom = documentHasLibraryPublishModal();
  if (libraryPublishModalInDom) {
    scheduleSortLibraryPublishModalForced();
    ensureLibraryPublishScanUi();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
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
