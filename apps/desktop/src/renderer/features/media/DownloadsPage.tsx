import { useCallback, useEffect, useState } from 'react';
import type { TorrentDownload } from '../../../shared/contracts/media';

function size(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function stateLabel(status: TorrentDownload['status']): string {
  if (status === 'queued') return 'Preparando';
  if (status === 'downloading') return 'Baixando';
  if (status === 'paused') return 'Pausado';
  if (status === 'completed') return 'Concluído';
  return 'Falhou';
}

export function DownloadsPage(): React.JSX.Element {
  const [downloads, setDownloads] = useState<TorrentDownload[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.kitsune.torrents.status();
    if (result.ok) setDownloads(result.data);
    else setMessage(result.error.message);
  }, []);

  useEffect(() => {
    let active = true;
    const update = async (): Promise<void> => {
      if (active) await refresh();
    };
    void update();
    const timer = window.setInterval(() => { void update(); }, 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function control(download: TorrentDownload, action: 'pause' | 'resume' | 'remove', deleteFiles = false): Promise<void> {
    if (deleteFiles && !window.confirm('Excluir permanentemente os arquivos baixados desta release?')) return;
    const result = await window.kitsune.torrents.control({
      infoHash: download.infoHash,
      action,
      deleteFiles,
    });
    setMessage(result.ok ? null : result.error.message);
    await refresh();
  }

  return (
    <section className="page downloads-page">
      <div className="page-heading">
        <div><span className="eyebrow">WEBTORRENT</span><h1>Downloads</h1></div>
      </div>
      <p className="page-intro">Downloads P2P ficam em Vídeos. Ao concluir, o cliente encerra a conexão e não permanece semeando.</p>
      {message !== null && <p className="notice error" role="alert">{message}</p>}
      {downloads.length === 0 && <section className="panel empty-state">Nenhum download iniciado.</section>}
      <div className="result-list">
        {downloads.map((download) => (
          <article className="panel download-card" key={download.infoHash}>
            <div className="download-heading">
              <div>
                <strong>{download.name}</strong>
                <small>{stateLabel(download.status)} · {(download.progress * 100).toFixed(1)}%</small>
              </div>
              <span>{download.peers} peers</span>
            </div>
            <progress max={1} value={download.progress} aria-label={`Progresso de ${download.name}`} />
            <small>
              {size(download.downloadedBytes)} de {size(download.sizeBytes)} · {size(download.downloadSpeed)}/s
            </small>
            {download.error !== null && <p className="error" role="alert">{download.error}</p>}
            {download.files.length > 0 && (
              <ul className="download-files">
                {download.files.slice(0, 5).map((file) => (
                  <li key={file.name}>{file.name} · {(file.progress * 100).toFixed(0)}%</li>
                ))}
              </ul>
            )}
            <div className="action-row">
              {(download.status === 'queued' || download.status === 'downloading') && (
                <button type="button" onClick={() => void control(download, 'pause')}>Pausar</button>
              )}
              {(download.status === 'paused' || download.status === 'failed') && (
                <button className="primary" type="button" onClick={() => void control(download, 'resume')}>Retomar</button>
              )}
              <button type="button" onClick={() => void control(download, 'remove')}>Remover da lista</button>
              <button className="danger" type="button" onClick={() => void control(download, 'remove', true)}>Excluir arquivos</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
