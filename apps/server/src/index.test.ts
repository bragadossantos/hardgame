import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as createClient } from 'socket.io-client';
import { createAppServer } from './index.js';
import type { AddressInfo } from 'node:net';
import type { PongPayload } from '@hardgame/shared';

describe('@hardgame/server (Fase 0)', () => {
  const { httpServer, io } = createAppServer();
  let baseUrl = '';

  beforeAll(async () => {
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
  });

  it('responde a GET /api/health e troca ping/pong via Socket.IO', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string };
    expect(body.ok).toBe(true);
    expect(body.app).toBe('Hardgame');

    const client = createClient(baseUrl, { transports: ['websocket'] });
    const pong = await new Promise<PongPayload>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout no ping/pong')), 4000);
      client.on('connect', () => {
        client.emit(
          'ping',
          { clientTime: 12345, message: 'teste vitest' },
          (ack: PongPayload) => {
            clearTimeout(timeout);
            resolve(ack);
          }
        );
      });
    });

    expect(pong.clientTime).toBe(12345);
    expect(typeof pong.serverTime).toBe('number');
    client.disconnect();
  });
});

