import { z } from 'zod';
import { AppErrorDtoSchema } from '../errors/app-error';

export const AppStatusInputSchema = z.object({}).strict();

export const AppStatusSchema = z
  .object({
    version: z.string().min(1),
    electronVersion: z.string().min(1),
    nodeVersion: z.string().min(1),
    platform: z.enum(['windows', 'linux', 'macos', 'unsupported']),
    databaseReady: z.literal(true),
  })
  .strict();

export const AppStatusResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: AppStatusSchema }).strict(),
  z.object({ ok: z.literal(false), error: AppErrorDtoSchema }).strict(),
]);

export type AppStatus = z.infer<typeof AppStatusSchema>;
export type AppStatusResult = z.infer<typeof AppStatusResultSchema>;

