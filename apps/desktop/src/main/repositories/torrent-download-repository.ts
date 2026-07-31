import { z } from 'zod';
import {
  InfoHashSchema,
  NyaaItemIdSchema,
  TorrentDownloadStateSchema,
  type TorrentDownloadState,
} from '../../shared/contracts/media';
import type { KitsuneDatabase } from '../infrastructure/database/open-database';

const TorrentDownloadRowSchema = z.object({
  release_id: NyaaItemIdSchema,
  info_hash: InfoHashSchema,
  torrent_file_path: z.string().min(1),
  destination_path: z.string().min(1),
  name: z.string().min(1).max(1_024),
  state: TorrentDownloadStateSchema,
  error_message: z.string().max(500).nullable(),
}).strict();

export interface StoredTorrentDownload {
  releaseId: string;
  infoHash: string;
  torrentFilePath: string;
  destinationPath: string;
  name: string;
  state: TorrentDownloadState;
  error: string | null;
}

function mapRow(row: z.infer<typeof TorrentDownloadRowSchema>): StoredTorrentDownload {
  return {
    releaseId: row.release_id,
    infoHash: row.info_hash,
    torrentFilePath: row.torrent_file_path,
    destinationPath: row.destination_path,
    name: row.name,
    state: row.state,
    error: row.error_message,
  };
}

export class TorrentDownloadRepository {
  public constructor(private readonly database: KitsuneDatabase) {}

  public list(): StoredTorrentDownload[] {
    return TorrentDownloadRowSchema.array().parse(this.database.prepare(`
      SELECT release_id, info_hash, torrent_file_path, destination_path, name, state, error_message
      FROM torrent_downloads
      ORDER BY updated_at DESC
      LIMIT 500
    `).all()).map(mapRow);
  }

  public getByInfoHash(infoHash: string): StoredTorrentDownload | null {
    const row = this.database.prepare(`
      SELECT release_id, info_hash, torrent_file_path, destination_path, name, state, error_message
      FROM torrent_downloads
      WHERE info_hash = ?
    `).get(infoHash);
    return row === undefined ? null : mapRow(TorrentDownloadRowSchema.parse(row));
  }

  public getByReleaseId(releaseId: string): StoredTorrentDownload | null {
    const row = this.database.prepare(`
      SELECT release_id, info_hash, torrent_file_path, destination_path, name, state, error_message
      FROM torrent_downloads
      WHERE release_id = ?
    `).get(releaseId);
    return row === undefined ? null : mapRow(TorrentDownloadRowSchema.parse(row));
  }

  public save(download: StoredTorrentDownload): void {
    const now = Date.now();
    this.database.prepare(`
      INSERT INTO torrent_downloads (
        release_id, info_hash, torrent_file_path, destination_path,
        name, state, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(release_id) DO UPDATE SET
        info_hash = excluded.info_hash,
        torrent_file_path = excluded.torrent_file_path,
        destination_path = excluded.destination_path,
        name = excluded.name,
        state = excluded.state,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
    `).run(
      download.releaseId,
      download.infoHash,
      download.torrentFilePath,
      download.destinationPath,
      download.name,
      download.state,
      download.error,
      now,
      now,
    );
  }

  public setState(infoHash: string, state: TorrentDownloadState, error: string | null = null): void {
    this.database.prepare(`
      UPDATE torrent_downloads
      SET state = ?, error_message = ?, updated_at = ?
      WHERE info_hash = ?
    `).run(state, error, Date.now(), infoHash);
  }

  public remove(infoHash: string): void {
    this.database.prepare('DELETE FROM torrent_downloads WHERE info_hash = ?').run(infoHash);
  }
}
