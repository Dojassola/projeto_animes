import type { AnimeSummary } from '../../../shared/contracts/catalog';

interface AnimeCardProps {
  anime: AnimeSummary;
  onSelect: (animeId: string) => void;
}

export function AnimeCard({ anime, onSelect }: AnimeCardProps): React.JSX.Element {
  const metadata = [
    anime.format?.replace('_', ' '),
    anime.seasonYear,
    anime.episodeCount === null ? null : `${String(anime.episodeCount)} eps`,
  ].filter((value) => value !== null);

  return (
    <button className="anime-card" type="button" onClick={() => { onSelect(anime.id); }}>
      <span className="cover-frame" style={{ backgroundColor: anime.coverColor ?? undefined }}>
        {anime.coverImage === null ? (
          <span className="cover-fallback" aria-hidden="true">狐</span>
        ) : (
          <img src={anime.coverImage} alt="" loading="lazy" decoding="async" />
        )}
        {anime.averageScore !== null && <span className="score">{anime.averageScore}%</span>}
      </span>
      <strong>{anime.title.romaji}</strong>
      <small>{metadata.join(' · ')}</small>
    </button>
  );
}
