import { app, BrowserWindow, dialog, Menu, safeStorage } from 'electron';
import { join } from 'node:path';
import { checkForUpdates } from './auto-update';
import { openDatabase, type KitsuneDatabase } from './infrastructure/database/open-database';
import { FileLogger } from './infrastructure/logging/file-logger';
import { registerIpc } from './ipc/register-ipc';
import { AniListProvider } from './providers/anilist/anilist-provider';
import { DarkMahouTorrentProvider } from './providers/darkmahou-torrent-provider';
import { NyaaTorrentProvider } from './providers/nyaa-torrent-provider';
import { TokyoToshoTorrentProvider } from './providers/tokyotosho-torrent-provider';
import { CatalogRepository } from './repositories/catalog-repository';
import { ProviderCacheRepository } from './repositories/provider-cache-repository';
import { SettingsRepository } from './repositories/settings-repository';
import { IntegrationSettingsRepository } from './repositories/integration-settings-repository';
import { TorrentDownloadRepository } from './repositories/torrent-download-repository';
import { CatalogService } from './services/catalog-service';
import { ReleaseService } from './services/release-service';
import { SubtitleService } from './services/subtitle-service';
import { TorrentFileService } from './services/torrent-file-service';
import { WebTorrentService } from './services/webtorrent-service';
import { createMainWindow } from './windows/create-main-window';
import type { AppStatus } from '../shared/contracts/app';

let mainWindow: BrowserWindow | undefined;
let database: KitsuneDatabase | undefined;
let unregisterIpc: (() => void) | undefined;
let catalogService: CatalogService | undefined;
let webTorrentService: WebTorrentService | undefined;

function platformName(): AppStatus['platform'] {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'darwin') return 'macos';
  return 'unsupported';
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized() === true) mainWindow.restore();
    mainWindow?.focus();
  });

  void app.whenReady().then(() => {
    const userDataPath = app.getPath('userData');
    const logger = new FileLogger(join(userDataPath, 'logs'));
    database = openDatabase(join(userDataPath, 'kitsune.db'));
    const settingsRepository = new SettingsRepository(database);
    const catalogRepository = new CatalogRepository(database);
    const cacheRepository = new ProviderCacheRepository(database);
    const integrationSettings = new IntegrationSettingsRepository(
      database,
      join(app.getPath('downloads'), 'Kitsune'),
      (value) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable');
        return safeStorage.encryptString(value);
      },
      (value) => safeStorage.decryptString(value),
    );
    catalogService = new CatalogService(new AniListProvider(), catalogRepository, cacheRepository);
    const torrentProviders = [
      new NyaaTorrentProvider(),
      new TokyoToshoTorrentProvider(),
      new DarkMahouTorrentProvider(),
    ] as const;
    const releaseService = new ReleaseService(catalogRepository, cacheRepository, integrationSettings, torrentProviders);
    const torrentFileService = new TorrentFileService(integrationSettings, torrentProviders);
    webTorrentService = new WebTorrentService(
      integrationSettings,
      new TorrentDownloadRepository(database),
      torrentFileService,
    );
    webTorrentService.restore();
    const subtitleService = new SubtitleService(catalogRepository, integrationSettings, cacheRepository);

    const openMainWindow = (): void => {
      unregisterIpc?.();
      const window = createMainWindow();
      mainWindow = window;
      const activeCatalogService = catalogService;
      const activeWebTorrentService = webTorrentService;
      if (activeCatalogService === undefined) throw new Error('Catalog service is not initialized');
      if (activeWebTorrentService === undefined) throw new Error('Torrent service is not initialized');
      unregisterIpc = registerIpc({
        window,
        settingsRepository,
        catalogService: activeCatalogService,
        integrationSettings,
        releaseService,
        torrentFileService,
        webTorrentService: activeWebTorrentService,
        subtitleService,
        logger,
        getAppStatus: () => ({
          version: app.getVersion(),
          electronVersion: process.versions['electron'],
          nodeVersion: process.version,
          platform: platformName(),
          databaseReady: true,
        }),
      });
      window.once('closed', () => {
        if (mainWindow !== window) return;
        unregisterIpc?.();
        unregisterIpc = undefined;
        mainWindow = undefined;
      });
    };

    Menu.setApplicationMenu(null);
    openMainWindow();
    checkForUpdates(logger);
    logger.write({
      level: 'info',
      category: 'application',
      operation: 'startup',
      message: 'Kitsune initialized',
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
    });
  }).catch(() => {
    dialog.showErrorBox(
      'Kitsune não pôde iniciar',
      'Não foi possível preparar os dados locais. Reinicie o aplicativo ou verifique as permissões da pasta de dados.',
    );
    app.quit();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  unregisterIpc?.();
  unregisterIpc = undefined;
  catalogService?.dispose();
  catalogService = undefined;
  webTorrentService?.dispose();
  webTorrentService = undefined;
  database?.close();
  database = undefined;
});
