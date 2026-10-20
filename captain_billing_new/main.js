const { app, BrowserWindow, ipcMain, dialog, nativeImage, shell, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const pdfParse = require('pdf-parse');

// ── Single instance ───────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let mainWindow = null;
let pendingFilePath = null;
let currentUserId = null;

// ── Settings ──────────────────────────────────────────────────────────────────
const defaultBillsDir = path.join(os.homedir(), 'Documents', 'CaptainBilling');
const globalSettingsPath = path.join(defaultBillsDir, 'settings.json');
let settingsPath = globalSettingsPath;

function safeUserSegment(value, fallback = 'user') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || fallback;
}

function getUserRootDir(uid) {
  if (!uid) return defaultBillsDir;
  return path.join(defaultBillsDir, safeUserSegment(uid));
}

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch { return {}; }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf-8');
}

function setActiveUser(uid) {
  currentUserId = uid || null;
  const userRoot = getUserRootDir(uid);
  if (!fs.existsSync(userRoot)) fs.mkdirSync(userRoot, { recursive: true });
  settingsPath = path.join(userRoot, 'settings.json');
  billsDir = path.join(userRoot, 'bills');
  if (!fs.existsSync(billsDir)) fs.mkdirSync(billsDir, { recursive: true });
  settings = loadSettings();
  if (mainWindow) {
    mainWindow.webContents.send('set-bills-dir', billsDir);
    mainWindow.webContents.send('set-settings', settings);
  }
}

let settings = loadSettings();
let billsDir = settings.savePath || defaultBillsDir;
if (!fs.existsSync(billsDir)) fs.mkdirSync(billsDir, { recursive: true });

// ── Open bill file helper ─────────────────────────────────────────────────────
function openBillFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    const bill = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (mainWindow) {
      mainWindow.show(); mainWindow.focus();
      mainWindow.webContents.send('load-bill', bill, filePath);
    } else {
      pendingFilePath = filePath;
    }
  } catch (e) { console.error('Failed to open bill file:', e); }
}

function getFileArgv(argv) {
  return argv.find(a => (a.endsWith('.lbb') || a.endsWith('.lux') || a.endsWith('.json')) && fs.existsSync(a)) || null;
}

// ── Splash screen ─────────────────────────────────────────────────────────────
function createSplash() {
  const splash = new BrowserWindow({
    width: 1920, height: 1080,
    transparent: false, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splash.loadFile(path.join(__dirname, 'src', 'splash.html'));
  splash.maximize();
  return splash;
}

// ── Create window ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 850, minWidth: 900, minHeight: 600,
    title: 'Captain Billing',
    backgroundColor: '#0b1929',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false,
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.maximize();

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingFilePath) { openBillFile(pendingFilePath); pendingFilePath = null; }
    const st = loadSettings();
    mainWindow.webContents.send('set-bills-dir', billsDir);
    mainWindow.webContents.send('set-settings', st);
  });

  mainWindow.on('close', () => { app.isQuitting = true; });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const splash = createSplash();
  createWindow();
  const fileArg = getFileArgv(process.argv);
  if (fileArg) pendingFilePath = fileArg;

  // Show main window after 2 seconds, then close splash
  setTimeout(() => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    splash.destroy();
  }, 5000);
});

app.on('second-instance', (_e, argv) => {
  const fileArg = getFileArgv(argv);
  if (fileArg) openBillFile(fileArg);
  else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => { app.quit(); });

// ── IPC: Window controls ──────────────────────────────────────────────────────
ipcMain.on('win-minimize', () => mainWindow.minimize());
ipcMain.on('win-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('win-close',    () => { app.isQuitting = true; mainWindow.close(); });
ipcMain.on('win-drag-move', (_e, { dx, dy }) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});

// ── IPC: Bill filename helper ─────────────────────────────────────────────────
const BILL_MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function makeBillName(billData) {
  const cust = (billData.customerName || 'Bill')
    .trim().toUpperCase().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_')
    .replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Bill';
  let mon = '', yr = '';
  if (billData.billDate) {
    const parts = String(billData.billDate).split('-');
    if (parts.length === 3) {
      const m = parseInt(parts[1], 10) - 1;
      const y = parseInt(parts[0], 10);
      if (m >= 0 && m <= 11 && y > 1900) { mon = BILL_MONTHS[m]; yr = String(y); }
    }
  }
  return [cust, mon, yr].filter(Boolean).join('_');
}

function safeSegment(value, fallback = 'default') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || fallback;
}

