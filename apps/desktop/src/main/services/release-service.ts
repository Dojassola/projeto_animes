import { z } from 'zod';
import {
  ReleaseCandidateArraySchema,
  ReleaseCandidateSchema,
  ReleaseSearchStatsSchema,
  type PrimaryLanguage,
  type ReleaseCandidate,
  type ReleaseSearchStats,
  type TorrentProviderId,
} from '../../shared/contracts/media';
import { ApplicationError } from '../domain/errors/application-error';
import { matchesAnimeTitle, parseReleaseTitle, scoreRelease } from '../domain/releases/release-ranking';
import type { TorrentProviderItem, TorrentSearchProvider } from '../providers/torrent-search-provider';
import type { CatalogRepository } from '../repositories/catalog-repository';
import type { IntegrationSettingsRepository } from '../repositories/integration-settings-repository';
import type { ProviderCacheRepository } from '../repositories/provider-cache-repository';

const SEARCH_TTL_MS = 10 * 60_000;
const CachedSearchSchema = z.object({ data: ReleaseCandidateArraySchema, stats: ReleaseSearchStatsSchema }).strict();
type SearchResult = { data: ReleaseCandidate[]; stats: ReleaseSearchStats; stale: boolean };

function buildQueries(
  primaryTitle: string,
  englishTitle: string | null,
  seasonYear: number | null,
  episode: number | null,
  language: PrimaryLanguage,
): string[] {
  const episodeSuffix = episode === null ? '' : ` ${String(episode).padStart(2, '0')}`;
  const languageQuery = language === 'pt-br'
    ? `${primaryTitle} PT-BR`
    : language === 'en' ? `${primaryTitle} dual audio` : '';
  return [
    `${primaryTitle}${episodeSuffix}`,
    englishTitle !== null && englishTitle !== primaryTitle ? `${englishTitle}${episodeSuffix}` : '',
    languageQuery,
    seasonYear === null ? '' : `${primaryTitle} ${String(seasonYear)}`,
  ].map((query) => query.trim()).filter((query, index, values) => query.length > 0 && values.indexOf(query) === index);
}

function toCandidate(
  item: TorrentProviderItem,
  provider: TorrentSearchProvider,
  titles: string[],
  episode: number | null,
  language: PrimaryLanguage,
): ReleaseCandidate | null {
  if (!matchesAnimeTitle(item.title, titles)) return null;
  const base = ReleaseCandidateSchema.omit({ score: true }).safeParse({
    id: `${provider.id}:${item.sourceId}`,
    provider: provider.id,
    providerName: provider.name,
    title: item.title,
    detailsUrl: item.detailsUrl,
    torrentUrl: item.torrentUrl,
    infoHash: item.infoHash,
    publishedAt: item.publishedAt,
    sizeBytes: item.sizeBytes,
    seeders: item.seeders,
    leechers: item.leechers,
    trusted: item.trusted,
    remake: item.remake,
    parsed: parseReleaseTitle(item.title),
  });
  if (!base.success) return null;
  return ReleaseCandidateSchema.parse({
    ...base.data,
    score: scoreRelease(base.data, titles, episode, language),
  });
}

function waitForCaller<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ApplicationError('OPERATION_CANCELLED', 'Operação cancelada.', true));
  return new Promise<T>((resolve, reject) => {
    const cancel = (): void => { reject(new ApplicationError('OPERATION_CANCELLED', 'Operação cancelada.', true)); };
    signal.addEventListener('abort', cancel, { once: true });
    void operation.then(resolve, reject).finally(() => { signal.removeEventListener('abort', cancel); });
  });
}

export class ReleaseService {
  private readonly inFlight = new Map<string, Promise<SearchResult>>();
  private readonly providersById: ReadonlyMap<TorrentProviderId, TorrentSearchProvider>;

  public constructor(
    private readonly catalogRepository: CatalogRepository,
    private readonly cacheRepository: ProviderCacheRepository,
    private readonly settingsRepository: IntegrationSettingsRepository,
    providers: readonly TorrentSearchProvider[],
  ) {
    if (providers.length === 0) throw new Error('At least one torrent provider is required');
    this.providersById = new Map(providers.map((provider) => [provider.id, provider]));
  }

