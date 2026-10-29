import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import bcrypt from 'bcryptjs';
import { and, desc, eq } from 'drizzle-orm';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  APP_NAME,
  AdminPlayerAllowSchema,
  AdminPlayerKickSchema,
  AdminRoundActionSchema,
  AdminScoreAdjustSchema,
  CreatePlayerSchema,
  CreateRoundSchema,
  DEFAULT_ROUND_CONFIG,
  ImportPlayersBulkSchema,
  LoginRequestSchema,
  PingPayloadSchema,
  PlayerJoinPayloadSchema,
  PongPayloadSchema,
  RoundConfigSchema,
  UpdatePlayerSchema,
  UpdateRoundSchema,
  type AuthUser,
  type RoundConfig,
  type RoundPlayerEntry,
  type RoundSnapshot,
} from '@hardgame/shared';
import { loadEnvFile } from './env.js';
import { createDatabase, applyMigrations } from './db/index.js';
import { seedDatabase } from './db/seed.js';
import {
  users,
  parts,
  motherboards,
  rounds,
  roundPlayers,
  scores,
  events,
  auditLog,
} from './db/schema.js';
import { signUserToken, verifyUserToken, requireAuth, requireRole } from './auth.js';

loadEnvFile();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DISPLAY_KEY = process.env.DISPLAY_KEY ?? 'telao2026';

export interface ServerOptions {
  dbPath?: string;
  displayKey?: string;
  bcryptCost?: number;
}

function getStageDurationMs(config: RoundConfig, stage: number): number {
  if (stage === 1) return config.stage1DurationSec * 1000;
  if (stage === 2) return config.stage2DurationSec * 1000;
  return config.stage3DurationSec * 1000;
}

