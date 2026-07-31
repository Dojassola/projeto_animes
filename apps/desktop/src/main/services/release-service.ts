import {
  ReleaseCandidateArraySchema,
  ReleaseCandidateSchema,
  type ReleaseCandidate,
} from '../../shared/contracts/media';
import { ApplicationError } from '../domain/errors/application-error';
import type { CatalogRepository } from '../repositories/catalog-repository';
import type { ProviderCacheRepository } from '../repositories/provider-cache-repository';

const NYAA_RSS_URL = 'https://nyaa.si/';
const SEARCH_TTL_MS = 10 * 60_000;

function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity, code: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10;
    const offset = radix === 16 ? 2 : 1;
    const point = Number.parseInt(code.slice(offset), radix);
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });
}

function tag(item: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(item);
  return decodeXml(match?.[1]?.trim() ?? '');
}

function sizeToBytes(value: string): number {
  const match = /^([\d.]+)\s*(KiB|MiB|GiB|TiB|B)$/i.exec(value);
  if (match === null) return 0;
  const amount = Number(match[1]);
  const powers: Record<string, number> = { b: 0, kib: 1, mib: 2, gib: 3, tib: 4 };
  return Math.round(amount * 1024 ** (powers[match[2]?.toLowerCase() ?? 'b'] ?? 0));
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function matchesAnimeTitle(releaseTitle: string, animeTitles: string[]): boolean {
  const withoutGroup = releaseTitle.replace(/^(?:\s*\[[^\]]+\])+\s*/, '');
  const segments = withoutGroup.split('|').map(normalize);
  return animeTitles.some((title) => {
    const alias = normalize(title);
    if (alias.length < 2) return false;
    return segments.some((segment) => {
      if (segment === alias) return true;
      if (!segment.startsWith(`${alias} `)) return false;
      const marker = segment.slice(alias.length + 1).split(' ')[0] ?? '';
      return /^(?:\d{1,4}|s\d|e\d|ep\d|v\d|season|part|cour|ova|oad|special|movie|complete|batch|bd|bluray|bdrip|web|hdtv|dvd|remux|dual|multi|vol)/i.test(marker);
    });
  });
}

export function parseReleaseTitle(title: string): ReleaseCandidate['parsed'] {
  const seasonEpisode = /\bS\d{1,2}E(\d{1,4})(?:\s*[-~]\s*E?(\d{1,4}))?\b/i.exec(title);
  const range = /\b(\d{1,3})\s*[-~]\s*(\d{1,3})\b/i.exec(title);
  const single = /(?:\s-\s|\bE(?:P)?\s*)(\d{1,4})(?:v\d+)?\b/i.exec(title);
  const resolution = /(?:\b(\d{3,4})p\b|\b\d{3,4}x(\d{3,4})\b)/i.exec(title);
  const group = /^\[([^\]]{1,80})\]/.exec(title)?.[1] ?? null;
  const upper = title.toUpperCase();
  const episode = Number(seasonEpisode?.[1] ?? single?.[1] ?? range?.[1] ?? 0) || null;
  const episodeEnd = Number(seasonEpisode?.[2] ?? range?.[2] ?? 0) || null;
  return {
    episode,
    episodeEnd,
    resolution: Number(resolution?.[1] ?? resolution?.[2] ?? 0) || null,
    codec: /\bAV1\b/.test(upper) ? 'AV1' : /\b(?:HEVC|H[ .]?265|X265)\b/.test(upper) ? 'HEVC' : /\b(?:H[ .]?264|X264|AVC)\b/.test(upper) ? 'H264' : 'UNKNOWN',
    source: /\b(?:BLU-?RAY|BDRIP|\bBD\b)\b/.test(upper) ? 'BLURAY' : /\bWEB[ ._-]?DL\b/.test(upper) ? 'WEB_DL' : /\bWEB(?:RIP)?\b/.test(upper) ? 'WEB' : /\bHDTV|\bTV\b/.test(upper) ? 'TV' : /\bDVD\b/.test(upper) ? 'DVD' : 'UNKNOWN',
    group,
    batch: /\bBATCH\b/i.test(title) || episodeEnd !== null,
    dualAudio: /\bDUAL[ ._-]?AUDIO\b/i.test(title),
    subtitleLanguages: /\b(?:PT[ ._-]?BR|BRAZILIAN[ ._-]?PORTUGUESE)\b/i.test(title) ? ['pt-br'] : [],
  };
}

export function scoreRelease(
  candidate: Omit<ReleaseCandidate, 'score'>,
  animeTitles: string[],
  wantedEpisode: number | null,
): ReleaseCandidate['score'] {
  const reasons: string[] = [];
  let total = 0;
  if (matchesAnimeTitle(candidate.title, animeTitles)) {
    total += 35;
    reasons.push('Título reconhecido');
  } else {
    total -= 25;
    reasons.push('Título com baixa confiança');
  }
  if (wantedEpisode !== null) {
    if (candidate.parsed.episode === wantedEpisode) {
      total += 30;
      reasons.push(`Episódio ${String(wantedEpisode)} corresponde`);
    } else if (
      candidate.parsed.episode !== null
      && candidate.parsed.episodeEnd !== null
      && wantedEpisode >= candidate.parsed.episode
      && wantedEpisode <= candidate.parsed.episodeEnd
    ) {
      total += 18;
      reasons.push('Batch contém o episódio');
    } else if (candidate.parsed.batch) {
      total += 8;
      reasons.push('Batch completo provável');
    } else {
      total -= 20;
      reasons.push('Episódio não confirmado');
    }
  }
  if (candidate.parsed.resolution === 1080) {
    total += 12;
    reasons.push('1080p');
  } else if (candidate.parsed.resolution === 2160) {
    total += 10;
    reasons.push('2160p');
  } else if (candidate.parsed.resolution === 720) total += 6;
  if (candidate.parsed.source === 'BLURAY' || candidate.parsed.source === 'WEB_DL') total += 8;
  if (candidate.parsed.codec === 'HEVC' || candidate.parsed.codec === 'AV1') total += 5;
  if (candidate.parsed.subtitleLanguages.includes('pt-br')) {
    total += 5;
    reasons.push('Indica legenda PT-BR');
  }
  if (candidate.trusted) total += 3;
  if (candidate.seeders > 0) {
    total += Math.min(10, Math.ceil(Math.log2(candidate.seeders + 1)));
    reasons.push(`${String(candidate.seeders)} seeders`);
  } else total -= 15;
  if (candidate.remake) total -= 25;
  return { total, reasons };
}

