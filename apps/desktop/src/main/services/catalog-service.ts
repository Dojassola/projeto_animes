import {
  AnimeDetailsSchema,
  CatalogCollectionSchema,
  CatalogDetailsPayloadSchema,
  EpisodeDetailsPayloadSchema,
  EpisodeSchema,
  WatchlistItemSchema,
  type AnimeDetails,
  type CatalogCollection,
  type CatalogDetailsInput,
  type CatalogDetailsPayload,
  type CatalogHomeInput,
  type CatalogSearchInput,
  type Episode,
  type EpisodeDetailsInput,
  type EpisodeDetailsPayload,
  type WatchStatus,
  type WatchlistItem,
} from '../../shared/contracts/catalog';
import { ApplicationError } from '../domain/errors/application-error';
import {
  ExternalAnimeDetailsSchema,
  ExternalAnimeSummaryArraySchema,
  type CatalogProvider,
  type ExternalAnimeDetails,
  type ExternalAnimeSummary,
} from '../providers/catalog-provider';
import {
  EpisodeMetadataArraySchema,
  EpisodeMetadataSchema,
  JikanEpisodeProvider,
  type EpisodeMetadata,
  type EpisodeMetadataProvider,
} from '../providers/jikan/jikan-episode-provider';
import type { CatalogRepository } from '../repositories/catalog-repository';
import type { ProviderCacheRepository } from '../repositories/provider-cache-repository';

const SEARCH_TTL_MS = 15 * 60 * 1_000;
const HOME_TTL_MS = 30 * 60 * 1_000;
const ACTIVE_DETAILS_TTL_MS = 6 * 60 * 60 * 1_000;
const FINISHED_DETAILS_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const EPISODE_LIST_TTL_MS = 24 * 60 * 60 * 1_000;
const EPISODE_DETAILS_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

interface CancellableFlight {
  controller: AbortController;
  consumers: Set<string>;
}

interface Flight<T> extends CancellableFlight {
  promise: Promise<T>;
}

export function normalizeCatalogQuery(query: string): string {
  return query.normalize('NFKC').trim().toLocaleLowerCase('pt-BR').replaceAll(/\s+/g, ' ');
}

function episodeFromMetadata(animeId: string, metadata: EpisodeMetadata): Episode {
  return EpisodeSchema.parse({ id: `${animeId}:${String(metadata.number)}`, ...metadata });
}

export function mergeEpisodeMetadata(anime: AnimeDetails, metadata: EpisodeMetadata[]): AnimeDetails {
  const byNumber = new Map(metadata.map((episode) => [episode.number, episode]));
  const localByNumber = new Map(anime.episodes.map((episode) => [episode.number, episode]));
  const numbers = new Set([
    ...anime.episodes.map((episode) => episode.number),
    ...metadata.map((episode) => episode.number),
  ]);
  const episodes = [...numbers]
    .sort((left, right) => left - right)
    .map((number) => {
      const enriched = byNumber.get(number);
      return enriched === undefined
        ? localByNumber.get(number)
        : episodeFromMetadata(anime.id, enriched);
    })
    .filter((episode): episode is Episode => episode !== undefined);
  return AnimeDetailsSchema.parse({
    ...anime,
    episodeCount: anime.episodeCount ?? (
      episodes.length === 0 ? null : episodes.reduce((maximum, episode) => Math.max(maximum, episode.number), 0)
    ),
    episodes,
  });
}

export class CatalogService {
  private readonly summaryFlights = new Map<string, Flight<ExternalAnimeSummary[]>>();
  private readonly detailsFlights = new Map<string, Flight<ExternalAnimeDetails>>();
  private readonly episodeListFlights = new Map<string, Flight<EpisodeMetadata[]>>();
  private readonly episodeDetailsFlights = new Map<string, Flight<EpisodeMetadata>>();
  private readonly activeRequests = new Map<string, CancellableFlight>();

  public constructor(
    private readonly provider: CatalogProvider,
    private readonly catalogRepository: CatalogRepository,
    private readonly cacheRepository: ProviderCacheRepository,
    private readonly episodeProvider: EpisodeMetadataProvider = new JikanEpisodeProvider(),
  ) {}

