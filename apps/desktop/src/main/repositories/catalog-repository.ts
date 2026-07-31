import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AnimeDetailsSchema,
  AnimeFormatSchema,
  AnimeRelationTypeSchema,
  AnimeSeasonSchema,
  AnimeStatusSchema,
  AnimeSummarySchema,
  WatchStatusSchema,
  WatchlistItemSchema,
  type AnimeDetails,
  type AnimeSummary,
  type WatchStatus,
  type WatchlistItem,
} from '../../shared/contracts/catalog';
import type {
  ExternalAnimeDetails,
  ExternalAnimeSummary,
} from '../providers/catalog-provider';
import type { KitsuneDatabase } from '../infrastructure/database/open-database';

const AnimeSummaryRowSchema = z
  .object({
    id: z.uuid(),
    anilist_id: z.number().int().positive(),
    title_romaji: z.string().min(1),
    title_english: z.string().min(1).nullable(),
    title_native: z.string().min(1).nullable(),
    cover_url: z.string().nullable(),
    cover_color: z.string().nullable(),
    format: AnimeFormatSchema,
    status: AnimeStatusSchema,
    season: AnimeSeasonSchema,
    season_year: z.number().int().nullable(),
    episode_count: z.number().int().positive().nullable(),
    average_score: z.number().int().min(0).max(100).nullable(),
  })
  .strict();

const AnimeDetailsRowSchema = AnimeSummaryRowSchema.extend({
  mal_id: z.number().int().positive().nullable(),
  description: z.string().nullable(),
  banner_url: z.string().nullable(),
  genres_json: z.string(),
  duration_minutes: z.number().int().positive().nullable(),
  watch_status: WatchStatusSchema.nullable(),
}).strict();

const RelationRowSchema = AnimeSummaryRowSchema.extend({
  relation_type: AnimeRelationTypeSchema,
}).strict();
const EpisodeRowSchema = z.object({ id: z.string().min(1), episode_number: z.number().int().positive() }).strict();
const GenresSchema = z.array(z.string().min(1)).max(30);
const WatchlistRowSchema = AnimeSummaryRowSchema.extend({ watch_status: WatchStatusSchema }).strict();

function summaryFromRow(row: z.infer<typeof AnimeSummaryRowSchema>): AnimeSummary {
  return AnimeSummarySchema.parse({
    id: row.id,
    anilistId: row.anilist_id,
    title: {
      romaji: row.title_romaji,
      english: row.title_english,
      native: row.title_native,
    },
    coverImage: row.cover_url,
    coverColor: row.cover_color,
    format: row.format,
    status: row.status,
    season: row.season,
    seasonYear: row.season_year,
    episodeCount: row.episode_count,
    averageScore: row.average_score,
  });
}

const SUMMARY_COLUMNS = `
  id, anilist_id, title_romaji, title_english, title_native,
  cover_url, cover_color, format, status, season, season_year,
  episode_count, average_score
`;
const ANIME_SUMMARY_COLUMNS = `
  a.id AS id, a.anilist_id AS anilist_id, a.title_romaji AS title_romaji,
  a.title_english AS title_english, a.title_native AS title_native,
  a.cover_url AS cover_url, a.cover_color AS cover_color, a.format AS format,
  a.status AS status, a.season AS season, a.season_year AS season_year,
  a.episode_count AS episode_count, a.average_score AS average_score
`;
const RELATED_SUMMARY_COLUMNS = `
  related.id AS id, related.anilist_id AS anilist_id, related.title_romaji AS title_romaji,
  related.title_english AS title_english, related.title_native AS title_native,
  related.cover_url AS cover_url, related.cover_color AS cover_color,
  related.format AS format, related.status AS status, related.season AS season,
  related.season_year AS season_year, related.episode_count AS episode_count,
  related.average_score AS average_score
`;

export class CatalogRepository {
  public constructor(private readonly database: KitsuneDatabase) {}

  private upsertSummary(input: ExternalAnimeSummary): AnimeSummary {
    const row = AnimeSummaryRowSchema.parse(
      this.database
        .prepare(`
          INSERT INTO anime (
            id, anilist_id, title_romaji, title_english, title_native,
            cover_url, cover_color, format, status, season, season_year,
            episode_count, average_score, metadata_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(anilist_id) DO UPDATE SET
            title_romaji = excluded.title_romaji,
            title_english = excluded.title_english,
            title_native = excluded.title_native,
            cover_url = excluded.cover_url,
            cover_color = excluded.cover_color,
            format = excluded.format,
            status = excluded.status,
            season = excluded.season,
            season_year = excluded.season_year,
            episode_count = excluded.episode_count,
            average_score = excluded.average_score,
            metadata_updated_at = excluded.metadata_updated_at
          RETURNING ${SUMMARY_COLUMNS}
        `)
        .get(
          randomUUID(),
          input.anilistId,
          input.title.romaji,
          input.title.english,
          input.title.native,
          input.coverImage,
          input.coverColor,
          input.format,
          input.status,
          input.season,
          input.seasonYear,
          input.episodeCount,
          input.averageScore,
          Date.now(),
        ),
    );
    return summaryFromRow(row);
  }

  public saveSummaries(inputs: ExternalAnimeSummary[]): AnimeSummary[] {
    return this.database.transaction(() => inputs.map((input) => this.upsertSummary(input)))();
  }

