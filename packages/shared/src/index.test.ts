import { describe, it, expect } from 'vitest';
import { APP_NAME, PingPayloadSchema, PongPayloadSchema } from './index.js';

describe('@hardgame/shared (Fase 0)', () => {
  it('exporta o nome da aplicação e esquemas Zod de ping/pong', () => {
    expect(APP_NAME).toBe('Hardgame');

    const parsedPing = PingPayloadSchema.parse({ clientTime: 1000 });
    expect(parsedPing.message).toBe('ping');

    const parsedPong = PongPayloadSchema.parse({
      clientTime: 1000,
      serverTime: 1005,
      message: 'pong',
    });
    expect(parsedPong.serverTime).toBe(1005);
  });
});

