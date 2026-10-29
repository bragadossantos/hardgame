import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { INITIAL_PARTS_CATALOG } from '@hardgame/shared';
import type { AppDb } from './index.js';
import { users, parts, motherboards } from './schema.js';

export interface SeedOptions {
  adminUsername?: string;
  adminPassword?: string;
  bcryptCost?: number;
}

export async function seedDatabase(db: AppDb, options: SeedOptions = {}): Promise<void> {
  const adminUsername = (options.adminUsername ?? process.env.ADMIN_USERNAME ?? 'admin').trim();
  const adminPassword = options.adminPassword ?? process.env.ADMIN_PASSWORD ?? 'admin123';
  const bcryptCost = options.bcryptCost ?? 10;

  // 1. Seed Admin User
  const existingAdmin = db
    .select()
    .from(users)
    .where(eq(users.username, adminUsername))
    .get();

  const passwordHash = await bcrypt.hash(adminPassword, bcryptCost);

  if (!existingAdmin) {
    db.insert(users)
      .values({
        username: adminUsername,
        displayName: 'Administrador do Torneio',
        passwordHash,
        role: 'admin',
        institution: 'Organização Hardgame',
        createdAt: Date.now(),
      })
      .run();
  } else {
    db.update(users)
      .set({
        passwordHash,
        role: 'admin',
      })
      .where(eq(users.id, existingAdmin.id))
      .run();
  }

  // 2. Seed Catálogo Inicial de Peças (contexto.md §7)
  for (const item of INITIAL_PARTS_CATALOG) {
    const existingPart = db
      .select()
      .from(parts)
      .where(eq(parts.slug, item.slug))
      .get();

    if (!existingPart) {
      db.insert(parts)
        .values({
          slug: item.slug,
          namePt: item.namePt,
          aliases: item.aliases,
          descriptionPt: item.descriptionPt,
          modelPath: item.modelPath,
          category: item.category,
        })
        .run();
    } else {
      db.update(parts)
        .set({
          namePt: item.namePt,
          aliases: item.aliases,
          descriptionPt: item.descriptionPt,
          category: item.category,
        })
        .where(eq(parts.id, existingPart.id))
        .run();
    }
  }

  // 3. Seed Placas-mãe de exemplo para a Etapa 3
  const existingMoboCount = db.select().from(motherboards).all().length;
  if (existingMoboCount === 0) {
    db.insert(motherboards)
      .values([
        {
          manufacturer: 'ASUS',
          modelName: 'TUF Gaming B550-PLUS',
          formFactor: 'ATX',
          socket: 'AM4',
          chipset: 'B550',
          modelPath: null,
          imagePath: null,
          aliases: {
            manufacturer: ['Asus', 'ASUSTeK'],
            formFactor: ['ATX', 'Standard ATX'],
            socket: ['AM4', 'Socket AM4', 'PGA 1331'],
            chipset: ['B550', 'AMD B550'],
            modelName: ['TUF B550-PLUS', 'ASUS TUF Gaming B550-PLUS'],
          },
        },
        {
          manufacturer: 'MSI',
          modelName: 'MAG B650M Mortar WiFi',
          formFactor: 'Micro-ATX',
          socket: 'AM5',
          chipset: 'B650',
          modelPath: null,
          imagePath: null,
          aliases: {
            manufacturer: ['MSI', 'Micro-Star'],
            formFactor: ['Micro-ATX', 'mATX', 'uATX', 'Micro ATX'],
            socket: ['AM5', 'Socket AM5', 'LGA 1718'],
            chipset: ['B650', 'AMD B650'],
            modelName: ['B650M Mortar', 'MSI MAG B650M Mortar'],
          },
        },
        {
          manufacturer: 'Gigabyte',
          modelName: 'Z790 AORUS Elite AX',
          formFactor: 'ATX',
          socket: 'LGA1700',
          chipset: 'Z790',
          modelPath: null,
          imagePath: null,
          aliases: {
            manufacturer: ['Gigabyte', 'AORUS'],
            formFactor: ['ATX'],
            socket: ['LGA1700', 'LGA 1700', 'Socket 1700'],
            chipset: ['Z790', 'Intel Z790'],
            modelName: ['Z790 Aorus Elite', 'Gigabyte Z790 AORUS Elite AX'],
          },
        },
      ])
      .run();
  }
}

