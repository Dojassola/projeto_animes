import { z } from 'zod';
import {
  IntegrationSettingsSchema,
  UpdateIntegrationSettingsInputSchema,
  type IntegrationSettings,
  type UpdateIntegrationSettingsInput,
} from '../../shared/contracts/media';
import { ApplicationError } from '../domain/errors/application-error';
import type { KitsuneDatabase } from '../infrastructure/database/open-database';

const SecretSchema = z.custom<Buffer>((value) => Buffer.isBuffer(value)).nullable();
const RowSchema = z.object({
  opensubtitles_api_key: SecretSchema,
  opensubtitles_username: z.string(),
  opensubtitles_password: SecretSchema,
  subtitle_languages_json: z.string(),
  download_path: z.string().nullable(),
}).strict();

export interface IntegrationSecrets {
  openSubtitlesApiKey: string | null;
  openSubtitlesPassword: string | null;
}

export class IntegrationSettingsRepository {
  public constructor(
    private readonly database: KitsuneDatabase,
    private readonly defaultDownloadPath: string,
    private readonly encrypt: (value: string) => Buffer,
    private readonly decrypt: (value: Buffer) => string,
  ) {}

  private row(): z.infer<typeof RowSchema> {
    return RowSchema.parse(this.database.prepare(`
      SELECT
        opensubtitles_api_key, opensubtitles_username, opensubtitles_password,
        subtitle_languages_json, download_path
      FROM integration_settings
      WHERE id = 1
    `).get());
  }

  public get(): IntegrationSettings {
    const row = this.row();
    const languages: unknown = JSON.parse(row.subtitle_languages_json);
    return IntegrationSettingsSchema.parse({
      torrentDownloadPath: row.download_path ?? this.defaultDownloadPath,
      openSubtitles: {
        hasApiKey: row.opensubtitles_api_key !== null,
        username: row.opensubtitles_username,
        hasPassword: row.opensubtitles_password !== null,
      },
      subtitleLanguages: languages,
    });
  }

  public secrets(): IntegrationSecrets {
    const row = this.row();
    try {
      return {
        openSubtitlesApiKey: row.opensubtitles_api_key === null ? null : this.decrypt(row.opensubtitles_api_key),
        openSubtitlesPassword: row.opensubtitles_password === null ? null : this.decrypt(row.opensubtitles_password),
      };
    } catch (cause: unknown) {
      throw new ApplicationError('CREDENTIAL_DECRYPTION_FAILED', 'Não foi possível ler as credenciais salvas.', false, { cause });
    }
  }

  public update(rawInput: UpdateIntegrationSettingsInput): IntegrationSettings {
    const input = UpdateIntegrationSettingsInputSchema.parse(rawInput);
    const current = this.row();
    const secret = (value: string | undefined, previous: Buffer | null): Buffer | null => {
      if (value === undefined) return previous;
      return value.length === 0 ? null : this.encrypt(value);
    };
    this.database.prepare(`
      UPDATE integration_settings SET
        opensubtitles_api_key = ?, opensubtitles_username = ?, opensubtitles_password = ?,
        subtitle_languages_json = ?, download_path = ?
      WHERE id = 1
    `).run(
      secret(input.openSubtitles.apiKey, current.opensubtitles_api_key),
      input.openSubtitles.username,
      secret(input.openSubtitles.password, current.opensubtitles_password),
      JSON.stringify(input.subtitleLanguages),
      current.download_path,
    );
    return this.get();
  }

  public setDownloadPath(downloadPath: string): IntegrationSettings {
    this.database.prepare('UPDATE integration_settings SET download_path = ? WHERE id = 1').run(downloadPath);
    return this.get();
  }
}
