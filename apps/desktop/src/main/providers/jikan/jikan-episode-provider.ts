import { z } from 'zod';
import { EpisodeSchema } from '../../../shared/contracts/catalog';
import { ApplicationError } from '../../domain/errors/application-error';

const JIKAN_URL = 'https://api.jikan.moe/v4';
const REQUEST_INTERVAL_MS = 350;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_PAGES = 25;

export const EpisodeMetadataSchema = EpisodeSchema.omit({ id: true });
export const EpisodeMetadataArraySchema = z.array(EpisodeMetadataSchema).max(2_500);
export type EpisodeMetadata = z.infer<typeof EpisodeMetadataSchema>;

const RawEpisodeSchema = z.object({
  mal_id: z.number().int().positive(),
  title: z.string().min(1).nullable(),
  title_japanese: z.string().min(1).nullable(),
  title_romanji: z.string().min(1).nullable(),
  aired: z.iso.datetime({ offset: true }).nullable(),
  filler: z.boolean(),
  recap: z.boolean(),
  synopsis: z.string().min(1).nullable().optional(),
  duration: z.number().int().positive().nullable().optional(),
});
const PaginationSchema = z.object({
  has_next_page: z.boolean(),
  last_visible_page: z.number().int().positive(),
});
const EpisodeListResponseSchema = z.object({
  data: z.array(RawEpisodeSchema),
  pagination: PaginationSchema,
});
const EpisodeResponseSchema = z.object({ data: RawEpisodeSchema });

function normalizeEpisode(raw: z.infer<typeof RawEpisodeSchema>): EpisodeMetadata {
  return EpisodeMetadataSchema.parse({
    number: raw.mal_id,
    title: raw.title,
    titleJapanese: raw.title_japanese,
    titleRomanji: raw.title_romanji,
    synopsis: raw.synopsis ?? null,
    airedAt: raw.aired,
    durationSeconds: raw.duration ?? null,
    filler: raw.filler,
    recap: raw.recap,
  });
}

export interface EpisodeMetadataProvider {
  listEpisodes(malId: number, signal: AbortSignal): Promise<EpisodeMetadata[]>;
  getEpisode(malId: number, episodeNumber: number, signal: AbortSignal): Promise<EpisodeMetadata>;
}

export class JikanEpisodeProvider implements EpisodeMetadataProvider {
  private nextRequestAt = 0;

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async throttle(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new ApplicationError('OPERATION_CANCELLED', 'A operação foi cancelada.', true);
    const waitMs = Math.max(0, this.nextRequestAt - Date.now());
    this.nextRequestAt = Math.max(Date.now(), this.nextRequestAt) + REQUEST_INTERVAL_MS;
    if (waitMs === 0) return;
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new ApplicationError('OPERATION_CANCELLED', 'A operação foi cancelada.', true));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, waitMs);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async request<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await this.throttle(signal);
      try {
        const response = await this.fetcher(`${JIKAN_URL}${path}`, {
          headers: { Accept: 'application/json', 'User-Agent': 'Kitsune/0.1.0' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        if (response.status === 404) {
          throw new ApplicationError('EPISODE_NOT_FOUND', 'Detalhes deste episódio não estão disponíveis.', false);
        }
        if (!response.ok) throw new Error(`Jikan HTTP ${String(response.status)}`);
        const payload: unknown = await response.json();
        return schema.parse(payload);
      } catch (error: unknown) {
        if (signal.aborted) {
          throw new ApplicationError('OPERATION_CANCELLED', 'A operação foi cancelada.', true, { cause: error });
        }
        if (error instanceof ApplicationError) throw error;
        if (attempt === 2) {
          throw new ApplicationError(
            'EPISODE_PROVIDER_UNAVAILABLE',
            'Os detalhes dos episódios estão temporariamente indisponíveis.',
            true,
            { cause: error },
          );
        }
      }
    }
    throw new ApplicationError('EPISODE_PROVIDER_UNAVAILABLE', 'O provedor de episódios está indisponível.', true);
  }

  public async listEpisodes(malId: number, signal: AbortSignal): Promise<EpisodeMetadata[]> {
    const episodes = new Map<number, EpisodeMetadata>();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await this.request(
        `/anime/${String(malId)}/episodes?page=${String(page)}`,
        EpisodeListResponseSchema,
        signal,
      );
      for (const raw of response.data) episodes.set(raw.mal_id, normalizeEpisode(raw));
      if (!response.pagination.has_next_page) return EpisodeMetadataArraySchema.parse([...episodes.values()]);
      if (page >= response.pagination.last_visible_page) break;
    }
    throw new ApplicationError('EPISODE_LIST_TOO_LARGE', 'A lista de episódios excede o limite suportado.', false);
  }

  public async getEpisode(
    malId: number,
    episodeNumber: number,
    signal: AbortSignal,
  ): Promise<EpisodeMetadata> {
    const response = await this.request(
      `/anime/${String(malId)}/episodes/${String(episodeNumber)}`,
      EpisodeResponseSchema,
      signal,
    );
    return normalizeEpisode(response.data);
  }
}
