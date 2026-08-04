import { z } from 'zod';
import { ApplicationError } from '../../domain/errors/application-error';
import {
  ExternalAnimeDetailsSchema,
  ExternalAnimeSummaryArraySchema,
  ExternalAnimeSummarySchema,
  type CatalogProvider,
  type CatalogProviderSearchInput,
  type ExternalAnimeDetails,
  type ExternalAnimeSummary,
} from '../catalog-provider';

const ANILIST_URL = 'https://graphql.anilist.co';
const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_INTERVAL_MS = 2_100;

const RawTitleSchema = z.object({
  romaji: z.string().min(1).nullable(),
  english: z.string().min(1).nullable(),
  native: z.string().min(1).nullable(),
});
const RawSummarySchema = z.object({
  id: z.number().int().positive(),
  title: RawTitleSchema,
  coverImage: z.object({ large: z.url().nullable(), color: z.string().nullable() }).nullable(),
  format: z.string().nullable(),
  status: z.string().nullable(),
  season: z.string().nullable(),
  seasonYear: z.number().int().nullable(),
  episodes: z.number().int().positive().nullable(),
  averageScore: z.number().int().min(0).max(100).nullable(),
});
const RawRelationNodeSchema = RawSummarySchema.extend({
  type: z.enum(['ANIME', 'MANGA']),
});
const RawDetailsSchema = RawSummarySchema.extend({
  idMal: z.number().int().positive().nullable(),
  description: z.string().nullable(),
  bannerImage: z.url().nullable(),
  genres: z.array(z.string().min(1)).nullable(),
  duration: z.number().int().positive().nullable(),
  nextAiringEpisode: z.object({ episode: z.number().int().positive() }).nullable(),
  relations: z
    .object({
      edges: z.array(
        z.object({
          relationType: z.string(),
          node: RawRelationNodeSchema,
        }),
      ),
    })
    .nullable(),
});

const PageDataSchema = z.object({
  Page: z.object({ media: z.array(RawSummarySchema).nullable() }).nullable(),
});
const DetailsDataSchema = z.object({ Media: RawDetailsSchema.nullable() });
const GraphqlEnvelopeSchema = z.object({
  data: z.unknown().nullable().optional(),
  errors: z.array(z.object({ message: z.string(), status: z.number().int().optional() })).optional(),
});

const SUMMARY_FIELDS = `
  id
  title { romaji english native }
  coverImage { large color }
  format
  status
  season
  seasonYear
  episodes
  averageScore
`;

const SEARCH_QUERY = `
  query SearchAnime($search: String, $genres: [String], $sort: [MediaSort], $perPage: Int!) {
    Page(page: 1, perPage: $perPage) {
      media(search: $search, genre_in: $genres, type: ANIME, isAdult: false, sort: $sort) {
        ${SUMMARY_FIELDS}
      }
    }
  }
`;
const HOME_QUERY = `
  query HomeAnime($perPage: Int!) {
    Page(page: 1, perPage: $perPage) {
      media(type: ANIME, isAdult: false, sort: [TRENDING_DESC, POPULARITY_DESC]) {
        ${SUMMARY_FIELDS}
      }
    }
  }
`;
const DETAILS_QUERY = `
  query AnimeDetails($id: Int!) {
    Media(id: $id, type: ANIME) {
      ${SUMMARY_FIELDS}
      idMal
      description(asHtml: false)
      bannerImage
      genres
      duration
      nextAiringEpisode { episode }
      relations {
        edges {
          relationType(version: 2)
          node { type ${SUMMARY_FIELDS} }
        }
      }
    }
  }
`;

type GraphqlVariables =
  | { search: string | null; genres: readonly string[] | null; sort: readonly string[]; perPage: number }
  | { perPage: number }
  | { id: number };