  public saveDetails(input: ExternalAnimeDetails): AnimeDetails {
    const animeId = this.database.transaction(() => {
      const summary = this.upsertSummary(input);
      this.database
        .prepare(`
          UPDATE anime SET
            mal_id = ?, description = ?, banner_url = ?, genres_json = ?,
            duration_minutes = ?, metadata_updated_at = ?
          WHERE id = ?
        `)
        .run(
          input.malId,
          input.description,
          input.bannerImage,
          JSON.stringify(input.genres),
          input.durationMinutes,
          Date.now(),
          summary.id,
        );

      this.database.prepare('DELETE FROM anime_relations WHERE anime_id = ?').run(summary.id);
      const insertRelation = this.database.prepare(`
        INSERT OR IGNORE INTO anime_relations (anime_id, related_anime_id, relation_type)
        VALUES (?, ?, ?)
      `);
      for (const relation of input.relations) {
        const related = this.upsertSummary(relation.anime);
        insertRelation.run(summary.id, related.id, relation.type);
      }

      if (input.episodeCount !== null) {
        const insertEpisode = this.database.prepare(`
          INSERT OR IGNORE INTO episodes (id, anime_id, episode_number) VALUES (?, ?, ?)
        `);
        for (let number = 1; number <= input.episodeCount; number += 1) {
          insertEpisode.run(`${summary.id}:${String(number)}`, summary.id, number);
        }
        this.database
          .prepare('DELETE FROM episodes WHERE anime_id = ? AND episode_number > ?')
          .run(summary.id, input.episodeCount);
      }
      return summary.id;
    })();

    const details = this.getDetails(animeId);
    if (details === undefined) throw new Error('Saved anime could not be read');
    return details;
  }

  public getDetails(animeId: string): AnimeDetails | undefined {
    const rawRow = this.database
      .prepare(`
        SELECT ${ANIME_SUMMARY_COLUMNS}, a.mal_id, a.description, a.banner_url,
          a.genres_json, a.duration_minutes, u.status AS watch_status
        FROM anime a
        LEFT JOIN user_lists u ON u.anime_id = a.id
        WHERE a.id = ?
      `)
      .get(animeId);
    if (rawRow === undefined) return undefined;
    const row = AnimeDetailsRowSchema.parse(rawRow);

    const relations = this.database
      .prepare(`
        SELECT ${RELATED_SUMMARY_COLUMNS},
          relations.relation_type
        FROM anime_relations relations
        JOIN anime related ON related.id = relations.related_anime_id
        WHERE relations.anime_id = ?
        ORDER BY related.season_year, related.title_romaji
      `)
      .all(animeId)
      .map((value) => RelationRowSchema.parse(value))
      .map((relation) => ({ type: relation.relation_type, anime: summaryFromRow(relation) }));

    const episodes = this.database
      .prepare('SELECT id, episode_number FROM episodes WHERE anime_id = ? ORDER BY episode_number')
      .all(animeId)
      .map((value) => EpisodeRowSchema.parse(value))
      .map((episode) => ({
        id: episode.id,
        number: episode.episode_number,
        title: null,
        titleJapanese: null,
        titleRomanji: null,
        synopsis: null,
        airedAt: null,
        durationSeconds: null,
        filler: null,
        recap: null,
      }));
    const genresRaw: unknown = JSON.parse(row.genres_json);

    return AnimeDetailsSchema.parse({
      ...summaryFromRow(row),
      malId: row.mal_id,
      description: row.description,
      bannerImage: row.banner_url,
      genres: GenresSchema.parse(genresRaw),
      durationMinutes: row.duration_minutes,
      episodes,
      relations,
      watchStatus: row.watch_status,
    });
  }

  public getAnilistId(animeId: string): number | undefined {
    const value: unknown = this.database
      .prepare('SELECT anilist_id FROM anime WHERE id = ?')
      .pluck()
      .get(animeId);
    return value === undefined ? undefined : z.number().int().positive().parse(value);
  }

  public getWatchlist(): WatchlistItem[] {
    return this.database
      .prepare(`
        SELECT ${ANIME_SUMMARY_COLUMNS}, u.status AS watch_status
        FROM user_lists u JOIN anime a ON a.id = u.anime_id
        ORDER BY u.updated_at DESC
      `)
      .all()
      .map((value) => {
        const row = WatchlistRowSchema.parse(value);
        return WatchlistItemSchema.parse({ anime: summaryFromRow(row), status: row.watch_status });
      });
  }

  public setWatchStatus(animeId: string, status: WatchStatus | null): WatchlistItem | null {
    if (status === null) {
      this.database.prepare('DELETE FROM user_lists WHERE anime_id = ?').run(animeId);
      return null;
    }
    this.database.prepare(`
      INSERT INTO user_lists (anime_id, status, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(anime_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(animeId, status, Date.now());

    const row = WatchlistRowSchema.parse(
      this.database.prepare(`
        SELECT ${ANIME_SUMMARY_COLUMNS}, u.status AS watch_status
        FROM user_lists u JOIN anime a ON a.id = u.anime_id
        WHERE u.anime_id = ?
      `).get(animeId),
    );
    return WatchlistItemSchema.parse({ anime: summaryFromRow(row), status: row.watch_status });
  }
}