function getFinancialYearInfo(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const valid = !Number.isNaN(d.getTime());
  const year = valid ? d.getFullYear() : new Date().getFullYear();
  const month = valid ? d.getMonth() + 1 : new Date().getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return {
    startYear,
    endYear,
    folder: `fy_${startYear}_${String(endYear).slice(-2)}`,
    label: `${startYear}-${String(endYear).slice(-2)}`,
  };
}

function getTaxMode(billData) {
  return billData.taxMode === 'gst' || billData?.gst?.enabled ? 'gst' : 'non-gst';
}

function listBillFiles(dir, out = []) {
  if (!dir || !fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listBillFiles(fp, out);
    } else if (/\.(lbb|lux|json)$/i.test(entry.name)) {
      out.push(fp);
    }
  }
  return out;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeBillPrefix(value, fallback = '', allowEmpty = false) {
  const cleaned = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_\-/]/g, '');
  return cleaned || (allowEmpty ? '' : fallback);
}

function getBillNumberConfig(taxMode) {
  const startRaw = String(settings.billNoStart || '0001').replace(/\D/g, '') || '0001';
  const start = Math.max(1, parseInt(startRaw, 10) || 1);
  const position = settings.billPrefixPosition === 'last' ? 'last' : 'front';
  return {
    prefix: taxMode === 'gst'
      ? sanitizeBillPrefix(settings.gstBillPrefix, 'GST-', true)
      : sanitizeBillPrefix(settings.nonGstBillPrefix, 'NGST-', true),
    position,
    start,
    width: Math.max(startRaw.length, 1),
  };
}

function nextBillNumber(targetDir, taxMode) {
  const cfg = getBillNumberConfig(taxMode);
  const prefixRe = escapeRegex(cfg.prefix);
  let max = cfg.start - 1;
  for (const fp of listBillFiles(targetDir)) {
    try {
      const bill = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      const raw = String(bill.billNumber || '').trim();
      const frontMatch = cfg.prefix ? raw.match(new RegExp(`^${prefixRe}(\\d+)$`, 'i')) : raw.match(/^(\d+)$/);
      const lastMatch = cfg.prefix ? raw.match(new RegExp(`^(\\d+)${prefixRe}$`, 'i')) : raw.match(/^(\d+)$/);
      const match = frontMatch || lastMatch || raw.match(/(\d+)/);
      if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
    } catch {}
  }
  const number = String(Math.max(max + 1, cfg.start)).padStart(cfg.width, '0');
  return cfg.position === 'last' ? `${number}${cfg.prefix}` : `${cfg.prefix}${number}`;
}

function uniqueFilePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  let i = 2;
  let candidate;
  do {
    candidate = path.join(dir, `${base}_${i}${ext}`);
    i++;
  } while (fs.existsSync(candidate));
  return candidate;
}

function resolveStructuredBillPath(billData) {
  const taxMode = getTaxMode(billData);
  const financialYear = getFinancialYearInfo(billData.billDate);
  const targetDir = path.join(billsDir, 'bills', financialYear.folder, taxMode);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const billNumber = String(billData.billNumber || '').trim() || nextBillNumber(targetDir, taxMode);
  const enrichedBill = {
    ...billData,
    billNumber,
    taxMode,
    financialYear,
  };
  const filename = safeSegment(`${billNumber}_${makeBillName(enrichedBill)}`, billNumber) + '.lbb';
  return { bill: enrichedBill, filePath: uniqueFilePath(path.join(targetDir, filename)) };
}

