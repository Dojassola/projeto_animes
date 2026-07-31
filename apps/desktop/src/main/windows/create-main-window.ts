import { BrowserWindow } from 'electron';
import { join } from 'node:path';

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#090b10',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl === undefined) {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  } else {
    void window.loadURL(rendererUrl);
  }

  return window;
}
