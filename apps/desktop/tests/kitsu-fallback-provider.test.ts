import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AnimeDetails } from '../src/shared/contracts/catalog';
import { KitsuFallbackProvider } from '../src/main/providers/kitsu-fallback-provider';

const base: AnimeDetails = {
  id: randomUUID(),
  anilistId: 154768,
  title: { romaji: 'Sono Bisque Doll wa Koi wo Suru Season 2', english: null, native: null },
  coverImage: null,
  coverColor: null,
  format: 'TV',
  status: 'FINISHED',
  season: 'SUMMER',
  seasonYear: 2025,
  episodeCount: null,
  averageScore: 82,
  malId: null,
  description: null,
  bannerImage: null,
  genres: [],
  durationMinutes: null,
  episodes: [],
  relations: [],
  watchStatus: null,
};

function json(data: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  }));
}

describe('Kitsu fallback provider', () => {
  it('maps an AniList entry to MAL details and episodes without title guessing', async () => {
    const fetcher: typeof fetch = (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/anime/46492/mappings')) {
        return json({ data: [{ attributes: { externalSite: 'myanimelist/anime', externalId: '53065' } }] });
      }
      if (url.includes('/episodes?')) {
        return json({
          data: [{
            attributes: {
              number: 1,
              canonicalTitle: 'Wakana Gojo, 15 Years Old, Teenager',
              synopsis: 'Wakana helps Marin make a new outfit.',
              airdate: '2025-07-05',
              length: 23,
            },
          }],
          links: { next: null },
        });
      }
      return json({
        data: [{ relationships: { item: { data: { type: 'anime', id: '46492' } } } }],
        included: [{
          id: '46492',
          type: 'anime',
          attributes: {
            canonicalTitle: 'Sono Bisque Doll wa Koi wo Suru 2nd Season',
            titles: { en: 'My Dress-Up Darling Season 2', en_jp: 'Sono Bisque Doll wa Koi wo Suru 2nd Season' },
            synopsis: 'The second season.',
            posterImage: null,
            coverImage: null,
            episodeCount: 12,
            episodeLength: 23,
            averageRating: '83.06',
            status: 'finished',
            subtype: 'TV',
            startDate: '2025-07-05',
          },
        }],
      });
    };

    const payload = await new KitsuFallbackProvider(fetcher).getDetails(
      154768,
      base,
      AbortSignal.timeout(2_000),
    );

    expect(payload.details.malId).toBe(53065);
    expect(payload.details.description).toBe('The second season.');
    expect(payload.details.episodeCount).toBe(12);
    expect(payload.episodes[0]).toMatchObject({ number: 1, durationSeconds: 1_380 });
  });
});
