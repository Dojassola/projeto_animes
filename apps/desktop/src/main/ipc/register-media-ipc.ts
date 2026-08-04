import { dialog, type BrowserWindow } from 'electron';
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
} from '../../shared/contracts/media';
import { IPC_CHANNELS } from '../../shared/contracts/ipc';
import type { IntegrationSettingsRepository } from '../repositories/integration-settings-repository';
import type { ReleaseService } from '../services/release-service';
import type { SubtitleService } from '../services/subtitle-service';
import type { TorrentFileService } from '../services/torrent-file-service';
import type { WebTorrentService } from '../services/webtorrent-service';
import { createIpcRegistrar } from './ipc-helpers';

interface Dependencies {
  window: BrowserWindow;
  integrationSettings: IntegrationSettingsRepository;
  releaseService: ReleaseService;
  torrentFileService: TorrentFileService;
  webTorrentService: WebTorrentService;
  subtitleService: SubtitleService;
}

export function registerMediaIpc(dependencies: Dependencies): () => void {
  const {
    window, integrationSettings, releaseService, torrentFileService, webTorrentService, subtitleService,
  } = dependencies;
  const requests = new Map<string, AbortController>();
  const ipc = createIpcRegistrar(window);

  ipc.handle(IPC_CHANNELS.integrationsGet, IntegrationSettingsResultSchema, (raw) => {
    MediaCancelInputSchema.omit({ requestId: true }).parse(raw);
    return { ok: true, data: integrationSettings.get() };
  });
  ipc.handle(IPC_CHANNELS.integrationsUpdate, IntegrationSettingsResultSchema, (raw) => {
    const input = UpdateIntegrationSettingsInputSchema.parse(raw);
    return { ok: true, data: integrationSettings.update(input) };
  });
  ipc.handle(IPC_CHANNELS.integrationsChooseDownloadPath, ChooseDownloadPathResultSchema, async (raw) => {
    MediaCancelInputSchema.omit({ requestId: true }).parse(raw);
    const result = await dialog.showOpenDialog(window, {
      title: 'Escolher pasta para arquivos .torrent',
      defaultPath: integrationSettings.get().torrentDownloadPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    const selected = result.filePaths[0];
    const data = selected === undefined ? integrationSettings.get() : integrationSettings.setDownloadPath(selected);
    return { ok: true, data };
  });
  ipc.handle(IPC_CHANNELS.releasesSearch, ReleaseSearchResultSchema, async (raw) => {
    const input = ReleaseSearchInputSchema.parse(raw);
    const controller = new AbortController();
    requests.set(input.requestId, controller);
    try {
      const result = await releaseService.search(input.animeId, input.episode, input.provider, controller.signal);
      return { ok: true, data: result.data, stale: result.stale, stats: result.stats };
    } finally {
      if (requests.get(input.requestId) === controller) requests.delete(input.requestId);
    }
  });
  ipc.handle(IPC_CHANNELS.releasesDownload, ReleaseDownloadResultSchema, async (raw) => {
    const input = ReleaseDownloadInputSchema.parse(raw);
    return { ok: true, data: await torrentFileService.save(input.releaseId) };
  });
  ipc.handle(IPC_CHANNELS.mediaCancel, OperationResultSchema, (raw) => {
    const input = MediaCancelInputSchema.parse(raw);
    requests.get(input.requestId)?.abort();
    requests.delete(input.requestId);
    return { ok: true };
  });
  ipc.handle(IPC_CHANNELS.torrentsStart, TorrentStartResultSchema, async (raw) => {
    const input = TorrentStartInputSchema.parse(raw);
    return { ok: true, data: await webTorrentService.start(input.releaseId) };
  });
  ipc.handle(IPC_CHANNELS.torrentsStatus, TorrentStatusResultSchema, (raw) => {
    MediaCancelInputSchema.omit({ requestId: true }).parse(raw);
    return { ok: true, data: webTorrentService.status() };
  });
  ipc.handle(IPC_CHANNELS.torrentsControl, OperationResultSchema, async (raw) => {
    const input = TorrentControlInputSchema.parse(raw);
    await webTorrentService.control(input);
    return { ok: true };
  });
  ipc.handle(IPC_CHANNELS.subtitlesSearch, SubtitleSearchResultSchema, async (raw) => {
    const input = SubtitleSearchInputSchema.parse(raw);
    const controller = new AbortController();
    requests.set(input.requestId, controller);
    try {
      return { ok: true, data: await subtitleService.search(input.animeId, input.episode, controller.signal) };
    } finally {
      if (requests.get(input.requestId) === controller) requests.delete(input.requestId);
    }
  });
  ipc.handle(IPC_CHANNELS.subtitlesDownload, SubtitleDownloadResultSchema, async (raw) => {
    const input = SubtitleDownloadInputSchema.parse(raw);
    return { ok: true, ...await subtitleService.download(input.animeId, input.episode, input.fileId) };
  });

  return () => {
    for (const controller of requests.values()) controller.abort();
    requests.clear();
    ipc.dispose();
  };
}
