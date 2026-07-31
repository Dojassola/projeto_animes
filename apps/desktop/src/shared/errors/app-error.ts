import { z } from 'zod';

export const AppErrorDtoSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    recoverable: z.boolean(),
  })
  .strict();

export type AppErrorDto = z.infer<typeof AppErrorDtoSchema>;

