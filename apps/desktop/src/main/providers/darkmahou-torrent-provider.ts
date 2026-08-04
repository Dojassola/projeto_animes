import { MagnetUriSchema } from '../../shared/contracts/media';
import { decodeXml, infoHashToHex } from './rss-utils';
import {
  TorrentProviderItemSchema,
  type TorrentProviderItem,
  type TorrentSearchProvider,
} from './torrent-search-provider';

const BASE_URL = 'https://darkmahou.io/';
const DUBBED_MARKER = /\b(?:dublado|dual(?:\s+audio)?|multi[\s-]?audio)\b/i;

function htmlText(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function safePageUrl(raw: string): URL | null {
  try {
    const url = new URL(decodeXml(raw), BASE_URL);
    return url.protocol === 'https:' && url.hostname === 'darkmahou.io' ? url : null;
  } catch {
    return null;
  }
}

function magnetData(raw: string): { uri: string; infoHash: string } | null {
  const parsed = MagnetUriSchema.safeParse(decodeXml(raw));
  if (!parsed.success) return null;
  const xt = new URL(parsed.data).searchParams.get('xt');
  const value = xt?.replace(/^urn:btih:/i, '');
  const infoHash = value === undefined ? null : infoHashToHex(value);
  return infoHash === null ? null : { uri: parsed.data, infoHash };
}

export function parseDarkMahouSearch(html: string): URL[] {
  const urls = new Map<string, URL>();
  for (const article of html.matchAll(/<article\b[^>]*class=["'][^"']*\bbs\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)) {
    const href = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(article[1] ?? '')?.[1];
    if (href === undefined) continue;
    const url = safePageUrl(href);
    if (url !== null && url.pathname !== '/') urls.set(url.toString(), url);
  }
  return [...urls.values()].slice(0, 3);
}

export function parseDarkMahouPage(html: string, detailsUrl: URL): TorrentProviderItem[] {
  const pageTitle = htmlText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  const publishedRaw = /["']datePublished["']\s*:\s*["']([^"']+)["']/i.exec(html)?.[1]
    ?? /property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1];
  const published = publishedRaw === undefined ? null : new Date(publishedRaw);
  if (pageTitle.length === 0 || published === null || Number.isNaN(published.valueOf())) return [];

  const results = new Map<string, TorrentProviderItem>();
  const sections = html.split(/<div\b[^>]*class=["'][^"']*\bsoraddl\b[^"']*\bdlone\b[^"']*["'][^>]*>/gi).slice(1);
  for (const section of sections) {
    const heading = htmlText(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(section)?.[1] ?? '');
    const headingIsDubbed = DUBBED_MARKER.test(heading);
    const rows = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? '');
    const candidates = rows.length > 0 ? rows : [section];
    for (const row of candidates) {
      const label = htmlText(/<div\b[^>]*class=["'][^"']*\bres\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1] ?? '');
      if (!headingIsDubbed && !DUBBED_MARKER.test(label)) continue;
      for (const anchor of row.matchAll(/<a\b[^>]*href=["'](magnet:\?[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const magnet = magnetData(anchor[1] ?? '');
        if (magnet === null) continue;
        const quality = htmlText(anchor[2] ?? '');
        const parsed = TorrentProviderItemSchema.safeParse({
          sourceId: magnet.infoHash,
          title: `${pageTitle} - ${heading || 'Release'} [PT-BR Dublado]${quality ? ` [${quality}]` : ''}`,
          detailsUrl: detailsUrl.toString(),
          torrentUrl: magnet.uri,
          infoHash: magnet.infoHash,
          publishedAt: published.toISOString(),
          sizeBytes: 0,
          seeders: null,
          leechers: null,
          trusted: false,
          remake: false,
        });
        if (parsed.success) results.set(magnet.infoHash, parsed.data);
      }
    }
  }
  return [...results.values()];
}

export class DarkMahouTorrentProvider implements TorrentSearchProvider {
  public readonly id = 'darkmahou' as const;
  public readonly name = 'DarkMahou · PT-BR Dublado';
  public readonly exhaustiveSearch = false;
  private readonly magnets = new Map<string, string>();

  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  private remember(infoHash: string, magnet: string): void {
    if (this.magnets.size >= 500) {
      const oldest = this.magnets.keys().next().value;
      if (oldest !== undefined) this.magnets.delete(oldest);
    }
    this.magnets.set(infoHash, magnet);
  }

  private async page(url: URL, signal: AbortSignal): Promise<string> {
    const response = await this.fetcher(url, {
      headers: { Accept: 'text/html', 'User-Agent': 'Kitsune/0.1.0' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new Error(`DarkMahou HTTP ${String(response.status)}`);
    const html = await response.text();
    if (html.length > 3_000_000) throw new Error('DarkMahou page too large');
    return html;
  }

  public async search(query: string, signal: AbortSignal): Promise<TorrentProviderItem[]> {
    const searchUrl = new URL(BASE_URL);
    searchUrl.searchParams.set('s', query);
    const pages = parseDarkMahouSearch(await this.page(searchUrl, signal));
    const groups = await Promise.all(pages.map(async (url) => parseDarkMahouPage(await this.page(url, signal), url)));
    const results = groups.flat().slice(0, 100);
    for (const item of results) this.remember(item.infoHash, item.torrentUrl);
    return results;
  }

  public resolveTorrentUrl(sourceId: string): Promise<URL> {
    const infoHash = infoHashToHex(sourceId);
    if (infoHash === null) return Promise.reject(new Error('Invalid DarkMahou info hash'));
    return Promise.resolve(new URL(this.magnets.get(infoHash) ?? `magnet:?xt=urn:btih:${infoHash}`));
  }
}
