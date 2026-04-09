/**
 * Выполняется в контексте страницы (не в isolated world расширения).
 * Hover на [command="export_file_menu"], клик по [command="export_pix"], обход shadow DOM.
 */
(function () {
  if (window.__pixsoTunerExportBridge) return;
  window.__pixsoTunerExportBridge = true;

  function deepQuery(sel, root) {
    if (!root) return null;
    if (root.nodeType === Node.ELEMENT_NODE && root.matches && root.matches(sel)) {
      return root;
    }
    const direct = root.querySelector ? root.querySelector(sel) : null;
    if (direct) return direct;
    const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].shadowRoot) {
        const f = deepQuery(sel, nodes[i].shadowRoot);
        if (f) return f;
      }
    }
    return null;
  }

  function isUsable(node) {
    if (!node || !node.getClientRects || node.getClientRects().length === 0) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hoverExportFileMenuNode(row) {
    if (!row || !row.getBoundingClientRect) return;
    const rect = row.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
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
  }

  function clickExportFileMenuNode(row) {
    if (!row || !row.getBoundingClientRect) return;
    if (row.closest && row.closest('.px-cascader-item__disabled')) return;
    const rect = row.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
    const p = {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      view: window
    };
    try {
      row.dispatchEvent(new PointerEvent('pointerdown', p));
      row.dispatchEvent(new MouseEvent('mousedown', o));
      row.dispatchEvent(new PointerEvent('pointerup', { ...p, buttons: 0 }));
      row.dispatchEvent(new MouseEvent('mouseup', o));
      row.dispatchEvent(new MouseEvent('click', o));
    } catch (_) {
      row.dispatchEvent(new MouseEvent('click', o));
    }
    if (typeof row.click === 'function') row.click();
  }

  function clickExportPixNode(node) {
    if (!node || !node.getBoundingClientRect) return;
    if (node.closest && node.closest('.px-cascader-item__disabled')) return;
    if (!isUsable(node)) return;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
    const p = {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      view: window
    };
    try {
      node.dispatchEvent(new PointerEvent('pointerdown', p));
      node.dispatchEvent(new MouseEvent('mousedown', o));
      node.dispatchEvent(new PointerEvent('pointerup', { ...p, buttons: 0 }));
      node.dispatchEvent(new MouseEvent('mouseup', o));
      node.dispatchEvent(new MouseEvent('click', o));
    } catch (_) {
      node.dispatchEvent(new MouseEvent('click', o));
    }
    if (typeof node.click === 'function') node.click();
  }

  function runClickExportPix() {
    const node = deepQuery('[command="export_pix"]', document.documentElement);
    if (node) clickExportPixNode(node);
  }

  function runHoverExportFileMenu() {
    const row = deepQuery('[command="export_file_menu"]', document.documentElement);
    if (row) hoverExportFileMenuNode(row);
  }

  function runClickExportFileMenu() {
    const row = deepQuery('[command="export_file_menu"]', document.documentElement);
    if (row) clickExportFileMenuNode(row);
  }

  /** Селектор с обходом open shadow (чекбоксы Publish могут быть внутри shadow). */
  function deepQuerySelector(sel, root) {
    if (!root) return null;
    try {
      if (root.nodeType === Node.ELEMENT_NODE && root.matches && root.matches(sel)) {
        return root;
      }
      const direct = root.querySelector ? root.querySelector(sel) : null;
      if (direct) return direct;
    } catch (_) {}
    const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].shadowRoot) {
        const f = deepQuerySelector(sel, nodes[i].shadowRoot);
        if (f) return f;
      }
    }
    return null;
  }

  /** Как clickExportPixNode, но для скрытого input берём центр .px-checkbox (иначе 0×0 и isUsable = false). */
  function clickPublishCheckboxNode(node) {
    if (!node || !node.getBoundingClientRect) return;
    if (node.closest && node.closest('.px-cascader-item__disabled')) return;
    const rect = node.getBoundingClientRect();
    let cx;
    let cy;
    if (rect.width > 0 && rect.height > 0) {
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
    } else {
      const wrap =
        (node.closest && node.closest('.flex-align-center.px-checkbox')) ||
        (node.closest && node.closest('.px-checkbox'));
      if (wrap && wrap.getBoundingClientRect) {
        const r2 = wrap.getBoundingClientRect();
        if (r2.width > 0 && r2.height > 0) {
          cx = r2.left + r2.width / 2;
          cy = r2.top + r2.height / 2;
        }
      }
    }
    if (cx !== undefined && cy !== undefined) {
      const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
      const p = {
        bubbles: true,
        cancelable: true,
        clientX: cx,
        clientY: cy,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: 1,
        view: window
      };
      try {
        node.dispatchEvent(new PointerEvent('pointerdown', p));
        node.dispatchEvent(new MouseEvent('mousedown', o));
        node.dispatchEvent(new PointerEvent('pointerup', { ...p, buttons: 0 }));
        node.dispatchEvent(new MouseEvent('mouseup', o));
        node.dispatchEvent(new MouseEvent('click', o));
      } catch (_) {
        node.dispatchEvent(new MouseEvent('click', o));
      }
    }
    if (typeof node.click === 'function') node.click();
    if (node.tagName === 'INPUT' && node.type === 'checkbox') {
      try {
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
    }
  }

  const __publishClickDone = new Set();

  /** Клик по чекбоксу Publish: контент-скрипт помечает узел data-pixso-tuner-pub, клик в MAIN world. */
  function runClickPublishCheckbox(token) {
    if (!token || typeof token !== 'string') return;
    if (__publishClickDone.has(token)) return;
    const sel = '[data-pixso-tuner-pub="' + token.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
    const node = deepQuerySelector(sel, document.documentElement);
    if (!node) return;
    if (node.closest && node.closest('.px-cascader-item__disabled')) return;
    __publishClickDone.add(token);
    window.setTimeout(function () {
      try {
        __publishClickDone.delete(token);
      } catch (_) {}
    }, 1500);
    clickPublishCheckboxNode(node);
    try {
      node.removeAttribute('data-pixso-tuner-pub');
    } catch (_) {}
  }

  window.addEventListener(
    'message',
    function (ev) {
      if (!ev.data || ev.data.source !== 'pixso-tuner') return;
      try {
        if (ev.origin && ev.origin !== window.location.origin) return;
      } catch (_) {}
      if (ev.data.action === 'click-export-pix') runClickExportPix();
      if (ev.data.action === 'hover-export-file-menu') runHoverExportFileMenu();
      if (ev.data.action === 'click-export-file-menu') runClickExportFileMenu();
      if (ev.data.action === 'click-publish-checkbox') runClickPublishCheckbox(ev.data.token);
    },
    false
  );

  try {
    const bridgeScript = document.querySelector('script[data-pixso-tuner-bridge]');
    if (bridgeScript) bridgeScript.setAttribute('data-pixso-bridge-loaded', '1');
  } catch (_) {}
})();
