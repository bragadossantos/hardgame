import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
import type { RoundConfig, RoundStatus, UserRole } from '@hardgame/shared';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<UserRole>().notNull().default('player'),
  institution: text('institution'),
  createdAt: integer('created_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const rounds = sqliteTable('rounds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  status: text('status').$type<RoundStatus>().notNull().default('draft'),
  currentStage: integer('current_stage').notNull().default(1),
  stageStartedAt: integer('stage_started_at', { mode: 'number' }),
  stageEndsAt: integer('stage_ends_at', { mode: 'number' }),
  pausedRemainingMs: integer('paused_remaining_ms', { mode: 'number' }),
  config: text('config', { mode: 'json' }).$type<RoundConfig>().notNull(),
  createdAt: integer('created_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const roundPlayers = sqliteTable(
  'round_players',
  {
    roundId: integer('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    allowed: integer('allowed', { mode: 'boolean' }).notNull().default(true),
    joinedAt: integer('joined_at', { mode: 'number' }),
    connected: integer('connected', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.roundId, table.userId] })]
);

export const parts = sqliteTable('parts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  namePt: text('name_pt').notNull(),
  aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull(),
  descriptionPt: text('description_pt').notNull(),
  modelPath: text('model_path'),
  category: text('category').notNull(),
});

export interface MotherboardAliases {
  manufacturer?: string[];
  formFactor?: string[];
  socket?: string[];
  chipset?: string[];
  modelName?: string[];
}

export const motherboards = sqliteTable('motherboards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  manufacturer: text('manufacturer').notNull(),
  modelName: text('model_name').notNull(),
  formFactor: text('form_factor').notNull(),
  socket: text('socket').notNull(),
  chipset: text('chipset').notNull(),
  modelPath: text('model_path'),
  imagePath: text('image_path'),
  aliases: text('aliases', { mode: 'json' }).$type<MotherboardAliases>().notNull(),
});

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roundId: integer('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stage: integer('stage').notNull(),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    correct: integer('correct', { mode: 'boolean' }).notNull(),
    points: integer('points').notNull(),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index('events_round_user_idx').on(table.roundId, table.userId)]
);

export const scores = sqliteTable(
  'scores',
  {
    roundId: integer('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stage1: integer('stage1').notNull().default(0),
    stage2: integer('stage2').notNull().default(0),
    stage3: integer('stage3').notNull().default(0),
    total: integer('total').notNull().default(0),
    timeSpentMs: integer('time_spent_ms').notNull().default(0),
    firstTryHits: integer('first_try_hits').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [primaryKey({ columns: [table.roundId, table.userId] })]
);

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  adminId: integer('admin_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  target: text('target').notNull(),
  reason: text('reason').notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer('created_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now()),
});