  public search(
    animeId: string,
    episode: number | null,
    providerId: TorrentProviderId,
    signal: AbortSignal,
  ): Promise<SearchResult> {
    const language = this.settingsRepository.get().primaryLanguage;
    const operationKey = `${providerId}:${animeId}:${String(episode ?? 0)}:${language}`;
    let operation = this.inFlight.get(operationKey);
    if (operation === undefined) {
      operation = this.searchInternal(animeId, episode, language, providerId, AbortSignal.timeout(50_000))
        .finally(() => { this.inFlight.delete(operationKey); });
      this.inFlight.set(operationKey, operation);
    }
    return waitForCaller(operation, signal);
  }

  private async searchProvider(
    provider: TorrentSearchProvider,
    queries: string[],
    signal: AbortSignal,
  ): Promise<TorrentProviderItem[]> {
    const byHash = new Map<string, TorrentProviderItem>();
    for (const query of queries) {
      for (const item of await provider.search(query, signal)) byHash.set(item.infoHash.toLowerCase(), item);
      if (byHash.size >= 100 || (byHash.size > 0 && provider.exhaustiveSearch === false)) break;
    }
    return [...byHash.values()];
  }

  private async searchInternal(
    animeId: string,
    episode: number | null,
    language: PrimaryLanguage,
    providerId: TorrentProviderId,
    signal: AbortSignal,
  ): Promise<SearchResult> {
    const provider = this.providersById.get(providerId);
    if (provider === undefined) {
      throw new ApplicationError('RELEASE_PROVIDER_UNAVAILABLE', 'O provedor solicitado não está disponível.', true);
    }
    const anime = this.catalogRepository.getDetails(animeId);
    if (anime === undefined) throw new ApplicationError('ANIME_NOT_FOUND', 'Anime não encontrado.', false);
    const titles = [anime.title.romaji, anime.title.english, anime.title.native]
      .filter((value): value is string => value !== null);
    const primaryTitle = titles[0] ?? '';
    const queries = buildQueries(primaryTitle, anime.title.english, anime.seasonYear, episode, language);
    const cacheKey = `releases:v9:${provider.id}:${language}:${anime.id}:${String(episode ?? 0)}`;
    const cached = this.cacheRepository.get(cacheKey, CachedSearchSchema);
    if (cached !== undefined && !cached.expired) return { ...cached.value, stale: false };

    let items: TorrentProviderItem[];
    try {
      items = await this.searchProvider(provider, queries, signal);
    } catch (error: unknown) {
      if (cached !== undefined) return { ...cached.value, stale: true };
      throw new ApplicationError(
        'RELEASE_PROVIDER_UNAVAILABLE',
        `${provider.name} não respondeu. Tente novamente.`,
        true,
        { cause: error },
      );
    }

    const byHash = new Map<string, ReleaseCandidate>();
    let titleMatched = 0;
    let available = 0;
    for (const item of items) {
      if (!matchesAnimeTitle(item.title, titles)) continue;
      titleMatched += 1;
      const candidate = toCandidate(item, provider, titles, episode, language);
      if (candidate === null || candidate.seeders === 0) continue;
      available += 1;
      if (candidate.score.total < 10) continue;
      const key = candidate.infoHash.toLowerCase();
      const previous = byHash.get(key);
      if (previous === undefined || candidate.score.total > previous.score.total
        || (candidate.seeders ?? -1) > (previous.seeders ?? -1)) byHash.set(key, candidate);
    }
    const data = ReleaseCandidateArraySchema.parse([...byHash.values()]
      .sort((left, right) => right.score.total - left.score.total || (right.seeders ?? -1) - (left.seeders ?? -1))
      .slice(0, 100));
    const value = CachedSearchSchema.parse({
      data,
      stats: { received: items.length, titleMatched, available, accepted: data.length },
    });
    this.cacheRepository.set(cacheKey, value, SEARCH_TTL_MS, CachedSearchSchema);
    return { ...value, stale: false };
  }
}

export { matchesAnimeTitle, parseReleaseTitle, scoreRelease } from '../domain/releases/release-ranking';