export function createAppServer(options: ServerOptions = {}) {
  const displayKey = options.displayKey ?? process.env.DISPLAY_KEY ?? 'telao2026';
  const bcryptCost = options.bcryptCost ?? 10;
  const rawDbPath =
    options.dbPath ??
    (process.env.DATABASE_PATH
      ? resolve(__dirname, '../../../', process.env.DATABASE_PATH)
      : resolve(__dirname, '../../../data/hardgame.db'));

  const { sqlite, db } = createDatabase(rawDbPath);
  applyMigrations(sqlite);

  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Mapa de sessões activas por jogador: userId -> socket
  const activePlayerSockets = new Map<number, Socket>();
  // Mapa de temporizadores de fecho de etapa por ronda: roundId -> NodeJS.Timeout
  const roundTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function clearRoundTimer(roundId: number) {
    const existing = roundTimers.get(roundId);
    if (existing) {
      clearTimeout(existing);
      roundTimers.delete(roundId);
    }
  }

  function buildRoundSnapshot(roundId: number): RoundSnapshot | null {
    const roundRow = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
    if (!roundRow) return null;

    const rpRows = db
      .select()
      .from(roundPlayers)
      .where(eq(roundPlayers.roundId, roundId))
      .all();

    const allPlayers = db
      .select()
      .from(users)
      .where(eq(users.role, 'player'))
      .all();

    const scoreRows = db
      .select()
      .from(scores)
      .where(eq(scores.roundId, roundId))
      .all();

    const rpMap = new Map(rpRows.map((r) => [r.userId, r]));
    const scoreMap = new Map(scoreRows.map((s) => [s.userId, s]));

    const entries: RoundPlayerEntry[] = allPlayers.map((u) => {
      const rp = rpMap.get(u.id);
      const sc = scoreMap.get(u.id);
      return {
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        institution: u.institution,
        allowed: rp ? rp.allowed : false,
        connected: rp ? rp.connected : false,
        joinedAt: rp?.joinedAt ?? null,
        stage1: sc?.stage1 ?? 0,
        stage2: sc?.stage2 ?? 0,
        stage3: sc?.stage3 ?? 0,
        total: sc?.total ?? 0,
        timeSpentMs: sc?.timeSpentMs ?? 0,
        firstTryHits: sc?.firstTryHits ?? 0,
      };
    });

    // Ordenar por ranking: maior pontuação total -> menor tempo gasto -> mais acertos à 1.ª tentativa
    entries.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (a.timeSpentMs !== b.timeSpentMs) return a.timeSpentMs - b.timeSpentMs;
      return b.firstTryHits - a.firstTryHits;
    });

    return {
      id: roundRow.id,
      name: roundRow.name,
      status: roundRow.status,
      currentStage: roundRow.currentStage,
      stageStartedAt: roundRow.stageStartedAt,
      stageEndsAt: roundRow.stageEndsAt,
      pausedRemainingMs: roundRow.pausedRemainingMs,
      serverNow: Date.now(),
      config: roundRow.config,
      players: entries,
    };
  }

  function broadcastRoundState(roundId: number) {
    const snapshot = buildRoundSnapshot(roundId);
    if (!snapshot) return;
    io.to(`round:${roundId}`).emit('round:state', snapshot);
    io.to('admin:global').emit('round:state', snapshot);
    io.to(`round:${roundId}:display`).emit('display:snapshot', snapshot);
  }

  function scheduleStageTimeout(roundId: number, remainingMs: number) {
    clearRoundTimer(roundId);
    const timeout = setTimeout(() => {
      const r = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
      if (!r || r.status !== 'running') return;

      if (r.currentStage < 3) {
        const nextStage = r.currentStage + 1;
        const now = Date.now();
        const duration = getStageDurationMs(r.config, nextStage);
        const endsAt = now + duration;
        db.update(rounds)
          .set({
            currentStage: nextStage,
            stageStartedAt: now,
            stageEndsAt: endsAt,
            pausedRemainingMs: null,
          })
          .where(eq(rounds.id, roundId))
          .run();

        io.to(`round:${roundId}`).emit('stage:started', {
          stage: nextStage,
          endsAt,
          serverNow: now,
        });
        broadcastRoundState(roundId);
        scheduleStageTimeout(roundId, duration);
      } else {
        db.update(rounds)
          .set({
            status: 'finished',
            stageEndsAt: Date.now(),
            pausedRemainingMs: null,
          })
          .where(eq(rounds.id, roundId))
          .run();
        broadcastRoundState(roundId);
      }
    }, Math.max(50, remainingMs));

    roundTimers.set(roundId, timeout);
  }

  function startRoundLogic(roundId: number): RoundSnapshot | null {
    const roundRow = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
    if (!roundRow) return null;

    const now = Date.now();
    const duration = getStageDurationMs(roundRow.config, 1);
    const endsAt = now + duration;

    db.update(rounds)
      .set({
        status: 'running',
        currentStage: 1,
        stageStartedAt: now,
        stageEndsAt: endsAt,
        pausedRemainingMs: null,
      })
      .where(eq(rounds.id, roundId))
      .run();

    scheduleStageTimeout(roundId, duration);

    io.to(`round:${roundId}`).emit('stage:started', {
      stage: 1,
      endsAt,
      serverNow: now,
    });
    broadcastRoundState(roundId);
    return buildRoundSnapshot(roundId);
  }

  function pauseRoundLogic(roundId: number): RoundSnapshot | null {
    const roundRow = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
    if (!roundRow || roundRow.status !== 'running') return buildRoundSnapshot(roundId);

    clearRoundTimer(roundId);
    const now = Date.now();
    const remaining = roundRow.stageEndsAt ? Math.max(0, roundRow.stageEndsAt - now) : 0;

    db.update(rounds)
      .set({
        status: 'paused',
        stageEndsAt: null,
        pausedRemainingMs: remaining,
      })
      .where(eq(rounds.id, roundId))
      .run();

    io.to(`round:${roundId}`).emit('stage:paused', {
      stage: roundRow.currentStage,
      remainingMs: remaining,
      serverNow: now,
    });
    broadcastRoundState(roundId);
    return buildRoundSnapshot(roundId);
  }

  function resumeRoundLogic(roundId: number): RoundSnapshot | null {
    const roundRow = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
    if (!roundRow || roundRow.status !== 'paused') return buildRoundSnapshot(roundId);

    const now = Date.now();
    const remaining =
      roundRow.pausedRemainingMs ?? getStageDurationMs(roundRow.config, roundRow.currentStage);
    const endsAt = now + remaining;

    db.update(rounds)
      .set({
        status: 'running',
        stageEndsAt: endsAt,
        pausedRemainingMs: null,
      })
      .where(eq(rounds.id, roundId))
      .run();

    scheduleStageTimeout(roundId, remaining);

    io.to(`round:${roundId}`).emit('stage:resumed', {
      stage: roundRow.currentStage,
      endsAt,
      serverNow: now,
    });
    broadcastRoundState(roundId);
    return buildRoundSnapshot(roundId);
  }

  function nextStageLogic(roundId: number): RoundSnapshot | null {
    const roundRow = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
    if (!roundRow) return null;

    clearRoundTimer(roundId);
    if (roundRow.currentStage >= 3) {
      db.update(rounds)
        .set({
          status: 'finished',
          stageEndsAt: Date.now(),
          pausedRemainingMs: null,
        })
        .where(eq(rounds.id, roundId))
        .run();
      broadcastRoundState(roundId);
      return buildRoundSnapshot(roundId);
    }

    const nextStage = roundRow.currentStage + 1;
    const now = Date.now();
    const duration = getStageDurationMs(roundRow.config, nextStage);
    const endsAt = now + duration;

    db.update(rounds)
      .set({
        status: 'running',
        currentStage: nextStage,
        stageStartedAt: now,
        stageEndsAt: endsAt,
        pausedRemainingMs: null,
      })
      .where(eq(rounds.id, roundId))
      .run();

    scheduleStageTimeout(roundId, duration);

    io.to(`round:${roundId}`).emit('stage:started', {
      stage: nextStage,
      endsAt,
      serverNow: now,
    });
    broadcastRoundState(roundId);
    return buildRoundSnapshot(roundId);
  }

  function finishRoundLogic(roundId: number): RoundSnapshot | null {
    const roundRow = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
    if (!roundRow) return null;

    clearRoundTimer(roundId);
    db.update(rounds)
      .set({
        status: 'finished',
        stageEndsAt: Date.now(),
        pausedRemainingMs: null,
      })
      .where(eq(rounds.id, roundId))
      .run();

    broadcastRoundState(roundId);
    return buildRoundSnapshot(roundId);
  }

  function resetRoundLogic(roundId: number, adminId: number): RoundSnapshot | null {
    const roundRow = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
    if (!roundRow) return null;

    clearRoundTimer(roundId);

    sqlite.transaction(() => {
      db.delete(events).where(eq(events.roundId, roundId)).run();
      db.delete(scores).where(eq(scores.roundId, roundId)).run();
      db.update(rounds)
        .set({
          status: 'lobby',
          currentStage: 1,
          stageStartedAt: null,
          stageEndsAt: null,
          pausedRemainingMs: null,
        })
        .where(eq(rounds.id, roundId))
        .run();
      db.insert(auditLog)
        .values({
          adminId,
          action: 'round:reset',
          target: `round:${roundId}`,
          reason: 'Reinício completo da ronda pelo administrador',
          payload: { roundId },
          createdAt: Date.now(),
        })
        .run();
    })();

    broadcastRoundState(roundId);
    return buildRoundSnapshot(roundId);
  }

  function adjustScoreLogic(
    adminId: number,
    roundId: number,
    userId: number,
    delta: number,
    reason: string
  ): RoundSnapshot | null {
    const roundRow = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
    if (!roundRow) return null;

    const now = Date.now();
    sqlite.transaction(() => {
      db.insert(events)
        .values({
          roundId,
          userId,
          stage: roundRow.currentStage,
          type: 'admin:score:adjust',
          payload: { delta, reason, adminId },
          correct: delta >= 0,
          points: delta,
          createdAt: now,
        })
        .run();

      const existingScore = db
        .select()
        .from(scores)
        .where(and(eq(scores.roundId, roundId), eq(scores.userId, userId)))
        .get();

      if (!existingScore) {
        const initialTotal = Math.max(0, delta);
        db.insert(scores)
          .values({
            roundId,
            userId,
            stage1: roundRow.currentStage === 1 ? initialTotal : 0,
            stage2: roundRow.currentStage === 2 ? initialTotal : 0,
            stage3: roundRow.currentStage === 3 ? initialTotal : 0,
            total: initialTotal,
            timeSpentMs: 0,
            firstTryHits: 0,
            updatedAt: now,
          })
          .run();
      } else {
        const s1 =
          roundRow.currentStage === 1
            ? Math.max(0, existingScore.stage1 + delta)
            : existingScore.stage1;
        const s2 =
          roundRow.currentStage === 2
            ? Math.max(0, existingScore.stage2 + delta)
            : existingScore.stage2;
        const s3 =
          roundRow.currentStage === 3
            ? Math.max(0, existingScore.stage3 + delta)
            : existingScore.stage3;
        const newTotal = Math.max(0, existingScore.total + delta);

        db.update(scores)
          .set({
            stage1: s1,
            stage2: s2,
            stage3: s3,
            total: newTotal,
            updatedAt: now,
          })
          .where(and(eq(scores.roundId, roundId), eq(scores.userId, userId)))
          .run();
      }

      db.insert(auditLog)
        .values({
          adminId,
          action: 'score:adjust',
          target: `user:${userId}`,
          reason,
          payload: { roundId, userId, delta },
          createdAt: now,
        })
        .run();
    })();

    const updatedScore = db
      .select()
      .from(scores)
      .where(and(eq(scores.roundId, roundId), eq(scores.userId, userId)))
      .get();

    if (updatedScore) {
      io.to(`user:${userId}`).emit('score:update', {
        total: updatedScore.total,
        byStage: {
          stage1: updatedScore.stage1,
          stage2: updatedScore.stage2,
          stage3: updatedScore.stage3,
        },
      });
    }

    broadcastRoundState(roundId);
    return buildRoundSnapshot(roundId);
  }

  function kickPlayerLogic(
    adminId: number,
    roundId: number,
    userId: number,
    reason = 'Expulso da ronda pelo administrador'
  ): RoundSnapshot | null {
    const now = Date.now();
    sqlite.transaction(() => {
      db.update(roundPlayers)
        .set({ allowed: false, connected: false })
        .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.userId, userId)))
        .run();

      db.insert(auditLog)
        .values({
          adminId,
          action: 'player:kick',
          target: `user:${userId}`,
          reason,
          payload: { roundId, userId },
          createdAt: now,
        })
        .run();
    })();

    const targetSocket = activePlayerSockets.get(userId);
    if (targetSocket) {
      targetSocket.emit('player:kicked', { roundId, reason });
      targetSocket.leave(`round:${roundId}`);
      targetSocket.leave(`round:${roundId}:players`);
    }

    broadcastRoundState(roundId);
    return buildRoundSnapshot(roundId);
  }

  // ==================== ROTAS HTTP ====================

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: APP_NAME,
      serverNow: Date.now(),
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Dados de início de sessão inválidos.',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { username, password } = parsed.data;
    const foundUser = db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .get();

    if (!foundUser) {
      res.status(401).json({ error: 'Utilizador ou palavra-passe incorrectos.' });
      return;
    }

    const passwordMatches = await bcrypt.compare(password, foundUser.passwordHash);
    if (!passwordMatches) {
      res.status(401).json({ error: 'Utilizador ou palavra-passe incorrectos.' });
      return;
    }

    const authUser: AuthUser = {
      id: foundUser.id,
      username: foundUser.username,
      displayName: foundUser.displayName,
      role: foundUser.role,
      institution: foundUser.institution,
    };

    const token = await signUserToken(authUser);
    res.json({ token, user: authUser });
  });

  app.get('/api/auth/me', requireAuth(), (req, res) => {
    res.json({ user: req.user });
  });

  app.get('/api/parts', (_req, res) => {
    const catalog = db.select().from(parts).all();
    res.json({ parts: catalog });
  });

  app.get('/api/motherboards', requireAuth(), (_req, res) => {
    const boards = db.select().from(motherboards).all();
    res.json({ motherboards: boards });
  });

  // Rondas disponíveis para o jogador autenticado
  app.get('/api/rounds/active', requireAuth(), (req, res) => {
    const allRounds = db.select().from(rounds).orderBy(desc(rounds.id)).all();
    const userId = req.user!.id;
    const rpRows = db
      .select()
      .from(roundPlayers)
      .where(eq(roundPlayers.userId, userId))
      .all();
    const allowedMap = new Map(rpRows.map((r) => [r.roundId, r.allowed]));

    res.json({
      rounds: allRounds.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        currentStage: r.currentStage,
        allowed: allowedMap.get(r.id) ?? false,
      })),
    });
  });

  // ==================== ROTAS ADMIN ====================

  app.get('/api/admin/overview', requireRole('admin'), (req, res) => {
    const allUsers = db.select().from(users).all();
    const allParts = db.select().from(parts).all();
    const allRounds = db.select().from(rounds).all();
    res.json({
      admin: req.user,
      usersCount: allUsers.length,
      partsCount: allParts.length,
      roundsCount: allRounds.length,
    });
  });

  // CRUD de Jogadores
  app.get('/api/admin/players', requireRole('admin'), (_req, res) => {
    const playerRows = db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        institution: users.institution,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.role, 'player'))
      .orderBy(desc(users.id))
      .all();

    res.json({ players: playerRows });
  });

  app.post('/api/admin/players', requireRole('admin'), async (req, res) => {
    const parsed = CreatePlayerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Dados de jogador inválidos.',
      });
      return;
    }

    const existing = db
      .select()
      .from(users)
      .where(eq(users.username, parsed.data.username))
      .get();
    if (existing) {
      res.status(409).json({ error: `O utilizador '${parsed.data.username}' já existe.` });
      return;
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, bcryptCost);
    const result = db
      .insert(users)
      .values({
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        passwordHash,
        role: 'player',
        institution: parsed.data.institution ?? null,
        createdAt: Date.now(),
      })
      .returning({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        institution: users.institution,
        createdAt: users.createdAt,
      })
      .get();

    res.status(201).json({ player: result });
  });

  app.post('/api/admin/players/import', requireRole('admin'), async (req, res) => {
    const parsed = ImportPlayersBulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Lista de jogadores inválida.',
      });
      return;
    }

    const created: Array<{ id: number; username: string; displayName: string }> = [];
    const skipped: Array<{ username: string; reason: string }> = [];

    for (const item of parsed.data.players) {
      const existing = db
        .select()
        .from(users)
        .where(eq(users.username, item.username))
        .get();
      if (existing) {
        skipped.push({ username: item.username, reason: 'Nome de utilizador já existe' });
        continue;
      }

      const passwordHash = await bcrypt.hash(item.password, bcryptCost);
      const inserted = db
        .insert(users)
        .values({
          username: item.username,
          displayName: item.displayName,
          passwordHash,
          role: 'player',
          institution: item.institution ?? null,
          createdAt: Date.now(),
        })
        .returning({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
        })
        .get();

      created.push(inserted);
    }

    res.status(201).json({ created, skipped });
  });

  app.put('/api/admin/players/:id', requireRole('admin'), async (req, res) => {
    const playerId = Number(req.params.id);
    if (!Number.isInteger(playerId)) {
      res.status(400).json({ error: 'ID de jogador inválido.' });
      return;
    }

    const parsed = UpdatePlayerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados de actualização inválidos.' });
      return;
    }

    const existing = db.select().from(users).where(eq(users.id, playerId)).get();
    if (!existing || existing.role !== 'player') {
      res.status(404).json({ error: 'Jogador não encontrado.' });
      return;
    }

    const updates: Partial<typeof users.$inferInsert> = {};
    if (parsed.data.displayName !== undefined) updates.displayName = parsed.data.displayName;
    if (parsed.data.institution !== undefined) updates.institution = parsed.data.institution;
    if (parsed.data.password) {
      updates.passwordHash = await bcrypt.hash(parsed.data.password, bcryptCost);
    }

    const updated = db
      .update(users)
      .set(updates)
      .where(eq(users.id, playerId))
      .returning({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        institution: users.institution,
        createdAt: users.createdAt,
      })
      .get();

    res.json({ player: updated });
  });

  app.delete('/api/admin/players/:id', requireRole('admin'), (req, res) => {
    const playerId = Number(req.params.id);
    const existing = db.select().from(users).where(eq(users.id, playerId)).get();
    if (!existing || existing.role !== 'player') {
      res.status(404).json({ error: 'Jogador não encontrado.' });
      return;
    }

    db.delete(users).where(eq(users.id, playerId)).run();
    const targetSocket = activePlayerSockets.get(playerId);
    if (targetSocket) {
      targetSocket.disconnect(true);
    }
    res.json({ ok: true });
  });

  // Gestão de Rondas
  app.get('/api/admin/rounds', requireRole('admin'), (_req, res) => {
    const allRounds = db.select().from(rounds).orderBy(desc(rounds.id)).all();
    const snapshots = allRounds
      .map((r) => buildRoundSnapshot(r.id))
      .filter((s): s is RoundSnapshot => s !== null);
    res.json({ rounds: snapshots });
  });

  app.get('/api/admin/rounds/:id', requireRole('admin'), (req, res) => {
    const roundId = Number(req.params.id);
    const snapshot = buildRoundSnapshot(roundId);
    if (!snapshot) {
      res.status(404).json({ error: 'Ronda não encontrada.' });
      return;
    }
    res.json({ round: snapshot });
  });

  app.post('/api/admin/rounds', requireRole('admin'), (req, res) => {
    const parsed = CreateRoundSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Dados da ronda inválidos.',
      });
      return;
    }

    const config = parsed.data.config
      ? RoundConfigSchema.parse(parsed.data.config)
      : DEFAULT_ROUND_CONFIG;

    let createdRoundId = 0;
    sqlite.transaction(() => {
      const inserted = db
        .insert(rounds)
        .values({
          name: parsed.data.name,
          status: 'lobby',
          currentStage: 1,
          config,
          createdAt: Date.now(),
        })
        .returning({ id: rounds.id })
        .get();

      createdRoundId = inserted.id;

      for (const userId of parsed.data.allowedPlayerIds) {
        db.insert(roundPlayers)
          .values({
            roundId: createdRoundId,
            userId,
            allowed: true,
            connected: false,
          })
          .onConflictDoNothing()
          .run();
      }
    })();

    const snapshot = buildRoundSnapshot(createdRoundId);
    res.status(201).json({ round: snapshot });
  });

  app.put('/api/admin/rounds/:id', requireRole('admin'), (req, res) => {
    const roundId = Number(req.params.id);
    const existing = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
    if (!existing) {
      res.status(404).json({ error: 'Ronda não encontrada.' });
      return;
    }

    const parsed = UpdateRoundSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados de actualização da ronda inválidos.' });
      return;
    }

    sqlite.transaction(() => {
      const mergedConfig = parsed.data.config
        ? RoundConfigSchema.parse({ ...existing.config, ...parsed.data.config })
        : existing.config;

      db.update(rounds)
        .set({
          name: parsed.data.name ?? existing.name,
          status: parsed.data.status ?? existing.status,
          config: mergedConfig,
        })
        .where(eq(rounds.id, roundId))
        .run();

      if (parsed.data.allowedPlayerIds !== undefined) {
        const allowedSet = new Set(parsed.data.allowedPlayerIds);
        const existingRp = db
          .select()
          .from(roundPlayers)
          .where(eq(roundPlayers.roundId, roundId))
          .all();
        const existingIds = new Set(existingRp.map((r) => r.userId));

        for (const r of existingRp) {
          const shouldAllow = allowedSet.has(r.userId);
          db.update(roundPlayers)
            .set({ allowed: shouldAllow })
            .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.userId, r.userId)))
            .run();
        }

        for (const uid of allowedSet) {
          if (!existingIds.has(uid)) {
            db.insert(roundPlayers)
              .values({
                roundId,
                userId: uid,
                allowed: true,
                connected: false,
              })
              .run();
          }
        }
      }
    })();

    broadcastRoundState(roundId);
    res.json({ round: buildRoundSnapshot(roundId) });
  });

  // Controlos HTTP da ronda (espelham os eventos Socket.IO do admin)
  app.post('/api/admin/rounds/:id/start', requireRole('admin'), (req, res) => {
    const snapshot = startRoundLogic(Number(req.params.id));
    if (!snapshot) {
      res.status(404).json({ error: 'Ronda não encontrada.' });
      return;
    }
    res.json({ round: snapshot });
  });

  app.post('/api/admin/rounds/:id/pause', requireRole('admin'), (req, res) => {
    const snapshot = pauseRoundLogic(Number(req.params.id));
    if (!snapshot) {
      res.status(404).json({ error: 'Ronda não encontrada.' });
      return;
    }
    res.json({ round: snapshot });
  });

  app.post('/api/admin/rounds/:id/resume', requireRole('admin'), (req, res) => {
    const snapshot = resumeRoundLogic(Number(req.params.id));
    if (!snapshot) {
      res.status(404).json({ error: 'Ronda não encontrada.' });
      return;
    }
    res.json({ round: snapshot });
  });

  app.post('/api/admin/rounds/:id/next-stage', requireRole('admin'), (req, res) => {
    const snapshot = nextStageLogic(Number(req.params.id));
    if (!snapshot) {
      res.status(404).json({ error: 'Ronda não encontrada.' });
      return;
    }
    res.json({ round: snapshot });
  });

  app.post('/api/admin/rounds/:id/finish', requireRole('admin'), (req, res) => {
    const snapshot = finishRoundLogic(Number(req.params.id));
    if (!snapshot) {
      res.status(404).json({ error: 'Ronda não encontrada.' });
      return;
    }
    res.json({ round: snapshot });
  });

  app.post('/api/admin/rounds/:id/reset', requireRole('admin'), (req, res) => {
    const snapshot = resetRoundLogic(Number(req.params.id), req.user!.id);
    if (!snapshot) {
      res.status(404).json({ error: 'Ronda não encontrada.' });
      return;
    }
    res.json({ round: snapshot });
  });

  app.post('/api/admin/rounds/:id/score-adjust', requireRole('admin'), (req, res) => {
    const roundId = Number(req.params.id);
    const parsed = AdminScoreAdjustSchema.safeParse({ ...req.body, roundId });
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Dados de ajuste de pontuação inválidos.',
      });
      return;
    }

    const snapshot = adjustScoreLogic(
      req.user!.id,
      roundId,
      parsed.data.userId,
      parsed.data.delta,
      parsed.data.reason
    );
    if (!snapshot) {
      res.status(404).json({ error: 'Ronda não encontrada.' });
      return;
    }
    res.json({ round: snapshot });
  });

  app.post('/api/admin/rounds/:id/kick', requireRole('admin'), (req, res) => {
    const roundId = Number(req.params.id);
    const parsed = AdminPlayerKickSchema.safeParse({ ...req.body, roundId });
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos para expulsar jogador.' });
      return;
    }

    const snapshot = kickPlayerLogic(
      req.user!.id,
      roundId,
      parsed.data.userId,
      parsed.data.reason
    );
    res.json({ round: snapshot });
  });

  // Exportação CSV da ronda
  app.get('/api/admin/rounds/:id/export-csv', requireRole('admin'), (req, res) => {
    const roundId = Number(req.params.id);
    const snapshot = buildRoundSnapshot(roundId);
    if (!snapshot) {
      res.status(404).json({ error: 'Ronda não encontrada.' });
      return;
    }

    const header =
      'posicao,username,nome,instituicao,etapa1,etapa2,etapa3,total,tempo_ms,acertos_primeira_tentativa';
    const allowedPlayers = snapshot.players.filter((p) => p.allowed || p.total > 0);
    const lines = allowedPlayers.map((p, idx) =>
      [
        idx + 1,
        p.username,
        `"${p.displayName.replace(/"/g, '""')}"`,
        `"${(p.institution ?? '').replace(/"/g, '""')}"`,
        p.stage1,
        p.stage2,
        p.stage3,
        p.total,
        p.timeSpentMs,
        p.firstTryHits,
      ].join(',')
    );

    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="hardgame-ronda-${roundId}-resultados.csv"`
    );
    res.send(csv);
  });

  // Registo de Auditoria
  app.get('/api/admin/audit-log', requireRole('admin'), (_req, res) => {
    const logs = db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(100).all();
    res.json({ auditLog: logs });
  });

  // Serve compiled frontend in production
  const webDistCandidates = [
    resolve(__dirname, '../../web/dist'),
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), '../web/dist'),
  ];
  const webDist = webDistCandidates.find((p) => existsSync(p));

  if (webDist) {
    app.use(express.static(webDist));
    app.get('*splat', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        next();
        return;
      }
      res.sendFile(resolve(webDist, 'index.html'));
    });
  }

  // ==================== SOCKET.IO ====================

  io.use(async (socket, next) => {
    const auth = socket.handshake.auth as { token?: unknown; displayKey?: unknown } | undefined;

    if (typeof auth?.displayKey === 'string' && auth.displayKey === displayKey) {
      socket.data.isDisplay = true;
      next();
      return;
    }

    if (typeof auth?.token !== 'string' || auth.token.trim().length === 0) {
      next(new Error('AUTH_REQUIRED'));
      return;
    }

    const verifiedUser = await verifyUserToken(auth.token);
    if (!verifiedUser) {
      next(new Error('INVALID_TOKEN'));
      return;
    }

    socket.data.user = verifiedUser;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser | undefined;

    if (user) {
      socket.join(`user:${user.id}`);

      if (user.role === 'admin') {
        socket.join('admin:global');
      }

      if (user.role === 'player') {
        const previousSocket = activePlayerSockets.get(user.id);
        if (previousSocket && previousSocket.id !== socket.id) {
          previousSocket.emit('session:replaced', {
            reason: 'Outra sessão foi iniciada com a tua conta.',
          });
          previousSocket.disconnect(true);
        }
        activePlayerSockets.set(user.id, socket);
      }
    }

    socket.emit(
      'pong',
      PongPayloadSchema.parse({
        clientTime: Date.now(),
        serverTime: Date.now(),
        message: 'Ligação autenticada com o servidor Hardgame!',
      })
    );

    socket.on('ping', (rawPayload, ack?: (response: unknown) => void) => {
      const parsed = PingPayloadSchema.safeParse(rawPayload);
      if (!parsed.success) return;
      const pongPayload = PongPayloadSchema.parse({
        clientTime: parsed.data.clientTime,
        serverTime: Date.now(),
        message: 'pong do servidor autoritário Hardgame',
      });
      socket.emit('pong', pongPayload);
      if (typeof ack === 'function') {
        ack(pongPayload);
      }
    });

    // Jogador entra numa ronda
    socket.on(
      'player:join',
      (
        rawPayload: unknown,
        ack?: (res: { ok: boolean; error?: string; round?: RoundSnapshot }) => void
      ) => {
        if (!user) {
          ack?.({ ok: false, error: 'Sessão não autenticada.' });
          return;
        }
        const parsed = PlayerJoinPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'ID de ronda inválido.' });
          return;
        }

        const { roundId } = parsed.data;
        const roundRow = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
        if (!roundRow) {
          ack?.({ ok: false, error: 'Ronda não encontrada.' });
          return;
        }

        if (user.role === 'player') {
          const rp = db
            .select()
            .from(roundPlayers)
            .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.userId, user.id)))
            .get();

          if (!rp || !rp.allowed) {
            ack?.({ ok: false, error: 'Não estás inscrito nesta ronda' });
            return;
          }

          const now = Date.now();
          db.update(roundPlayers)
            .set({
              connected: true,
              joinedAt: rp.joinedAt ?? now,
            })
            .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.userId, user.id)))
            .run();

          socket.data.joinedRoundId = roundId;
          socket.join(`round:${roundId}`);
          socket.join(`round:${roundId}:players`);
        } else if (user.role === 'admin') {
          socket.join(`round:${roundId}`);
          socket.join(`round:${roundId}:admin`);
        }

        const snapshot = buildRoundSnapshot(roundId)!;
        socket.emit('round:state', snapshot);
        broadcastRoundState(roundId);
        ack?.({ ok: true, round: snapshot });
      }
    );

    // Eventos de controlo em tempo real do Admin via Socket.IO
    socket.on(
      'admin:round:start',
      (rawPayload: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
        if (!user || user.role !== 'admin') {
          ack?.({ ok: false, error: 'Apenas administradores podem iniciar a ronda.' });
          return;
        }
        const parsed = AdminRoundActionSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'Payload inválido.' });
          return;
        }
        const snapshot = startRoundLogic(parsed.data.roundId);
        ack?.({ ok: Boolean(snapshot) });
      }
    );

    socket.on(
      'admin:round:pause',
      (rawPayload: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
        if (!user || user.role !== 'admin') {
          ack?.({ ok: false, error: 'Não autorizado.' });
          return;
        }
        const parsed = AdminRoundActionSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'Payload inválido.' });
          return;
        }
        pauseRoundLogic(parsed.data.roundId);
        ack?.({ ok: true });
      }
    );

    socket.on(
      'admin:round:resume',
      (rawPayload: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
        if (!user || user.role !== 'admin') {
          ack?.({ ok: false, error: 'Não autorizado.' });
          return;
        }
        const parsed = AdminRoundActionSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'Payload inválido.' });
          return;
        }
        resumeRoundLogic(parsed.data.roundId);
        ack?.({ ok: true });
      }
    );

    socket.on(
      'admin:stage:next',
      (rawPayload: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
        if (!user || user.role !== 'admin') {
          ack?.({ ok: false, error: 'Não autorizado.' });
          return;
        }
        const parsed = AdminRoundActionSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'Payload inválido.' });
          return;
        }
        nextStageLogic(parsed.data.roundId);
        ack?.({ ok: true });
      }
    );

    socket.on(
      'admin:round:finish',
      (rawPayload: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
        if (!user || user.role !== 'admin') {
          ack?.({ ok: false, error: 'Não autorizado.' });
          return;
        }
        const parsed = AdminRoundActionSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'Payload inválido.' });
          return;
        }
        finishRoundLogic(parsed.data.roundId);
        ack?.({ ok: true });
      }
    );

    socket.on(
      'admin:round:reset',
      (rawPayload: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
        if (!user || user.role !== 'admin') {
          ack?.({ ok: false, error: 'Não autorizado.' });
          return;
        }
        const parsed = AdminRoundActionSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'Payload inválido.' });
          return;
        }
        resetRoundLogic(parsed.data.roundId, user.id);
        ack?.({ ok: true });
      }
    );

    socket.on(
      'admin:player:allow',
      (rawPayload: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
        if (!user || user.role !== 'admin') {
          ack?.({ ok: false, error: 'Não autorizado.' });
          return;
        }
        const parsed = AdminPlayerAllowSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'Payload inválido.' });
          return;
        }

        const { roundId, userId, allowed } = parsed.data;
        const existing = db
          .select()
          .from(roundPlayers)
          .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.userId, userId)))
          .get();

        if (!existing) {
          db.insert(roundPlayers)
            .values({ roundId, userId, allowed, connected: false })
            .run();
        } else {
          db.update(roundPlayers)
            .set({ allowed })
            .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.userId, userId)))
            .run();
        }

        broadcastRoundState(roundId);
        ack?.({ ok: true });
      }
    );

    socket.on(
      'admin:player:kick',
      (rawPayload: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
        if (!user || user.role !== 'admin') {
          ack?.({ ok: false, error: 'Não autorizado.' });
          return;
        }
        const parsed = AdminPlayerKickSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({ ok: false, error: 'Payload inválido.' });
          return;
        }
        kickPlayerLogic(user.id, parsed.data.roundId, parsed.data.userId, parsed.data.reason);
        ack?.({ ok: true });
      }
    );

    socket.on(
      'admin:score:adjust',
      (rawPayload: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
        if (!user || user.role !== 'admin') {
          ack?.({ ok: false, error: 'Não autorizado.' });
          return;
        }
        const parsed = AdminScoreAdjustSchema.safeParse(rawPayload);
        if (!parsed.success) {
          ack?.({
            ok: false,
            error: parsed.error.issues[0]?.message ?? 'Motivo e delta são obrigatórios.',
          });
          return;
        }

        adjustScoreLogic(
          user.id,
          parsed.data.roundId,
          parsed.data.userId,
          parsed.data.delta,
          parsed.data.reason
        );
        ack?.({ ok: true });
      }
    );

    socket.on('disconnect', () => {
      if (user && user.role === 'player') {
        const currentSocket = activePlayerSockets.get(user.id);
        if (currentSocket?.id === socket.id) {
          activePlayerSockets.delete(user.id);
        }

        const joinedRoundId = socket.data.joinedRoundId as number | undefined;
        if (joinedRoundId) {
          db.update(roundPlayers)
            .set({ connected: false })
            .where(
              and(eq(roundPlayers.roundId, joinedRoundId), eq(roundPlayers.userId, user.id))
            )
            .run();
          broadcastRoundState(joinedRoundId);
        }
      }
    });
  });

  return { app, httpServer, io, db, sqlite };
}

function getLanAddresses(): string[] {
  const nets = networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { httpServer, db } = createAppServer();
  seedDatabase(db)
    .then(() => {
      httpServer.listen(PORT, '0.0.0.0', () => {
        const lanIps = getLanAddresses();
        console.log('\n============================================================');
        console.log(`  ${APP_NAME.toUpperCase()} — Servidor Autoritário em Execução`);
        console.log('============================================================');
        console.log(`  Local:    http://localhost:${PORT}`);
        for (const ip of lanIps) {
          console.log(`  Rede LAN: http://${ip}:${PORT}`);
          console.log(`  Admin:    http://${ip}:${PORT}/admin`);
          console.log(`  Telão:    http://${ip}:${PORT}/telao?key=${DISPLAY_KEY}`);
        }
        if (lanIps.length === 0) {
          console.log(`  Admin:    http://localhost:${PORT}/admin`);
          console.log(`  Telão:    http://localhost:${PORT}/telao?key=${DISPLAY_KEY}`);
        }
        console.log('============================================================\n');
      });
    })
    .catch((err) => {
      console.error('Erro ao inicializar servidor Hardgame:', err);
      process.exit(1);
    });
}
