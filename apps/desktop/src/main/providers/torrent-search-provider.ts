import { z } from 'zod';
import { HttpsUrlSchema } from '../../shared/contracts/catalog';
import {
  InfoHashSchema,
  TorrentSourceUrlSchema,
  type TorrentProviderIdSchema,
} from '../../shared/contracts/media';

export const TorrentProviderItemSchema = z.object({
  sourceId: z.string().regex(/^(?:\d{1,12}|[a-f\d]{40})$/i),
  title: z.string().min(1).max(500),
  detailsUrl: HttpsUrlSchema,
  torrentUrl: TorrentSourceUrlSchema,
  infoHash: InfoHashSchema,
  publishedAt: z.iso.datetime(),
  sizeBytes: z.number().int().nonnegative(),
  seeders: z.number().int().nonnegative().nullable(),
  leechers: z.number().int().nonnegative().nullable(),
  trusted: z.boolean(),
  remake: z.boolean(),
}).strict();

export type TorrentProviderItem = z.infer<typeof TorrentProviderItemSchema>;
export type TorrentProviderId = z.infer<typeof TorrentProviderIdSchema>;

export interface TorrentSearchProvider {
  readonly id: TorrentProviderId;
  readonly name: string;
  readonly exhaustiveSearch?: boolean;
  search(query: string, signal: AbortSignal): Promise<TorrentProviderItem[]>;
  resolveTorrentUrl(sourceId: string, signal: AbortSignal): Promise<URL>;
}
