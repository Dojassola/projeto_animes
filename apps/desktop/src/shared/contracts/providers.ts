import { z } from 'zod';

export const AnimeSearchInputSchema = z
  .object({
    query: z.string().trim().min(2).max(100),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export const AnimeSearchResultSchema = z
  .object({
    providerId: z.string().min(1),
    providerAnimeId: z.string().min(1),
    title: z.string().min(1),
    coverImage: z.url().nullable(),
    episodes: z.number().int().positive().nullable(),
  })
  .strict();

export type AnimeSearchInput = z.infer<typeof AnimeSearchInputSchema>;
export type AnimeSearchResult = z.infer<typeof AnimeSearchResultSchema>;

export interface AnimeMetadataProvider {
  readonly id: string;
  search(input: AnimeSearchInput, signal: AbortSignal): Promise<AnimeSearchResult[]>;
}

