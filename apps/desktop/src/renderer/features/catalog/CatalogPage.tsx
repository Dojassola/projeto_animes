import { useEffect, useState } from 'react';
import type { CatalogCollection } from '../../../shared/contracts/catalog';
import { AnimeCard } from './AnimeCard';

type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; collection: CatalogCollection }
  | { status: 'failed'; message: string };

interface CatalogPageProps {
  onSelect: (animeId: string) => void;
}

export function CatalogPage({ onSelect }: CatalogPageProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<CatalogState>({ status: 'loading' });

  useEffect(() => {
    const requestId = crypto.randomUUID();
    const trimmedQuery = query.trim();
    let active = true;

    const load = async (): Promise<void> => {
      setState({ status: 'loading' });
      try {
        const result = trimmedQuery.length >= 2
          ? await window.kitsune.catalog.search({ query: trimmedQuery, requestId })
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

    const timer = setTimeout(() => { void load(); }, trimmedQuery.length >= 2 ? 350 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
      void window.kitsune.catalog.cancel({ requestId }).catch(() => undefined);
    };
  }, [query]);

  return (
    <section className="catalog-page" aria-busy={state.status === 'loading'}>
      <div className="catalog-heading">
        <div>
          <p className="eyebrow">CATÁLOGO ANILIST</p>
          <h1>{query.trim().length >= 2 ? 'Resultados' : 'Em destaque agora'}</h1>
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

      {state.status === 'loading' && <div className="skeleton-grid" aria-live="polite">Carregando catálogo…</div>}
      {state.status === 'failed' && <div className="panel error" role="alert">{state.message}</div>}
      {state.status === 'ready' && (
        <>
          {state.collection.stale && <p className="notice">Exibindo dados salvos enquanto o provedor está indisponível.</p>}
          {state.collection.items.length === 0 ? (
            <div className="panel empty">Nenhum anime encontrado. Tente outro título.</div>
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
