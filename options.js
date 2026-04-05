const DEFAULTS = {
  autosaveEnabled: false,
  autosaveIntervalMinutes: 10,
  renamePixDownloads: false,
  pixDownloadFilenameTemplate: '{{date}} {{title}}.pix',
  trimPluginsListEnabled: true,
  exportPixButtonEnabled: true
};

const enabledEl = document.getElementById('enabled');
const intervalEl = document.getElementById('interval');
const renamePixEl = document.getElementById('renamePix');
const templateEl = document.getElementById('template');
const trimPluginsEl = document.getElementById('trimPlugins');
const exportPixButtonEl = document.getElementById('exportPixButton');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');
const intervalRow = document.getElementById('intervalRow');
const templateBlock = document.getElementById('templateBlock');

function updateConditionalVisibility() {
  if (intervalRow && enabledEl) {
    intervalRow.classList.toggle('is-hidden', !enabledEl.checked);
  }
  if (templateBlock && renamePixEl) {
    templateBlock.classList.toggle('is-hidden', !renamePixEl.checked);
  }
}

async function load() {
  const data = await chrome.storage.local.get(DEFAULTS);
  if (enabledEl) enabledEl.checked = data.autosaveEnabled;
  if (intervalEl) intervalEl.value = String(data.autosaveIntervalMinutes);
  if (renamePixEl) renamePixEl.checked = data.renamePixDownloads;
  if (templateEl) templateEl.value = data.pixDownloadFilenameTemplate;
  if (trimPluginsEl) trimPluginsEl.checked = data.trimPluginsListEnabled !== false;
  if (exportPixButtonEl) exportPixButtonEl.checked = data.exportPixButtonEnabled !== false;
  updateConditionalVisibility();
}

async function save() {
  let minutes = parseInt(intervalEl && intervalEl.value, 10);
  if (Number.isNaN(minutes)) minutes = DEFAULTS.autosaveIntervalMinutes;
  minutes = Math.min(120, Math.max(1, minutes));
  if (intervalEl) intervalEl.value = String(minutes);

  let tpl = templateEl ? templateEl.value.trim() : '';
  if (!tpl) tpl = DEFAULTS.pixDownloadFilenameTemplate;

  const payload = {
    autosaveEnabled: enabledEl ? enabledEl.checked : DEFAULTS.autosaveEnabled,
    autosaveIntervalMinutes: minutes,
    renamePixDownloads: renamePixEl ? renamePixEl.checked : DEFAULTS.renamePixDownloads,
    pixDownloadFilenameTemplate: tpl,
    trimPluginsListEnabled: trimPluginsEl
      ? trimPluginsEl.checked
      : DEFAULTS.trimPluginsListEnabled,
    exportPixButtonEnabled: exportPixButtonEl
      ? exportPixButtonEl.checked
      : DEFAULTS.exportPixButtonEnabled
  };

  await chrome.storage.local.set(payload);

  if (statusEl) {
    statusEl.textContent = 'Сделано';
  }
  window.setTimeout(() => {
    window.close();
  }, 500);
}

if (saveBtn) saveBtn.addEventListener('click', save);
if (enabledEl) enabledEl.addEventListener('change', updateConditionalVisibility);
if (renamePixEl) renamePixEl.addEventListener('change', updateConditionalVisibility);
load();
