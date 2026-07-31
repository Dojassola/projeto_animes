import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  CatalogCancelInputSchema,
  CatalogCancelResultSchema,
  CatalogCollectionResultSchema,
  CatalogDetailsInputSchema,
  CatalogDetailsResultSchema,
  CatalogHomeInputSchema,
  CatalogSearchInputSchema,
  EpisodeDetailsInputSchema,
  EpisodeDetailsResultSchema,
  WatchlistGetInputSchema,
  WatchlistResultSchema,
  WatchlistSetInputSchema,
  WatchlistSetResultSchema,
  type CatalogCancelResult,
  type CatalogCollectionResult,
  type CatalogDetailsResult,
  type EpisodeDetailsResult,
  type WatchlistResult,
  type WatchlistSetResult,
} from '../../shared/contracts/catalog';
import type { AppErrorDto } from '../../shared/errors/app-error';
import { IPC_CHANNELS } from '../../shared/contracts/ipc';
import type { FileLogger } from '../infrastructure/logging/file-logger';
import type { CatalogService } from '../services/catalog-service';
import { authorize, toErrorDto } from './ipc-helpers';

interface RegisterCatalogIpcDependencies {
  window: BrowserWindow;
  catalogService: CatalogService;
  logger: FileLogger;
}

function logFailure(
  logger: FileLogger,
  operation: string,
  error: AppErrorDto,
  startedAt: number,
): void {
  logger.write({
    level: 'error',
    category: 'catalog',
    operation,
    message: error.message,
    errorCode: error.code,
    durationMs: performance.now() - startedAt,
  });
}

export function registerCatalogIpc(dependencies: RegisterCatalogIpcDependencies): () => void {
  const { window, catalogService, logger } = dependencies;

  ipcMain.handle(IPC_CHANNELS.catalogHome, async (
    event: IpcMainInvokeEvent,
    rawInput: unknown,
  ): Promise<CatalogCollectionResult> => {
    const startedAt = performance.now();
    try {
      authorize(event, window);
      const input = CatalogHomeInputSchema.parse(rawInput);
      return CatalogCollectionResultSchema.parse({ ok: true, data: await catalogService.home(input) });
    } catch (error: unknown) {
      const errorDto = toErrorDto(error);
      logFailure(logger, IPC_CHANNELS.catalogHome, errorDto, startedAt);
      return CatalogCollectionResultSchema.parse({ ok: false, error: errorDto });
    }
  });

  ipcMain.handle(IPC_CHANNELS.catalogSearch, async (
    event: IpcMainInvokeEvent,
    rawInput: unknown,
  ): Promise<CatalogCollectionResult> => {
    const startedAt = performance.now();
    try {
      authorize(event, window);
      const input = CatalogSearchInputSchema.parse(rawInput);
      return CatalogCollectionResultSchema.parse({ ok: true, data: await catalogService.search(input) });
    } catch (error: unknown) {
      const errorDto = toErrorDto(error);
      logFailure(logger, IPC_CHANNELS.catalogSearch, errorDto, startedAt);
      return CatalogCollectionResultSchema.parse({ ok: false, error: errorDto });
    }
  });

  ipcMain.handle(IPC_CHANNELS.catalogDetails, async (
    event: IpcMainInvokeEvent,
    rawInput: unknown,
  ): Promise<CatalogDetailsResult> => {
    const startedAt = performance.now();
    try {
      authorize(event, window);
      const input = CatalogDetailsInputSchema.parse(rawInput);
      return CatalogDetailsResultSchema.parse({ ok: true, data: await catalogService.getDetails(input) });
    } catch (error: unknown) {
      const errorDto = toErrorDto(error);
      logFailure(logger, IPC_CHANNELS.catalogDetails, errorDto, startedAt);
      return CatalogDetailsResultSchema.parse({ ok: false, error: errorDto });
    }
  });

  ipcMain.handle(IPC_CHANNELS.catalogEpisodeDetails, async (
    event: IpcMainInvokeEvent,
    rawInput: unknown,
  ): Promise<EpisodeDetailsResult> => {
    const startedAt = performance.now();
    try {
      authorize(event, window);
      const input = EpisodeDetailsInputSchema.parse(rawInput);
      return EpisodeDetailsResultSchema.parse({ ok: true, data: await catalogService.getEpisodeDetails(input) });
    } catch (error: unknown) {
      const errorDto = toErrorDto(error);
      logFailure(logger, IPC_CHANNELS.catalogEpisodeDetails, errorDto, startedAt);
      return EpisodeDetailsResultSchema.parse({ ok: false, error: errorDto });
    }
  });

  ipcMain.handle(IPC_CHANNELS.catalogCancel, (
    event: IpcMainInvokeEvent,
    rawInput: unknown,
  ): CatalogCancelResult => {
    try {
      authorize(event, window);
      const input = CatalogCancelInputSchema.parse(rawInput);
      return CatalogCancelResultSchema.parse({
        ok: true,
        data: { cancelled: catalogService.cancel(input.requestId) },
      });
    } catch (error: unknown) {
      return CatalogCancelResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });

  ipcMain.handle(IPC_CHANNELS.watchlistGet, (
    event: IpcMainInvokeEvent,
    rawInput: unknown,
  ): WatchlistResult => {
    try {
      authorize(event, window);
      WatchlistGetInputSchema.parse(rawInput);
      return WatchlistResultSchema.parse({ ok: true, data: catalogService.getWatchlist() });
    } catch (error: unknown) {
      return WatchlistResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });

  ipcMain.handle(IPC_CHANNELS.watchlistSet, (
    event: IpcMainInvokeEvent,
    rawInput: unknown,
  ): WatchlistSetResult => {
    try {
      authorize(event, window);
      const input = WatchlistSetInputSchema.parse(rawInput);
      return WatchlistSetResultSchema.parse({
        ok: true,
        data: catalogService.setWatchStatus(input.animeId, input.status),
      });
    } catch (error: unknown) {
      return WatchlistSetResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.catalogHome);
    ipcMain.removeHandler(IPC_CHANNELS.catalogSearch);
    ipcMain.removeHandler(IPC_CHANNELS.catalogDetails);
    ipcMain.removeHandler(IPC_CHANNELS.catalogEpisodeDetails);
    ipcMain.removeHandler(IPC_CHANNELS.catalogCancel);
    ipcMain.removeHandler(IPC_CHANNELS.watchlistGet);
    ipcMain.removeHandler(IPC_CHANNELS.watchlistSet);
  };
}
