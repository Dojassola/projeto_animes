import type { PrimaryLanguage, ReleaseCandidate } from '../../../shared/contracts/media';

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
      return /^(?:\d{1,4}|s\d|e\d|ep\d|v\d|episodio|season|part|cour|ova|oad|special|movie|complete|batch|bd|bluray|bdrip|web|hdtv|dvd|remux|dual|multi|vol)/i.test(marker);
    });
  });
}

export function parseReleaseTitle(title: string): ReleaseCandidate['parsed'] {
  const seasonEpisode = /\bS\d{1,2}E(\d{1,4})(?:\s*[-~]\s*E?(\d{1,4}))?\b/i.exec(title);
  const range = /\b(\d{1,3})\s*[-~]\s*(\d{1,3})\b/i.exec(title);
  const single = /(?:\s-\s|\bE(?:P)?\s*)(\d{1,4})(?:v\d+)?\b/i.exec(title);
  const portugueseEpisode = /\bEPIS[ÓO]DIO\s*(\d{1,4})(?:v\d+)?\b/i.exec(title);
  const resolution = /(?:\b(\d{3,4})p\b|\b\d{3,4}x(\d{3,4})\b)/i.exec(title);
  const group = /^\[([^\]]{1,80})\]/.exec(title)?.[1] ?? null;
  const upper = title.toUpperCase();
  const episode = Number(seasonEpisode?.[1] ?? single?.[1] ?? portugueseEpisode?.[1] ?? range?.[1] ?? 0) || null;
  const episodeEnd = Number(seasonEpisode?.[2] ?? range?.[2] ?? 0) || null;
  const dualAudio = /\b(?:DUAL[ ._-]?AUDIO|MULTI[ ._-]?AUDIO|DUAL)\b/i.test(title);
  const portuguese = /\b(?:PT[ ._-]?BR|BRAZILIAN[ ._-]?PORTUGUESE|PORTUGUESE)\b/i.test(title);
  const portugueseAudio = /\bDUBLAD[OA]\b/i.test(title)
    || /\bPORTUGUESE\b[^)]{0,80}\bDUBS?\b|\bDUBS?\b[^)]{0,80}\bPORTUGUESE\b/i.test(title)
    || (dualAudio && portuguese);
  const audioLanguages = [
    ...(portugueseAudio ? ['pt-br'] : []),
    ...(/\bENGLISH\b[^)]{0,40}\bDUBS?\b|\bENG\b[^)]{0,20}\bDUB\b/i.test(title) ? ['en'] : []),
    ...(/\b(?:JPN|JAPANESE)[ ._-]?(?:AUDIO)?\b/i.test(title) ? ['ja'] : []),
  ];
  return {
    episode,
    episodeEnd,
    resolution: Number(resolution?.[1] ?? resolution?.[2] ?? 0) || null,
    codec: /\bAV1\b/.test(upper) ? 'AV1' : /\b(?:HEVC|H[ .]?265|X265)\b/.test(upper) ? 'HEVC' : /\b(?:H[ .]?264|X264|AVC)\b/.test(upper) ? 'H264' : 'UNKNOWN',
    source: /\b(?:BLU-?RAY|BDRIP|\bBD\b)\b/.test(upper) ? 'BLURAY' : /\bWEB[ ._-]?DL\b/.test(upper) ? 'WEB_DL' : /\bWEB(?:RIP)?\b/.test(upper) ? 'WEB' : /\bHDTV|\bTV\b/.test(upper) ? 'TV' : /\bDVD\b/.test(upper) ? 'DVD' : 'UNKNOWN',
    group,
    batch: /\b(?:BATCH|COMPLETE|COMPLETO)\b/i.test(title) || episodeEnd !== null,
    dualAudio,
    audioLanguages: [...new Set(audioLanguages)],
    subtitleLanguages: portuguese ? ['pt-br'] : [],
  };
}

export function scoreRelease(
  candidate: Omit<ReleaseCandidate, 'score'>,
  animeTitles: string[],
  wantedEpisode: number | null,
  primaryLanguage: PrimaryLanguage,
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
    } else if (candidate.parsed.episode !== null && candidate.parsed.episodeEnd !== null
      && wantedEpisode >= candidate.parsed.episode && wantedEpisode <= candidate.parsed.episodeEnd) {
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
  if (candidate.parsed.audioLanguages.includes(primaryLanguage)) {
    total += 25;
    reasons.push(primaryLanguage === 'pt-br' ? 'Áudio PT-BR' : `Áudio ${primaryLanguage.toUpperCase()}`);
  } else if (primaryLanguage === 'pt-br' && candidate.parsed.subtitleLanguages.includes('pt-br')) {
    total += 5;
    reasons.push('Indica PT-BR');
  }
  if (candidate.trusted) total += 3;
  if (candidate.seeders !== null) {
    if (candidate.seeders > 0) {
      total += Math.min(10, Math.ceil(Math.log2(candidate.seeders + 1)));
      reasons.push(`${String(candidate.seeders)} seeders`);
    } else total -= 15;
  }
  if (candidate.remake) total -= 25;
  return { total, reasons };
}
