import { z } from 'zod';
import {
  AnimeFormatSchema,
  AnimeRelationTypeSchema,
  AnimeSeasonSchema,
  AnimeStatusSchema,
  AnimeTitleSchema,
  HttpsUrlSchema,
} from '../../shared/contracts/catalog';

export const ExternalAnimeSummarySchema = z
  .object({
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

export const ExternalAnimeDetailsSchema = ExternalAnimeSummarySchema.extend({
  malId: z.number().int().positive().nullable(),
  description: z.string().nullable(),
  bannerImage: HttpsUrlSchema.nullable(),
  genres: z.array(z.string().min(1)).max(30),
  durationMinutes: z.number().int().positive().nullable(),
  relations: z.array(
    z
      .object({
        type: AnimeRelationTypeSchema,
        anime: ExternalAnimeSummarySchema,
      })
      .strict(),
  ),
}).strict();

export const ExternalAnimeSummaryArraySchema = z.array(ExternalAnimeSummarySchema).max(50);

export type ExternalAnimeSummary = z.infer<typeof ExternalAnimeSummarySchema>;
export type ExternalAnimeDetails = z.infer<typeof ExternalAnimeDetailsSchema>;

export interface CatalogProvider {
  readonly id: string;
  search(query: string, signal: AbortSignal): Promise<ExternalAnimeSummary[]>;
  home(signal: AbortSignal): Promise<ExternalAnimeSummary[]>;
  getDetails(anilistId: number, signal: AbortSignal): Promise<ExternalAnimeDetails>;
}

