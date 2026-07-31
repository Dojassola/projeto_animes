import Database from 'better-sqlite3';
import { migrateDatabase } from './migrations';

export type KitsuneDatabase = InstanceType<typeof Database>;

export function openDatabase(filePath: string): KitsuneDatabase {
  const database = new Database(filePath);
  try {
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    migrateDatabase(database);
    return database;
  } catch (error: unknown) {
    database.close();
    throw error;
  }
}
