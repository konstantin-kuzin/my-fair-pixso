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

  window.addEventListener(
    'message',
    function (ev) {
      if (ev.source !== window || !ev.data || ev.data.source !== 'pixso-tuner') return;
      if (ev.data.action === 'click-export-pix') runClickExportPix();
      if (ev.data.action === 'hover-export-file-menu') runHoverExportFileMenu();
    },
    false
  );
})();
