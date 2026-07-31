import { describe, expect, it } from 'vitest';
import { normalizeDetails } from '../src/main/providers/anilist/anilist-provider';

const summary = {
  id: 1,
  title: { romaji: 'Anime', english: null, native: null },
  coverImage: null,
  format: 'TV',
  status: 'FINISHED',
  season: 'SPRING',
  seasonYear: 2020,
  episodes: 12,
  averageScore: 80,
} as const;

describe('AniList normalization', () => {
  it('keeps anime relations and ignores manga relations', () => {
    const details = normalizeDetails({
      ...summary,
      idMal: 1,
      description: null,
      bannerImage: null,
      genres: [],
      duration: 24,
      nextAiringEpisode: null,
      relations: {
        edges: [
          { relationType: 'SEQUEL', node: { ...summary, id: 2, type: 'ANIME' } },
          { relationType: 'SOURCE', node: { ...summary, id: 3, format: 'MANGA', type: 'MANGA' } },
        ],
      },
    });

    expect(details.relations).toHaveLength(1);
    expect(details.relations[0]?.anime.anilistId).toBe(2);
  });
});
