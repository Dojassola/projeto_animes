import { z } from 'zod';
import { AppErrorDtoSchema } from '../errors/app-error';

export const SettingsSchema = z
  .object({
    theme: z.enum(['dark', 'oled', 'light']),
    reduceMotion: z.boolean(),
  })
  .strict();

export const GetSettingsInputSchema = z.object({}).strict();
export const UpdateSettingsInputSchema = SettingsSchema;

export const SettingsResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: SettingsSchema }).strict(),
  z.object({ ok: z.literal(false), error: AppErrorDtoSchema }).strict(),
]);

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsResult = z.infer<typeof SettingsResultSchema>;

