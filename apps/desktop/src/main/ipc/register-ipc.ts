import type { BrowserWindow } from 'electron';
import {
  AppStatusInputSchema,
  AppStatusResultSchema,
  type AppStatus,
} from '../../shared/contracts/app';
import { IPC_CHANNELS } from '../../shared/contracts/ipc';
import {
  GetSettingsInputSchema,
  SettingsResultSchema,
  UpdateSettingsInputSchema,
} from '../../shared/contracts/settings';
import type { FileLogger } from '../infrastructure/logging/file-logger';
import type { SettingsRepository } from '../repositories/settings-repository';
import type { IntegrationSettingsRepository } from '../repositories/integration-settings-repository';
import type { CatalogService } from '../services/catalog-service';
import type { ReleaseService } from '../services/release-service';
import type { SubtitleService } from '../services/subtitle-service';
import type { TorrentFileService } from '../services/torrent-file-service';
import type { WebTorrentService } from '../services/webtorrent-service';
import { createIpcRegistrar } from './ipc-helpers';
import { registerCatalogIpc } from './register-catalog-ipc';
import { registerMediaIpc } from './register-media-ipc';

interface RegisterIpcDependencies {
  window: BrowserWindow;
  settingsRepository: SettingsRepository;
  logger: FileLogger;
  catalogService: CatalogService;
  integrationSettings: IntegrationSettingsRepository;
  releaseService: ReleaseService;
  torrentFileService: TorrentFileService;
  webTorrentService: WebTorrentService;
  subtitleService: SubtitleService;
  getAppStatus: () => AppStatus;
}

export function registerIpc(dependencies: RegisterIpcDependencies): () => void {
  const {
    window, settingsRepository, logger, catalogService, integrationSettings,
    releaseService, torrentFileService, webTorrentService, subtitleService, getAppStatus,
  } = dependencies;
  const unregisterCatalogIpc = registerCatalogIpc({ window, catalogService, logger });
  const unregisterMediaIpc = registerMediaIpc({
    window,
    integrationSettings,
    releaseService,
    torrentFileService,
    webTorrentService,
    subtitleService,
  });
  const ipc = createIpcRegistrar(window, (operation, error, durationMs) => {
    logger.write({
      level: 'error',
      category: 'ipc',
      operation,
      message: error.message,
      durationMs,
      errorCode: error.code,
    });
  });

  ipc.handle(IPC_CHANNELS.appGetStatus, AppStatusResultSchema, (rawInput) => {
    AppStatusInputSchema.parse(rawInput);
    return { ok: true, data: getAppStatus() };
  });
  ipc.handle(IPC_CHANNELS.settingsGet, SettingsResultSchema, (rawInput) => {
    GetSettingsInputSchema.parse(rawInput);
    return { ok: true, data: settingsRepository.get() };
  });
  ipc.handle(IPC_CHANNELS.settingsUpdate, SettingsResultSchema, (rawInput) => {
    const input = UpdateSettingsInputSchema.parse(rawInput);
    return { ok: true, data: settingsRepository.update(input) };
  });

  return () => {
    unregisterCatalogIpc();
    unregisterMediaIpc();
    ipc.dispose();
  };
}
