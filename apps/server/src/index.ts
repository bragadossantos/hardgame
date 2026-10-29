import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  APP_NAME,
  LoginRequestSchema,
  PingPayloadSchema,
  PongPayloadSchema,
  type AuthUser,
} from '@hardgame/shared';
import { loadEnvFile } from './env.js';
import { createDatabase, applyMigrations, type AppDb } from './db/index.js';
import { seedDatabase } from './db/seed.js';
import { users, parts } from './db/schema.js';
import { signUserToken, verifyUserToken, requireAuth, requireRole } from './auth.js';

loadEnvFile();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DISPLAY_KEY = process.env.DISPLAY_KEY ?? 'telao2026';

export interface ServerOptions {
  dbPath?: string;
  displayKey?: string;
}

export function createAppServer(options: ServerOptions = {}) {
  const displayKey = options.displayKey ?? process.env.DISPLAY_KEY ?? 'telao2026';
  const rawDbPath =
    options.dbPath ??
    (process.env.DATABASE_PATH
      ? resolve(__dirname, '../../../', process.env.DATABASE_PATH)
      : resolve(__dirname, '../../../data/hardgame.db'));

  const { sqlite, db } = createDatabase(rawDbPath);
  applyMigrations(sqlite);

  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: APP_NAME,
      serverNow: Date.now(),
    });
  });

  // POST /api/auth/login
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

  // GET /api/auth/me
  app.get('/api/auth/me', requireAuth(), (req, res) => {
    res.json({ user: req.user });
  });

  // GET /api/admin/overview (rota protegida por papel admin)
  app.get('/api/admin/overview', requireRole('admin'), (req, res) => {
    const allUsers = db.select().from(users).all();
    const allParts = db.select().from(parts).all();
    res.json({
      admin: req.user,
      usersCount: allUsers.length,
      partsCount: allParts.length,
    });
  });

  // GET /api/parts (catálogo de peças para treino/consulta, sem expor dados sensíveis)
  app.get('/api/parts', (_req, res) => {
    const catalog = db.select().from(parts).all();
    res.json({ parts: catalog });
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

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Mapa de sessões activas por jogador: userId -> socket
  const activePlayerSockets = new Map<number, Socket>();

  // Middleware de autenticação no handshake do Socket.IO (Skill 6 & Fase 1)
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

      // Uma sessão activa por jogador: se entrar nova sessão com a mesma conta, emite session:replaced e desliga a anterior
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
      if (!parsed.success) {
        return;
      }
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

    socket.on('disconnect', () => {
      if (user && user.role === 'player') {
        const currentSocket = activePlayerSockets.get(user.id);
        if (currentSocket?.id === socket.id) {
          activePlayerSockets.delete(user.id);
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
