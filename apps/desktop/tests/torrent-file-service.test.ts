import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/main/infrastructure/database/migrations';
import { IntegrationSettingsRepository } from '../src/main/repositories/integration-settings-repository';
import { TorrentDownloadRepository } from '../src/main/repositories/torrent-download-repository';
import { TorrentFileService } from '../src/main/services/torrent-file-service';
import { validateTorrentContents, WebTorrentService } from '../src/main/services/webtorrent-service';

const temporaryPaths: string[] = [];

afterEach(async () => {
  for (const path of temporaryPaths.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('torrent file service', () => {
  it('downloads and saves a validated Nyaa .torrent file', async () => {
    const downloadPath = await mkdtemp(join(tmpdir(), 'kitsune-torrent-'));
    temporaryPaths.push(downloadPath);
    const database = new Database(':memory:');
    migrateDatabase(database);
    const settings = new IntegrationSettingsRepository(
      database,
      downloadPath,
      (value) => Buffer.from(value),
      (value) => value.toString(),
    );
    const torrentBytes = new TextEncoder().encode('d4:infod4:name4:testee');
    const fetcher: typeof fetch = () => Promise.resolve(new Response(torrentBytes, { status: 200 }));

    const result = await new TorrentFileService(settings, fetcher).save('1890607');

    expect(result.filePath).toBe(join(downloadPath, 'Torrents', '1890607.torrent'));
    expect(await readFile(result.filePath)).toEqual(Buffer.from(torrentBytes));
    database.close();
  });

  it('rejects paths that escape the isolated torrent directory', () => {
    expect(() => {
      validateTorrentContents(
        '27a54cbc8334f7f7c90d43482fb9ef1547bce5a7',
        1_024,
        [{ path: '..\\outside.exe' }],
        'C:\\Downloads\\Kitsune\\Videos',
      );
    }).toThrow('caminho de arquivo inseguro');
  });

  it('waits for WebTorrent metadata before persisting the info hash', async () => {
    const downloadPath = await mkdtemp(join(tmpdir(), 'kitsune-webtorrent-'));
    temporaryPaths.push(downloadPath);
    const database = new Database(':memory:');
    migrateDatabase(database);
    const settings = new IntegrationSettingsRepository(
      database,
      downloadPath,
      (value) => Buffer.from(value),
      (value) => value.toString(),
    );
    const torrentBytes = Buffer.concat([
      Buffer.from('d4:infod6:lengthi4e4:name8:test.mp412:piece lengthi16384e6:pieces20:'),
      createHash('sha1').update('test').digest(),
      Buffer.from('ee'),
    ]);
    const torrentFiles = new TorrentFileService(
      settings,
      () => Promise.resolve(new Response(torrentBytes, { status: 200 })),
    );
    const downloads = new TorrentDownloadRepository(database);
    const service = new WebTorrentService(settings, downloads, torrentFiles);

    try {
      const result = await service.start('1');

      expect(result.infoHash).toMatch(/^[a-f0-9]{40}$/);
      expect(result.infoHash).not.toBe('0000000000000000000000000000000000000000');
      expect(downloads.list()).toMatchObject([{ infoHash: result.infoHash, state: 'downloading' }]);
    } finally {
      service.dispose();
      database.close();
    }
  });
});