function abortedError(signal: AbortSignal): ApplicationError {
  return new ApplicationError(
    'OPERATION_CANCELLED',
    'A operação foi cancelada.',
    true,
    { cause: signal.reason },
  );
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortedError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortedError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function normalizeSummary(raw: z.infer<typeof RawSummarySchema>): ExternalAnimeSummary {
  const romaji = raw.title.romaji ?? raw.title.english ?? raw.title.native ?? `Anime ${String(raw.id)}`;
  return ExternalAnimeSummarySchema.parse({
    anilistId: raw.id,
    title: {
      romaji,
      english: raw.title.english,
      native: raw.title.native,
    },
    coverImage: raw.coverImage?.large ?? null,
    coverColor: raw.coverImage?.color ?? null,
    format: raw.format,
    status: raw.status,
    season: raw.season,
    seasonYear: raw.seasonYear,
    episodeCount: raw.episodes,
    averageScore: raw.averageScore,
  });
}

export function normalizeDetails(raw: z.infer<typeof RawDetailsSchema>): ExternalAnimeDetails {
  return ExternalAnimeDetailsSchema.parse({
    ...normalizeSummary(raw),
    episodeCount: raw.episodes ?? (
      raw.nextAiringEpisode !== null && raw.nextAiringEpisode.episode > 1
        ? raw.nextAiringEpisode.episode - 1
        : null
    ),
    malId: raw.idMal,
    description: raw.description,
    bannerImage: raw.bannerImage,
    genres: raw.genres ?? [],
    durationMinutes: raw.duration,
    relations: (raw.relations?.edges ?? [])
      .filter((edge) => edge.node.type === 'ANIME')
      .map((edge) => ({
        type: edge.relationType,
        anime: normalizeSummary(edge.node),
      })),
  });
}

export class AniListProvider implements CatalogProvider {
  public readonly id = 'anilist';
  private nextRequestAt = 0;

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async throttle(signal: AbortSignal): Promise<void> {
    const scheduledAt = Math.max(Date.now(), this.nextRequestAt);
    this.nextRequestAt = scheduledAt + REQUEST_INTERVAL_MS;
    if (scheduledAt > Date.now()) await delay(scheduledAt - Date.now(), signal);
  }

  private async request<T>(
    query: string,
    variables: GraphqlVariables,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await this.throttle(signal);
      try {
        const response = await this.fetcher(ANILIST_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        const rawPayload: unknown = await response.json();
        const envelope = GraphqlEnvelopeSchema.parse(rawPayload);

        if (response.status === 429) {
          throw new ApplicationError(
            'PROVIDER_RATE_LIMITED',
            'O AniList limitou temporariamente as consultas. Tente novamente em instantes.',
            true,
          );
        }
        if (!response.ok || (envelope.errors?.length ?? 0) > 0) {
          throw new ApplicationError(
            'PROVIDER_RESPONSE_ERROR',
            'O AniList não conseguiu responder à consulta.',
            true,
          );
        }
        if (envelope.data === undefined || envelope.data === null) {
          throw new ApplicationError(
            'PROVIDER_INVALID_RESPONSE',
            'O AniList retornou uma resposta incompleta.',
            true,
          );
        }
        return schema.parse(envelope.data);
      } catch (error: unknown) {
        if (signal.aborted) throw abortedError(signal);
        if (error instanceof ApplicationError) throw error;
        if (attempt === 2) {
          throw new ApplicationError(
            'PROVIDER_UNAVAILABLE',
            'O AniList está indisponível. Dados salvos continuarão disponíveis.',
            true,
            { cause: error },
          );
        }
        await delay(300, signal);
      }
    }
    throw new ApplicationError('PROVIDER_UNAVAILABLE', 'O AniList está indisponível.', true);
  }

  public async search(input: CatalogProviderSearchInput, signal: AbortSignal): Promise<ExternalAnimeSummary[]> {
    const data = await this.request(
      SEARCH_QUERY,
      {
        search: input.query,
        genres: input.genres.length === 0 ? null : input.genres,
        sort: input.query === null ? ['POPULARITY_DESC', 'SCORE_DESC'] : ['SEARCH_MATCH', 'POPULARITY_DESC'],
        perPage: 24,
      },
      PageDataSchema,
      signal,
    );
    return ExternalAnimeSummaryArraySchema.parse((data.Page?.media ?? []).map(normalizeSummary));
  }

  public async home(signal: AbortSignal): Promise<ExternalAnimeSummary[]> {
    const data = await this.request(HOME_QUERY, { perPage: 18 }, PageDataSchema, signal);
    return ExternalAnimeSummaryArraySchema.parse((data.Page?.media ?? []).map(normalizeSummary));
  }

  public async getDetails(anilistId: number, signal: AbortSignal): Promise<ExternalAnimeDetails> {
    const data = await this.request(DETAILS_QUERY, { id: anilistId }, DetailsDataSchema, signal);
    if (data.Media === null) {
      throw new ApplicationError('ANIME_NOT_FOUND', 'Anime não encontrado.', false);
    }
    return normalizeDetails(data.Media);
  }
}
