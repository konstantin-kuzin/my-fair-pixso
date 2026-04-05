const DEFAULTS = {
  autosaveEnabled: false,
  autosaveIntervalMinutes: 10,
  renamePixDownloads: false,
  pixDownloadFilenameTemplate: '{{date}}-{{title}}.pix'
};

const enabledEl = document.getElementById('enabled');
const intervalEl = document.getElementById('interval');
const renamePixEl = document.getElementById('renamePix');
const templateEl = document.getElementById('template');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

async function load() {
  const data = await chrome.storage.local.get(DEFAULTS);
  enabledEl.checked = data.autosaveEnabled;
  intervalEl.value = String(data.autosaveIntervalMinutes);
  renamePixEl.checked = data.renamePixDownloads;
  templateEl.value = data.pixDownloadFilenameTemplate;
}

async function save() {
  let minutes = parseInt(intervalEl.value, 10);
  if (Number.isNaN(minutes)) minutes = DEFAULTS.autosaveIntervalMinutes;
  minutes = Math.min(120, Math.max(1, minutes));
  intervalEl.value = String(minutes);

  let tpl = templateEl.value.trim();
  if (!tpl) tpl = DEFAULTS.pixDownloadFilenameTemplate;

  await chrome.storage.local.set({
    autosaveEnabled: enabledEl.checked,
    autosaveIntervalMinutes: minutes,
    renamePixDownloads: renamePixEl.checked,
    pixDownloadFilenameTemplate: tpl
  });

  statusEl.textContent = 'Сохранено.';
  window.setTimeout(() => {
    statusEl.textContent = '';
  }, 2500);
}

saveBtn.addEventListener('click', save);
load();
