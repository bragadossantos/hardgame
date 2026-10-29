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

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1, 'Introduz o nome de utilizador'),
  password: z.string().min(1, 'Introduz a palavra-passe'),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  displayName: z.string(),
  role: UserRoleSchema,
  institution: z.string().nullable(),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;

export const LoginResponseSchema = z.object({
  token: z.string(),
  user: AuthUserSchema,
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const RoundConfigSchema = z.object({
  stage1DurationSec: z.number().int().positive().default(180),
  stage2DurationSec: z.number().int().positive().default(150),
  stage3DurationSec: z.number().int().positive().default(180),
  correctPlacementPoints: z.number().int().nonnegative().default(100),
  wrongPlacementPenalty: z.number().int().nonnegative().default(20),
  speedBonusPerSecond: z.number().int().nonnegative().default(2),
  enforceAssemblyDependencies: z.boolean().default(true),
  dependencyViolationPenalty: z.number().int().nonnegative().default(0),
  maxLabelAttempts: z.number().int().min(1).max(5).default(2),
  labelFirstTryPoints: z.number().int().nonnegative().default(50),
  labelSecondTryPoints: z.number().int().nonnegative().default(25),
  labelWrongPenalty: z.number().int().nonnegative().default(0),
  allowTypos: z.boolean().default(true),
  moboManufacturerPoints: z.number().int().nonnegative().default(30),
  moboFormFactorPoints: z.number().int().nonnegative().default(30),
  moboSocketPoints: z.number().int().nonnegative().default(40),
  moboChipsetPoints: z.number().int().nonnegative().default(50),
  moboModelPoints: z.number().int().nonnegative().default(50),
  enabledPartSlugs: z
    .array(z.string())
    .default([
      'motherboard',
      'cpu',
      'cpu-cooler',
      'ram',
      'gpu',
      'ssd-m2',
      'ssd-sata',
      'hdd',
      'psu',
      'case-fan',
    ]),
  motherboardIds: z.array(z.number()).default([]),
});

export type RoundConfig = z.infer<typeof RoundConfigSchema>;

export const DEFAULT_ROUND_CONFIG: RoundConfig = RoundConfigSchema.parse({});

export const DEFAULT_SCORING_CONFIG = {
  correctPlacementPoints: DEFAULT_ROUND_CONFIG.correctPlacementPoints,
  wrongPlacementPenalty: DEFAULT_ROUND_CONFIG.wrongPlacementPenalty,
  speedBonusPerSecond: DEFAULT_ROUND_CONFIG.speedBonusPerSecond,
  labelFirstTryPoints: DEFAULT_ROUND_CONFIG.labelFirstTryPoints,
  labelSecondTryPoints: DEFAULT_ROUND_CONFIG.labelSecondTryPoints,
  moboManufacturerPoints: DEFAULT_ROUND_CONFIG.moboManufacturerPoints,
  moboFormFactorPoints: DEFAULT_ROUND_CONFIG.moboFormFactorPoints,
  moboSocketPoints: DEFAULT_ROUND_CONFIG.moboSocketPoints,
  moboChipsetPoints: DEFAULT_ROUND_CONFIG.moboChipsetPoints,
  moboModelPoints: DEFAULT_ROUND_CONFIG.moboModelPoints,
} as const;

export interface CatalogPartSeed {
  slug: string;
  namePt: string;
  aliases: string[];
  descriptionPt: string;
  modelPath: string | null;
  category: string;
  slots: string[];
}

export const INITIAL_PARTS_CATALOG: CatalogPartSeed[] = [
  {
    slug: 'motherboard',
    namePt: 'Placa-mãe',
    aliases: ['motherboard', 'board', 'placa mae', 'mobo', 'mainboard', 'placa principal'],
    descriptionPt:
      'A placa-mãe é a espinha dorsal do computador onde todos os componentes se ligam e comunicam entre si. Deve ser instalada primeiro nos espaçadores da caixa.',
    modelPath: null,
    category: 'base',
    slots: ['slot-motherboard'],
  },
  {
    slug: 'cpu',
    namePt: 'Processador',
    aliases: ['CPU', 'microprocessador', 'unidade central de processamento', 'processador central'],
    descriptionPt:
      'O processador (CPU) é o cérebro do computador, responsável por executar as instruções dos programas. Encaixa no socket da placa-mãe com alinhamento exacto.',
    modelPath: null,
    category: 'processamento',
    slots: ['slot-cpu-socket'],
  },
  {
    slug: 'cpu-cooler',
    namePt: 'Cooler do processador',
    aliases: [
      'cooler',
      'dissipador',
      'dissipador de calor',
      'ventoinha do processador',
      'cooler cpu',
    ],
    descriptionPt:
      'O cooler do processador retira o calor gerado pelo CPU através de um dissipador metálico e uma ventoinha. Instala-se directamente por cima do processador.',
    modelPath: null,
    category: 'arrefecimento',
    slots: ['slot-cpu-cooler'],
  },
  {
    slug: 'ram',
    namePt: 'Memória RAM',
    aliases: ['RAM', 'memória', 'pente de memória', 'DIMM', 'módulo de memória', 'memoria ram'],
    descriptionPt:
      'A memória RAM guarda temporariamente os dados dos programas em execução para acesso ultra-rápido pelo processador. Encaixa nos slots DIMM da placa-mãe.',
    modelPath: null,
    category: 'memoria',
    slots: ['slot-ram-1', 'slot-ram-2'],
  },
  {
    slug: 'gpu',
    namePt: 'Placa gráfica',
    aliases: ['placa de vídeo', 'GPU', 'placa de video', 'gráfica', 'placa grafica'],
    descriptionPt:
      'A placa gráfica processa imagens, vídeo e gráficos 3D para o ecrã. Encaixa na ranhura PCIe x16 principal da placa-mãe.',
    modelPath: null,
    category: 'graficos',
    slots: ['slot-pcie-x16'],
  },
  {
    slug: 'ssd-m2',
    namePt: 'SSD M.2',
    aliases: ['M.2', 'NVMe', 'SSD NVMe', 'ssd m2', 'disco m2'],
    descriptionPt:
      'O SSD M.2 é uma unidade de armazenamento compacta de altíssima velocidade que encaixa directamente na ranhura M.2 da placa-mãe, sem cabos.',
    modelPath: null,
    category: 'armazenamento',
    slots: ['slot-m2'],
  },
  {
    slug: 'ssd-sata',
    namePt: 'SSD SATA',
    aliases: ['SSD', 'disco SSD', 'disco sólido', 'ssd 2.5', 'unidade de estado solido'],
    descriptionPt:
      'O SSD SATA de 2,5 polegadas armazena o sistema operativo e ficheiros em memória flash, sendo muito mais rápido e resistente a choques do que um disco mecânico.',
    modelPath: null,
    category: 'armazenamento',
    slots: ['slot-drive-bay'],
  },
  {
    slug: 'hdd',
    namePt: 'Disco rígido',
    aliases: ['HDD', 'disco duro', 'disco rígido', 'disco mecanico', 'hard drive'],
    descriptionPt:
      'O disco rígido (HDD) guarda grandes volumes de dados em pratos magnéticos rotativos. É instalado nas baias de 3,5 polegadas da caixa.',
    modelPath: null,
    category: 'armazenamento',
    slots: ['slot-drive-bay-2'],
  },
  {
    slug: 'psu',
    namePt: 'Fonte de alimentação',
    aliases: ['fonte', 'PSU', 'fonte de energia', 'fonte de alimentacao'],
    descriptionPt:
      'A fonte de alimentação converte a corrente alternada da tomada em corrente contínua estável para alimentar todos os componentes do computador.',
    modelPath: null,
    category: 'energia',
    slots: ['slot-psu'],
  },
  {
    slug: 'case-fan',
    namePt: 'Ventoinha da caixa',
    aliases: ['ventoinha', 'fan', 'cooler da caixa', 'ventoinha do gabinete'],
    descriptionPt:
      'A ventoinha da caixa mantém o fluxo de ar dentro do computador, fazendo entrar ar fresco pela frente e expulsando o ar quente pela traseira.',
    modelPath: null,
    category: 'arrefecimento',
    slots: ['slot-fan-front', 'slot-fan-rear'],
  },
];
