const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize:  () => ipcRenderer.send('win-minimize'),
  maximize:  () => ipcRenderer.send('win-maximize'),
  close:     () => ipcRenderer.send('win-close'),
  dragMove:  (dx, dy) => ipcRenderer.send('win-drag-move', { dx, dy }),

  // File operations
  saveBill:        (billData)           => ipcRenderer.invoke('save-bill-dialog', billData),
  openBill:        ()                   => ipcRenderer.invoke('open-bill-dialog'),
  openBillsBulk:   (syncPath)           => ipcRenderer.invoke('open-bills-bulk', syncPath),
  updateBillFile:  (billData, filePath) => ipcRenderer.invoke('update-bill-file', billData, filePath),
  listBills:       ()                   => ipcRenderer.invoke('list-bills'),
  deleteBill:      (filePath)           => ipcRenderer.invoke('delete-bill', filePath),
  openBillsFolder: ()                   => ipcRenderer.send('open-bills-folder'),

  // External / shell
  openExternal:    (url)      => ipcRenderer.send('open-external', url),
  revealFile:      (filePath) => ipcRenderer.send('reveal-file', filePath),
  copyToClipboard: (text)     => ipcRenderer.send('copy-to-clipboard', text),

  // PDF generation
  generatePdf: (html, filePath) => ipcRenderer.invoke('generate-pdf', html, filePath),
  // Import PDF and parse invoice data
  importPdf: () => ipcRenderer.invoke('import-pdf'),

  // Print preview
  printPreview: (html) => ipcRenderer.send('print-preview', html),

  // Settings
  browseFolder:  (title) => ipcRenderer.invoke('browse-folder', title),
  saveSettings:  (s)     => ipcRenderer.invoke('save-settings', s),
  getSettings:   ()      => ipcRenderer.invoke('get-settings'),
  getConfig:     ()      => ipcRenderer.invoke('get-config'),

  // ── Google OAuth (Electron-safe auth) ─────────────────────────────────────
  openGoogleAuth: () => ipcRenderer.send('open-google-auth'),
  onGoogleToken:  (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('google-token', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('google-token', handler);
  },

  // Events main -> renderer
  onLoadBill:    (cb) => ipcRenderer.on('load-bill',     (_e, bill, fp) => cb(bill, fp)),
  onSetBillsDir: (cb) => ipcRenderer.on('set-bills-dir', (_e, dir)      => cb(dir)),
  onSetSettings: (cb) => ipcRenderer.on('set-settings',  (_e, s)        => cb(s)),
  setUserId:     (uid) => ipcRenderer.invoke('set-user-id', uid),
});
