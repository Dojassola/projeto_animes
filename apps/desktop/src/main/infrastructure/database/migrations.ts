import { z } from 'zod';
import type { KitsuneDatabase } from './open-database';

const MigrationVersionSchema = z.number().int().nonnegative();

const migrations = [
  {
    version: 1,
    up(database: KitsuneDatabase): void {
      database.exec(`
        CREATE TABLE settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          theme TEXT NOT NULL CHECK (theme IN ('dark', 'oled', 'light')),
          reduce_motion INTEGER NOT NULL CHECK (reduce_motion IN (0, 1))
        );

        INSERT INTO settings (id, theme, reduce_motion) VALUES (1, 'dark', 0);
      `);
    },
  },
  {
    version: 2,
    up(database: KitsuneDatabase): void {
      database.exec(`
        CREATE TABLE anime (
          id TEXT PRIMARY KEY,
          anilist_id INTEGER NOT NULL UNIQUE,
          mal_id INTEGER,
          title_romaji TEXT NOT NULL,
          title_english TEXT,
          title_native TEXT,
          description TEXT,
          cover_url TEXT,
          cover_color TEXT,
          banner_url TEXT,
          episode_count INTEGER CHECK (episode_count IS NULL OR episode_count > 0),
          duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),
          format TEXT,
          status TEXT,
          season TEXT,
          season_year INTEGER,
          average_score INTEGER CHECK (average_score IS NULL OR average_score BETWEEN 0 AND 100),
          genres_json TEXT NOT NULL DEFAULT '[]',
          metadata_updated_at INTEGER NOT NULL
        );

        CREATE TABLE anime_relations (
          anime_id TEXT NOT NULL,
          related_anime_id TEXT NOT NULL,
          relation_type TEXT NOT NULL,
          PRIMARY KEY (anime_id, related_anime_id, relation_type),
          FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE,
          FOREIGN KEY (related_anime_id) REFERENCES anime(id) ON DELETE CASCADE
        );

        CREATE TABLE episodes (
          id TEXT PRIMARY KEY,
          anime_id TEXT NOT NULL,
          episode_number INTEGER NOT NULL CHECK (episode_number > 0),
          UNIQUE (anime_id, episode_number),
          FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
        );

        CREATE TABLE provider_cache (
          cache_key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE user_lists (
          anime_id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('planning', 'watching', 'completed', 'paused', 'dropped')),
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_anime_title_romaji ON anime(title_romaji);
        CREATE INDEX idx_anime_season ON anime(season_year, season);
        CREATE INDEX idx_episodes_anime ON episodes(anime_id, episode_number);
        CREATE INDEX idx_provider_cache_expiry ON provider_cache(expires_at);
        CREATE INDEX idx_user_lists_updated ON user_lists(updated_at DESC);
      `);
    },
  },
  {
    version: 3,
    up(database: KitsuneDatabase): void {
      database.exec(`
        CREATE TABLE integration_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          qbittorrent_url TEXT NOT NULL,
          qbittorrent_username TEXT NOT NULL,
          qbittorrent_password BLOB,
          opensubtitles_api_key BLOB,
          opensubtitles_username TEXT NOT NULL,
          opensubtitles_password BLOB,
          subtitle_languages_json TEXT NOT NULL,
          download_path TEXT
        );

        INSERT INTO integration_settings (
          id, qbittorrent_url, qbittorrent_username, opensubtitles_username,
          subtitle_languages_json
        ) VALUES (1, 'http://127.0.0.1:8080', 'admin', '', '["pt-br","en"]');
      `);
    },
  },
  {
    version: 4,
    up(database: KitsuneDatabase): void {
      database.exec(`
        CREATE TABLE integration_settings_next (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          opensubtitles_api_key BLOB,
          opensubtitles_username TEXT NOT NULL,
          opensubtitles_password BLOB,
          subtitle_languages_json TEXT NOT NULL,
          download_path TEXT
        );

        INSERT INTO integration_settings_next (
          id, opensubtitles_api_key, opensubtitles_username,
          opensubtitles_password, subtitle_languages_json, download_path
        )
        SELECT
          id, opensubtitles_api_key, opensubtitles_username,
          opensubtitles_password, subtitle_languages_json, download_path
        FROM integration_settings;

        DROP TABLE integration_settings;
        ALTER TABLE integration_settings_next RENAME TO integration_settings;
      `);
    },
  },
  {
    version: 5,
    up(database: KitsuneDatabase): void {
      database.exec(`
        CREATE TABLE torrent_downloads (
          release_id TEXT PRIMARY KEY CHECK (release_id GLOB '[0-9]*' AND length(release_id) BETWEEN 1 AND 12),
          info_hash TEXT NOT NULL UNIQUE CHECK (length(info_hash) = 40),
          torrent_file_path TEXT NOT NULL,
          destination_path TEXT NOT NULL,
          name TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('queued', 'downloading', 'paused', 'completed', 'failed')),
          error_message TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX idx_torrent_downloads_updated ON torrent_downloads(updated_at DESC);
      `);
    },
  },
  {
    version: 6,
    up(database: KitsuneDatabase): void {
      database.exec(`
        ALTER TABLE integration_settings ADD COLUMN primary_language TEXT NOT NULL
          DEFAULT 'pt-br' CHECK (primary_language IN ('pt-br', 'en', 'ja'));

        CREATE TABLE torrent_downloads_next (
          release_id TEXT PRIMARY KEY CHECK (
            (
              substr(release_id, 1, 5) = 'nyaa:'
              AND length(release_id) BETWEEN 6 AND 17
              AND substr(release_id, 6) NOT GLOB '*[^0-9]*'
            ) OR (
              substr(release_id, 1, 12) = 'tokyotosho:'
              AND length(release_id) BETWEEN 13 AND 24
              AND substr(release_id, 13) NOT GLOB '*[^0-9]*'
            )
          ),
          info_hash TEXT NOT NULL UNIQUE CHECK (length(info_hash) = 40),
          torrent_file_path TEXT NOT NULL,
          destination_path TEXT NOT NULL,
          name TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('queued', 'downloading', 'paused', 'completed', 'failed')),
          error_message TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        INSERT INTO torrent_downloads_next (
          release_id, info_hash, torrent_file_path, destination_path,
          name, state, error_message, created_at, updated_at
        )
        SELECT
          'nyaa:' || release_id, info_hash, torrent_file_path, destination_path,
          name, state, error_message, created_at, updated_at
        FROM torrent_downloads;

        DROP TABLE torrent_downloads;
        ALTER TABLE torrent_downloads_next RENAME TO torrent_downloads;
        CREATE INDEX idx_torrent_downloads_updated ON torrent_downloads(updated_at DESC);
      `);
    },
  },
] as const;

export function migrateDatabase(database: KitsuneDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const currentVersion = MigrationVersionSchema.parse(
    database.prepare('SELECT COALESCE(MAX(version), 0) FROM schema_migrations').pluck().get(),
  );

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;

    database.transaction(() => {
      migration.up(database);
      database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
    })();
  }
}
