import { useEffect, useState } from 'react';
import type { AppStatus } from '../../shared/contracts/app';
import type { Settings } from '../../shared/contracts/settings';
import { AnimeDetailsPage } from '../features/catalog/AnimeDetailsPage';
import { CatalogPage } from '../features/catalog/CatalogPage';
import { WatchlistPage } from '../features/catalog/WatchlistPage';
import { DownloadsPage } from '../features/media/DownloadsPage';
import { IntegrationSettingsPage } from '../features/media/IntegrationSettingsPage';

type DesktopState =
  | { status: 'loading' }
  | { status: 'ready'; app: AppStatus; settings: Settings; saving: boolean }
  | { status: 'failed'; message: string };
type View =
  | { page: 'catalog' }
  | { page: 'watchlist' }
  | { page: 'downloads' }
  | { page: 'integrations' }
  | { page: 'details'; animeId: string; returnPage: 'catalog' | 'watchlist' };

const themes: Settings['theme'][] = ['dark', 'oled', 'light'];

function nextTheme(theme: Settings['theme']): Settings['theme'] {
  const index = themes.indexOf(theme);
  return themes[(index + 1) % themes.length] ?? 'dark';
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<DesktopState>({ status: 'loading' });
  const [view, setView] = useState<View>({ page: 'catalog' });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([window.kitsune.app.getStatus(), window.kitsune.settings.get()])
      .then(([appResult, settingsResult]) => {
        if (cancelled) return;
        if (!appResult.ok) throw new Error(appResult.error.message);
        if (!settingsResult.ok) throw new Error(settingsResult.error.message);
        document.documentElement.dataset['theme'] = settingsResult.data.theme;
        setState({
          status: 'ready',
          app: appResult.data,
          settings: settingsResult.data,
          saving: false,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'failed',
            message: error instanceof Error ? error.message : 'Falha inesperada ao iniciar.',
          });
        }
      });
    return () => { cancelled = true; };
  }, []);

  async function changeTheme(): Promise<void> {
    if (state.status !== 'ready' || state.saving) return;
    const settings = { ...state.settings, theme: nextTheme(state.settings.theme) };
    setState({ ...state, saving: true });
    try {
      const result = await window.kitsune.settings.update(settings);
      if (!result.ok) {
        setState({ status: 'failed', message: result.error.message });
        return;
      }
      document.documentElement.dataset['theme'] = result.data.theme;
      setState({ ...state, settings: result.data, saving: false });
    } catch (error: unknown) {
      setState({
        status: 'failed',
        message: error instanceof Error ? error.message : 'Não foi possível trocar o tema.',
      });
    }
  }

  function selectAnime(animeId: string): void {
    const returnPage = view.page === 'watchlist'
      ? 'watchlist'
      : view.page === 'details' ? view.returnPage : 'catalog';
    setView({ page: 'details', animeId, returnPage });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>K</span>Kitsune</div>
        <nav aria-label="Navegação principal">
          <button className={view.page === 'catalog' ? 'active' : ''} type="button" onClick={() => { setView({ page: 'catalog' }); }}>Descobrir</button>
          <button className={view.page === 'watchlist' ? 'active' : ''} type="button" onClick={() => { setView({ page: 'watchlist' }); }}>Minha lista</button>
          <button className={view.page === 'downloads' ? 'active' : ''} type="button" onClick={() => { setView({ page: 'downloads' }); }}>Downloads</button>
          <button className={view.page === 'integrations' ? 'active' : ''} type="button" onClick={() => { setView({ page: 'integrations' }); }}>Configurações</button>
        </nav>
        {state.status === 'ready' && (
          <div className="sidebar-footer">
            <span className="status-dot" /> Banco local
            <small>Kitsune {state.app.version}</small>
          </div>
        )}
      </aside>

      <main>
        <div className="top-actions">
          {state.status === 'ready' && (
            <button type="button" onClick={() => void changeTheme()} disabled={state.saving}>
              Tema: {state.settings.theme}
            </button>
          )}
        </div>

        {state.status === 'loading' && <section className="panel" aria-live="polite">Inicializando banco e contratos…</section>}
        {state.status === 'failed' && <section className="panel error" role="alert">{state.message}</section>}
        {state.status === 'ready' && <div hidden={view.page !== 'catalog'}><CatalogPage onSelect={selectAnime} /></div>}
        {state.status === 'ready' && view.page === 'watchlist' && <WatchlistPage onSelect={selectAnime} />}
        {state.status === 'ready' && view.page === 'downloads' && <DownloadsPage />}
        {state.status === 'ready' && view.page === 'integrations' && <IntegrationSettingsPage />}
        {state.status === 'ready' && view.page === 'details' && (
          <AnimeDetailsPage
            animeId={view.animeId}
            localOnly={view.returnPage === 'watchlist'}
            onBack={() => { setView({ page: view.returnPage }); }}
            onSelect={selectAnime}
          />
        )}
      </main>
    </div>
  );
}
