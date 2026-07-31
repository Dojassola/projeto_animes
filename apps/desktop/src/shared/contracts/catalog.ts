import { z } from 'zod';
import { AppErrorDtoSchema } from '../errors/app-error';

export const AnimeIdSchema = z.uuid();
export const RequestIdSchema = z.uuid();
export const HttpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'A URL deve usar HTTPS');

export const AnimeFormatSchema = z
  .enum(['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'])
  .nullable();
export const AnimeStatusSchema = z
  .enum(['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'])
  .nullable();
export const AnimeSeasonSchema = z.enum(['WINTER', 'SPRING', 'SUMMER', 'FALL']).nullable();
export const AnimeRelationTypeSchema = z.enum([
  'ADAPTATION',
  'PREQUEL',
  'SEQUEL',
  'PARENT',
  'SIDE_STORY',
  'CHARACTER',
  'SUMMARY',
  'ALTERNATIVE',
  'SPIN_OFF',
  'OTHER',
  'SOURCE',
  'COMPILATION',
  'CONTAINS',
]);

export const AnimeTitleSchema = z
  .object({
    romaji: z.string().min(1),
    english: z.string().min(1).nullable(),
    native: z.string().min(1).nullable(),
  })
  .strict();

export const AnimeSummarySchema = z
  .object({
    id: AnimeIdSchema,
    anilistId: z.number().int().positive(),
    title: AnimeTitleSchema,
    coverImage: HttpsUrlSchema.nullable(),
    coverColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
    format: AnimeFormatSchema,
    status: AnimeStatusSchema,
    season: AnimeSeasonSchema,
    seasonYear: z.number().int().min(1900).max(2200).nullable(),
    episodeCount: z.number().int().positive().nullable(),
    averageScore: z.number().int().min(0).max(100).nullable(),
  })
  .strict();

export const EpisodeSchema = z
  .object({
    id: z.string().min(1),
    number: z.number().int().positive(),
    title: z.string().min(1).nullable(),
    titleJapanese: z.string().min(1).nullable(),
    titleRomanji: z.string().min(1).nullable(),
    synopsis: z.string().min(1).nullable(),
    airedAt: z.iso.datetime({ offset: true }).nullable(),
    durationSeconds: z.number().int().positive().nullable(),
    filler: z.boolean().nullable(),
    recap: z.boolean().nullable(),
  })
  .strict();

export const AnimeRelationSchema = z
  .object({
    type: AnimeRelationTypeSchema,
    anime: AnimeSummarySchema,
  })
  .strict();

export const WatchStatusSchema = z.enum([
  'planning',
  'watching',
  'completed',
  'paused',
  'dropped',
]);

export const AnimeDetailsSchema = AnimeSummarySchema.extend({
  malId: z.number().int().positive().nullable(),
  description: z.string().nullable(),
  bannerImage: HttpsUrlSchema.nullable(),
  genres: z.array(z.string().min(1)).max(30),
  durationMinutes: z.number().int().positive().nullable(),
  episodes: z.array(EpisodeSchema),
  relations: z.array(AnimeRelationSchema).max(100),
  watchStatus: WatchStatusSchema.nullable(),
}).strict();

export const CatalogCollectionSchema = z
  .object({
    items: z.array(AnimeSummarySchema).max(50),
    stale: z.boolean(),
  })
  .strict();

export const CatalogDetailsPayloadSchema = z
  .object({ anime: AnimeDetailsSchema, stale: z.boolean() })
  .strict();

export const CatalogSearchInputSchema = z
  .object({
    query: z.string().trim().min(2).max(100),
    requestId: RequestIdSchema,
  })
  .strict();
export const CatalogHomeInputSchema = z.object({ requestId: RequestIdSchema }).strict();
export const CatalogDetailsInputSchema = z
  .object({ animeId: AnimeIdSchema, requestId: RequestIdSchema })
  .strict();
export const EpisodeDetailsInputSchema = z
  .object({
    animeId: AnimeIdSchema,
    episodeNumber: z.number().int().positive(),
    requestId: RequestIdSchema,
  })
  .strict();
export const CatalogCancelInputSchema = z.object({ requestId: RequestIdSchema }).strict();

const FailureResultSchema = z.object({ ok: z.literal(false), error: AppErrorDtoSchema }).strict();
export const CatalogCollectionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: CatalogCollectionSchema }).strict(),
  FailureResultSchema,
]);
export const CatalogDetailsResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: CatalogDetailsPayloadSchema }).strict(),
  FailureResultSchema,
]);
export const EpisodeDetailsPayloadSchema = z
  .object({ episode: EpisodeSchema, stale: z.boolean() })
  .strict();
export const EpisodeDetailsResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: EpisodeDetailsPayloadSchema }).strict(),
  FailureResultSchema,
]);
export const CatalogCancelResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.object({ cancelled: z.boolean() }).strict() }).strict(),
  FailureResultSchema,
]);

export const WatchlistItemSchema = z
  .object({ anime: AnimeSummarySchema, status: WatchStatusSchema })
  .strict();
export const WatchlistGetInputSchema = z.object({}).strict();
export const WatchlistSetInputSchema = z
  .object({ animeId: AnimeIdSchema, status: WatchStatusSchema.nullable() })
  .strict();
export const WatchlistResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.array(WatchlistItemSchema) }).strict(),
  FailureResultSchema,
]);
export const WatchlistSetResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: WatchlistItemSchema.nullable() }).strict(),
  FailureResultSchema,
]);

export type AnimeSummary = z.infer<typeof AnimeSummarySchema>;
export type AnimeDetails = z.infer<typeof AnimeDetailsSchema>;
export type Episode = z.infer<typeof EpisodeSchema>;
export type CatalogCollection = z.infer<typeof CatalogCollectionSchema>;
export type CatalogDetailsPayload = z.infer<typeof CatalogDetailsPayloadSchema>;
export type CatalogSearchInput = z.infer<typeof CatalogSearchInputSchema>;
export type CatalogHomeInput = z.infer<typeof CatalogHomeInputSchema>;
export type CatalogDetailsInput = z.infer<typeof CatalogDetailsInputSchema>;
export type EpisodeDetailsInput = z.infer<typeof EpisodeDetailsInputSchema>;
export type CatalogCancelInput = z.infer<typeof CatalogCancelInputSchema>;
export type CatalogCollectionResult = z.infer<typeof CatalogCollectionResultSchema>;
export type CatalogDetailsResult = z.infer<typeof CatalogDetailsResultSchema>;
export type EpisodeDetailsPayload = z.infer<typeof EpisodeDetailsPayloadSchema>;
export type EpisodeDetailsResult = z.infer<typeof EpisodeDetailsResultSchema>;
export type CatalogCancelResult = z.infer<typeof CatalogCancelResultSchema>;
export type WatchStatus = z.infer<typeof WatchStatusSchema>;
export type WatchlistItem = z.infer<typeof WatchlistItemSchema>;
export type WatchlistSetInput = z.infer<typeof WatchlistSetInputSchema>;
export type WatchlistResult = z.infer<typeof WatchlistResultSchema>;
export type WatchlistSetResult = z.infer<typeof WatchlistSetResultSchema>;
