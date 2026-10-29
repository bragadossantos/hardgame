import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as createClient } from 'socket.io-client';
import bcrypt from 'bcryptjs';
import { createAppServer } from './index.js';
import { seedDatabase } from './db/seed.js';
import { users, parts } from './db/schema.js';
import type { AddressInfo } from 'node:net';
import type { LoginResponse, PongPayload } from '@hardgame/shared';

describe('@hardgame/server (Fase 0 & Fase 1 — Base de dados e Autenticação)', () => {
  const { httpServer, io, db, sqlite } = createAppServer({
    dbPath: ':memory:',
    displayKey: 'telao-teste',
  });
  let baseUrl = '';

  beforeAll(async () => {
    await seedDatabase(db, {
      adminUsername: 'admin_test',
      adminPassword: 'secret_admin_password',
      bcryptCost: 4, // mais rápido nos testes
    });

    // Criar jogador de teste
    const playerHash = await bcrypt.hash('senha_jogador', 4);
    db.insert(users)
      .values({
        username: 'jogador1',
        displayName: 'Carlos Silva',
        passwordHash: playerHash,
        role: 'player',
        institution: 'ISPTEC',
        createdAt: Date.now(),
      })
      .run();

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
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

  it('permite login válido para admin e jogador e devolve JWT', async () => {
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin_test', password: 'secret_admin_password' }),
    });
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as LoginResponse;
    expect(adminBody.user.role).toBe('admin');
    expect(typeof adminBody.token).toBe('string');

    const playerRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jogador1', password: 'senha_jogador' }),
    });
    expect(playerRes.status).toBe(200);
    const playerBody = (await playerRes.json()) as LoginResponse;
    expect(playerBody.user.role).toBe('player');
    expect(playerBody.user.displayName).toBe('Carlos Silva');
  });

  it('rejeita login com palavra-passe errada ou utilizador inexistente (401)', async () => {
    const wrongPass = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jogador1', password: 'errada' }),
    });
    expect(wrongPass.status).toBe(401);

    const unknownUser = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nao_existe', password: '123' }),
    });
    expect(unknownUser.status).toBe(401);
  });

  it('bloqueia acesso a rota de admin com papel errado (403) ou sem token (401)', async () => {
    const noTokenRes = await fetch(`${baseUrl}/api/admin/overview`);
    expect(noTokenRes.status).toBe(401);

    const playerLogin = (await (
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'jogador1', password: 'senha_jogador' }),
      })
    ).json()) as LoginResponse;

    const forbiddenRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${playerLogin.token}` },
    });
    expect(forbiddenRes.status).toBe(403);

    const adminLogin = (await (
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin_test', password: 'secret_admin_password' }),
      })
    ).json()) as LoginResponse;

    const allowedRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` },
    });
    expect(allowedRes.status).toBe(200);
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
      unauthClient.on('connect', () => {
        clearTimeout(timer);
        reject(new Error('Ligou sem autenticação'));
      });
    });

    expect(connectError.message).toBe('AUTH_REQUIRED');
    unauthClient.disconnect();
  });

  it('garante apenas uma sessão activa por jogador (emite session:replaced e desliga a anterior)', async () => {
    const playerLogin = (await (
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'jogador1', password: 'senha_jogador' }),
      })
    ).json()) as LoginResponse;

    const socket1 = createClient(baseUrl, {
      transports: ['websocket'],
      auth: { token: playerLogin.token },
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
      const timer = setTimeout(() => reject(new Error('Timeout à espera de session:replaced')), 3000);
      socket1.on('session:replaced', (payload: { reason: string }) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    const disconnectPromise = new Promise<string>((resolve) => {
      socket1.on('disconnect', (reason) => resolve(reason));
    });

    // Segunda sessão com a mesma conta de jogador
    const socket2 = createClient(baseUrl, {
      transports: ['websocket'],
      auth: { token: playerLogin.token },
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
    const disconnectReason = await disconnectPromise;

    expect(replacedEvent.reason).toContain('Outra sessão');
    expect(disconnectReason).toBe('io server disconnect');
    expect(pongFromSocket2.clientTime).toBe(555);

    socket2.disconnect();
  });
});
