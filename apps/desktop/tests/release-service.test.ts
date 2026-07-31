import { describe, expect, it } from 'vitest';
import {
  matchesAnimeTitle,
  parseNyaaRss,
  parseReleaseTitle,
} from '../src/main/services/release-service';

describe('release parsing and ranking', () => {
  it('parses Brazilian release tags and ranks the exact episode', () => {
    expect(parseReleaseTitle('[Grupo] Anime - 07 [1080p][HEVC][PT-BR]')).toMatchObject({
      episode: 7,
      resolution: 1080,
      codec: 'HEVC',
      group: 'Grupo',
      subtitleLanguages: ['pt-br'],
    });

    const rss = `<rss><channel><item>
      <title>[Grupo] Anime - 07 [1080p][HEVC][PT-BR]</title>
      <link>https://nyaa.si/download/123.torrent</link>
      <guid>https://nyaa.si/view/123</guid>
      <pubDate>Tue, 30 Jun 2026 16:23:25 -0000</pubDate>
      <nyaa:seeders>48</nyaa:seeders><nyaa:leechers>2</nyaa:leechers>
      <nyaa:infoHash>27a54cbc8334f7f7c90d43482fb9ef1547bce5a7</nyaa:infoHash>
      <nyaa:size>1.2 GiB</nyaa:size><nyaa:trusted>Yes</nyaa:trusted><nyaa:remake>No</nyaa:remake>
    </item></channel></rss>`;
    const results = parseNyaaRss(rss, ['Anime'], 7);

    expect(results).toHaveLength(1);
    expect(results[0]?.score.total).toBeGreaterThan(80);
    expect(results[0]?.sizeBytes).toBe(1_288_490_189);
  });

  it('does not confuse a short title with an unrelated phrase', () => {
    expect(matchesAnimeTitle('[Doki] Another - 01 [1080p]', ['Another'])).toBe(true);
    expect(matchesAnimeTitle(
      '[LostYears] Re:ZERO, Starting Life in Another World - S03E01 [1080p]',
      ['Another'],
    )).toBe(false);
    expect(matchesAnimeTitle('[SubsPlease] 16bit Sensation - Another Layer - 01', ['Another'])).toBe(false);
    expect(matchesAnimeTitle('[SubsPlease] Another Journey to the West - 01', ['Another'])).toBe(false);
    expect(matchesAnimeTitle('[EMBER] Another (2012) (Season 1 + OVA) [1080p]', ['Another'])).toBe(true);
  });
});
