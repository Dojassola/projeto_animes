import { describe, expect, it } from 'vitest';
import { AppStatusInputSchema } from '../src/shared/contracts/app';
import { CatalogSearchInputSchema } from '../src/shared/contracts/catalog';
import { ReleaseSearchInputSchema } from '../src/shared/contracts/media';
import { UpdateSettingsInputSchema } from '../src/shared/contracts/settings';

const requestId = '00000000-0000-4000-8000-000000000000';

describe('IPC contracts', () => {
  it('rejects unknown or invalid input', () => {
    expect(AppStatusInputSchema.safeParse({ channel: 'arbitrary' }).success).toBe(false);
    expect(UpdateSettingsInputSchema.safeParse({ theme: 'custom', reduceMotion: false }).success).toBe(false);
    expect(CatalogSearchInputSchema.safeParse({ query: null, genres: [], requestId }).success).toBe(false);
    expect(CatalogSearchInputSchema.safeParse({ query: null, genres: ['Horror', 'Thriller'], requestId }).success).toBe(true);
    expect(CatalogSearchInputSchema.safeParse({ query: 'Another', genres: ['not-a-genre'], requestId }).success).toBe(false);
    expect(ReleaseSearchInputSchema.safeParse({
      animeId: requestId,
      episode: 1,
      provider: 'arbitrary',
      requestId,
    }).success).toBe(false);
  });
});
