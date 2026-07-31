import { mkdir, readFile, rm } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';
import WebTorrent from 'webtorrent';
import {
  TorrentDownloadSchema,
  type TorrentControlInput,
  type TorrentDownload,
} from '../../shared/contracts/media';
import { ApplicationError } from '../domain/errors/application-error';
import type {
  StoredTorrentDownload,
  TorrentDownloadRepository,
} from '../repositories/torrent-download-repository';
import type { IntegrationSettingsRepository } from '../repositories/integration-settings-repository';
import type { TorrentFileService } from './torrent-file-service';

const DOWNLOADABLE_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.webm', '.avi', '.m4v', '.mov', '.ts', '.m2ts',
  '.srt', '.ass', '.ssa', '.vtt',
]);
const PLAYABLE_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v']);
const MAX_TORRENT_BYTES = 2 * 1024 ** 4;

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Falha no cliente torrent.';
  return message.slice(0, 500);
}

function safeName(value: string, fallback: string): string {
  const name = value.trim().slice(0, 1_024);
  return name.length === 0 ? fallback : name;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function validateTorrentContents(
  infoHash: string,
  length: number,
  files: readonly { path: string }[],
  destinationPath: string,
): void {
  if (files.length === 0 || files.length > 500 || length > MAX_TORRENT_BYTES) {
    throw new ApplicationError('INVALID_TORRENT_CONTENTS', 'A estrutura da release não é segura para download.', false);
  }
  const root = resolve(destinationPath, infoHash);
  for (const file of files) {
    const target = resolve(root, file.path);
    if (isAbsolute(file.path) || (target !== root && !target.startsWith(`${root}${sep}`))) {
      throw new ApplicationError('UNSAFE_TORRENT_PATH', 'A release contém um caminho de arquivo inseguro.', false);
    }
  }
}

export class WebTorrentService {
  private readonly client: WebTorrent.Instance;
  private readonly starts = new Map<string, Promise<TorrentDownload>>();
  private disposed = false;

  public constructor(
    private readonly settingsRepository: IntegrationSettingsRepository,
    private readonly downloads: TorrentDownloadRepository,
    private readonly torrentFiles: TorrentFileService,
  ) {
    const options = {
      maxConns: 40,
      lsd: false,
      utp: false,
      natUpnp: false,
      natPmp: false,
      seedOutgoingConnections: false,
      uploadLimit: 512 * 1024,
    };
    this.client = new WebTorrent(options);
    this.client.on('error', (error) => {
      if (this.disposed) return;
      const message = safeMessage(error);
      for (const torrent of this.client.torrents) {
        this.downloads.setState(torrent.infoHash, 'failed', message);
      }
    });
  }

  public restore(): void {
    for (const download of this.downloads.list()) {
      if (download.state === 'queued' || download.state === 'downloading') {
        void this.addStored(download).catch((error: unknown) => {
          this.downloads.setState(download.infoHash, 'failed', safeMessage(error));
        });
      }
    }
  }

  public async start(releaseId: string): Promise<TorrentDownload> {
    const existing = this.downloads.getByReleaseId(releaseId);
    if (existing !== null) return this.statusFor(existing);
    const pending = this.starts.get(releaseId);
    if (pending !== undefined) return pending;

    const operation = this.startNew(releaseId).finally(() => {
      this.starts.delete(releaseId);
    });
    this.starts.set(releaseId, operation);
    return operation;
  }

  private async startNew(releaseId: string): Promise<TorrentDownload> {
    const { filePath } = await this.torrentFiles.save(releaseId);
    const destinationPath = join(this.settingsRepository.get().torrentDownloadPath, 'Videos');
    if (!isAbsolute(destinationPath)) {
      throw new ApplicationError('INVALID_DOWNLOAD_PATH', 'Escolha uma pasta absoluta para os vídeos.', false);
    }
    await mkdir(destinationPath, { recursive: true });
    const torrent = await this.addTorrent({
      releaseId,
      infoHash: '0000000000000000000000000000000000000000',
      torrentFilePath: filePath,
      destinationPath,
      name: `Release ${releaseId}`,
      state: 'queued',
      error: null,
    });
    return this.statusFor(torrent);
  }

  private async addStored(download: StoredTorrentDownload): Promise<StoredTorrentDownload> {
    if (this.client.torrents.some((torrent) => torrent.infoHash === download.infoHash)) return download;
    return this.addTorrent(download);
  }

  private async addTorrent(download: StoredTorrentDownload): Promise<StoredTorrentDownload> {
    if (this.disposed) throw new ApplicationError('TORRENT_CLIENT_STOPPED', 'O cliente torrent está encerrado.', true);
    const bytes = await readFile(download.torrentFilePath);
    const options = {
      path: download.destinationPath,
      addUID: true,
      paused: true,
      deselect: true,
      destroyStoreOnDestroy: false,
      strategy: 'sequential',
    };
    return new Promise<StoredTorrentDownload>((resolveStart, rejectStart) => {
      let settled = false;
      let torrent: WebTorrent.Torrent;
      const reject = (error: unknown): void => {
        const applicationError = error instanceof ApplicationError
          ? error
          : new ApplicationError(
            'TORRENT_START_FAILED',
            `WebTorrent não iniciou: ${safeMessage(error)}`,
            true,
            { cause: error },
        );
        if (settled) {
          if (!this.disposed) {
            this.downloads.setState(torrent.infoHash, 'failed', applicationError.userMessage);
          }
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (download.infoHash !== '0000000000000000000000000000000000000000') {
          this.downloads.setState(download.infoHash, 'failed', applicationError.userMessage);
        }
        rejectStart(applicationError);
      };

      try {
        torrent = this.client.add(bytes, options, (readyTorrent) => {
          void this.onReady(readyTorrent, download).then((stored) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolveStart(stored);
          }).catch(reject);
        });
      } catch (error: unknown) {
        rejectStart(new ApplicationError(
          'TORRENT_START_FAILED',
          `WebTorrent não iniciou: ${safeMessage(error)}`,
          true,
          { cause: error },
        ));
        return;
      }
      const timeout = setTimeout(() => {
        torrent.destroy({ destroyStore: false });
        reject(new ApplicationError('TORRENT_START_TIMEOUT', 'O WebTorrent demorou demais para preparar a release.', true));
      }, 30_000);
      torrent.on('error', reject);
      torrent.on('done', () => {
        if (this.disposed) return;
        this.downloads.setState(torrent.infoHash, 'completed');
        void this.client.remove(torrent.infoHash, { destroyStore: false }).catch(() => undefined);
      });
    });
  }

  private async onReady(
    torrent: WebTorrent.Torrent,
    download: StoredTorrentDownload,
  ): Promise<StoredTorrentDownload> {
    try {
      validateTorrentContents(torrent.infoHash, torrent.length, torrent.files, download.destinationPath);
      const files = torrent.files.filter((file) => DOWNLOADABLE_EXTENSIONS.has(extname(file.name).toLocaleLowerCase('en')));
      if (!files.some((file) => !['.srt', '.ass', '.ssa', '.vtt'].includes(extname(file.name).toLocaleLowerCase('en')))) {
        throw new ApplicationError('TORRENT_WITHOUT_VIDEO', 'A release não contém um arquivo de vídeo reconhecido.', false);
      }
      if (download.infoHash !== '0000000000000000000000000000000000000000'
        && download.infoHash !== torrent.infoHash) {
        throw new ApplicationError('TORRENT_HASH_MISMATCH', 'O arquivo .torrent salvo não corresponde ao download.', false);
      }
      for (const file of files) file.select();
      const stored: StoredTorrentDownload = {
        ...download,
        infoHash: torrent.infoHash,
        name: safeName(torrent.name, download.name),
        state: 'downloading',
        error: null,
      };
      this.downloads.save(stored);
      torrent.resume();
      return stored;
    } catch (error: unknown) {
      await this.client.remove(torrent.infoHash, { destroyStore: true }).catch(() => undefined);
      throw error;
    }
  }

  public status(): TorrentDownload[] {
    const activeByHash = new Map(this.client.torrents.map((torrent) => [torrent.infoHash, torrent]));
    return this.downloads.list().map((row) => {
      const torrent = activeByHash.get(row.infoHash);
      if (torrent === undefined) return this.statusFor(row);
      const timeRemaining = torrent.timeRemaining;
      return TorrentDownloadSchema.parse({
        releaseId: row.releaseId,
        infoHash: row.infoHash,
        name: safeName(torrent.name, row.name),
        status: torrent.paused ? 'paused' : torrent.ready ? 'downloading' : 'queued',
        progress: Math.min(1, finiteNonNegative(torrent.progress)),
        downloadSpeed: finiteNonNegative(torrent.downloadSpeed),
        downloadedBytes: finiteNonNegative(torrent.downloaded),
        sizeBytes: finiteNonNegative(torrent.length),
        peers: Math.max(0, torrent.numPeers),
        timeRemainingMs: Number.isFinite(timeRemaining) && timeRemaining >= 0 ? timeRemaining : null,
        files: torrent.files
          .filter((file) => DOWNLOADABLE_EXTENSIONS.has(extname(file.name).toLocaleLowerCase('en')))
          .slice(0, 500)
          .map((file) => ({
            name: safeName(file.name, 'Arquivo'),
            sizeBytes: finiteNonNegative(file.length),
            progress: Math.min(1, finiteNonNegative(file.progress)),
            playable: PLAYABLE_EXTENSIONS.has(extname(file.name).toLocaleLowerCase('en')),
          })),
        error: row.error,
      });
    });
  }

  private statusFor(row: StoredTorrentDownload): TorrentDownload {
    return TorrentDownloadSchema.parse({
      releaseId: row.releaseId,
      infoHash: row.infoHash,
      name: row.name,
      status: row.state,
      progress: row.state === 'completed' ? 1 : 0,
      downloadSpeed: 0,
      downloadedBytes: 0,
      sizeBytes: 0,
      peers: 0,
      timeRemainingMs: null,
      files: [],
      error: row.error,
    });
  }

  public async control(input: TorrentControlInput): Promise<void> {
    const row = this.downloads.getByInfoHash(input.infoHash);
    if (row === null) throw new ApplicationError('TORRENT_NOT_FOUND', 'O download não foi encontrado.', false);
    const active = this.client.torrents.find((torrent) => torrent.infoHash === input.infoHash);

    if (input.action === 'pause') {
      this.downloads.setState(input.infoHash, 'paused');
      if (active !== undefined) await this.client.remove(input.infoHash, { destroyStore: false });
      return;
    }
    if (input.action === 'resume') {
      if (active === undefined) await this.addStored({ ...row, state: 'queued', error: null });
      return;
    }
    if (active !== undefined) {
      await this.client.remove(input.infoHash, { destroyStore: input.deleteFiles });
    } else if (input.deleteFiles) {
      const target = resolve(row.destinationPath, row.infoHash);
      const root = resolve(row.destinationPath);
      if (target === root || !target.startsWith(`${root}${sep}`)) {
        throw new ApplicationError('UNSAFE_DELETE_PATH', 'A pasta do download é inválida.', false);
      }
      await rm(target, { recursive: true, force: true });
    }
    this.downloads.remove(input.infoHash);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.client.destroy();
  }
}
