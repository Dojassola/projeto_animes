import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { ApplicationError } from '../domain/errors/application-error';
import type { IntegrationSettingsRepository } from '../repositories/integration-settings-repository';

export class TorrentFileService {
  public constructor(
    private readonly settingsRepository: IntegrationSettingsRepository,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async save(releaseId: string): Promise<{ filePath: string }> {
    const downloadPath = this.settingsRepository.get().torrentDownloadPath;
    if (!isAbsolute(downloadPath)) {
      throw new ApplicationError('INVALID_DOWNLOAD_PATH', 'Escolha uma pasta absoluta para salvar torrents.', false);
    }

    let response: Response;
    try {
      response = await this.fetcher(`https://nyaa.si/download/${releaseId}.torrent`, {
        headers: { Accept: 'application/x-bittorrent', 'User-Agent': 'Kitsune/0.1.0' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (cause: unknown) {
      throw new ApplicationError('TORRENT_FILE_UNAVAILABLE', 'Não foi possível baixar o arquivo .torrent.', true, { cause });
    }
    if (!response.ok) {
      throw new ApplicationError('TORRENT_FILE_UNAVAILABLE', `O Nyaa recusou o arquivo .torrent (${String(response.status)}).`, true);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024 || bytes[0] !== 0x64) {
      throw new ApplicationError('INVALID_TORRENT_FILE', 'O Nyaa retornou um arquivo .torrent inválido.', false);
    }

    const directory = join(downloadPath, 'Torrents');
    const filePath = join(directory, `${releaseId}.torrent`);
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, bytes);
    return { filePath };
  }
}
