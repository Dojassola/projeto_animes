import { z } from 'zod';
import { AppErrorDtoSchema } from '../errors/app-error';
import { AnimeIdSchema, HttpsUrlSchema, RequestIdSchema } from './catalog';

const failure = z.object({ ok: z.literal(false), error: AppErrorDtoSchema }).strict();
export const LanguageCodeSchema = z.string().regex(/^[a-z]{2}(?:-[a-z]{2})?$/);
export const InfoHashSchema = z.string().regex(/^[a-fA-F0-9]{40}$/);
export const NyaaItemIdSchema = z.string().regex(/^\d{1,12}$/);

export const ParsedReleaseSchema = z.object({
  episode: z.number().int().positive().nullable(),
  episodeEnd: z.number().int().positive().nullable(),
  resolution: z.number().int().positive().nullable(),
  codec: z.enum(['AV1', 'HEVC', 'H264', 'UNKNOWN']),
  source: z.enum(['BLURAY', 'WEB_DL', 'WEB', 'TV', 'DVD', 'UNKNOWN']),
  group: z.string().nullable(),
  batch: z.boolean(),
  dualAudio: z.boolean(),
  subtitleLanguages: z.array(LanguageCodeSchema),
}).strict();

export const ReleaseCandidateSchema = z.object({
  id: NyaaItemIdSchema,
  title: z.string().min(1).max(500),
  detailsUrl: HttpsUrlSchema,
  torrentUrl: HttpsUrlSchema,
  infoHash: InfoHashSchema,
  publishedAt: z.iso.datetime(),
  sizeBytes: z.number().int().nonnegative(),
  seeders: z.number().int().nonnegative(),
  leechers: z.number().int().nonnegative(),
  trusted: z.boolean(),
  remake: z.boolean(),
  parsed: ParsedReleaseSchema,
  score: z.object({
    total: z.number().int(),
    reasons: z.array(z.string().min(1).max(120)).max(12),
  }).strict(),
}).strict();
export const ReleaseCandidateArraySchema = z.array(ReleaseCandidateSchema).max(100);
export const ReleaseSearchInputSchema = z.object({
  animeId: AnimeIdSchema,
  episode: z.number().int().positive().nullable(),
  requestId: RequestIdSchema,
}).strict();
export const ReleaseSearchResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: ReleaseCandidateArraySchema, stale: z.boolean() }).strict(),
  failure,
]);
export const ReleaseDownloadInputSchema = z.object({ releaseId: NyaaItemIdSchema }).strict();
export const ReleaseDownloadResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    data: z.object({ filePath: z.string().min(1) }).strict(),
  }).strict(),
  failure,
]);
export const MediaCancelInputSchema = z.object({ requestId: RequestIdSchema }).strict();

export const IntegrationSettingsSchema = z.object({
  torrentDownloadPath: z.string().min(1).max(1_024),
  openSubtitles: z.object({
    hasApiKey: z.boolean(),
    username: z.string().max(100),
    hasPassword: z.boolean(),
  }).strict(),
  subtitleLanguages: z.array(LanguageCodeSchema).min(1).max(8),
}).strict();
export const UpdateIntegrationSettingsInputSchema = z.object({
  openSubtitles: z.object({
    apiKey: z.string().max(500).optional(),
    username: z.string().max(100),
    password: z.string().max(500).optional(),
  }).strict(),
  subtitleLanguages: z.array(LanguageCodeSchema).min(1).max(8),
}).strict();
export const IntegrationSettingsResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: IntegrationSettingsSchema }).strict(),
  failure,
]);
export const ChooseDownloadPathResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: IntegrationSettingsSchema }).strict(),
  failure,
]);
export const TorrentDownloadStateSchema = z.enum([
  'queued', 'downloading', 'paused', 'completed', 'failed',
]);
export const TorrentFileSummarySchema = z.object({
  name: z.string().min(1).max(1_024),
  sizeBytes: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1),
  playable: z.boolean(),
}).strict();
export const TorrentDownloadSchema = z.object({
  releaseId: NyaaItemIdSchema,
  infoHash: InfoHashSchema,
  name: z.string().min(1).max(1_024),
  status: TorrentDownloadStateSchema,
  progress: z.number().min(0).max(1),
  downloadSpeed: z.number().nonnegative(),
  downloadedBytes: z.number().nonnegative(),
  sizeBytes: z.number().nonnegative(),
  peers: z.number().int().nonnegative(),
  timeRemainingMs: z.number().nonnegative().nullable(),
  files: z.array(TorrentFileSummarySchema).max(500),
  error: z.string().max(500).nullable(),
}).strict();
export const TorrentStartInputSchema = z.object({ releaseId: NyaaItemIdSchema }).strict();
export const TorrentStartResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: TorrentDownloadSchema }).strict(),
  failure,
]);
export const TorrentStatusResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.array(TorrentDownloadSchema).max(500) }).strict(),
  failure,
]);
export const TorrentControlInputSchema = z.object({
  infoHash: InfoHashSchema,
  action: z.enum(['pause', 'resume', 'remove']),
  deleteFiles: z.boolean(),
}).strict();
export const OperationResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  failure,
]);

