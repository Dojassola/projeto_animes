import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  AppStatusInputSchema,
  AppStatusResultSchema,
  type AppStatus,
  type AppStatusResult,
} from '../../shared/contracts/app';
import { IPC_CHANNELS } from '../../shared/contracts/ipc';
import {
  GetSettingsInputSchema,
  SettingsResultSchema,
  UpdateSettingsInputSchema,
  type SettingsResult,
} from '../../shared/contracts/settings';
import type { FileLogger } from '../infrastructure/logging/file-logger';
import type { SettingsRepository } from '../repositories/settings-repository';
import type { IntegrationSettingsRepository } from '../repositories/integration-settings-repository';
import type { CatalogService } from '../services/catalog-service';
import type { ReleaseService } from '../services/release-service';
import type { SubtitleService } from '../services/subtitle-service';
import type { TorrentFileService } from '../services/torrent-file-service';
import type { WebTorrentService } from '../services/webtorrent-service';
import { authorize, toErrorDto } from './ipc-helpers';
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

  ipcMain.handle(
    IPC_CHANNELS.appGetStatus,
    (event: IpcMainInvokeEvent, rawInput: unknown): AppStatusResult => {
      const startedAt = performance.now();
      try {
        authorize(event, window);
        AppStatusInputSchema.parse(rawInput);
        return AppStatusResultSchema.parse({ ok: true, data: getAppStatus() });
      } catch (error: unknown) {
        const errorDto = toErrorDto(error);
        const result = AppStatusResultSchema.parse({ ok: false, error: errorDto });
        logger.write({
          level: 'error',
          category: 'ipc',
          operation: IPC_CHANNELS.appGetStatus,
          message: errorDto.message,
          durationMs: performance.now() - startedAt,
          errorCode: errorDto.code,
        });
        return result;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.settingsGet,
    (event: IpcMainInvokeEvent, rawInput: unknown): SettingsResult => {
      try {
        authorize(event, window);
        GetSettingsInputSchema.parse(rawInput);
        return SettingsResultSchema.parse({ ok: true, data: settingsRepository.get() });
      } catch (error: unknown) {
        return SettingsResultSchema.parse({ ok: false, error: toErrorDto(error) });
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.settingsUpdate,
    (event: IpcMainInvokeEvent, rawInput: unknown): SettingsResult => {
      try {
        authorize(event, window);
        const input = UpdateSettingsInputSchema.parse(rawInput);
        return SettingsResultSchema.parse({ ok: true, data: settingsRepository.update(input) });
      } catch (error: unknown) {
        return SettingsResultSchema.parse({ ok: false, error: toErrorDto(error) });
      }
    },
  );

  return () => {
    unregisterCatalogIpc();
    unregisterMediaIpc();
    ipcMain.removeHandler(IPC_CHANNELS.appGetStatus);
    ipcMain.removeHandler(IPC_CHANNELS.settingsGet);
    ipcMain.removeHandler(IPC_CHANNELS.settingsUpdate);
  };
}
