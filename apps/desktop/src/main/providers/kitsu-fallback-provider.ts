import { z } from 'zod';
import type { AnimeDetails, AnimeSummary } from '../../shared/contracts/catalog';
import { ApplicationError } from '../domain/errors/application-error';
import {
  ExternalAnimeDetailsSchema,
  type ExternalAnimeDetails,
  type ExternalAnimeSummary,
} from './catalog-provider';
import {
  EpisodeMetadataArraySchema,
  EpisodeMetadataSchema,
  type EpisodeMetadata,
} from './jikan/jikan-episode-provider';

const KITSU_URL = 'https://kitsu.io/api/edge';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 20;

const ImageSchema = z.object({ original: z.url().nullable().optional() }).nullable().optional();
const AnimeResourceSchema = z.object({
  id: z.string().regex(/^\d+$/),
  type: z.literal('anime'),
  attributes: z.object({
    canonicalTitle: z.string().min(1),
    titles: z.object({
      en: z.string().min(1).nullable().optional(),
      en_jp: z.string().min(1).nullable().optional(),
      ja_jp: z.string().min(1).nullable().optional(),
    }),
    synopsis: z.string().min(1).nullable(),
    posterImage: ImageSchema,
    coverImage: ImageSchema,
    episodeCount: z.number().int().positive().nullable(),
    episodeLength: z.number().int().positive().nullable(),
    averageRating: z.string().nullable(),
    status: z.string(),
    subtype: z.string(),
    startDate: z.iso.date().nullable(),
  }),
});
const MappingLookupSchema = z.object({
  data: z.array(z.object({
    relationships: z.object({ item: z.object({ data: z.object({ type: z.string(), id: z.string() }) }) }),
  })),
  included: z.array(AnimeResourceSchema).default([]),
});
const MappingListSchema = z.object({
  data: z.array(z.object({
    attributes: z.object({ externalSite: z.string(), externalId: z.string() }),
  })),
});
const EpisodeResourceSchema = z.object({
  attributes: z.object({
    number: z.number().int().positive(),
    canonicalTitle: z.string().min(1).nullable(),
    synopsis: z.string().min(1).nullable(),
    airdate: z.iso.date().nullable(),
    length: z.number().int().positive().nullable(),
  }),
});
const EpisodePageSchema = z.object({
  data: z.array(EpisodeResourceSchema),
  links: z.object({ next: z.url().nullable() }),
});

export const CatalogFallbackPayloadSchema = z.object({
  details: ExternalAnimeDetailsSchema,
  episodes: EpisodeMetadataArraySchema,
});
export type CatalogFallbackPayload = z.infer<typeof CatalogFallbackPayloadSchema>;

export interface CatalogFallbackProvider {
  readonly id: string;
  getDetails(anilistId: number, base: AnimeDetails, signal: AbortSignal): Promise<CatalogFallbackPayload>;
}

type AnimeFormat = AnimeDetails['format'];
type AnimeSeason = AnimeDetails['season'];
type AnimeStatus = AnimeDetails['status'];

function summary(details: AnimeSummary): ExternalAnimeSummary {
  return {
    anilistId: details.anilistId,
    title: details.title,
    coverImage: details.coverImage,
    coverColor: details.coverColor,
    format: details.format,
    status: details.status,
    season: details.season,
    seasonYear: details.seasonYear,
    episodeCount: details.episodeCount,
    averageScore: details.averageScore,
  };
}

function season(date: string | null): AnimeSeason {
  if (date === null) return null;
  const month = Number(date.slice(5, 7));
  if (month <= 3) return 'WINTER';
  if (month <= 6) return 'SPRING';
  if (month <= 9) return 'SUMMER';
  return 'FALL';
}

function format(subtype: string): AnimeFormat {
  const formats: Record<string, AnimeFormat> = {
    tv: 'TV', movie: 'MOVIE', special: 'SPECIAL', ova: 'OVA', ona: 'ONA', music: 'MUSIC',
  };
  return formats[subtype.toLowerCase()] ?? null;
}

function status(value: string): AnimeStatus {
  const statuses: Record<string, AnimeStatus> = {
    finished: 'FINISHED', current: 'RELEASING', tba: 'NOT_YET_RELEASED', upcoming: 'NOT_YET_RELEASED',
  };
  return statuses[value.toLowerCase()] ?? null;
}

function normalizeEpisode(raw: z.infer<typeof EpisodeResourceSchema>): EpisodeMetadata {
  const { attributes } = raw;
  return EpisodeMetadataSchema.parse({
    number: attributes.number,
    title: attributes.canonicalTitle,
    titleJapanese: null,
    titleRomanji: null,
    synopsis: attributes.synopsis,
    airedAt: attributes.airdate === null ? null : `${attributes.airdate}T00:00:00Z`,
    durationSeconds: attributes.length === null ? null : attributes.length * 60,
    filler: null,
    recap: null,
  });
}

