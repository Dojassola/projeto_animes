import { z } from 'zod';
import type { Settings } from '../../shared/contracts/settings';
import type { KitsuneDatabase } from '../infrastructure/database/open-database';

const SettingsRowSchema = z
  .object({
    theme: z.enum(['dark', 'oled', 'light']),
    reduce_motion: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();

export class SettingsRepository {
  public constructor(private readonly database: KitsuneDatabase) {}

  public get(): Settings {
    const row = SettingsRowSchema.parse(
      this.database.prepare('SELECT theme, reduce_motion FROM settings WHERE id = 1').get(),
    );
    return { theme: row.theme, reduceMotion: row.reduce_motion === 1 };
  }

  public update(settings: Settings): Settings {
    this.database
      .prepare('UPDATE settings SET theme = ?, reduce_motion = ? WHERE id = 1')
      .run(settings.theme, settings.reduceMotion ? 1 : 0);
    return this.get();
  }
}

