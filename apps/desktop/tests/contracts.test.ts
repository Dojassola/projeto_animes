import { describe, expect, it } from 'vitest';
import { AppStatusInputSchema } from '../src/shared/contracts/app';
import { UpdateSettingsInputSchema } from '../src/shared/contracts/settings';

describe('IPC contracts', () => {
  it('rejects unknown or invalid input', () => {
    expect(AppStatusInputSchema.safeParse({ channel: 'arbitrary' }).success).toBe(false);
    expect(UpdateSettingsInputSchema.safeParse({ theme: 'custom', reduceMotion: false }).success).toBe(false);
  });
});

