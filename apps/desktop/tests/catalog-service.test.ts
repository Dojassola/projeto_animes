import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/main/infrastructure/database/migrations';
import type {
  CatalogProvider,
  ExternalAnimeDetails,
  ExternalAnimeSummary,
} from '../src/main/providers/catalog-provider';
import type { EpisodeMetadataProvider } from '../src/main/providers/jikan/jikan-episode-provider';
import { CatalogRepository } from '../src/main/repositories/catalog-repository';
import { ProviderCacheRepository } from '../src/main/repositories/provider-cache-repository';
import { CatalogService, normalizeCatalogQuery } from '../src/main/services/catalog-service';

const anime: ExternalAnimeSummary = {
  anilistId: 154587,
  title: { romaji: 'Sousou no Frieren', english: 'Frieren', native: '葬送のフリーレン' },
  coverImage: null,
  coverColor: null,
  format: 'TV',
  status: 'FINISHED',
  season: 'FALL',
  seasonYear: 2023,
  episodeCount: 28,
  averageScore: 90,
};

function createService(
  provider: CatalogProvider,
  episodeProvider?: EpisodeMetadataProvider,
): { service: CatalogService; database: Database.Database } {
  const database = new Database(':memory:');
  migrateDatabase(database);
  return {
    database,
    service: new CatalogService(
      provider,
      new CatalogRepository(database),
      new ProviderCacheRepository(database),
      episodeProvider,
    ),
  };
}

describe('catalog service', () => {
  it('normalizes cache keys and deduplicates equal in-flight searches', async () => {
    let searchCalls = 0;
    const provider: CatalogProvider = {
      id: 'fixture',
      async search(): Promise<ExternalAnimeSummary[]> {
        searchCalls += 1;
        await Promise.resolve();
        return [anime];
      },
      home(): Promise<ExternalAnimeSummary[]> { return Promise.resolve([anime]); },
      getDetails(): Promise<ExternalAnimeDetails> { return Promise.reject(new Error('unused')); },
    };
    const { service, database } = createService(provider);

    expect(normalizeCatalogQuery('  ＦＲＩＥＲＥＮ   Beyond ')).toBe('frieren beyond');
    const [first, second] = await Promise.all([
      service.search({ query: 'Frieren', requestId: randomUUID() }),
      service.search({ query: 'frieren', requestId: randomUUID() }),
    ]);
    expect(searchCalls).toBe(1);
    expect(first.items[0]?.id).toBe(second.items[0]?.id);
    await service.search({ query: 'Frieren', requestId: randomUUID() });
    expect(searchCalls).toBe(1);
    service.dispose();
    database.close();
  });

  it('aborts a provider request after its last consumer cancels', async () => {
    const provider: CatalogProvider = {
      id: 'fixture',
      search(_query, signal): Promise<ExternalAnimeSummary[]> {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('aborted')); }, { once: true });
        });
      },
      home(): Promise<ExternalAnimeSummary[]> { return Promise.resolve([anime]); },
      getDetails(): Promise<ExternalAnimeDetails> { return Promise.reject(new Error('unused')); },
    };
    const { service, database } = createService(provider);
    const requestId = randomUUID();
    const request = service.search({ query: 'Frieren', requestId });

    expect(service.cancel(requestId)).toBe(true);
    await expect(request).rejects.toThrow('aborted');
    service.dispose();
    database.close();
  });

  it('fills a missing episode list and loads the selected episode details', async () => {
    const details: ExternalAnimeDetails = {
      ...anime,
      malId: 52991,
      episodeCount: null,
      bannerImage: null,
      description: 'Uma jornada.',
      durationMinutes: 24,
      genres: ['Fantasy'],
      relations: [],
    };
    const provider: CatalogProvider = {
      id: 'fixture',
      search(): Promise<ExternalAnimeSummary[]> { return Promise.resolve([anime]); },
      home(): Promise<ExternalAnimeSummary[]> { return Promise.resolve([anime]); },
      getDetails(): Promise<ExternalAnimeDetails> { return Promise.resolve(details); },
    };
    const episodeProvider: EpisodeMetadataProvider = {
      listEpisodes: () => Promise.resolve([
        {
          number: 1,
          title: 'The Journey Begins',
          titleJapanese: null,
          titleRomanji: null,
          synopsis: null,
          airedAt: '2023-09-29T00:00:00+00:00',
          durationSeconds: null,
          filler: false,
          recap: false,
        },
        {
          number: 2,
          title: 'Magic',
          titleJapanese: null,
          titleRomanji: null,
          synopsis: null,
          airedAt: null,
          durationSeconds: null,
          filler: false,
          recap: false,
        },
      ]),
      getEpisode: (_malId, episodeNumber) => Promise.resolve({
        number: episodeNumber,
        title: 'The Journey Begins',
        titleJapanese: null,
        titleRomanji: null,
        synopsis: 'Frieren starts a new journey.',
        airedAt: '2023-09-29T00:00:00+00:00',
        durationSeconds: 1_440,
        filler: false,
        recap: false,
      }),
    };
    const { service, database } = createService(provider, episodeProvider);
    const collection = await service.search({ query: 'Frieren', requestId: randomUUID() });
    const summary = collection.items[0];
    if (summary === undefined) throw new Error('Fixture anime was not saved');

    const payload = await service.getDetails({ animeId: summary.id, requestId: randomUUID() });
    expect(payload.anime.episodeCount).toBe(2);
    expect(payload.anime.episodes.map((episode) => episode.title)).toEqual(['The Journey Begins', 'Magic']);

    const episode = await service.getEpisodeDetails({
      animeId: summary.id,
      episodeNumber: 1,
      requestId: randomUUID(),
    });
    expect(episode.episode.synopsis).toBe('Frieren starts a new journey.');
    service.dispose();
    database.close();
  });
});
