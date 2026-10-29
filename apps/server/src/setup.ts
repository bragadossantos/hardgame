import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from './env.js';

loadEnvFile();

const dbPath = resolve(process.cwd(), '../../', process.env.DATABASE_PATH ?? './data/hardgame.db');
const dbDir = dirname(dbPath);

if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

console.log(`[Hardgame Setup] Directório de dados preparado em: ${dbDir}`);
console.log('[Hardgame Setup] Fase 0 concluída (migrações e seed completos entram na Fase 1).');

