import type { BrowserWindow } from 'electron';
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
} from '../../shared/contracts/catalog';
import { IPC_CHANNELS } from '../../shared/contracts/ipc';
import type { FileLogger } from '../infrastructure/logging/file-logger';
import type { CatalogService } from '../services/catalog-service';
import { createIpcRegistrar } from './ipc-helpers';

interface RegisterCatalogIpcDependencies {
  window: BrowserWindow;
  catalogService: CatalogService;
  logger: FileLogger;
}

export function registerCatalogIpc(dependencies: RegisterCatalogIpcDependencies): () => void {
  const { window, catalogService, logger } = dependencies;
  const ipc = createIpcRegistrar(window, (operation, error, durationMs) => {
    logger.write({
      level: 'error',
      category: 'catalog',
      operation,
      message: error.message,
      errorCode: error.code,
      durationMs,
    });
  });

  ipc.handle(IPC_CHANNELS.catalogHome, CatalogCollectionResultSchema, async (rawInput) => {
    const input = CatalogHomeInputSchema.parse(rawInput);
    return { ok: true, data: await catalogService.home(input) };
  });
  ipc.handle(IPC_CHANNELS.catalogSearch, CatalogCollectionResultSchema, async (rawInput) => {
    const input = CatalogSearchInputSchema.parse(rawInput);
    return { ok: true, data: await catalogService.search(input) };
  });
  ipc.handle(IPC_CHANNELS.catalogDetails, CatalogDetailsResultSchema, async (rawInput) => {
    const input = CatalogDetailsInputSchema.parse(rawInput);
    return { ok: true, data: await catalogService.getDetails(input) };
  });
  ipc.handle(IPC_CHANNELS.catalogEpisodeDetails, EpisodeDetailsResultSchema, async (rawInput) => {
    const input = EpisodeDetailsInputSchema.parse(rawInput);
    return { ok: true, data: await catalogService.getEpisodeDetails(input) };
  });
  ipc.handle(IPC_CHANNELS.catalogCancel, CatalogCancelResultSchema, (rawInput) => {
    const input = CatalogCancelInputSchema.parse(rawInput);
    return { ok: true, data: { cancelled: catalogService.cancel(input.requestId) } };
  });
  ipc.handle(IPC_CHANNELS.watchlistGet, WatchlistResultSchema, (rawInput) => {
    WatchlistGetInputSchema.parse(rawInput);
    return { ok: true, data: catalogService.getWatchlist() };
  });
  ipc.handle(IPC_CHANNELS.watchlistSet, WatchlistSetResultSchema, (rawInput) => {
    const input = WatchlistSetInputSchema.parse(rawInput);
    return { ok: true, data: catalogService.setWatchStatus(input.animeId, input.status) };
  });

  return ipc.dispose;
}
