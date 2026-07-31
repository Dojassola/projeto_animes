import { contextBridge, ipcRenderer } from 'electron';
import { AppStatusResultSchema } from '../shared/contracts/app';
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
  WatchlistResultSchema,
  WatchlistSetInputSchema,
  WatchlistSetResultSchema,
} from '../shared/contracts/catalog';
import type { KitsuneDesktopApi } from '../shared/contracts/desktop-api';
import { IPC_CHANNELS } from '../shared/contracts/ipc';
import {
  ChooseDownloadPathResultSchema,
  IntegrationSettingsResultSchema,
  MediaCancelInputSchema,
  OperationResultSchema,
  ReleaseDownloadInputSchema,
  ReleaseDownloadResultSchema,
  ReleaseSearchInputSchema,
  ReleaseSearchResultSchema,
  SubtitleDownloadInputSchema,
  SubtitleDownloadResultSchema,
  SubtitleSearchInputSchema,
  SubtitleSearchResultSchema,
  TorrentControlInputSchema,
  TorrentStartInputSchema,
  TorrentStartResultSchema,
  TorrentStatusResultSchema,
  UpdateIntegrationSettingsInputSchema,
} from '../shared/contracts/media';
import {
  SettingsResultSchema,
  UpdateSettingsInputSchema,
} from '../shared/contracts/settings';

const api = {
  app: {
    getStatus: async () =>
      AppStatusResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.appGetStatus, {}),
      ),
  },
  settings: {
    get: async () =>
      SettingsResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.settingsGet, {}),
      ),
    update: async (input) =>
      SettingsResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.settingsUpdate,
          UpdateSettingsInputSchema.parse(input),
        ),
      ),
  },
  catalog: {
    home: async (input) =>
      CatalogCollectionResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.catalogHome, CatalogHomeInputSchema.parse(input)),
      ),
    search: async (input) =>
      CatalogCollectionResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.catalogSearch, CatalogSearchInputSchema.parse(input)),
      ),
    getDetails: async (input) =>
      CatalogDetailsResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.catalogDetails, CatalogDetailsInputSchema.parse(input)),
      ),
    getEpisodeDetails: async (input) =>
      EpisodeDetailsResultSchema.parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.catalogEpisodeDetails,
          EpisodeDetailsInputSchema.parse(input),
        ),
      ),
    cancel: async (input) =>
      CatalogCancelResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.catalogCancel, CatalogCancelInputSchema.parse(input)),
      ),
  },
  watchlist: {
    get: async () =>
      WatchlistResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.watchlistGet, {})),
    set: async (input) =>
      WatchlistSetResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.watchlistSet, WatchlistSetInputSchema.parse(input)),
      ),
  },
  integrations: {
    get: async () =>
      IntegrationSettingsResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.integrationsGet, {})),
    update: async (input) =>
      IntegrationSettingsResultSchema.parse(await ipcRenderer.invoke(
        IPC_CHANNELS.integrationsUpdate,
        UpdateIntegrationSettingsInputSchema.parse(input),
      )),
    chooseDownloadPath: async () =>
      ChooseDownloadPathResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.integrationsChooseDownloadPath, {}),
      ),
  },
  releases: {
    search: async (input) =>
      ReleaseSearchResultSchema.parse(await ipcRenderer.invoke(
        IPC_CHANNELS.releasesSearch,
        ReleaseSearchInputSchema.parse(input),
      )),
    download: async (input) =>
      ReleaseDownloadResultSchema.parse(await ipcRenderer.invoke(
        IPC_CHANNELS.releasesDownload,
        ReleaseDownloadInputSchema.parse(input),
      )),
    cancel: async (input) =>
      OperationResultSchema.parse(await ipcRenderer.invoke(
        IPC_CHANNELS.mediaCancel,
        MediaCancelInputSchema.parse(input),
      )),
  },
  torrents: {
    start: async (input) =>
      TorrentStartResultSchema.parse(await ipcRenderer.invoke(
        IPC_CHANNELS.torrentsStart,
        TorrentStartInputSchema.parse(input),
      )),
    status: async () =>
      TorrentStatusResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.torrentsStatus, {})),
    control: async (input) =>
      OperationResultSchema.parse(await ipcRenderer.invoke(
        IPC_CHANNELS.torrentsControl,
        TorrentControlInputSchema.parse(input),
      )),
  },
  subtitles: {
    search: async (input) =>
      SubtitleSearchResultSchema.parse(await ipcRenderer.invoke(
        IPC_CHANNELS.subtitlesSearch,
        SubtitleSearchInputSchema.parse(input),
      )),
    download: async (input) =>
      SubtitleDownloadResultSchema.parse(await ipcRenderer.invoke(
        IPC_CHANNELS.subtitlesDownload,
        SubtitleDownloadInputSchema.parse(input),
      )),
  },
} satisfies KitsuneDesktopApi;

contextBridge.exposeInMainWorld('kitsune', api);
