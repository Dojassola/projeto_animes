import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/main/infrastructure/database/migrations';
import type { TorrentSearchProvider } from '../src/main/providers/torrent-search-provider';
import { CatalogRepository } from '../src/main/repositories/catalog-repository';
import { IntegrationSettingsRepository } from '../src/main/repositories/integration-settings-repository';
import { ProviderCacheRepository } from '../src/main/repositories/provider-cache-repository';
import {
  ReleaseService,
  matchesAnimeTitle,
  parseReleaseTitle,
  scoreRelease,
} from '../src/main/services/release-service';
import { parseNyaaRss } from '../src/main/providers/nyaa-torrent-provider';
import { parseTokyoToshoRss } from '../src/main/providers/tokyotosho-torrent-provider';
import { parseDarkMahouPage, parseDarkMahouSearch } from '../src/main/providers/darkmahou-torrent-provider';

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
      <title>[Grupo] Anime - 07 [1080p][HEVC][Dual Audio][PT-BR]</title>
      <link>https://nyaa.si/download/123.torrent</link>
      <guid>https://nyaa.si/view/123</guid>
      <pubDate>Tue, 30 Jun 2026 16:23:25 -0000</pubDate>
      <nyaa:seeders>48</nyaa:seeders><nyaa:leechers>2</nyaa:leechers>
      <nyaa:infoHash>27a54cbc8334f7f7c90d43482fb9ef1547bce5a7</nyaa:infoHash>
      <nyaa:size>1.2 GiB</nyaa:size><nyaa:trusted>Yes</nyaa:trusted><nyaa:remake>No</nyaa:remake>
    </item></channel></rss>`;
    const results = parseNyaaRss(rss);

    expect(results).toHaveLength(1);
    expect(results[0]?.sizeBytes).toBe(1_288_490_189);
    const item = results[0];
    expect(item).toBeDefined();
    if (item === undefined) return;
    const score = scoreRelease({
      id: `nyaa:${item.sourceId}`,
      provider: 'nyaa',
      providerName: 'Nyaa',
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
    }, ['Anime'], 7, 'pt-br');
    expect(score.total).toBeGreaterThan(100);
    expect(score.reasons).toContain('Áudio PT-BR');
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

  it('parses Tokyo Toshokan RSS and converts a base32 info hash', () => {
    const rss = `<rss><channel><item>
      <title>[Grupo] Anime - 07 [1080p][Dual][PT-BR]</title>
      <link><![CDATA[http://nyaa.si/download/1974801.torrent]]></link>
      <description><![CDATA[<a href="magnet:?xt=urn:btih:KD3S5QWFRP5ANOXDEBMKOEFFDPFBQDEC">Magnet</a><br />Size: 1.5GB<br />]]></description>
      <guid><![CDATA[https://www.tokyotosho.info/details.php?id=2067638]]></guid>
      <pubDate>Tue, 17 Mar 2026 15:56:38 GMT</pubDate>
    </item></channel></rss>`;

    expect(parseTokyoToshoRss(rss)).toMatchObject([{
      sourceId: '2067638',
      torrentUrl: 'https://nyaa.si/download/1974801.torrent',
      infoHash: '50f72ec2c58bfa06bae32058a710a51bca180c82',
      sizeBytes: 1_610_612_736,
      seeders: null,
    }]);
  });

  it('keeps only explicitly dubbed DarkMahou magnets', () => {
    const search = '<article class="bs"><a href="https://darkmahou.io/blue-lock/">Blue Lock</a></article>';
    const detail = `<script type="application/ld+json">{"datePublished":"2024-03-01T10:00:00+00:00"}</script>
      <h1>Blue Lock</h1><div class="soraddl dlone"><h3>Episódio 01</h3><table>
      <tr><td><div class="res">Baixar&gt;&gt;</div><a href="magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">1080p</a></td></tr>
      <tr><td><div class="res">Dublado.[Multi-Audio]&gt;&gt;</div><a href="magnet:?xt=urn:btih:KD3S5QWFRP5ANOXDEBMKOEFFDPFBQDEC">1080p</a></td></tr>
      </table></div>`;
    const pages = parseDarkMahouSearch(search);

    expect(pages.map((url) => url.toString())).toEqual(['https://darkmahou.io/blue-lock/']);
    const releases = parseDarkMahouPage(detail, pages[0] ?? new URL('https://darkmahou.io/blue-lock/'));
    expect(releases).toMatchObject([{
      sourceId: '50f72ec2c58bfa06bae32058a710a51bca180c82',
      title: 'Blue Lock - Episódio 01 [PT-BR Dublado] [1080p]',
      seeders: null,
      torrentUrl: 'magnet:?xt=urn:btih:KD3S5QWFRP5ANOXDEBMKOEFFDPFBQDEC',
    }]);
    expect(matchesAnimeTitle(releases[0]?.title ?? '', ['Blue Lock'])).toBe(true);
    expect(parseReleaseTitle(releases[0]?.title ?? '').episode).toBe(1);
  });

  it('searches only the requested provider and discards releases with zero seeders', async () => {
    const database = new Database(':memory:');
    migrateDatabase(database);
    const catalog = new CatalogRepository(database);
    const anime = catalog.saveDetails({
      anilistId: 11111,
      malId: 11111,
      title: { romaji: 'Another', english: 'Another', native: 'アナザー' },
      coverImage: null,
      coverColor: null,
      bannerImage: null,
      description: null,
      format: 'TV',
      status: 'FINISHED',
      season: 'WINTER',
      seasonYear: 2012,
      episodeCount: 12,
      averageScore: 75,
      durationMinutes: 24,
      genres: ['Horror'],
      relations: [],
    });
    let tokyoCalls = 0;
    const nyaa: TorrentSearchProvider = {
      id: 'nyaa',
      name: 'Nyaa',
      search: () => Promise.resolve([
        {
          sourceId: '1',
          title: '[Grupo] Another - 01 [1080p]',
          detailsUrl: 'https://nyaa.si/view/1',
          torrentUrl: 'https://nyaa.si/download/1.torrent',
          infoHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          publishedAt: '2026-08-02T00:00:00.000Z',
          sizeBytes: 1_000,
          seeders: 0,
          leechers: 0,
          trusted: false,
          remake: false,
        },
        {
          sourceId: '2',
          title: '[Grupo] Another - 01 [1080p]',
          detailsUrl: 'https://nyaa.si/view/2',
          torrentUrl: 'https://nyaa.si/download/2.torrent',
          infoHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          publishedAt: '2026-08-02T00:00:00.000Z',
          sizeBytes: 1_000,
          seeders: 5,
          leechers: 0,
          trusted: false,
          remake: false,
        },
      ]),
      resolveTorrentUrl: () => Promise.resolve(new URL('https://nyaa.si/download/2.torrent')),
    };
    const tokyo: TorrentSearchProvider = {
      id: 'tokyotosho',
      name: 'Tokyo Toshokan',
      search: () => { tokyoCalls += 1; return Promise.resolve([]); },
      resolveTorrentUrl: () => Promise.resolve(new URL('https://www.tokyotosho.info/download.php/2.torrent')),
    };
    const integrations = new IntegrationSettingsRepository(
      database,
      'C:\\Downloads\\Kitsune',
      (value) => Buffer.from(value),
      (value) => value.toString(),
    );
    const service = new ReleaseService(
      catalog,
      new ProviderCacheRepository(database),
      integrations,
      [nyaa, tokyo],
    );

    const result = await service.search(anime.id, 1, 'nyaa', AbortSignal.timeout(2_000));

    expect(result.data.map((release) => release.seeders)).toEqual([5]);
    expect(result.stats).toEqual({ received: 2, titleMatched: 2, available: 1, accepted: 1 });
    expect(tokyoCalls).toBe(0);
    database.close();
  });
});
