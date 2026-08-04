import { decodeXml, infoHashToHex, rssItems, sizeToBytes, xmlTag } from './rss-utils';
import { TorrentProviderItemSchema, type TorrentProviderItem, type TorrentSearchProvider } from './torrent-search-provider';

const BASE_URL = 'https://www.tokyotosho.info/';
const ALLOWED_TORRENT_HOSTS = new Set(['nyaa.si', 'anidex.info', 'anidex.moe', 'www.tokyotosho.info', 'tokyotosho.info']);

function infoHashFromDescription(description: string): string | null {
  const value = /btih:([a-f\d]{40}|[a-z2-7]{32})/i.exec(description)?.[1];
  return value === undefined ? null : infoHashToHex(value);
}

function safeTorrentUrl(raw: string): URL | null {
  try {
    const url = new URL(decodeXml(raw));
    if (!['http:', 'https:'].includes(url.protocol) || !ALLOWED_TORRENT_HOSTS.has(url.hostname)) return null;
    url.protocol = 'https:';
    return url;
  } catch {
    return null;
  }
}

function torrentUrlFromHtml(html: string): URL | null {
  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const raw = match[1];
    if (raw === undefined || !/\.torrent(?:$|\?)/i.test(raw)) continue;
    const url = safeTorrentUrl(raw);
    if (url !== null) return url;
  }
  return null;
}

export function parseTokyoToshoRss(xml: string): TorrentProviderItem[] {
  const results: TorrentProviderItem[] = [];
  for (const item of rssItems(xml)) {
    const detailsUrl = xmlTag(item, 'guid');
    const sourceId = /[?&]id=(\d{1,12})(?:&|$)/.exec(detailsUrl)?.[1];
    const description = xmlTag(item, 'description');
    const torrentUrl = safeTorrentUrl(xmlTag(item, 'link'));
    const infoHash = infoHashFromDescription(description);
    const size = /Size:\s*([\d.]+\s*(?:TiB|GiB|MiB|KiB|TB|GB|MB|KB|B))/i.exec(description)?.[1] ?? '';
    const published = new Date(xmlTag(item, 'pubDate'));
    const parsed = TorrentProviderItemSchema.safeParse({
      sourceId,
      title: xmlTag(item, 'title'),
      detailsUrl,
      torrentUrl: torrentUrl?.toString(),
      infoHash,
      publishedAt: Number.isNaN(published.valueOf()) ? '' : published.toISOString(),
      sizeBytes: sizeToBytes(size),
      seeders: null,
      leechers: null,
      trusted: false,
      remake: false,
    });
    if (parsed.success) results.push(parsed.data);
  }
  return results;
}

export class TokyoToshoTorrentProvider implements TorrentSearchProvider {
  public readonly id = 'tokyotosho' as const;
  public readonly name = 'Tokyo Toshokan';
  private readonly torrentUrls = new Map<string, URL>();

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  private remember(sourceId: string, url: URL): void {
    if (this.torrentUrls.size >= 500) {
      const oldest = this.torrentUrls.keys().next().value;
      if (oldest !== undefined) this.torrentUrls.delete(oldest);
    }
    this.torrentUrls.set(sourceId, url);
  }

  public async search(query: string, signal: AbortSignal): Promise<TorrentProviderItem[]> {
    const url = new URL('rss.php', BASE_URL);
    url.search = new URLSearchParams({ filter: '1', terms: query }).toString();
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/rss+xml, application/xml', 'User-Agent': 'Kitsune/0.1.0' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    if (!response.ok) throw new Error(`Tokyo Toshokan HTTP ${String(response.status)}`);
    const xml = await response.text();
    if (xml.length > 2_000_000) throw new Error('Tokyo Toshokan RSS too large');
    const results = parseTokyoToshoRss(xml);
    for (const item of results) this.remember(item.sourceId, new URL(item.torrentUrl));
    return results;
  }

  public async resolveTorrentUrl(sourceId: string, signal: AbortSignal): Promise<URL> {
    if (!/^\d{1,12}$/.test(sourceId)) throw new Error('Invalid Tokyo Toshokan item id');
    const cached = this.torrentUrls.get(sourceId);
    if (cached !== undefined) return cached;
    const detailsUrl = new URL('details.php', BASE_URL);
    detailsUrl.searchParams.set('id', sourceId);
    const response = await this.fetcher(detailsUrl, {
      headers: { Accept: 'text/html', 'User-Agent': 'Kitsune/0.1.0' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new Error(`Tokyo Toshokan HTTP ${String(response.status)}`);
    const html = await response.text();
    if (html.length > 2_000_000) throw new Error('Tokyo Toshokan page too large');
    const url = torrentUrlFromHtml(html);
    if (url === null) throw new Error('Tokyo Toshokan torrent link unavailable');
    this.remember(sourceId, url);
    return url;
  }
}