export const SubtitleSearchInputSchema = z.object({
  animeId: AnimeIdSchema,
  episode: z.number().int().positive().nullable(),
  requestId: RequestIdSchema,
}).strict();
export const SubtitleCandidateSchema = z.object({
  id: z.string().min(1).max(100),
  fileId: z.number().int().positive(),
  language: LanguageCodeSchema,
  release: z.string().min(1).max(500),
  downloadCount: z.number().int().nonnegative(),
  hearingImpaired: z.boolean(),
  trusted: z.boolean(),
  score: z.number().int(),
}).strict();
export const SubtitleCandidateArraySchema = z.array(SubtitleCandidateSchema).max(100);
export const SubtitleSearchResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: SubtitleCandidateArraySchema }).strict(),
  failure,
]);
export const SubtitleDownloadInputSchema = z.object({
  animeId: AnimeIdSchema,
  episode: z.number().int().positive().nullable(),
  fileId: z.number().int().positive(),
}).strict();
export const SubtitleDownloadResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), fileName: z.string().min(1), directory: z.string().min(1) }).strict(),
  failure,
]);

export type ReleaseSearchInput = z.infer<typeof ReleaseSearchInputSchema>;
export type ReleaseSearchResult = z.infer<typeof ReleaseSearchResultSchema>;
export type ReleaseDownloadInput = z.infer<typeof ReleaseDownloadInputSchema>;
export type ReleaseDownloadResult = z.infer<typeof ReleaseDownloadResultSchema>;
export type MediaCancelInput = z.infer<typeof MediaCancelInputSchema>;
export type ReleaseCandidate = z.infer<typeof ReleaseCandidateSchema>;
export type IntegrationSettings = z.infer<typeof IntegrationSettingsSchema>;
export type UpdateIntegrationSettingsInput = z.infer<typeof UpdateIntegrationSettingsInputSchema>;
export type IntegrationSettingsResult = z.infer<typeof IntegrationSettingsResultSchema>;
export type ChooseDownloadPathResult = z.infer<typeof ChooseDownloadPathResultSchema>;
export type TorrentDownloadState = z.infer<typeof TorrentDownloadStateSchema>;
export type TorrentDownload = z.infer<typeof TorrentDownloadSchema>;
export type TorrentStartInput = z.infer<typeof TorrentStartInputSchema>;
export type TorrentStartResult = z.infer<typeof TorrentStartResultSchema>;
export type TorrentStatusResult = z.infer<typeof TorrentStatusResultSchema>;
export type TorrentControlInput = z.infer<typeof TorrentControlInputSchema>;
export type OperationResult = z.infer<typeof OperationResultSchema>;
export type SubtitleSearchInput = z.infer<typeof SubtitleSearchInputSchema>;
export type SubtitleSearchResult = z.infer<typeof SubtitleSearchResultSchema>;
export type SubtitleDownloadInput = z.infer<typeof SubtitleDownloadInputSchema>;
export type SubtitleDownloadResult = z.infer<typeof SubtitleDownloadResultSchema>;
