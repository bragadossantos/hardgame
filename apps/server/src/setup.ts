import { resolve } from 'node:path';
import { loadEnvFile } from './env.js';
import { createDatabase, applyMigrations } from './db/index.js';
import { seedDatabase } from './db/seed.js';

loadEnvFile();

async function runSetup() {
  const rawDbPath = process.env.DATABASE_PATH ?? './data/hardgame.db';
  const resolvedDbPath = resolve(process.cwd(), '../../', rawDbPath);
  const { sqlite, db } = createDatabase(resolvedDbPath);

  applyMigrations(sqlite);
  await seedDatabase(db);
  sqlite.close();

  console.log(`[Hardgame Setup] Base de dados SQLite criada e migrada em: ${resolvedDbPath}`);
  console.log(
    `[Hardgame Setup] Seed concluído: conta de administrador (${process.env.ADMIN_USERNAME ?? 'admin'}) e catálogo de 10 peças prontos.`
  );
}

runSetup().catch((err) => {
  console.error('[Hardgame Setup] Erro ao configurar a base de dados:', err);
  process.exit(1);
});