// ── IPC: Save bill ────────────────────────────────────────────────────────────
ipcMain.handle('save-bill-dialog', async (_e, billData) => {
  try {
    const resolved = resolveStructuredBillPath(billData);
    fs.writeFileSync(resolved.filePath, JSON.stringify(resolved.bill, null, 2), 'utf-8');
    return { success: true, filePath: resolved.filePath, bill: resolved.bill };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── IPC: Open bill ────────────────────────────────────────────────────────────
ipcMain.handle('open-bill-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Bill', defaultPath: billsDir,
    filters: [{ name: 'LB Bill', extensions: ['lbb', 'lux', 'json'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    const data = fs.readFileSync(result.filePaths[0], 'utf-8');
    return { bill: JSON.parse(data), filePath: result.filePaths[0] };
  } catch (e) { return { error: e.message }; }
});

// ── IPC: Import and parse PDF invoice ────────────────────────────────────────
function parseInvoiceText(text) {
  const out = { rawText: text, invoiceNumber: null, invoiceDate: null, total: null, vendor: null, items: [] };
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // invoice number
  for (const l of lines) {
    const m = l.match(/invoice\s*(?:no\.?|#|:)?\s*([A-Z0-9-\/\._]+)/i);
    if (m) { out.invoiceNumber = m[1]; break; }
  }
  // date (simple heuristics)
  for (const l of lines) {
    const m = l.match(/(\d{4}[-\./]\d{1,2}[-\./]\d{1,2})|([0-3]?\d[\-/][0-1]?\d[\-/](?:\d{2,4}))/);
    if (m) { out.invoiceDate = m[0]; break; }
  }
  // total — look for lines containing 'total' or last currency-like amount
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const m = l.match(/total[:\s]*\D*([0-9,]+(?:\.\d{2})?)/i);
    if (m) { out.total = m[1].replace(/,/g,''); break; }
    const mm = l.match(/\D([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)$/);
    if (mm && !out.total) { out.total = mm[1].replace(/,/g,''); }
  }
  // vendor — assume top lines contain vendor name (first non-empty line)
  if (lines.length) out.vendor = lines[0];
  return out;
}

ipcMain.handle('import-pdf', async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Import PDF Invoice', filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return null;
    const fp = res.filePaths[0];
    const buf = fs.readFileSync(fp);
    const data = await pdfParse(buf);
    const parsed = parseInvoiceText(data.text || '');
    return { success: true, filePath: fp, parsed };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── IPC: Bulk sync ────────────────────────────────────────────────────────────
ipcMain.handle('open-bills-bulk', async (_e, syncPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Sync Bills', defaultPath: (syncPath && fs.existsSync(syncPath)) ? syncPath : billsDir,
    filters: [{ name: 'LB Bill', extensions: ['lbb', 'lux', 'json'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || !result.filePaths.length) return { count: 0 };
  let copied = 0; const bills = [];
  for (const srcPath of result.filePaths) {
    try {
      const raw = fs.readFileSync(srcPath, 'utf-8');
      const bill = JSON.parse(raw);
      const resolved = resolveStructuredBillPath(bill);
      fs.writeFileSync(resolved.filePath, JSON.stringify(resolved.bill, null, 2), 'utf-8');
      if (path.resolve(srcPath) !== path.resolve(resolved.filePath)) copied++;
      bills.push({ ...resolved.bill, _filePath: resolved.filePath });
    } catch (e) { console.error('Sync error:', srcPath, e.message); }
  }
  return { count: result.filePaths.length, copied, bills };
});

// ── IPC: Update bill ──────────────────────────────────────────────────────────
ipcMain.handle('update-bill-file', async (_e, billData, filePath) => {
  try {
    let targetPath = filePath;
    if (!targetPath) {
      const resolved = resolveStructuredBillPath(billData);
      fs.writeFileSync(resolved.filePath, JSON.stringify(resolved.bill, null, 2), 'utf-8');
      return { success: true, filePath: resolved.filePath, bill: resolved.bill };
    }

    let mergedBill = { ...billData };
    try {
      const existing = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
      if (!mergedBill.billNumber && existing.billNumber) mergedBill.billNumber = existing.billNumber;
    } catch {}
    const taxMode = getTaxMode(mergedBill);
    const financialYear = getFinancialYearInfo(mergedBill.billDate);
    if (!mergedBill.billNumber) mergedBill.billNumber = nextBillNumber(path.dirname(targetPath), taxMode);
    mergedBill = { ...mergedBill, taxMode, financialYear };
    fs.writeFileSync(targetPath, JSON.stringify(mergedBill, null, 2), 'utf-8');
    return { success: true, filePath: targetPath, bill: mergedBill };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── IPC: List bills ───────────────────────────────────────────────────────────
ipcMain.handle('list-bills', async () => {
  try {
    const files = listBillFiles(billsDir).filter(fp => path.resolve(fp) !== path.resolve(settingsPath));
    return files.map(fp => {
      try { return { ...JSON.parse(fs.readFileSync(fp, 'utf-8')), _filePath: fp }; }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
});

// ── IPC: Delete bill ──────────────────────────────────────────────────────────
ipcMain.handle('delete-bill', async (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'File not found' };
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── IPC: Shell operations ─────────────────────────────────────────────────────
ipcMain.on('open-bills-folder',  ()           => shell.openPath(billsDir));
ipcMain.on('open-external',      (_e, url)    => shell.openExternal(url));
ipcMain.on('reveal-file',        (_e, fp)     => shell.showItemInFolder(fp));
ipcMain.on('copy-to-clipboard',  (_e, text)   => clipboard.writeText(String(text)));

// ── IPC: Generate PDF ─────────────────────────────────────────────────────────
ipcMain.handle('generate-pdf', async (_e, html, filePath) => {
  return new Promise((resolve) => {
    const pdfWin = new BrowserWindow({
      width: 860, height: 1100, show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    pdfWin.webContents.once('did-finish-load', async () => {
      try {
        const pdfData = await pdfWin.webContents.printToPDF({
          pageSize: 'A4', printBackground: true, marginsType: 1,
        });
        pdfWin.close();
        let fpath;
        if (filePath) {
          fpath = filePath;
          // Ensure directory exists
          const dir = path.dirname(fpath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        } else {
          fpath = path.join(os.tmpdir(), 'LB_Bill_' + Date.now() + '.pdf');
        }
        fs.writeFileSync(fpath, pdfData);
        resolve({ success: true, filePath: fpath });
      } catch (e) { pdfWin.close(); resolve({ success: false, error: e.message }); }
    });
  });
});

// ── IPC: Settings ─────────────────────────────────────────────────────────────
ipcMain.handle('browse-folder', async (_e, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Select Folder', properties: ['openDirectory'],
  });
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
});

ipcMain.handle('save-settings', async (_e, newSettings) => {
  try {
    const normalizedSettings = { ...newSettings };
    if (normalizedSettings.billNoStart !== undefined) {
      normalizedSettings.billNoStart = String(normalizedSettings.billNoStart).replace(/\D/g, '') || '0001';
    }
    if (normalizedSettings.gstBillPrefix !== undefined) {
      normalizedSettings.gstBillPrefix = sanitizeBillPrefix(normalizedSettings.gstBillPrefix, 'GST-', true);
    }
    if (normalizedSettings.nonGstBillPrefix !== undefined) {
      normalizedSettings.nonGstBillPrefix = sanitizeBillPrefix(normalizedSettings.nonGstBillPrefix, 'NGST-', true);
    }
    if (normalizedSettings.billPrefixPosition !== undefined) {
      normalizedSettings.billPrefixPosition = normalizedSettings.billPrefixPosition === 'last' ? 'last' : 'front';
    }
    settings = { ...settings, ...normalizedSettings };
    saveSettings(settings);
    if (normalizedSettings.savePath) {
      billsDir = normalizedSettings.savePath;
      if (!fs.existsSync(billsDir)) fs.mkdirSync(billsDir, { recursive: true });
    }
    mainWindow.webContents.send('set-bills-dir', billsDir);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('get-settings', async () => loadSettings());

// ── IPC: Get owner config (config.json) ───────────────────────────────────────
// Reads from __dirname so it works both in npm start AND packaged setup
const configPath = path.join(__dirname, 'config.json');
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch(e) {
    console.error('[CB] config.json not found or invalid:', e.message);
    return {};
  }
}
ipcMain.handle('get-config', async () => loadConfig());

ipcMain.handle('set-user-id', async (_e, uid) => {
  try {
    setActiveUser(uid);
    return { success: true, billsDir };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── IPC: Print preview ────────────────────────────────────────────────────────
let previewWin = null;
ipcMain.on('print-preview', (_e, html) => {
  if (previewWin && !previewWin.isDestroyed()) previewWin.close();
  previewWin = new BrowserWindow({
    width: 860, height: 820,
    title: 'Print Preview — Captain Billing',
    parent: mainWindow, modal: true, show: false,
    backgroundColor: '#f0ece4',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  const toolbar = `<div id="pt" style="position:fixed;top:0;left:0;right:0;z-index:9999;
    background:#1a1916;border-bottom:1px solid #3a3530;display:flex;align-items:center;
    justify-content:space-between;padding:10px 18px;gap:12px;font-family:Georgia,serif;
    -webkit-app-region:drag;">
    <span style="color:#c8860a;font-size:13px;font-weight:700;font-style:italic;">🖨 Print Preview</span>
    <div style="display:flex;gap:8px;-webkit-app-region:no-drag;">
      <button onclick="window.print()" style="background:#c8860a;color:#fff;border:none;
        border-radius:7px;padding:7px 20px;font-size:13px;font-weight:700;cursor:pointer;
        font-family:Georgia,serif;">🖨 Print</button>
      <button onclick="window.close()" style="background:#3a3530;color:#ede8df;border:none;
        border-radius:7px;padding:7px 14px;font-size:13px;cursor:pointer;
        font-family:Georgia,serif;">✕ Close</button>
    </div></div><div style="height:52px;"></div>`;

  const previewHtml = html
    .replace(/<script>window\.onload.*?<\/script>/s, '')
    .replace('<body>', '<body>' + toolbar);
  const finalHtml = previewHtml.replace('</head>',
    '<style>@media print{#pt,div[style*="height:52px"]{display:none!important}}</style></head>');

  previewWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(finalHtml));
  previewWin.setMenu(null);
  previewWin.once('ready-to-show', () => previewWin.show());
});




// ── Google Sign-In for Electron using BrowserWindow + Identity Toolkit ────────
//
// Strategy:
//   1. Open https://accounts.google.com/o/oauth2/v2/auth with response_type=token
//      (implicit flow — no client_secret, no redirect URI registration needed)
//   2. Load it in a hidden BrowserWindow
//   3. Watch for the redirect to the redirect_uri — we use the Firebase authDomain
//      as redirect (it's already registered by Firebase automatically)
//   4. Extract access_token from the URL hash
//   5. Exchange access_token for Firebase credential via signInWithCredential
//
// This uses Firebase's own registered redirect URI so no Google Cloud Console
// changes are needed.

// Preload for auth window
const authPreloadCode2 = `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('authBridge', {
  startOAuth:    ()    => ipcRenderer.send('auth-start-oauth'),
  onResult:      (cb)  => ipcRenderer.on('auth-result', (_e, d) => cb(d)),
  signalSuccess: (d)   => ipcRenderer.send('auth-success', d),
  saveClientId:  (id)  => ipcRenderer.send('auth-save-client-id', id),
});
`;
const authPreloadPath2 = require('path').join(os.tmpdir(), 'lb_auth_pre2.js');
fs.writeFileSync(authPreloadPath2, authPreloadCode2);

let authWin2 = null;
let oauthWin  = null;

ipcMain.on('open-google-auth', () => {
  if (authWin2 && !authWin2.isDestroyed()) { authWin2.focus(); return; }
  authWin2 = new BrowserWindow({
    width: 420, height: 480,
    title: 'Sign in — Captain Billing',
    parent: mainWindow, modal: true,
    resizable: false, backgroundColor: '#0f0e0c',
    webPreferences: {
      preload: authPreloadPath2,
      nodeIntegration: false, contextIsolation: true,
    },
  });
  authWin2.setMenu(null);
  authWin2.loadFile(path.join(__dirname, 'src', 'auth.html'));
  authWin2.on('closed', () => { authWin2 = null; });
});

// Web Client ID — hardcoded, no user setup needed
const GOOGLE_WEB_CLIENT_ID = '5472017689-u553lpolaha69cagmk0tvho0eidcvbhc.apps.googleusercontent.com';

ipcMain.on('auth-start-oauth', () => {
  if (oauthWin && !oauthWin.isDestroyed()) { oauthWin.close(); }
  const webClientId = GOOGLE_WEB_CLIENT_ID;

  const redirectUri = 'https://billing-app-70f4f.firebaseapp.com/__/auth/handler';
  const nonce = require('crypto').randomBytes(16).toString('hex');

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + [
    `client_id=${encodeURIComponent(webClientId)}`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
    'response_type=token id_token',
    'scope=' + encodeURIComponent('openid email profile'),
    `nonce=${nonce}`,
    'prompt=select_account',
  ].join('&');

  oauthWin = new BrowserWindow({
    width: 500, height: 650,
    title: 'Sign in with Google',
    parent: authWin2,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  oauthWin.setMenu(null);
  oauthWin.loadURL(authUrl);

  // Flag to track whether tokens were successfully captured
  let tokensCaptured = false;

  // Firebase auth handler will redirect back with tokens in the URL hash/params
  function checkForTokens(url) {
    try {
      const u = new URL(url);
      // Tokens may be in hash fragment
      const hash = u.hash.replace('#', '');
      const params = new URLSearchParams(hash);
      const id_token    = params.get('id_token');
      const access_token = params.get('access_token');
      if (id_token || access_token) {
        tokensCaptured = true;
        if (oauthWin && !oauthWin.isDestroyed()) oauthWin.destroy();
        sendResult2({ id_token, access_token });
        return true;
      }
      // Also check query params
      const id2 = u.searchParams.get('id_token');
      const at2 = u.searchParams.get('access_token');
      if (id2 || at2) {
        tokensCaptured = true;
        if (oauthWin && !oauthWin.isDestroyed()) oauthWin.destroy();
        sendResult2({ id_token: id2, access_token: at2 });
        return true;
      }
    } catch {}
    return false;
  }

  oauthWin.webContents.on('will-redirect',        (e, url) => checkForTokens(url));
  oauthWin.webContents.on('did-navigate',          (e, url) => checkForTokens(url));
  oauthWin.webContents.on('did-navigate-in-page',  (e, url) => checkForTokens(url));
  oauthWin.webContents.on('will-navigate',         (e, url) => checkForTokens(url));

  // Poll every 300ms as fallback
  const poll = setInterval(async () => {
    if (!oauthWin || oauthWin.isDestroyed()) { clearInterval(poll); return; }
    const url = oauthWin.webContents.getURL();
    if (checkForTokens(url)) clearInterval(poll);
  }, 300);

  oauthWin.on('closed', () => {
    clearInterval(poll);
    // Only send cancelled if tokens were not already captured
    if (!tokensCaptured) {
      sendResult2({ error: 'cancelled' });
    }
  });
});

function sendResult2(data) {
  if (authWin2 && !authWin2.isDestroyed()) {
    authWin2.webContents.send('auth-result', data);
  }
}

ipcMain.on('auth-success', (_e, data) => {
  if (authWin2 && !authWin2.isDestroyed()) { authWin2.destroy(); authWin2 = null; }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('google-token', data);
  }
});