  private async enrichEpisodes(anime: AnimeDetails, requestId: string): Promise<AnimeDetails> {
    const malId = anime.malId;
    if (malId === null || anime.format === 'MOVIE') return anime;
    const cacheKey = `jikan:episodes:v1:${String(malId)}`;
    const cached = this.cacheRepository.get(cacheKey, EpisodeMetadataArraySchema);
    if (cached !== undefined && !cached.expired) return mergeEpisodeMetadata(anime, cached.value);

    try {
      const episodes = await this.runDeduplicated(
        this.episodeListFlights,
        cacheKey,
        requestId,
        (signal) => this.episodeProvider.listEpisodes(malId, signal),
      );
      this.cacheRepository.set(cacheKey, episodes, EPISODE_LIST_TTL_MS, EpisodeMetadataArraySchema);
      return mergeEpisodeMetadata(anime, episodes);
    } catch (error: unknown) {
      if (error instanceof ApplicationError && error.code === 'OPERATION_CANCELLED') throw error;
      return cached === undefined ? anime : mergeEpisodeMetadata(anime, cached.value);
    }
  }

  private async detailsPayload(
    anime: AnimeDetails,
    stale: boolean,
    requestId: string,
  ): Promise<CatalogDetailsPayload> {
    return CatalogDetailsPayloadSchema.parse({
      anime: await this.enrichEpisodes(anime, requestId),
      stale,
    });
  }

  private async runDeduplicated<T>(
    flights: Map<string, Flight<T>>,
    key: string,
    requestId: string,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let flight = flights.get(key);
    if (flight === undefined) {
      const controller = new AbortController();
      flight = { controller, consumers: new Set(), promise: task(controller.signal) };
      flights.set(key, flight);
      const cleanup = (): void => {
        if (flights.get(key) === flight) flights.delete(key);
      };
      void flight.promise.then(cleanup, cleanup);
    }

    flight.consumers.add(requestId);
    this.activeRequests.set(requestId, flight);
    try {
      return await flight.promise;
    } finally {
      if (this.activeRequests.get(requestId) === flight) this.activeRequests.delete(requestId);
      flight.consumers.delete(requestId);
    }
  }

  private saveCollection(items: ExternalAnimeSummary[], stale: boolean): CatalogCollection {
    return CatalogCollectionSchema.parse({
      items: this.catalogRepository.saveSummaries(items),
      stale,
    });
  }

  public async search(input: CatalogSearchInput): Promise<CatalogCollection> {
    const normalizedQuery = normalizeCatalogQuery(input.query);
    const cacheKey = `${this.provider.id}:search:${normalizedQuery}`;
    const cached = this.cacheRepository.get(cacheKey, ExternalAnimeSummaryArraySchema);
    if (cached !== undefined && !cached.expired) return this.saveCollection(cached.value, false);

    try {
      const items = await this.runDeduplicated(
        this.summaryFlights,
        cacheKey,
        input.requestId,
        (signal) => this.provider.search(input.query.trim(), signal),
      );
      this.cacheRepository.set(cacheKey, items, SEARCH_TTL_MS, ExternalAnimeSummaryArraySchema);
      return this.saveCollection(items, false);
    } catch (error: unknown) {
      if (cached !== undefined) return this.saveCollection(cached.value, true);
      throw error;
    }
  }

  public async home(input: CatalogHomeInput): Promise<CatalogCollection> {
    const cacheKey = `${this.provider.id}:home:trending`;
    const cached = this.cacheRepository.get(cacheKey, ExternalAnimeSummaryArraySchema);
    if (cached !== undefined && !cached.expired) return this.saveCollection(cached.value, false);

    try {
      const items = await this.runDeduplicated(
        this.summaryFlights,
        cacheKey,
        input.requestId,
        (signal) => this.provider.home(signal),
      );
      this.cacheRepository.set(cacheKey, items, HOME_TTL_MS, ExternalAnimeSummaryArraySchema);
      return this.saveCollection(items, false);
    } catch (error: unknown) {
      if (cached !== undefined) return this.saveCollection(cached.value, true);
      throw error;
    }
  }

