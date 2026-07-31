import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
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
import { authorize, toErrorDto } from './ipc-helpers';

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

  ipcMain.handle(IPC_CHANNELS.integrationsGet, (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      MediaCancelInputSchema.omit({ requestId: true }).parse(raw);
      return IntegrationSettingsResultSchema.parse({ ok: true, data: integrationSettings.get() });
    } catch (error: unknown) {
      return IntegrationSettingsResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });
  ipcMain.handle(IPC_CHANNELS.integrationsUpdate, (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      const input = UpdateIntegrationSettingsInputSchema.parse(raw);
      return IntegrationSettingsResultSchema.parse({ ok: true, data: integrationSettings.update(input) });
    } catch (error: unknown) {
      return IntegrationSettingsResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });
  ipcMain.handle(IPC_CHANNELS.integrationsChooseDownloadPath, async (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      MediaCancelInputSchema.omit({ requestId: true }).parse(raw);
      const result = await dialog.showOpenDialog(window, {
        title: 'Escolher pasta para arquivos .torrent',
        defaultPath: integrationSettings.get().torrentDownloadPath,
        properties: ['openDirectory', 'createDirectory'],
      });
      const selected = result.filePaths[0];
      const data = selected === undefined ? integrationSettings.get() : integrationSettings.setDownloadPath(selected);
      return ChooseDownloadPathResultSchema.parse({ ok: true, data });
    } catch (error: unknown) {
      return ChooseDownloadPathResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });
  ipcMain.handle(IPC_CHANNELS.releasesSearch, async (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      const input = ReleaseSearchInputSchema.parse(raw);
      const controller = new AbortController();
      requests.set(input.requestId, controller);
      try {
        const result = await releaseService.search(input.animeId, input.episode, controller.signal);
        return ReleaseSearchResultSchema.parse({ ok: true, data: result.data, stale: result.stale });
      } finally {
        if (requests.get(input.requestId) === controller) requests.delete(input.requestId);
      }
    } catch (error: unknown) {
      return ReleaseSearchResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });
  ipcMain.handle(IPC_CHANNELS.releasesDownload, async (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      const input = ReleaseDownloadInputSchema.parse(raw);
      const data = await torrentFileService.save(input.releaseId);
      return ReleaseDownloadResultSchema.parse({ ok: true, data });
    } catch (error: unknown) {
      return ReleaseDownloadResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });
  ipcMain.handle(IPC_CHANNELS.mediaCancel, (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      const input = MediaCancelInputSchema.parse(raw);
      requests.get(input.requestId)?.abort();
      requests.delete(input.requestId);
      return OperationResultSchema.parse({ ok: true });
    } catch (error: unknown) {
      return OperationResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });
  ipcMain.handle(IPC_CHANNELS.torrentsStart, async (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      const input = TorrentStartInputSchema.parse(raw);
      return TorrentStartResultSchema.parse({ ok: true, data: await webTorrentService.start(input.releaseId) });
    } catch (error: unknown) {
      return TorrentStartResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });
  ipcMain.handle(IPC_CHANNELS.torrentsStatus, (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      MediaCancelInputSchema.omit({ requestId: true }).parse(raw);
      return TorrentStatusResultSchema.parse({ ok: true, data: webTorrentService.status() });
    } catch (error: unknown) {
      return TorrentStatusResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });
  ipcMain.handle(IPC_CHANNELS.torrentsControl, async (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      const input = TorrentControlInputSchema.parse(raw);
      await webTorrentService.control(input);
      return OperationResultSchema.parse({ ok: true });
    } catch (error: unknown) {
      return OperationResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });
  ipcMain.handle(IPC_CHANNELS.subtitlesSearch, async (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      const input = SubtitleSearchInputSchema.parse(raw);
      const controller = new AbortController();
      requests.set(input.requestId, controller);
      try {
        const data = await subtitleService.search(input.animeId, input.episode, controller.signal);
        return SubtitleSearchResultSchema.parse({ ok: true, data });
      } finally {
        if (requests.get(input.requestId) === controller) requests.delete(input.requestId);
      }
    } catch (error: unknown) {
      return SubtitleSearchResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });
  ipcMain.handle(IPC_CHANNELS.subtitlesDownload, async (event: IpcMainInvokeEvent, raw: unknown) => {
    try {
      authorize(event, window);
      const input = SubtitleDownloadInputSchema.parse(raw);
      const data = await subtitleService.download(input.animeId, input.episode, input.fileId);
      return SubtitleDownloadResultSchema.parse({ ok: true, ...data });
    } catch (error: unknown) {
      return SubtitleDownloadResultSchema.parse({ ok: false, error: toErrorDto(error) });
    }
  });

  return () => {
    for (const controller of requests.values()) controller.abort();
    requests.clear();
    for (const channel of [
      IPC_CHANNELS.integrationsGet,
      IPC_CHANNELS.integrationsUpdate,
      IPC_CHANNELS.integrationsChooseDownloadPath,
      IPC_CHANNELS.releasesSearch,
      IPC_CHANNELS.releasesDownload,
      IPC_CHANNELS.mediaCancel,
      IPC_CHANNELS.torrentsStart,
      IPC_CHANNELS.torrentsStatus,
      IPC_CHANNELS.torrentsControl,
      IPC_CHANNELS.subtitlesSearch,
      IPC_CHANNELS.subtitlesDownload,
    ]) ipcMain.removeHandler(channel);
  };
}
