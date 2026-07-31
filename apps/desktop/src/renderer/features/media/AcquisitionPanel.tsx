import { useEffect, useState } from 'react';
import type { ReleaseCandidate } from '../../../shared/contracts/media';

interface Props {
  animeId: string;
  episode: number | null;
}

type Subtitle = Extract<Awaited<ReturnType<typeof window.kitsune.subtitles.search>>, { ok: true }>['data'][number];

function formatBytes(bytes: number): string {
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
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => () => {
    if (requestId !== null) void window.kitsune.releases.cancel({ requestId });
  }, [requestId]);

  async function searchReleases(): Promise<void> {
    const id = crypto.randomUUID();
    setRequestId(id);
    setBusy('releases');
    setMessage(null);
    const result = await window.kitsune.releases.search({ animeId, episode, requestId: id });
    setRequestId(null);
    setBusy(null);
    if (!result.ok) setMessage(result.error.message);
    else {
      setReleases(result.data);
      setMessage(result.stale ? 'Resultados salvos; o Nyaa não respondeu agora.' : null);
    }
  }

  async function searchSubtitles(): Promise<void> {
    const id = crypto.randomUUID();
    setRequestId(id);
    setBusy('subtitles');
    setMessage(null);
    const result = await window.kitsune.subtitles.search({ animeId, episode, requestId: id });
    setRequestId(null);
    setBusy(null);
    if (!result.ok) setMessage(result.error.message);
    else setSubtitles(result.data);
  }

  async function downloadRelease(id: string): Promise<void> {
    setMessage('Salvando arquivo .torrent…');
    const result = await window.kitsune.releases.download({ releaseId: id });
    if (!result.ok) setMessage(result.error.message);
    else setMessage(`Arquivo .torrent salvo em ${result.data.filePath}`);
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
          <p>Nyaa para releases; OpenSubtitles para PT-BR e outros idiomas.</p>
        </div>
        {episode !== null && <strong>Episódio {episode}</strong>}
      </div>
      <div className="action-row">
        <button className="primary" type="button" disabled={busy !== null} onClick={() => void searchReleases()}>
          {busy === 'releases' ? 'Buscando Nyaa…' : 'Buscar releases'}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void searchSubtitles()}>
          {busy === 'subtitles' ? 'Buscando legendas…' : 'Buscar legendas'}
        </button>
      </div>
      {message !== null && <p className="notice" role="status">{message}</p>}
      {releases.length > 0 && (
        <div className="result-list">
          {releases.map((release) => (
            <article key={release.id} className="media-result">
              <div>
                <strong>{release.title}</strong>
                <small>
                  {episodeCoverage(release)} · {formatBytes(release.sizeBytes)} · {release.seeders} seeders · score {release.score.total}
                </small>
                <span>{release.score.reasons.slice(0, 4).join(' · ')}</span>
              </div>
              <div className="action-row">
                <button className="primary" type="button" onClick={() => void startTorrent(release.id)}>Baixar vídeo</button>
                <button type="button" onClick={() => void downloadRelease(release.id)}>Salvar .torrent</button>
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
