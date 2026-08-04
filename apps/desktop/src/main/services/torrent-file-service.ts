import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  MagnetUriSchema,
  ReleaseIdSchema,
  TorrentProviderIdSchema,
  type TorrentProviderId,
} from '../../shared/contracts/media';
import { ApplicationError } from '../domain/errors/application-error';
import type { TorrentSearchProvider } from '../providers/torrent-search-provider';
import type { IntegrationSettingsRepository } from '../repositories/integration-settings-repository';

export class TorrentFileService {
  public constructor(
    private readonly settingsRepository: IntegrationSettingsRepository,
    providers: readonly TorrentSearchProvider[],
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  private readonly providers: ReadonlyMap<TorrentProviderId, TorrentSearchProvider>;

  public async save(releaseId: string): Promise<{ filePath: string }> {
    const validReleaseId = ReleaseIdSchema.parse(releaseId);
    const separator = validReleaseId.indexOf(':');
    const providerId = TorrentProviderIdSchema.parse(validReleaseId.slice(0, separator));
    const sourceId = validReleaseId.slice(separator + 1);
    const provider = this.providers.get(providerId);
    if (provider === undefined) throw new ApplicationError('TORRENT_PROVIDER_UNAVAILABLE', 'O provedor da release não está disponível.', true);
    const downloadPath = this.settingsRepository.get().torrentDownloadPath;
    if (!isAbsolute(downloadPath)) {
      throw new ApplicationError('INVALID_DOWNLOAD_PATH', 'Escolha uma pasta absoluta para salvar torrents.', false);
    }

    let url: URL;
    try {
      url = await provider.resolveTorrentUrl(sourceId, AbortSignal.timeout(15_000));
    } catch (cause: unknown) {
      throw new ApplicationError('TORRENT_FILE_UNAVAILABLE', 'Não foi possível obter a fonte torrent.', true, { cause });
    }

    const directory = join(downloadPath, 'Torrents');
    await mkdir(directory, { recursive: true });
    if (url.protocol === 'magnet:') {
      const magnet = MagnetUriSchema.parse(url.toString());
      const filePath = join(directory, `${providerId}-${sourceId}.magnet`);
      await writeFile(filePath, magnet, 'utf8');
      return { filePath };
    }
    if (url.protocol !== 'https:') {
      throw new ApplicationError('INVALID_TORRENT_URL', 'O provedor retornou uma URL torrent insegura.', false);
    }

    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { Accept: 'application/x-bittorrent', 'User-Agent': 'Kitsune/0.1.0' },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (cause: unknown) {
      throw new ApplicationError('TORRENT_FILE_UNAVAILABLE', 'Não foi possível baixar o arquivo .torrent.', true, { cause });
    }
    if (!response.ok) {
      throw new ApplicationError('TORRENT_FILE_UNAVAILABLE', `${provider.name} recusou o arquivo .torrent (${String(response.status)}).`, true);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024 || bytes[0] !== 0x64) {
      throw new ApplicationError('INVALID_TORRENT_FILE', `${provider.name} retornou um arquivo .torrent inválido.`, false);
    }

    const filePath = join(directory, `${providerId}-${sourceId}.torrent`);
    await writeFile(filePath, bytes);
    return { filePath };
  }
}
