import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as createClient } from 'socket.io-client';
import bcrypt from 'bcryptjs';
import { createAppServer } from './index.js';
import { seedDatabase } from './db/seed.js';
import { users, parts, auditLog } from './db/schema.js';
import type { AddressInfo } from 'node:net';
import type { LoginResponse, PongPayload, RoundSnapshot } from '@hardgame/shared';

describe('@hardgame/server (Fases 0, 1 e 2 — Base de dados, Auth e Painel de Admin)', () => {
  const { httpServer, io, db, sqlite } = createAppServer({
    dbPath: ':memory:',
    displayKey: 'telao-teste',
    bcryptCost: 4,
  });
  let baseUrl = '';
  let adminToken = '';
  let player1Token = '';
  let player1Id = 0;

  beforeAll(async () => {
    await seedDatabase(db, {
      adminUsername: 'admin_test',
      adminPassword: 'secret_admin_password',
      bcryptCost: 4,
    });

    const playerHash = await bcrypt.hash('senha_jogador', 4);
    const insertedPlayer = db
      .insert(users)
      .values({
        username: 'jogador1',
        displayName: 'Carlos Silva',
        passwordHash: playerHash,
        role: 'player',
        institution: 'ISPTEC',
        createdAt: Date.now(),
      })
      .returning({ id: users.id })
      .get();

    player1Id = insertedPlayer.id;

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin_test', password: 'secret_admin_password' }),
    });
    const adminBody = (await adminRes.json()) as LoginResponse;
    adminToken = adminBody.token;

    const playerRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jogador1', password: 'senha_jogador' }),
    });
    const playerBody = (await playerRes.json()) as LoginResponse;
    player1Token = playerBody.token;
  });

  afterAll(async () => {
    await io.close();
    httpServer.close();
    sqlite.close();
  });

  it('efectua seed do catálogo inicial de 10 peças com aliases e descrições', () => {
    const allParts = db.select().from(parts).all();
    expect(allParts).toHaveLength(10);
    const slugs = allParts.map((p) => p.slug);
    expect(slugs).toContain('motherboard');
    expect(slugs).toContain('cpu');
    expect(slugs).toContain('gpu');
    expect(slugs).toContain('ram');
  });

  it('rejeita login inválido (401) e bloqueia acesso admin para papel player (403)', async () => {
    const wrongPass = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jogador1', password: 'errada' }),
    });
    expect(wrongPass.status).toBe(401);

    const forbiddenRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${player1Token}` },
    });
    expect(forbiddenRes.status).toBe(403);
  });

  it('rejeita ligação Socket.IO sem token válido no handshake', async () => {
    const unauthClient = createClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
    });

    const connectError = await new Promise<Error>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Deveria ter falhado handshake')), 3000);
      unauthClient.on('connect_error', (err) => {
        clearTimeout(timer);
        resolve(err);
      });
    });

    expect(connectError.message).toBe('AUTH_REQUIRED');
    unauthClient.disconnect();
  });

  it('garante apenas uma sessão activa por jogador (emite session:replaced e desliga a anterior)', async () => {
    const socket1 = createClient(baseUrl, {
      transports: ['websocket'],
      auth: { token: player1Token },
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout socket1')), 3000);
      socket1.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const replacedPromise = new Promise<{ reason: string }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timeout à espera de session:replaced')),
        3000
      );
      socket1.on('session:replaced', (payload: { reason: string }) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    const socket2 = createClient(baseUrl, {
      transports: ['websocket'],
      auth: { token: player1Token },
      reconnection: false,
    });

    const pongFromSocket2 = await new Promise<PongPayload>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout socket2')), 3000);
      socket2.on('connect', () => {
        socket2.emit('ping', { clientTime: 555, message: 'ping s2' }, (ack: PongPayload) => {
          clearTimeout(timer);
          resolve(ack);
        });
      });
    });

    const replacedEvent = await replacedPromise;
    expect(replacedEvent.reason).toContain('Outra sessão');
    expect(pongFromSocket2.clientTime).toBe(555);
    socket2.disconnect();
  });

  it('Fase 2: importa jogadores via lote CSV e rejeita jogador não autorizado na ronda', async () => {
    // Importar jogador2
    const importRes = await fetch(`${baseUrl}/api/admin/players/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        players: [
          {
            username: 'jogador_nao_autorizado',
            displayName: 'Marta Neto',
            password: 'senha123',
            institution: 'UAN',
          },
        ],
      }),
    });
    expect(importRes.status).toBe(201);

    // Login com jogador_nao_autorizado
    const login2Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jogador_nao_autorizado', password: 'senha123' }),
    });
    const login2 = (await login2Res.json()) as LoginResponse;

    // Criar ronda autorizando apenas player1Id
    const roundRes = await fetch(`${baseUrl}/api/admin/rounds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Final Universitária',
        allowedPlayerIds: [player1Id],
      }),
    });
    expect(roundRes.status).toBe(201);
    const { round } = (await roundRes.json()) as { round: RoundSnapshot };

    // Tentar entrar com jogador não autorizado
    const unallowedSocket = createClient(baseUrl, {
      transports: ['websocket'],
      auth: { token: login2.token },
      reconnection: false,
    });

    const joinDenied = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      unallowedSocket.on('connect', () => {
        unallowedSocket.emit(
          'player:join',
          { roundId: round.id },
          (ack: { ok: boolean; error?: string }) => resolve(ack)
        );
      });
    });

    expect(joinDenied.ok).toBe(false);
    expect(joinDenied.error).toBe('Não estás inscrito nesta ronda');
    unallowedSocket.disconnect();

    // Entrar com jogador autorizado (player1)
    const allowedSocket = createClient(baseUrl, {
      transports: ['websocket'],
      auth: { token: player1Token },
      reconnection: false,
    });

    const joinAllowed = await new Promise<{ ok: boolean; round?: RoundSnapshot }>((resolve) => {
      allowedSocket.on('connect', () => {
        allowedSocket.emit(
          'player:join',
          { roundId: round.id },
          (ack: { ok: boolean; round?: RoundSnapshot }) => resolve(ack)
        );
      });
    });

    expect(joinAllowed.ok).toBe(true);
    expect(joinAllowed.round?.name).toBe('Final Universitária');
    allowedSocket.disconnect();
  });

  it('Fase 2: pausa congela o tempo para todos e retoma a partir de pausedRemainingMs', async () => {
    const roundRes = await fetch(`${baseUrl}/api/admin/rounds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Ronda de Teste de Pausa',
        allowedPlayerIds: [player1Id],
      }),
    });
    const { round } = (await roundRes.json()) as { round: RoundSnapshot };

    // Iniciar ronda
    const startRes = await fetch(`${baseUrl}/api/admin/rounds/${round.id}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const started = ((await startRes.json()) as { round: RoundSnapshot }).round;
    expect(started.status).toBe('running');
    expect(started.stageEndsAt).toBeTypeOf('number');

    // Pausar ronda
    const pauseRes = await fetch(`${baseUrl}/api/admin/rounds/${round.id}/pause`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const paused = ((await pauseRes.json()) as { round: RoundSnapshot }).round;
    expect(paused.status).toBe('paused');
    expect(paused.stageEndsAt).toBeNull();
    expect(paused.pausedRemainingMs).toBeGreaterThan(170000);

    // Retomar ronda
    const resumeRes = await fetch(`${baseUrl}/api/admin/rounds/${round.id}/resume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const resumed = ((await resumeRes.json()) as { round: RoundSnapshot }).round;
    expect(resumed.status).toBe('running');
    expect(resumed.pausedRemainingMs).toBeNull();
    expect(resumed.stageEndsAt).toBeTypeOf('number');
  });

  it('Fase 2: rejeita ajuste manual sem motivo (400), regista ajuste com motivo no audit_log e exporta CSV', async () => {
    const roundRes = await fetch(`${baseUrl}/api/admin/rounds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Ronda Auditoria e CSV',
        allowedPlayerIds: [player1Id],
      }),
    });
    const { round } = (await roundRes.json()) as { round: RoundSnapshot };

    // Ajuste sem motivo -> 400
    const badAdjust = await fetch(`${baseUrl}/api/admin/rounds/${round.id}/score-adjust`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        userId: player1Id,
        delta: 50,
        reason: ' ',
      }),
    });
    expect(badAdjust.status).toBe(400);

    // Ajuste com motivo válido -> 200 e registado no audit_log
    const goodAdjust = await fetch(`${baseUrl}/api/admin/rounds/${round.id}/score-adjust`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        userId: player1Id,
        delta: 75,
        reason: 'Bónus atribuído pelo júri pela resposta técnica completa',
      }),
    });
    expect(goodAdjust.status).toBe(200);
    const adjustedRound = ((await goodAdjust.json()) as { round: RoundSnapshot }).round;
    const p1Score = adjustedRound.players.find((p) => p.userId === player1Id);
    expect(p1Score?.total).toBe(75);

    const logs = db.select().from(auditLog).all();
    expect(logs.some((l) => l.action === 'score:adjust' && l.reason.includes('Bónus'))).toBe(
      true
    );

    // Exportar CSV
    const csvRes = await fetch(`${baseUrl}/api/admin/rounds/${round.id}/export-csv`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();
    expect(csvText).toContain('posicao,username,nome,instituicao');
    expect(csvText).toContain('jogador1');
    expect(csvText).toContain('75');
  });
});
