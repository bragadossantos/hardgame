import { z } from 'zod';

export const APP_NAME = 'Hardgame';

export const PingPayloadSchema = z.object({
  clientTime: z.number(),
  message: z.string().default('ping'),
});

export type PingPayload = z.infer<typeof PingPayloadSchema>;

export const PongPayloadSchema = z.object({
  clientTime: z.number(),
  serverTime: z.number(),
  message: z.string(),
});

export type PongPayload = z.infer<typeof PongPayloadSchema>;

export const RoundStatusSchema = z.enum(['draft', 'lobby', 'running', 'paused', 'finished']);
export type RoundStatus = z.infer<typeof RoundStatusSchema>;

export const UserRoleSchema = z.enum(['admin', 'player']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const DEFAULT_SCORING_CONFIG = {
  correctPlacementPoints: 100,
  wrongPlacementPenalty: 20,
  speedBonusPerSecond: 2,
  labelFirstTryPoints: 50,
  labelSecondTryPoints: 25,
  moboManufacturerPoints: 30,
  moboFormFactorPoints: 30,
  moboSocketPoints: 40,
  moboChipsetPoints: 50,
  moboModelPoints: 50,
} as const;

