import { useEffect, useRef, useState } from 'react';
import type { ReleaseCandidate, ReleaseSearchStats, TorrentProviderId } from '../../../shared/contracts/media';

interface Props {
  animeId: string;
  episode: number | null;
}

type Subtitle = Extract<Awaited<ReturnType<typeof window.kitsune.subtitles.search>>, { ok: true }>['data'][number];
type ProviderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
    status: 'ready';
    stats: ReleaseSearchStats;
    stale: boolean;
  }
  | { status: 'failed'; message: string };
type ProviderStates = Record<TorrentProviderId, ProviderState>;

const RELEASE_PROVIDERS: ReadonlyArray<{ id: TorrentProviderId; name: string }> = [
  { id: 'nyaa', name: 'Nyaa' },
  { id: 'tokyotosho', name: 'Tokyo Toshokan' },
  { id: 'darkmahou', name: 'DarkMahou · PT-BR Dublado' },
];
const IDLE_PROVIDER_STATES: ProviderStates = {
  nyaa: { status: 'idle' },
  tokyotosho: { status: 'idle' },
  darkmahou: { status: 'idle' },
};
const DEFAULT_PROVIDER_SELECTION: Record<TorrentProviderId, boolean> = {
  nyaa: true,
  tokyotosho: true,
  darkmahou: true,
};

function mergeReleaseResults(current: ReleaseCandidate[], incoming: ReleaseCandidate[]): ReleaseCandidate[] {
  const byHash = new Map(current.map((release) => [release.infoHash.toLowerCase(), release]));
  for (const release of incoming) {
    if (release.seeders === 0) continue;
    const key = release.infoHash.toLowerCase();
    const previous = byHash.get(key);
    if (previous === undefined || release.score.total > previous.score.total
      || (release.seeders ?? -1) > (previous.seeders ?? -1)) byHash.set(key, release);
  }
  return [...byHash.values()]
    .sort((left, right) => right.score.total - left.score.total || (right.seeders ?? -1) - (left.seeders ?? -1))
    .slice(0, 100);
}

