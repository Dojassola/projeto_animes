import { useEffect, useRef, useState } from 'react';
import type { CatalogDetailsPayload, Episode } from '../../../shared/contracts/catalog';
import { AcquisitionPanel } from '../media/AcquisitionPanel';
import { AnimeCard } from './AnimeCard';

type DetailsState =
  | { status: 'loading' }
  | { status: 'ready'; payload: CatalogDetailsPayload; saving: boolean }
  | { status: 'failed'; message: string };
type EpisodeState =
  | { status: 'idle' }
  | { status: 'loading'; episode: Episode }
  | { status: 'ready'; episode: Episode; stale: boolean }
  | { status: 'failed'; episode: Episode; message: string };

interface AnimeDetailsPageProps {
  animeId: string;
  localOnly: boolean;
  onBack: () => void;
  onSelect: (animeId: string) => void;
}

export function AnimeDetailsPage({ animeId, localOnly, onBack, onSelect }: AnimeDetailsPageProps): React.JSX.Element {
  const [state, setState] = useState<DetailsState>({ status: 'loading' });
  const [visibleEpisodes, setVisibleEpisodes] = useState(48);
  const [episodeState, setEpisodeState] = useState<EpisodeState>({ status: 'idle' });
  const episodeRequestId = useRef<string | null>(null);

  useEffect(() => {
    const requestId = crypto.randomUUID();
    let active = true;
    setState({ status: 'loading' });
    setVisibleEpisodes(48);
    setEpisodeState({ status: 'idle' });
    if (episodeRequestId.current !== null) void window.kitsune.catalog.cancel({ requestId: episodeRequestId.current });
    episodeRequestId.current = null;

    void window.kitsune.catalog.getDetails({ animeId, requestId, source: localOnly ? 'local' : 'refresh' })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setState({ status: 'failed', message: result.error.message });
          return;
        }
        setState({ status: 'ready', payload: result.data, saving: false });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: 'failed',
            message: error instanceof Error ? error.message : 'Não foi possível carregar o anime.',
          });
        }
      });

    return () => {
      active = false;
      void window.kitsune.catalog.cancel({ requestId }).catch(() => undefined);
    };
  }, [animeId, localOnly]);

  useEffect(() => () => {
    if (episodeRequestId.current !== null) void window.kitsune.catalog.cancel({ requestId: episodeRequestId.current });
  }, []);

  async function selectEpisode(episode: Episode): Promise<void> {
    if (episodeRequestId.current !== null) {
      await window.kitsune.catalog.cancel({ requestId: episodeRequestId.current }).catch(() => undefined);
    }
    const requestId = crypto.randomUUID();
    episodeRequestId.current = requestId;
    setEpisodeState({ status: 'loading', episode });
    try {
      const result = await window.kitsune.catalog.getEpisodeDetails({
        animeId,
        episodeNumber: episode.number,
        requestId,
      });
      if (episodeRequestId.current !== requestId) return;
      setEpisodeState(result.ok
        ? { status: 'ready', episode: result.data.episode, stale: result.data.stale }
        : { status: 'failed', episode, message: result.error.message });
    } catch (error: unknown) {
      if (episodeRequestId.current === requestId) {
        setEpisodeState({
          status: 'failed',
          episode,
          message: error instanceof Error ? error.message : 'Não foi possível carregar o episódio.',
        });
      }
    } finally {
      if (episodeRequestId.current === requestId) episodeRequestId.current = null;
    }
  }

  async function toggleWatchlist(): Promise<void> {
    if (state.status !== 'ready' || state.saving) return;
    setState({ ...state, saving: true });
    try {
      const status = state.payload.anime.watchStatus === null ? 'planning' : null;
      const result = await window.kitsune.watchlist.set({ animeId, status });
      if (!result.ok) {
        setState({ status: 'failed', message: result.error.message });
        return;
      }
      setState({
        status: 'ready',
        saving: false,
        payload: {
          ...state.payload,
          anime: { ...state.payload.anime, watchStatus: result.data?.status ?? null },
        },
      });
    } catch (error: unknown) {
      setState({
        status: 'failed',
        message: error instanceof Error ? error.message : 'Não foi possível atualizar sua lista.',
      });
    }
  }

  if (state.status === 'loading') return <div className="panel" aria-live="polite">Carregando detalhes…</div>;
  if (state.status === 'failed') {
    return <div className="panel error" role="alert"><button type="button" onClick={onBack}>Voltar</button>{state.message}</div>;
  }

  const { anime } = state.payload;
  const selectedEpisode = episodeState.status === 'idle' ? null : episodeState.episode;
  const seasonRelations = anime.relations
    .filter((relation) => relation.type === 'PREQUEL' || relation.type === 'SEQUEL')
    .sort((left, right) => (left.anime.seasonYear ?? 9_999) - (right.anime.seasonYear ?? 9_999));
  const otherRelations = anime.relations.filter((relation) => relation.type !== 'PREQUEL' && relation.type !== 'SEQUEL');
  return (
    <article className="details-page">
      <button className="back-button" type="button" onClick={onBack}>← Voltar</button>
      <section className="details-hero">
        {anime.bannerImage !== null && <img className="banner" src={anime.bannerImage} alt="" />}
        <div className="details-overlay" />
        <div className="details-content">
          {anime.coverImage !== null && <img className="details-cover" src={anime.coverImage} alt="" />}
          <div>
            <p className="eyebrow">{[anime.format, anime.season, anime.seasonYear].filter(Boolean).join(' · ')}</p>
            <h1>{anime.title.romaji}</h1>
            {anime.title.english !== null && anime.title.english !== anime.title.romaji && <p className="alternate-title">{anime.title.english}</p>}
            <div className="tag-row">
              {anime.averageScore !== null && <span>{anime.averageScore}%</span>}
              {anime.episodeCount !== null && <span>{anime.episodeCount} episódios</span>}
              {anime.durationMinutes !== null && <span>{anime.durationMinutes} min</span>}
            </div>
            <button className="primary" type="button" onClick={() => void toggleWatchlist()} disabled={state.saving}>
              {anime.watchStatus === null ? '+ Adicionar à minha lista' : '✓ Na minha lista'}
            </button>
          </div>
        </div>
      </section>

      {state.payload.stale && <p className="notice">Detalhes salvos localmente; o provedor não respondeu.</p>}
      <section className="details-section">
        <h2>Sinopse</h2>
        <p className="description">{anime.description ?? 'Sinopse ainda não disponível.'}</p>
        <div className="genre-row">{anime.genres.map((genre) => <span key={genre}>{genre}</span>)}</div>
      </section>

      {anime.format === 'MOVIE' && <AcquisitionPanel animeId={anime.id} episode={null} />}

      {seasonRelations.length > 0 && (
        <section className="details-section">
          <h2>Temporadas e continuações</h2>
          <p className="description">Prequelas e sequências oficiais relacionadas a este anime.</p>
          <div className="anime-grid compact">
            {seasonRelations.map((relation) => (
              <div key={`${relation.type}:${relation.anime.id}`}>
                <small className="relation-type">{relation.type === 'PREQUEL' ? 'TEMPORADA ANTERIOR' : 'PRÓXIMA TEMPORADA'}</small>
                <AnimeCard anime={relation.anime} onSelect={onSelect} />
              </div>
            ))}
          </div>
        </section>
      )}

      {anime.format !== 'MOVIE' && (
        <section className="details-section">
          <h2>Episódios</h2>
          {anime.episodes.length === 0
            ? <p className="empty">A lista de episódios ainda não foi publicada pelos provedores.</p>
            : (
              <>
                <div className="episode-grid">
                  {anime.episodes.slice(0, visibleEpisodes).map((episode) => (
                    <button
                      className={selectedEpisode?.number === episode.number ? 'active' : ''}
                      type="button"
                      key={episode.id}
                      aria-pressed={selectedEpisode?.number === episode.number}
                      onClick={() => void selectEpisode(episode)}
                    >
                      <strong>Episódio {episode.number}</strong>
                      {episode.title !== null && <small>{episode.title}</small>}
                    </button>
                  ))}
                </div>
                {visibleEpisodes < anime.episodes.length && (
                  <button type="button" onClick={() => { setVisibleEpisodes((count) => count + 48); }}>Mostrar mais</button>
                )}
              </>
            )}
        </section>
      )}

      {selectedEpisode !== null && (
        <section className="details-section episode-details" aria-live="polite">
          <p className="eyebrow">EPISÓDIO {selectedEpisode.number}</p>
          <h2>{selectedEpisode.title ?? `Episódio ${String(selectedEpisode.number)}`}</h2>
          {selectedEpisode.titleJapanese !== null && <p className="alternate-title">{selectedEpisode.titleJapanese}</p>}
          <div className="tag-row">
            {selectedEpisode.airedAt !== null && <span>{new Date(selectedEpisode.airedAt).toLocaleDateString('pt-BR')}</span>}
            {selectedEpisode.durationSeconds !== null && <span>{Math.ceil(selectedEpisode.durationSeconds / 60)} min</span>}
            {selectedEpisode.filler === true && <span>Filler</span>}
            {selectedEpisode.recap === true && <span>Recapitulação</span>}
          </div>
          <p className="description">{selectedEpisode.synopsis ?? 'Sinopse individual ainda não disponível.'}</p>
          {episodeState.status === 'loading' && <p className="notice">Buscando detalhes do episódio…</p>}
          {episodeState.status === 'failed' && <p className="notice">{episodeState.message}</p>}
          {episodeState.status === 'ready' && episodeState.stale && (
            <p className="notice">Detalhes básicos salvos; o provedor não respondeu agora.</p>
          )}
          <AcquisitionPanel key={selectedEpisode.number} animeId={anime.id} episode={selectedEpisode.number} />
        </section>
      )}

      {otherRelations.length > 0 && (
        <section className="details-section">
          <h2>Relacionados</h2>
          <div className="anime-grid compact">
            {otherRelations.map((relation) => (
              <div key={`${relation.type}:${relation.anime.id}`}>
                <small className="relation-type">{relation.type.replaceAll('_', ' ')}</small>
                <AnimeCard anime={relation.anime} onSelect={onSelect} />
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
