import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/main/infrastructure/database/migrations';
import { AniListProvider } from '../src/main/providers/anilist/anilist-provider';
import type {
  CatalogProvider,
  ExternalAnimeDetails,
  ExternalAnimeSummary,
} from '../src/main/providers/catalog-provider';
import type { EpisodeMetadataProvider } from '../src/main/providers/jikan/jikan-episode-provider';
import type { CatalogFallbackProvider } from '../src/main/providers/kitsu-fallback-provider';
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
  fallbackProvider?: CatalogFallbackProvider,
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
      fallbackProvider,
    ),
  };
}

describe('catalog service', () => {
  it('omits the AniList genre filter when searching only by title', async () => {
    let body = '';
    const fetcher: typeof fetch = (_input, init) => {
      if (typeof init?.body === 'string') body = init.body;
      return Promise.resolve(new Response(JSON.stringify({
        data: {
          Page: {
            media: [{
              id: 20,
              title: { romaji: 'Naruto', english: 'Naruto', native: 'ナルト' },
              coverImage: null,
              format: 'TV',
              status: 'FINISHED',
              season: 'FALL',
              seasonYear: 2002,
              episodes: 220,
              averageScore: 80,
            }],
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };

    const results = await new AniListProvider(fetcher).search(
      { query: 'Naruto', genres: [] },
      AbortSignal.timeout(2_000),
    );

    expect(results[0]?.title.romaji).toBe('Naruto');
    expect(body).toContain('"genres":null');
  });

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
      service.search({ query: 'Frieren', genres: ['Fantasy'], requestId: randomUUID() }),
      service.search({ query: 'frieren', genres: ['Fantasy'], requestId: randomUUID() }),
    ]);
    expect(searchCalls).toBe(1);
    expect(first.items[0]?.id).toBe(second.items[0]?.id);
    await service.search({ query: 'Frieren', genres: ['Fantasy'], requestId: randomUUID() });
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
    const request = service.search({ query: 'Frieren', genres: [], requestId });

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
    const collection = await service.search({ query: 'Frieren', genres: [], requestId: randomUUID() });
    const summary = collection.items[0];
    if (summary === undefined) throw new Error('Fixture anime was not saved');

    const payload = await service.getDetails({ animeId: summary.id, requestId: randomUUID(), source: 'refresh' });
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

  it('uses an independent fallback when AniList details are unavailable', async () => {
    const incomplete = { ...anime, anilistId: 154768, episodeCount: null };
    const provider: CatalogProvider = {
      id: 'fixture',
      search: () => Promise.resolve([incomplete]),
      home: () => Promise.resolve([incomplete]),
      getDetails: () => Promise.reject(new Error('AniList unavailable')),
    };
    const fallback: CatalogFallbackProvider = {
      id: 'fixture-fallback',
      getDetails: () => Promise.resolve({
        details: {
          ...incomplete,
          malId: 53065,
          description: 'The second season.',
          bannerImage: null,
          genres: ['Romance'],
          durationMinutes: 23,
          relations: [],
          episodeCount: 12,
        },
        episodes: Array.from({ length: 12 }, (_, index) => ({
          number: index + 1,
          title: `Episode ${String(index + 1)}`,
          titleJapanese: null,
          titleRomanji: null,
          synopsis: index === 0 ? 'Fallback episode synopsis.' : null,
          airedAt: null,
          durationSeconds: 1_380,
          filler: null,
          recap: null,
        })),
      }),
    };
    const unavailableEpisodes: EpisodeMetadataProvider = {
      listEpisodes: () => Promise.reject(new Error('Jikan unavailable')),
      getEpisode: () => Promise.reject(new Error('Jikan unavailable')),
    };
    const { service, database } = createService(provider, unavailableEpisodes, fallback);
    const collection = await service.search({ query: 'Dress-Up Darling', genres: [], requestId: randomUUID() });
    const saved = collection.items[0];
    if (saved === undefined) throw new Error('Fixture anime was not saved');

    const payload = await service.getDetails({ animeId: saved.id, requestId: randomUUID(), source: 'refresh' });

    expect(payload.stale).toBe(false);
    expect(payload.anime.description).toBe('The second season.');
    expect(payload.anime.malId).toBe(53065);
    expect(payload.anime.episodes).toHaveLength(12);
    const episode = await service.getEpisodeDetails({
      animeId: saved.id,
      episodeNumber: 1,
      requestId: randomUUID(),
    });
    expect(episode.episode.synopsis).toBe('Fallback episode synopsis.');
    service.dispose();
    database.close();
  });

  it('opens locally saved anime details without calling external providers', async () => {
    let detailCalls = 0;
    const provider: CatalogProvider = {
      id: 'fixture',
      search(): Promise<ExternalAnimeSummary[]> { return Promise.resolve([anime]); },
      home(): Promise<ExternalAnimeSummary[]> { return Promise.resolve([anime]); },
      getDetails(): Promise<ExternalAnimeDetails> {
        detailCalls += 1;
        return Promise.reject(new Error('AniList unavailable'));
      },
    };
    const { service, database } = createService(provider);
    const collection = await service.search({ query: 'Frieren', genres: [], requestId: randomUUID() });
    const saved = collection.items[0];
    if (saved === undefined) throw new Error('Fixture anime was not saved');

    const payload = await service.getDetails({
      animeId: saved.id,
      requestId: randomUUID(),
      source: 'local',
    });

    expect(payload.anime.title.romaji).toBe('Sousou no Frieren');
    expect(payload.stale).toBe(true);
    expect(detailCalls).toBe(0);
    service.dispose();
    database.close();
  });
});
