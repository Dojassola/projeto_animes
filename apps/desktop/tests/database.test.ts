import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/main/infrastructure/database/migrations';
import { CatalogRepository } from '../src/main/repositories/catalog-repository';
import { IntegrationSettingsRepository } from '../src/main/repositories/integration-settings-repository';
import { SettingsRepository } from '../src/main/repositories/settings-repository';
import { TorrentDownloadRepository } from '../src/main/repositories/torrent-download-repository';

describe('database foundation', () => {
  it('applies migrations once and persists validated settings', () => {
    const database = new Database(':memory:');
    migrateDatabase(database);
    migrateDatabase(database);

    const repository = new SettingsRepository(database);
    expect(repository.get()).toEqual({ theme: 'dark', reduceMotion: false });
    expect(repository.update({ theme: 'oled', reduceMotion: true })).toEqual({
      theme: 'oled',
      reduceMotion: true,
    });
    expect(database.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(6);
    expect(database.prepare(`
      SELECT COUNT(*) FROM pragma_table_info('integration_settings')
      WHERE name LIKE 'qbittorrent_%'
    `).pluck().get()).toBe(0);

    const integrations = new IntegrationSettingsRepository(
      database,
      'C:\\Downloads\\Kitsune',
      (value) => Buffer.from(value),
      (value) => value.toString(),
    );
    expect(integrations.get()).toMatchObject({
      torrentDownloadPath: 'C:\\Downloads\\Kitsune',
      primaryLanguage: 'pt-br',
      subtitleLanguages: ['pt-br', 'en'],
    });
    expect(integrations.update({
      primaryLanguage: 'en',
      openSubtitles: { username: '' },
      subtitleLanguages: ['en', 'pt-br'],
    })).toMatchObject({ primaryLanguage: 'en', subtitleLanguages: ['en', 'pt-br'] });
    const torrents = new TorrentDownloadRepository(database);
    torrents.save({
      releaseId: 'nyaa:1890607',
      infoHash: '27a54cbc8334f7f7c90d43482fb9ef1547bce5a7',
      torrentFilePath: 'C:\\Downloads\\Kitsune\\Torrents\\1890607.torrent',
      destinationPath: 'C:\\Downloads\\Kitsune\\Videos',
      name: 'Another',
      state: 'paused',
      error: null,
    });
    expect(torrents.list()).toMatchObject([{ releaseId: 'nyaa:1890607', state: 'paused', name: 'Another' }]);
    database.close();
  });

  it('persists anime details, generated episodes and the local watchlist', () => {
    const database = new Database(':memory:');
    migrateDatabase(database);
    const repository = new CatalogRepository(database);
    const details = repository.saveDetails({
      anilistId: 154587,
      malId: 52991,
      title: { romaji: 'Sousou no Frieren', english: 'Frieren', native: '葬送のフリーレン' },
      coverImage: 'https://example.com/frieren.webp',
      coverColor: '#87aacc',
      bannerImage: null,
      description: 'Uma jornada depois da aventura.',
      format: 'TV',
      status: 'FINISHED',
      season: 'FALL',
      seasonYear: 2023,
      episodeCount: 3,
      averageScore: 90,
      durationMinutes: 24,
      genres: ['Adventure', 'Fantasy'],
      relations: [],
    });

    expect(details.episodes.map((episode) => episode.number)).toEqual([1, 2, 3]);
    expect(repository.setWatchStatus(details.id, 'planning')?.anime.id).toBe(details.id);
    expect(repository.getWatchlist()).toHaveLength(1);
    expect(repository.setWatchStatus(details.id, null)).toBeNull();
    database.close();
  });
});
