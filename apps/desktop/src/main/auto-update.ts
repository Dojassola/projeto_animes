import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { FileLogger } from './infrastructure/logging/file-logger';

const { autoUpdater } = electronUpdater;

export function checkForUpdates(logger: FileLogger): void {
  if (!app.isPackaged || process.platform !== 'win32') return;

  autoUpdater.on('error', (error) => {
    logger.write({
      level: 'error',
      category: 'application',
      operation: 'auto-update',
      message: error.message,
    });
  });
  void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
}
