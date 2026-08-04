import { TorrentProviderItemSchema, type TorrentProviderItem, type TorrentSearchProvider } from './torrent-search-provider';
import { rssItems, sizeToBytes, xmlTag } from './rss-utils';

const BASE_URL = 'https://nyaa.si/';

export function parseNyaaRss(xml: string): TorrentProviderItem[] {
  const results: TorrentProviderItem[] = [];
  for (const item of rssItems(xml)) {
    const detailsUrl = xmlTag(item, 'guid');
    const sourceId = /\/view\/(\d+)$/.exec(detailsUrl)?.[1];
    const published = new Date(xmlTag(item, 'pubDate'));
    const parsed = TorrentProviderItemSchema.safeParse({
      sourceId,
      title: xmlTag(item, 'title'),
      detailsUrl,
      torrentUrl: xmlTag(item, 'link'),
      infoHash: xmlTag(item, 'nyaa:infoHash'),
      publishedAt: Number.isNaN(published.valueOf()) ? '' : published.toISOString(),
      sizeBytes: sizeToBytes(xmlTag(item, 'nyaa:size')),
      seeders: Number(xmlTag(item, 'nyaa:seeders')),
      leechers: Number(xmlTag(item, 'nyaa:leechers')),
      trusted: xmlTag(item, 'nyaa:trusted') === 'Yes',
      remake: xmlTag(item, 'nyaa:remake') === 'Yes',
    });
    if (parsed.success) results.push(parsed.data);
  }
  return results;
}

export class NyaaTorrentProvider implements TorrentSearchProvider {
  public readonly id = 'nyaa' as const;
  public readonly name = 'Nyaa';

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async search(query: string, signal: AbortSignal): Promise<TorrentProviderItem[]> {
    const url = new URL(BASE_URL);
    url.search = new URLSearchParams({
      page: 'rss', q: query, c: '1_0', f: '0', s: 'seeders', o: 'desc',
    }).toString();
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/rss+xml, application/xml', 'User-Agent': 'Kitsune/0.1.0' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    });
    if (!response.ok) throw new Error(`Nyaa HTTP ${String(response.status)}`);
    const xml = await response.text();
    if (xml.length > 2_000_000) throw new Error('Nyaa RSS too large');
    return parseNyaaRss(xml);
  }

  public resolveTorrentUrl(sourceId: string): Promise<URL> {
    if (!/^\d{1,12}$/.test(sourceId)) return Promise.reject(new Error('Invalid Nyaa item id'));
    return Promise.resolve(new URL(`download/${sourceId}.torrent`, BASE_URL));
  }
}
