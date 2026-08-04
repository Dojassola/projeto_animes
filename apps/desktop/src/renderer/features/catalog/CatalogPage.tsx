import { useEffect, useState } from 'react';
import type { AnimeGenre, CatalogCollection } from '../../../shared/contracts/catalog';
import { AnimeCard } from './AnimeCard';

const GENRES: ReadonlyArray<{ value: AnimeGenre; label: string }> = [
  { value: 'Action', label: 'Ação' },
  { value: 'Adventure', label: 'Aventura' },
  { value: 'Comedy', label: 'Comédia' },
  { value: 'Drama', label: 'Drama' },
  { value: 'Ecchi', label: 'Ecchi' },
  { value: 'Fantasy', label: 'Fantasia' },
  { value: 'Horror', label: 'Terror' },
  { value: 'Mahou Shoujo', label: 'Garotas mágicas' },
  { value: 'Mecha', label: 'Mecha' },
  { value: 'Music', label: 'Música' },
  { value: 'Mystery', label: 'Mistério' },
  { value: 'Psychological', label: 'Psicológico' },
  { value: 'Romance', label: 'Romance' },
  { value: 'Sci-Fi', label: 'Ficção científica' },
  { value: 'Slice of Life', label: 'Cotidiano' },
  { value: 'Sports', label: 'Esportes' },
  { value: 'Supernatural', label: 'Sobrenatural' },
  { value: 'Thriller', label: 'Suspense' },
];

type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; collection: CatalogCollection }
  | { status: 'failed'; message: string };

interface CatalogPageProps {
  onSelect: (animeId: string) => void;
}

export function CatalogPage({ onSelect }: CatalogPageProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<AnimeGenre[]>([]);
  const [state, setState] = useState<CatalogState>({ status: 'loading' });

  useEffect(() => {
    const requestId = crypto.randomUUID();
    const trimmedQuery = query.trim();
    const titleQuery = trimmedQuery.length >= 2 ? trimmedQuery : null;
    const hasFilters = titleQuery !== null || selectedGenres.length > 0;
    let active = true;

    const load = async (): Promise<void> => {
      setState({ status: 'loading' });
      try {
        const result = hasFilters
          ? await window.kitsune.catalog.search({ query: titleQuery, genres: selectedGenres, requestId })
          : await window.kitsune.catalog.home({ requestId });
        if (!active) return;
        if (!result.ok) {
          setState({ status: 'failed', message: result.error.message });
          return;
        }
        setState({ status: 'ready', collection: result.data });
      } catch (error: unknown) {
        if (active) {
          setState({
            status: 'failed',
            message: error instanceof Error ? error.message : 'Não foi possível carregar o catálogo.',
          });
        }
      }
    };

    const timer = setTimeout(() => { void load(); }, hasFilters ? 350 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
      void window.kitsune.catalog.cancel({ requestId }).catch(() => undefined);
    };
  }, [query, selectedGenres]);

  function toggleGenre(genre: AnimeGenre): void {
    setSelectedGenres((current) => current.includes(genre)
      ? current.filter((item) => item !== genre)
      : current.length < 6 ? [...current, genre] : current);
  }

  return (
    <section className="catalog-page" aria-busy={state.status === 'loading'}>
      <div className="catalog-heading">
        <div>
          <p className="eyebrow">CATÁLOGO ANILIST</p>
          <h1>{query.trim().length >= 2 || selectedGenres.length > 0 ? 'Resultados' : 'Em destaque agora'}</h1>
        </div>
        <label className="search-box">
          <span className="sr-only">Buscar anime</span>
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); }}
            placeholder="Busque por título romaji, inglês ou japonês"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="catalog-genres" aria-label="Filtrar por gêneros">
        {GENRES.map((genre) => {
          const selected = selectedGenres.includes(genre.value);
          return (
            <button
              key={genre.value}
              type="button"
              className={selected ? 'active' : undefined}
              aria-pressed={selected}
              onClick={() => { toggleGenre(genre.value); }}
            >
              {genre.label}
            </button>
          );
        })}
      </div>

      {state.status === 'loading' && <div className="skeleton-grid" aria-live="polite">Carregando catálogo…</div>}
      {state.status === 'failed' && <div className="panel error" role="alert">{state.message}</div>}
      {state.status === 'ready' && (
        <>
          {state.collection.stale && <p className="notice">Exibindo dados salvos enquanto o provedor está indisponível.</p>}
          {state.collection.items.length === 0 ? (
            <div className="panel empty">Nenhum anime encontrado. Tente outro título ou combinação de gêneros.</div>
          ) : (
            <div className="anime-grid">
              {state.collection.items.map((anime) => (
                <AnimeCard key={anime.id} anime={anime} onSelect={onSelect} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
