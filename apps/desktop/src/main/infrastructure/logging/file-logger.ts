import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'info' | 'error';

export interface LogEntry {
  level: LogLevel;
  category: string;
  operation: string;
  message: string;
  durationMs?: number;
  errorCode?: string;
}

const MAX_LOG_BYTES = 1_000_000;

export class FileLogger {
  private readonly logPath: string;
  private readonly previousLogPath: string;

  public constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.logPath = join(directory, 'kitsune.log');
    this.previousLogPath = join(directory, 'kitsune.previous.log');
  }

  public write(entry: LogEntry): void {
    if (existsSync(this.logPath) && statSync(this.logPath).size >= MAX_LOG_BYTES) {
      rmSync(this.previousLogPath, { force: true });
      renameSync(this.logPath, this.previousLogPath);
    }

    writeFileSync(
      this.logPath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
      { flag: 'a', encoding: 'utf8' },
    );
  }
}
