import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { APP_NAME, PingPayloadSchema, PongPayloadSchema } from '@hardgame/shared';
import { loadEnvFile } from './env.js';

loadEnvFile();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DISPLAY_KEY = process.env.DISPLAY_KEY ?? 'telao2026';

export function createAppServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: APP_NAME,
      serverNow: Date.now(),
    });
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

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Cliente ligado: ${socket.id}`);

    // Enviar ping inicial assim que liga para diagnóstico na Fase 0
    socket.emit(
      'pong',
      PongPayloadSchema.parse({
        clientTime: Date.now(),
        serverTime: Date.now(),
        message: 'Ligação estabelecida com o servidor Hardgame!',
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
      console.log(`[Socket.IO] Ping recebido de ${socket.id} -> a enviar pong`);
      socket.emit('pong', pongPayload);
      if (typeof ack === 'function') {
        ack(pongPayload);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] Cliente desligado (${socket.id}): ${reason}`);
    });
  });

  return { app, httpServer, io };
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

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { httpServer } = createAppServer();
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
}