export function parseNyaaRss(xml: string, animeTitles: string[], episode: number | null): ReleaseCandidate[] {
  const candidates: ReleaseCandidate[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    if (item === undefined) continue;
    const detailsUrl = tag(item, 'guid');
    const id = /\/view\/(\d+)$/.exec(detailsUrl)?.[1];
    const title = tag(item, 'title');
    if (!matchesAnimeTitle(title, animeTitles)) continue;
    const published = new Date(tag(item, 'pubDate'));
    const base = {
      id,
      title,
      detailsUrl,
      torrentUrl: tag(item, 'link'),
      infoHash: tag(item, 'nyaa:infoHash'),
      publishedAt: Number.isNaN(published.valueOf()) ? '' : published.toISOString(),
      sizeBytes: sizeToBytes(tag(item, 'nyaa:size')),
      seeders: Number(tag(item, 'nyaa:seeders')),
      leechers: Number(tag(item, 'nyaa:leechers')),
      trusted: tag(item, 'nyaa:trusted') === 'Yes',
      remake: tag(item, 'nyaa:remake') === 'Yes',
      parsed: parseReleaseTitle(title),
    };
    const parsedBase = ReleaseCandidateSchema.omit({ score: true }).safeParse(base);
    if (!parsedBase.success) continue;
    candidates.push(ReleaseCandidateSchema.parse({
      ...parsedBase.data,
      score: scoreRelease(parsedBase.data, animeTitles, episode),
    }));
  }
  return candidates.sort((left, right) => right.score.total - left.score.total || right.seeders - left.seeders);
}

export class ReleaseService {
  public constructor(
    private readonly catalogRepository: CatalogRepository,
    private readonly cacheRepository: ProviderCacheRepository,
  ) {}

  private async fetchQuery(
    query: string,
    titles: string[],
    episode: number | null,
    signal: AbortSignal,
  ): Promise<ReleaseCandidate[]> {
    const url = new URL(NYAA_RSS_URL);
    url.search = new URLSearchParams({
      page: 'rss',
      q: query,
      c: '1_2',
      f: '0',
      s: 'seeders',
      o: 'desc',
    }).toString();
    const response = await fetch(url, {
      headers: { Accept: 'application/rss+xml, application/xml', 'User-Agent': 'Kitsune/0.1.0' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) throw new Error(`Nyaa HTTP ${String(response.status)}`);
    const xml = await response.text();
    if (xml.length > 2_000_000) throw new Error('Nyaa RSS too large');
    return parseNyaaRss(xml, titles, episode);
  }

  public async search(animeId: string, episode: number | null, signal: AbortSignal): Promise<{ data: ReleaseCandidate[]; stale: boolean }> {
    const anime = this.catalogRepository.getDetails(animeId);
    if (anime === undefined) throw new ApplicationError('ANIME_NOT_FOUND', 'Anime não encontrado.', false);
    const titles = [anime.title.romaji, anime.title.english, anime.title.native].filter((value): value is string => value !== null);
    const primaryTitle = titles[0] ?? '';
    const queries = [
      anime.seasonYear === null ? '' : `${primaryTitle} ${String(anime.seasonYear)}`,
      `${primaryTitle}${episode === null ? '' : ` ${String(episode).padStart(2, '0')}`}`,
      ...(anime.title.english !== null && anime.title.english !== primaryTitle
        ? [`${anime.title.english}${episode === null ? '' : ` ${String(episode).padStart(2, '0')}`}`]
        : []),
    ].map((query) => query.trim()).filter((query, index, values) => query.length > 0 && values.indexOf(query) === index);
    const cacheKey = `nyaa:v4:${anime.id}:${String(episode ?? 0)}`;
    const cached = this.cacheRepository.get(cacheKey, ReleaseCandidateArraySchema);
    if (cached !== undefined && !cached.expired) return { data: cached.value, stale: false };
    try {
      const byId = new Map<string, ReleaseCandidate>();
      for (const query of queries) {
        for (const candidate of await this.fetchQuery(query, titles, episode, signal)) {
          byId.set(candidate.id, candidate);
        }
        if (byId.size >= 20) break;
      }
      const data = ReleaseCandidateArraySchema.parse(
        [...byId.values()]
          .filter((candidate) => candidate.seeders > 0 && candidate.score.total >= 10)
          .sort((left, right) => right.score.total - left.score.total || right.seeders - left.seeders)
          .slice(0, 100),
      );
      this.cacheRepository.set(cacheKey, data, SEARCH_TTL_MS, ReleaseCandidateArraySchema);
      return { data, stale: false };
    } catch (cause: unknown) {
      if (cached !== undefined) return { data: cached.value, stale: true };
      throw new ApplicationError('NYAA_UNAVAILABLE', 'O Nyaa não respondeu. Tente novamente.', true, { cause });
    }
  }
}
