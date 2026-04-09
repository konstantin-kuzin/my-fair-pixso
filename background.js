const AUTO_EXPORT_ALARM = 'pixso-tuner-auto-export';

const RENAME_DEFAULTS = {
  renamePixDownloads: false,
  pixDownloadFilenameTemplate: '{{date}} {{title}}.pix',
  autosaveFolderEnabled: true,
  autosaveFolder: 'Pixso Backup'
};

/** Синхронный снимок настроек переименования — onDeterminingFilename требует один вызов suggest() синхронно */
let renameSettingsCache = { ...RENAME_DEFAULTS };

function refreshRenameCache() {
  return chrome.storage.local.get(RENAME_DEFAULTS).then((d) => {
    renameSettingsCache = { ...RENAME_DEFAULTS, ...d };
  });
}

/** Chrome может вызвать обработчик повторно с тем же id — suggest допустим только один раз */
const suggestAlreadyCalledForDownloadId = new Set();

async function syncAutosaveAlarm() {
  const data = await chrome.storage.local.get({
    autosaveIntervalMinutes: 5
  });
  await chrome.alarms.clear(AUTO_EXPORT_ALARM);
  await chrome.alarms.clear('pixso-tuner-autosave');
  const m = Math.min(120, Math.max(1, Number(data.autosaveIntervalMinutes) || 5));
  chrome.alarms.create(AUTO_EXPORT_ALARM, { periodInMinutes: m });
}

function extractFileKeyFromUrl(url) {
  if (typeof url !== 'string') return '';
  const m = url.match(/\/design\/([^/?#]+)/i);
  return m && m[1] ? m[1] : '';
}

function sanitizeStem(s) {
  return String(s)
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'export';
}

function sanitizeFolderPath(folderPath) {
  const raw = String(folderPath || '').trim();
  if (!raw) return '';
  const parts = raw
    .split(/[\\/]+/)
    .map((part) =>
      String(part)
        .replace(/[?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((part) => !!part && part !== '.' && part !== '..');
  return parts.join('/');
}

function formatDateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function isLikelyPixsoPixDownload(item) {
  const fn = (item.filename || '').toLowerCase();
  const base = fn.split(/[/\\]/).pop() || fn;
  if (!base.endsWith('.pix')) return false;

  const ref = (item.referrer || '').toLowerCase();
  const u = (item.url || '').toLowerCase();
  const fu = (item.finalUrl || '').toLowerCase();

  if (ref.includes('pixso.net') || u.includes('pixso.net') || fu.includes('pixso.net')) {
    return true;
  }
  if (u.startsWith('blob:')) return true;
  return false;
}

function buildPixFilename(template, downloadItem) {
  const orig = downloadItem.filename || 'export.pix';
  const baseName = orig.split(/[/\\]/).pop() || 'export.pix';
  const titleStem = baseName.replace(/\.pix$/i, '').replace(/\s*\(\d+\)\s*$/, '');
  let name = String(template)
    .replace(/\{\{date\}\}/g, formatDateStamp())
    .replace(/\{\{title\}\}/g, sanitizeStem(titleStem))
    .replace(/\{\{raw\}\}/g, baseName);
  if (!/\.pix$/i.test(name)) name += '.pix';
  const last = name.split(/[/\\]/).pop() || name;
  const stem = last.replace(/\.pix$/i, '');
  return `${sanitizeStem(stem)}.pix`;
}

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const id = downloadItem.id;
  if (suggestAlreadyCalledForDownloadId.has(id)) {
    return;
  }

  if (!isLikelyPixsoPixDownload(downloadItem)) {
    return;
  }
  const folder = renameSettingsCache.autosaveFolderEnabled === false
    ? ''
    : sanitizeFolderPath(renameSettingsCache.autosaveFolder);
  const needRename = renameSettingsCache.renamePixDownloads === true;
  if (!needRename && !folder) return;

  suggestAlreadyCalledForDownloadId.add(id);

  const baseFilename = needRename
    ? buildPixFilename(
        renameSettingsCache.pixDownloadFilenameTemplate || RENAME_DEFAULTS.pixDownloadFilenameTemplate,
        downloadItem
      )
    : (downloadItem.filename || 'export.pix').split(/[/\\]/).pop() || 'export.pix';
  const filename = folder ? `${folder}/${baseFilename}` : baseFilename;

  try {
    suggest({ filename, conflictAction: 'uniquify' });
  } catch (_) {
    suggestAlreadyCalledForDownloadId.delete(id);
  }

  if (suggestAlreadyCalledForDownloadId.size > 300) {
    const it = suggestAlreadyCalledForDownloadId.values();
    for (let i = 0; i < 150; i++) {
      const v = it.next().value;
      if (v !== undefined) suggestAlreadyCalledForDownloadId.delete(v);
    }
  }
});

refreshRenameCache();

chrome.runtime.onInstalled.addListener(() => {
  refreshRenameCache();
  syncAutosaveAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  refreshRenameCache();
  syncAutosaveAlarm();
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') {
    refreshRenameCache();
    syncAutosaveAlarm();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_EXPORT_ALARM) return;
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url) return;
    if (!/^https:\/\/([^/]+\.)?pixso\.net\//.test(tab.url)) return;
    const fileKey = extractFileKeyFromUrl(tab.url);
    if (!fileKey) return;
    const data = await chrome.storage.local.get({ autosaveByFile: {} });
    const autosaveByFile = data && data.autosaveByFile && typeof data.autosaveByFile === 'object'
      ? data.autosaveByFile
      : {};
    if (autosaveByFile[fileKey] !== true) return;
    chrome.tabs
      .sendMessage(tab.id, { type: 'pixso-tuner-auto-export-pix' })
      .catch(() => {});
  });
});
