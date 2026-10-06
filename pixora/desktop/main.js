const { app, BrowserWindow, shell, nativeTheme } = require('electron');
const APP_URL = 'https://pixora-btgo.onrender.com';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800,
    minWidth: 900, minHeight: 640,
    backgroundColor: '#0a0a0a',
    title: 'Pixora',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  nativeTheme.themeSource = 'dark';
  win.loadURL(APP_URL);
  // open external links in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