export class KitsuFallbackProvider implements CatalogFallbackProvider {
  public readonly id = 'kitsu';

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async request<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await this.fetcher(`${KITSU_URL}${path}`, {
          headers: { Accept: 'application/vnd.api+json', 'User-Agent': 'Kitsune Desktop' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        if (!response.ok) throw new Error(`Kitsu HTTP ${String(response.status)}`);
        return schema.parse(await response.json());
      } catch (error: unknown) {
        if (signal.aborted) {
          throw new ApplicationError('OPERATION_CANCELLED', 'A operação foi cancelada.', true, { cause: error });
        }
        if (attempt === 2) {
          throw new ApplicationError(
            'PROVIDER_UNAVAILABLE',
            'AniList, MyAnimeList e Kitsu estão temporariamente indisponíveis.',
            true,
            { cause: error },
          );
        }
      }
    }
    throw new ApplicationError('PROVIDER_UNAVAILABLE', 'O Kitsu está indisponível.', true);
  }

  private async episodes(kitsuId: string, signal: AbortSignal): Promise<EpisodeMetadata[]> {
    const episodes: EpisodeMetadata[] = [];
    for (let offset = 0; offset < 2_500; offset += PAGE_SIZE) {
      const query = new URLSearchParams({
        'filter[mediaId]': kitsuId,
        'page[limit]': String(PAGE_SIZE),
        'page[offset]': String(offset),
        sort: 'number',
      });
      const page = await this.request(`/episodes?${query.toString()}`, EpisodePageSchema, signal);
      episodes.push(...page.data.map(normalizeEpisode));
      if (page.links.next === null) return EpisodeMetadataArraySchema.parse(episodes);
    }
    throw new ApplicationError('EPISODE_LIST_TOO_LARGE', 'A lista de episódios excede o limite suportado.', false);
  }

  public async getDetails(
    anilistId: number,
    base: AnimeDetails,
    signal: AbortSignal,
  ): Promise<CatalogFallbackPayload> {
    const lookupQuery = new URLSearchParams({
      'filter[externalSite]': 'anilist/anime',
      'filter[externalId]': String(anilistId),
      include: 'item',
    });
    const lookup = await this.request(`/mappings?${lookupQuery.toString()}`, MappingLookupSchema, signal);
    const itemId = lookup.data.find((mapping) => mapping.relationships.item.data.type === 'anime')
      ?.relationships.item.data.id;
    const anime = lookup.included.find((item) => item.id === itemId);
    if (anime === undefined) throw new ApplicationError('ANIME_NOT_FOUND', 'Anime não encontrado no Kitsu.', false);

    const [mappings, episodes] = await Promise.all([
      this.request(`/anime/${anime.id}/mappings`, MappingListSchema, signal),
      this.episodes(anime.id, signal),
    ]);
    const malIdRaw = mappings.data.find((mapping) => mapping.attributes.externalSite === 'myanimelist/anime')
      ?.attributes.externalId;
    const malId = malIdRaw === undefined ? base.malId : z.coerce.number().int().positive().parse(malIdRaw);
    const attributes = anime.attributes;
    const startYear = attributes.startDate === null ? null : Number(attributes.startDate.slice(0, 4));
    const rating = attributes.averageRating === null ? null : Math.round(Number(attributes.averageRating));
    const details: ExternalAnimeDetails = ExternalAnimeDetailsSchema.parse({
      ...summary(base),
      title: {
        romaji: attributes.titles.en_jp ?? attributes.canonicalTitle,
        english: attributes.titles.en ?? base.title.english,
        native: attributes.titles.ja_jp ?? base.title.native,
      },
      coverImage: base.coverImage ?? attributes.posterImage?.original ?? null,
      format: base.format ?? format(attributes.subtype),
      status: base.status ?? status(attributes.status),
      season: base.season ?? season(attributes.startDate),
      seasonYear: base.seasonYear ?? startYear,
      episodeCount: attributes.episodeCount ?? base.episodeCount,
      averageScore: base.averageScore ?? (Number.isFinite(rating) ? rating : null),
      malId,
      description: attributes.synopsis ?? base.description,
      bannerImage: base.bannerImage ?? attributes.coverImage?.original ?? null,
      genres: base.genres,
      durationMinutes: attributes.episodeLength ?? base.durationMinutes,
      relations: base.relations.map((relation) => ({ type: relation.type, anime: summary(relation.anime) })),
    });
    return CatalogFallbackPayloadSchema.parse({ details, episodes });
  }
}
