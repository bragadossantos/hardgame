import { describe, it, expect } from 'vitest';
import {
  APP_NAME,
  PingPayloadSchema,
  PongPayloadSchema,
  parsePlayersCsv,
  AdminScoreAdjustSchema,
} from './index.js';

describe('@hardgame/shared (Fase 0 a Fase 2)', () => {
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

  it('valida importação CSV de jogadores com cabeçalho e detecta erros linha a linha', () => {
    const csv = [
      'username,display_name,password,institution',
      'ana_silva,Ana Silva,senha123,UAN',
      'invalido_sem_senha,Joao',
    ].join('\n');

    const rows = parsePlayersCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.data?.username).toBe('ana_silva');
    expect(rows[0]?.data?.institution).toBe('UAN');
    expect(rows[1]?.error).toBeDefined();
  });

  it('rejeita ajuste manual de pontos sem motivo válido', () => {
    const missingReason = AdminScoreAdjustSchema.safeParse({
      roundId: 1,
      userId: 2,
      delta: 20,
      reason: ' ',
    });
    expect(missingReason.success).toBe(false);

    const validReason = AdminScoreAdjustSchema.safeParse({
      roundId: 1,
      userId: 2,
      delta: -15,
      reason: 'Penalização por conduta',
    });
    expect(validReason.success).toBe(true);
  });
});
