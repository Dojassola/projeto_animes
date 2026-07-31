import { useEffect, useState } from 'react';
import type { WatchlistItem } from '../../../shared/contracts/catalog';
import { AnimeCard } from './AnimeCard';

type WatchlistState =
  | { status: 'loading' }
  | { status: 'ready'; items: WatchlistItem[] }
  | { status: 'failed'; message: string };

interface WatchlistPageProps {
  onSelect: (animeId: string) => void;
}

export function WatchlistPage({ onSelect }: WatchlistPageProps): React.JSX.Element {
  const [state, setState] = useState<WatchlistState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void window.kitsune.watchlist.get()
      .then((result) => {
        if (!active) return;
        setState(result.ok
          ? { status: 'ready', items: result.data }
          : { status: 'failed', message: result.error.message });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'failed', message: error instanceof Error ? error.message : 'Falha ao carregar sua lista.' });
      });
    return () => { active = false; };
  }, []);

  return (
    <section>
      <p className="eyebrow">PERFIL LOCAL</p>
      <h1>Minha lista</h1>
      {state.status === 'loading' && <div className="panel">Carregando sua lista…</div>}
      {state.status === 'failed' && <div className="panel error" role="alert">{state.message}</div>}
      {state.status === 'ready' && (state.items.length === 0
        ? <div className="panel empty">Sua lista está vazia. Adicione um anime pela tela de detalhes.</div>
        : <div className="anime-grid">{state.items.map(({ anime }) => <AnimeCard key={anime.id} anime={anime} onSelect={onSelect} />)}</div>)}
    </section>
  );
}
