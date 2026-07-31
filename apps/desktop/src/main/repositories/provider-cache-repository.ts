import { z } from 'zod';
import type { KitsuneDatabase } from '../infrastructure/database/open-database';

const CacheRowSchema = z
  .object({ payload: z.string(), expires_at: z.number().int(), updated_at: z.number().int() })
  .strict();

export interface CachedValue<T> {
  value: T;
  expired: boolean;
  updatedAt: number;
}

const MAX_CACHE_ENTRIES = 200;

export class ProviderCacheRepository {
  public constructor(private readonly database: KitsuneDatabase) {}

  public get<T>(cacheKey: string, schema: z.ZodType<T>): CachedValue<T> | undefined {
    const rawRow = this.database
      .prepare('SELECT payload, expires_at, updated_at FROM provider_cache WHERE cache_key = ?')
      .get(cacheKey);
    if (rawRow === undefined) return undefined;

    try {
      const row = CacheRowSchema.parse(rawRow);
      const payload: unknown = JSON.parse(row.payload);
      return {
        value: schema.parse(payload),
        expired: row.expires_at <= Date.now(),
        updatedAt: row.updated_at,
      };
    } catch {
      this.database.prepare('DELETE FROM provider_cache WHERE cache_key = ?').run(cacheKey);
      return undefined;
    }
  }

  public set<T>(cacheKey: string, value: T, ttlMs: number, schema: z.ZodType<T>): void {
    const validated = schema.parse(value);
    const now = Date.now();
    this.database.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO provider_cache (cache_key, payload, expires_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET
            payload = excluded.payload,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
        `)
        .run(cacheKey, JSON.stringify(validated), now + ttlMs, now);
      this.database.prepare(`
        DELETE FROM provider_cache
        WHERE cache_key NOT IN (
          SELECT cache_key FROM provider_cache ORDER BY updated_at DESC LIMIT ?
        )
      `).run(MAX_CACHE_ENTRIES);
    })();
  }
}
