const DEFAULTS = {
  autosaveIntervalMinutes: 5,
  renamePixDownloads: false,
  pixDownloadFilenameTemplate: '{{date}} {{title}}.pix',
  autosaveFolderEnabled: true,
  autosaveFolder: 'Pixso Backup',
  trimPluginsListEnabled: true,
  exportPixButtonEnabled: true
};

const intervalEl = document.getElementById('interval');
const renamePixEl = document.getElementById('renamePix');
const templateEl = document.getElementById('template');
const autosaveFolderEnabledEl = document.getElementById('autosaveFolderEnabled');
const autosaveFolderEl = document.getElementById('autosaveFolder');
const trimPluginsEl = document.getElementById('trimPlugins');
const exportPixButtonEl = document.getElementById('exportPixButton');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');
const intervalRow = document.getElementById('intervalRow');
const templateBlock = document.getElementById('templateBlock');
const autosaveFolderBlock = document.getElementById('autosaveFolderBlock');

function updateConditionalVisibility() {
  if (intervalRow) {
    intervalRow.classList.remove('is-hidden');
  }
  if (templateBlock && renamePixEl) {
    templateBlock.classList.toggle('is-hidden', !renamePixEl.checked);
  }
  if (autosaveFolderBlock && autosaveFolderEnabledEl) {
    autosaveFolderBlock.classList.toggle('is-hidden', !autosaveFolderEnabledEl.checked);
  }
}

async function load() {
  const data = await chrome.storage.local.get(DEFAULTS);
  if (intervalEl) intervalEl.value = String(data.autosaveIntervalMinutes);
  if (renamePixEl) renamePixEl.checked = data.renamePixDownloads;
  if (templateEl) templateEl.value = data.pixDownloadFilenameTemplate;
  if (autosaveFolderEnabledEl) autosaveFolderEnabledEl.checked = data.autosaveFolderEnabled !== false;
  if (autosaveFolderEl) autosaveFolderEl.value = data.autosaveFolder || DEFAULTS.autosaveFolder;
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
  let autosaveFolder = autosaveFolderEl ? autosaveFolderEl.value.trim() : '';
  if (!autosaveFolder) autosaveFolder = DEFAULTS.autosaveFolder;

  const payload = {
    autosaveIntervalMinutes: minutes,
    renamePixDownloads: renamePixEl ? renamePixEl.checked : DEFAULTS.renamePixDownloads,
    pixDownloadFilenameTemplate: tpl,
    autosaveFolderEnabled: autosaveFolderEnabledEl
      ? autosaveFolderEnabledEl.checked
      : DEFAULTS.autosaveFolderEnabled,
    autosaveFolder,
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
if (renamePixEl) renamePixEl.addEventListener('change', updateConditionalVisibility);
if (autosaveFolderEnabledEl) autosaveFolderEnabledEl.addEventListener('change', updateConditionalVisibility);
load();