function providerStatus(state: ProviderState): string {
  if (state.status === 'idle') return 'Aguardando';
  if (state.status === 'loading') return 'Buscando…';
  if (state.status === 'failed') return state.message;
  const { stats } = state;
  if (stats.received === 0) return 'O provedor não retornou itens';
  if (stats.titleMatched === 0) return `${String(stats.received)} itens, nenhum corresponde ao anime`;
  if (stats.available === 0) return `${String(stats.titleMatched)} correspondem, todos sem seeders`;
  if (stats.accepted === 0) return `${String(stats.available)} disponíveis, nenhum passou no ranking`;
  return `${String(stats.accepted)} release${stats.accepted === 1 ? '' : 's'} de ${String(stats.received)} itens${state.stale ? ' (salvas)' : ''}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return 'tamanho não informado';
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function episodeCoverage(release: ReleaseCandidate): string {
  const { episode, episodeEnd, batch } = release.parsed;
  if (episode !== null && episodeEnd !== null) {
    return `episódios ${String(episode)}–${String(episodeEnd)} (${String(episodeEnd - episode + 1)})`;
  }
  if (batch) return 'batch';
  return episode === null ? 'episódio não identificado' : `episódio ${String(episode)}`;
}

export function AcquisitionPanel({ animeId, episode }: Props): React.JSX.Element {
  const [releases, setReleases] = useState<ReleaseCandidate[]>([]);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [busy, setBusy] = useState<'releases' | 'subtitles' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [providerStates, setProviderStates] = useState<ProviderStates>(IDLE_PROVIDER_STATES);
  const [selectedProviders, setSelectedProviders] = useState(DEFAULT_PROVIDER_SELECTION);
  const activeRequestIds = useRef(new Set<string>());
  const activeReleaseSearch = useRef<string | null>(null);
  const activeSubtitleSearch = useRef<string | null>(null);

  useEffect(() => () => {
    activeReleaseSearch.current = null;
    activeSubtitleSearch.current = null;
    for (const requestId of activeRequestIds.current) void window.kitsune.releases.cancel({ requestId });
    activeRequestIds.current.clear();
  }, []);

  async function searchReleases(): Promise<void> {
    const providers = RELEASE_PROVIDERS.filter((provider) => selectedProviders[provider.id]);
    if (providers.length === 0) {
      setMessage('Selecione ao menos um provedor.');
      return;
    }
    const searchId = crypto.randomUUID();
    activeReleaseSearch.current = searchId;
    setBusy('releases');
    setMessage(null);
    setReleases([]);
    setProviderStates({
      nyaa: selectedProviders.nyaa ? { status: 'loading' } : { status: 'idle' },
      tokyotosho: selectedProviders.tokyotosho ? { status: 'loading' } : { status: 'idle' },
      darkmahou: selectedProviders.darkmahou ? { status: 'loading' } : { status: 'idle' },
    });

    await Promise.all(providers.map(async (provider) => {
      const requestId = crypto.randomUUID();
      activeRequestIds.current.add(requestId);
      try {
        const result = await window.kitsune.releases.search({ animeId, episode, provider: provider.id, requestId });
        if (activeReleaseSearch.current !== searchId) return;
        if (result.ok) {
          setReleases((current) => mergeReleaseResults(current, result.data));
          setProviderStates((current) => ({
            ...current,
            [provider.id]: { status: 'ready', stats: result.stats, stale: result.stale },
          }));
        } else {
          setProviderStates((current) => ({
            ...current,
            [provider.id]: { status: 'failed', message: result.error.message },
          }));
        }
      } catch (error: unknown) {
        if (activeReleaseSearch.current === searchId) {
          setProviderStates((current) => ({
            ...current,
            [provider.id]: {
              status: 'failed',
              message: error instanceof Error ? error.message : 'O provedor não respondeu.',
            },
          }));
        }
      } finally {
        activeRequestIds.current.delete(requestId);
      }
    }));

    if (activeReleaseSearch.current === searchId) {
      activeReleaseSearch.current = null;
      setBusy(null);
    }
  }

  function toggleProvider(provider: TorrentProviderId): void {
    setSelectedProviders((current) => ({ ...current, [provider]: !current[provider] }));
  }

  async function searchSubtitles(): Promise<void> {
    const id = crypto.randomUUID();
    activeSubtitleSearch.current = id;
    activeRequestIds.current.add(id);
    setBusy('subtitles');
    setMessage(null);
    try {
      const result = await window.kitsune.subtitles.search({ animeId, episode, requestId: id });
      if (activeSubtitleSearch.current !== id) return;
      if (!result.ok) setMessage(result.error.message);
      else setSubtitles(result.data);
    } catch (error: unknown) {
      if (activeSubtitleSearch.current === id) {
        setMessage(error instanceof Error ? error.message : 'O provedor de legendas não respondeu.');
      }
    } finally {
      activeRequestIds.current.delete(id);
      if (activeSubtitleSearch.current === id) {
        activeSubtitleSearch.current = null;
        setBusy(null);
      }
    }
  }

  async function downloadRelease(id: string): Promise<void> {
    setMessage('Salvando fonte torrent…');
    const result = await window.kitsune.releases.download({ releaseId: id });
    if (!result.ok) setMessage(result.error.message);
    else setMessage(`Fonte torrent salva em ${result.data.filePath}`);
  }

  async function startTorrent(id: string): Promise<void> {
    setMessage('Iniciando download seguro…');
    const result = await window.kitsune.torrents.start({ releaseId: id });
    setMessage(result.ok
      ? 'Download iniciado. Acompanhe o estado na tela Downloads.'
      : result.error.message);
  }

  async function downloadSubtitle(fileId: number): Promise<void> {
    setMessage('Baixando legenda…');
    const result = await window.kitsune.subtitles.download({ animeId, episode, fileId });
    setMessage(result.ok ? `Legenda salva em ${result.directory}` : result.error.message);
  }

  return (
    <section className="details-section acquisition">
      <div className="section-heading">
        <div>
          <h2>Releases e legendas</h2>
          <p>Nyaa, Tokyo Toshokan e DarkMahou PT-BR Dublado; OpenSubtitles para legendas.</p>
        </div>
        {episode !== null && <strong>Episódio {episode}</strong>}
      </div>
      <div className="provider-selector" role="group" aria-label="Provedores de releases">
        {RELEASE_PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            aria-pressed={selectedProviders[provider.id]}
            className={selectedProviders[provider.id] ? 'selected' : ''}
            onClick={() => { toggleProvider(provider.id); }}
          >
            {provider.name}
          </button>
        ))}
      </div>
      <div className="action-row">
        <button className="primary" type="button" disabled={busy !== null} onClick={() => void searchReleases()}>
          {busy === 'releases' ? 'Buscando provedores…' : 'Buscar releases'}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void searchSubtitles()}>
          {busy === 'subtitles' ? 'Buscando legendas…' : 'Buscar legendas'}
        </button>
      </div>
      {RELEASE_PROVIDERS.some((provider) => providerStates[provider.id].status !== 'idle') && (
        <div className="provider-progress" aria-live="polite">
          {RELEASE_PROVIDERS.filter((provider) => providerStates[provider.id].status !== 'idle').map((provider) => (
            <span key={provider.id} className={providerStates[provider.id].status}>
              <strong>{provider.name}</strong> · {providerStatus(providerStates[provider.id])}
            </span>
          ))}
        </div>
      )}
      {message !== null && <p className="notice" role="status">{message}</p>}
      {busy !== 'releases'
        && RELEASE_PROVIDERS.some((provider) => providerStates[provider.id].status !== 'idle')
        && releases.filter((release) => selectedProviders[release.provider]).length === 0
        && <div className="panel empty">Nenhuma release disponível.</div>}
      {releases.some((release) => selectedProviders[release.provider]) && (
        <div className="result-list">
          {releases.filter((release) => selectedProviders[release.provider]).map((release) => (
            <article key={release.id} className="media-result">
              <div>
                <strong>{release.title}</strong>
                <small>
                  {release.providerName} · {episodeCoverage(release)} · {formatBytes(release.sizeBytes)} · {release.seeders === null ? 'seeders não informados' : `${String(release.seeders)} seeders`} · score {release.score.total}
                </small>
                <span>{release.score.reasons.slice(0, 4).join(' · ')}</span>
              </div>
              <div className="action-row">
                <button className="primary" type="button" onClick={() => void startTorrent(release.id)}>Baixar vídeo</button>
                <button type="button" onClick={() => void downloadRelease(release.id)}>
                  {release.torrentUrl.startsWith('magnet:') ? 'Salvar magnet' : 'Salvar .torrent'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {subtitles.length > 0 && (
        <div className="result-list">
          {subtitles.map((subtitle) => (
            <article key={`${subtitle.id}-${String(subtitle.fileId)}`} className="media-result">
              <div>
                <strong>{subtitle.release}</strong>
                <small>{subtitle.language.toUpperCase()} · {subtitle.downloadCount} downloads</small>
              </div>
              <button type="button" onClick={() => void downloadSubtitle(subtitle.fileId)}>Baixar legenda</button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
