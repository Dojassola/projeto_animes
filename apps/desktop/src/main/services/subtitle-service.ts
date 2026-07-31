import { basename, extname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { SubtitleCandidateArraySchema } from '../../shared/contracts/media';
import { ApplicationError } from '../domain/errors/application-error';
import type { CatalogRepository } from '../repositories/catalog-repository';
import type { IntegrationSettingsRepository } from '../repositories/integration-settings-repository';
import type { ProviderCacheRepository } from '../repositories/provider-cache-repository';

const API_URL = 'https://api.opensubtitles.com/api/v1';
const SearchEnvelopeSchema = z.object({
  data: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    attributes: z.object({
      language: z.string(),
      download_count: z.number().int().nonnegative().default(0),
      hearing_impaired: z.boolean().default(false),
      from_trusted: z.boolean().default(false),
      release: z.string().nullable().default(null),
      files: z.array(z.object({
        file_id: z.number().int().positive(),
        file_name: z.string().nullable().default(null),
      })).min(1),
    }),
  })),
});
const LoginSchema = z.object({ token: z.string().min(1) });
const DownloadSchema = z.object({ link: z.url(), file_name: z.string().min(1) });
type SubtitleCandidate = z.infer<typeof SubtitleCandidateArraySchema>[number];

function scoreSubtitle(candidate: Omit<SubtitleCandidate, 'score'>, languages: string[], title: string): number {
  const languageIndex = languages.indexOf(candidate.language);
  let score = languageIndex < 0 ? 0 : 50 - languageIndex * 10;
  if (candidate.trusted) score += 15;
  if (candidate.release.toLocaleLowerCase('en').includes(title.toLocaleLowerCase('en'))) score += 10;
  score += Math.min(10, Math.ceil(Math.log2(candidate.downloadCount + 1)));
  if (candidate.hearingImpaired) score -= 2;
  return score;
}

export class SubtitleService {
  private token: string | null = null;

  public constructor(
    private readonly catalogRepository: CatalogRepository,
    private readonly settingsRepository: IntegrationSettingsRepository,
    private readonly cacheRepository: ProviderCacheRepository,
  ) {}