  public async getDetails(input: CatalogDetailsInput): Promise<CatalogDetailsPayload> {
    const anilistId = this.catalogRepository.getAnilistId(input.animeId);
    if (anilistId === undefined) {
      throw new ApplicationError('ANIME_NOT_FOUND', 'Anime não encontrado.', false);
    }

    const cacheKey = `${this.provider.id}:details:${String(anilistId)}`;
    const cached = this.cacheRepository.get(cacheKey, ExternalAnimeDetailsSchema);
    if (cached !== undefined && !cached.expired) {
      return this.detailsPayload(this.catalogRepository.saveDetails(cached.value), false, input.requestId);
    }

    try {
      const details = await this.runDeduplicated(
        this.detailsFlights,
        cacheKey,
        input.requestId,
        (signal) => this.provider.getDetails(anilistId, signal),
      );
      const ttl = details.status === 'FINISHED' ? FINISHED_DETAILS_TTL_MS : ACTIVE_DETAILS_TTL_MS;
      this.cacheRepository.set(cacheKey, details, ttl, ExternalAnimeDetailsSchema);
      return await this.detailsPayload(this.catalogRepository.saveDetails(details), false, input.requestId);
    } catch (error: unknown) {
      if (error instanceof ApplicationError && error.code === 'OPERATION_CANCELLED') throw error;
      if (cached !== undefined) {
        return this.detailsPayload(this.catalogRepository.saveDetails(cached.value), true, input.requestId);
      }
      const local = this.catalogRepository.getDetails(input.animeId);
      if (local !== undefined) return this.detailsPayload(local, true, input.requestId);
      throw error;
    }
  }

  public async getEpisodeDetails(input: EpisodeDetailsInput): Promise<EpisodeDetailsPayload> {
    const anime = this.catalogRepository.getDetails(input.animeId);
    if (anime === undefined) throw new ApplicationError('ANIME_NOT_FOUND', 'Anime não encontrado.', false);
    const local = anime.episodes.find((episode) => episode.number === input.episodeNumber);
    const malId = anime.malId;
    if (malId === null) {
      if (local === undefined) throw new ApplicationError('EPISODE_NOT_FOUND', 'Episódio não encontrado.', false);
      return EpisodeDetailsPayloadSchema.parse({ episode: local, stale: true });
    }

    const cacheKey = `jikan:episode:v1:${String(malId)}:${String(input.episodeNumber)}`;
    const cached = this.cacheRepository.get(cacheKey, EpisodeMetadataSchema);
    if (cached !== undefined && !cached.expired) {
      return EpisodeDetailsPayloadSchema.parse({
        episode: episodeFromMetadata(anime.id, cached.value),
        stale: false,
      });
    }

    try {
      const metadata = await this.runDeduplicated(
        this.episodeDetailsFlights,
        cacheKey,
        input.requestId,
        (signal) => this.episodeProvider.getEpisode(malId, input.episodeNumber, signal),
      );
      this.cacheRepository.set(cacheKey, metadata, EPISODE_DETAILS_TTL_MS, EpisodeMetadataSchema);
      return EpisodeDetailsPayloadSchema.parse({ episode: episodeFromMetadata(anime.id, metadata), stale: false });
    } catch (error: unknown) {
      if (error instanceof ApplicationError && error.code === 'OPERATION_CANCELLED') throw error;
      if (cached !== undefined) {
        return EpisodeDetailsPayloadSchema.parse({ episode: episodeFromMetadata(anime.id, cached.value), stale: true });
      }
      const list = this.cacheRepository.get(`jikan:episodes:v1:${String(malId)}`, EpisodeMetadataArraySchema);
      const summary = list?.value.find((episode) => episode.number === input.episodeNumber);
      if (summary !== undefined) {
        return EpisodeDetailsPayloadSchema.parse({ episode: episodeFromMetadata(anime.id, summary), stale: true });
      }
      if (local !== undefined) return EpisodeDetailsPayloadSchema.parse({ episode: local, stale: true });
      throw error;
    }
  }

  public cancel(requestId: string): boolean {
    const flight = this.activeRequests.get(requestId);
    if (flight === undefined) return false;
    flight.consumers.delete(requestId);
    this.activeRequests.delete(requestId);
    if (flight.consumers.size === 0) flight.controller.abort();
    return true;
  }

  public getWatchlist(): WatchlistItem[] {
    return WatchlistItemSchema.array().parse(this.catalogRepository.getWatchlist());
  }

  public setWatchStatus(animeId: string, status: WatchStatus | null): WatchlistItem | null {
    if (this.catalogRepository.getAnilistId(animeId) === undefined) {
      throw new ApplicationError('ANIME_NOT_FOUND', 'Anime não encontrado.', false);
    }
    return this.catalogRepository.setWatchStatus(animeId, status);
  }

  public dispose(): void {
    for (const flight of new Set(this.activeRequests.values())) flight.controller.abort();
    this.activeRequests.clear();
    this.summaryFlights.clear();
    this.detailsFlights.clear();
    this.episodeListFlights.clear();
    this.episodeDetailsFlights.clear();
  }
}
