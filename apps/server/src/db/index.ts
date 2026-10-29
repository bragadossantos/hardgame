import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type AppDb = BetterSQLite3Database<typeof schema>;

export function createDatabase(dbPathInput?: string): {
  sqlite: Database.Database;
  db: AppDb;
} {
  const rawPath = dbPathInput ?? process.env.DATABASE_PATH ?? './data/hardgame.db';
  const isMemory = rawPath === ':memory:';
  const resolvedPath = isMemory ? ':memory:' : resolve(process.cwd(), rawPath);

  if (!isMemory) {
    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const sqlite = new Database(resolvedPath);
  if (!isMemory) {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export function applyMigrations(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      institution TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      current_stage INTEGER NOT NULL DEFAULT 1,
      stage_started_at INTEGER,
      stage_ends_at INTEGER,
      paused_remaining_ms INTEGER,
      config TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS round_players (
      round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      allowed INTEGER NOT NULL DEFAULT 1,
      joined_at INTEGER,
      connected INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (round_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      name_pt TEXT NOT NULL,
      aliases TEXT NOT NULL,
      description_pt TEXT NOT NULL,
      model_path TEXT,
      category TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS motherboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      manufacturer TEXT NOT NULL,
      model_name TEXT NOT NULL,
      form_factor TEXT NOT NULL,
      socket TEXT NOT NULL,
      chipset TEXT NOT NULL,
      model_path TEXT,
      image_path TEXT,
      aliases TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stage INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      correct INTEGER NOT NULL,
      points INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS events_round_user_idx ON events (round_id, user_id);

    CREATE TABLE IF NOT EXISTS scores (
      round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stage1 INTEGER NOT NULL DEFAULT 0,
      stage2 INTEGER NOT NULL DEFAULT 0,
      stage3 INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      time_spent_ms INTEGER NOT NULL DEFAULT 0,
      first_try_hits INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (round_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      admin_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      reason TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