  private async headers(): Promise<Headers> {
    const settings = this.settingsRepository.get();
    const secrets = this.settingsRepository.secrets();
    if (secrets.openSubtitlesApiKey === null) {
      throw new ApplicationError('OPENSUBTITLES_API_KEY_REQUIRED', 'Informe sua chave da API OpenSubtitles nas configurações.', false);
    }
    const headers = new Headers({
      'Api-Key': secrets.openSubtitlesApiKey,
      'User-Agent': 'Kitsune v0.1.0',
      Accept: 'application/json',
    });
    if (
      this.token === null
      && settings.openSubtitles.username.length > 0
      && secrets.openSubtitlesPassword !== null
    ) {
      const response = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: new Headers({ ...Object.fromEntries(headers), 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          username: settings.openSubtitles.username,
          password: secrets.openSubtitlesPassword,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new ApplicationError('OPENSUBTITLES_AUTH_FAILED', 'OpenSubtitles recusou as credenciais.', false);
      this.token = LoginSchema.parse(await response.json()).token;
    }
    if (this.token !== null) headers.set('Authorization', `Bearer ${this.token}`);
    return headers;
  }

  public async search(animeId: string, episode: number | null, signal: AbortSignal): Promise<SubtitleCandidate[]> {
    const anime = this.catalogRepository.getDetails(animeId);
    if (anime === undefined) throw new ApplicationError('ANIME_NOT_FOUND', 'Anime não encontrado.', false);
    const settings = this.settingsRepository.get();
    const cacheKey = `opensubtitles:v1:${String(anime.malId ?? anime.anilistId)}:${String(episode ?? 0)}:${settings.subtitleLanguages.join(',')}`;
    const cached = this.cacheRepository.get(cacheKey, SubtitleCandidateArraySchema);
    if (cached !== undefined && !cached.expired) return cached.value;
    const query = new URLSearchParams({
      languages: settings.subtitleLanguages.join(','),
      order_by: 'download_count',
      order_direction: 'desc',
      query: anime.title.english ?? anime.title.romaji,
    });
    if (episode !== null) {
      query.set('episode_number', String(episode));
      query.set('type', 'episode');
    } else query.set('type', 'movie');
    let response: Response;
    try {
      response = await fetch(`${API_URL}/subtitles?${query.toString()}`, {
        headers: await this.headers(),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
    } catch (cause: unknown) {
      if (cached !== undefined) return cached.value;
      throw new ApplicationError('OPENSUBTITLES_UNAVAILABLE', 'OpenSubtitles não respondeu.', true, { cause });
    }
    if (!response.ok) throw new ApplicationError('OPENSUBTITLES_REQUEST_FAILED', `OpenSubtitles recusou a busca (${String(response.status)}).`, true);
    const payload = SearchEnvelopeSchema.parse(await response.json());
    const title = anime.title.english ?? anime.title.romaji;
    const candidates = SubtitleCandidateArraySchema.parse(payload.data.flatMap((item) => {
      const file = item.attributes.files[0];
      if (file === undefined) return [];
      const base = {
        id: String(item.id),
        fileId: file.file_id,
        language: item.attributes.language.toLocaleLowerCase('en'),
        release: item.attributes.release ?? file.file_name ?? title,
        downloadCount: item.attributes.download_count,
        hearingImpaired: item.attributes.hearing_impaired,
        trusted: item.attributes.from_trusted,
      };
      return [{ ...base, score: scoreSubtitle(base, settings.subtitleLanguages, title) }];
    }).sort((left, right) => right.score - left.score).slice(0, 100));
    this.cacheRepository.set(cacheKey, candidates, 10 * 60_000, SubtitleCandidateArraySchema);
    return candidates;
  }

  public async download(animeId: string, episode: number | null, fileId: number): Promise<{ fileName: string; directory: string }> {
    if (this.catalogRepository.getDetails(animeId) === undefined) {
      throw new ApplicationError('ANIME_NOT_FOUND', 'Anime não encontrado.', false);
    }
    const response = await fetch(`${API_URL}/download`, {
      method: 'POST',
      headers: new Headers({ ...Object.fromEntries(await this.headers()), 'Content-Type': 'application/json' }),
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new ApplicationError('SUBTITLE_DOWNLOAD_REJECTED', `OpenSubtitles recusou o download (${String(response.status)}).`, true);
    const download = DownloadSchema.parse(await response.json());
    const link = new URL(download.link);
    if (link.protocol !== 'https:') throw new ApplicationError('UNSAFE_SUBTITLE_URL', 'O provedor retornou um link inseguro.', false);
    const fileResponse = await fetch(link, { signal: AbortSignal.timeout(20_000) });
    if (!fileResponse.ok) throw new ApplicationError('SUBTITLE_DOWNLOAD_FAILED', 'Não foi possível baixar o arquivo de legenda.', true);
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    if (bytes.byteLength > 10 * 1024 * 1024) throw new ApplicationError('SUBTITLE_TOO_LARGE', 'A legenda excede o limite de 10 MB.', false);
    const printableName = Array.from(basename(download.file_name), (character) =>
      character.charCodeAt(0) < 32 ? '_' : character).join('');
    const rawName = printableName.replace(/[<>:"/\\|?*]/g, '_');
    const extension = extname(rawName).toLocaleLowerCase('en');
    const fileName = ['.srt', '.ass', '.ssa', '.vtt', '.sub'].includes(extension) ? rawName : `${rawName}.srt`;
    const directory = join(
      this.settingsRepository.get().torrentDownloadPath,
      'Legendas',
      animeId,
      episode === null ? 'filme' : `episodio-${String(episode)}`,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, fileName), bytes, { flag: 'wx' }).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return;
      throw error;
    });
    return { fileName, directory };
  }
}
