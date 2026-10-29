import { useEffect, useState } from 'react';
import { Routes, Route, Link } from 'react-router';
import { io, Socket } from 'socket.io-client';
import { APP_NAME, PongPayloadSchema, type PongPayload } from '@hardgame/shared';

function Home({
  connected,
  lastPong,
  onSendPing,
}: {
  connected: boolean;
  lastPong: PongPayload | null;
  onSendPing: () => void;
}) {
  const rtt = lastPong ? Math.max(0, lastPong.serverTime - lastPong.clientTime) : null;

  return (
    <div className="min-h-screen flex flex-col justify-between p-6 md:p-12 max-w-6xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 rounded-full px-3 py-1 mb-2">
            Competição Académica &amp; Laboratório 3D
          </span>
          <h1 className="text-4xl font-extrabold tracking-tight text-white">{APP_NAME}</h1>
          <p className="text-slate-400 mt-1">
            Montagem 3D, identificação de componentes e diagnóstico de placas-mãe em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <span
            className={`h-3 w-3 rounded-full ${
              connected ? 'bg-emerald-400 shadow-[0_0_12px_#34d399]' : 'bg-rose-500'
            }`}
          />
          <div className="text-sm">
            <div className="font-medium text-slate-200">
              {connected ? 'Servidor Ligado (Socket.IO)' : 'A aguardar servidor...'}
            </div>
            {lastPong && (
              <div className="text-xs text-slate-400">
                Último pong: {rtt !== null ? `${rtt} ms` : 'OK'}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onSendPing}
            className="ml-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 transition cursor-pointer"
          >
            Testar Ping
          </button>
        </div>
      </header>

      <main className="my-12 grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link
          to="/jogar"
          className="group relative rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/60 p-7 transition flex flex-col justify-between"
        >
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2">
              Modo Torneio • Jogador
            </div>
            <h2 className="text-2xl font-bold text-white group-hover:text-emerald-300 transition">
              Entrar no Torneio (/jogar)
            </h2>
            <p className="text-slate-400 mt-2 text-sm leading-relaxed">
              Inicia sessão com a tua conta de estudante, aguarda no lobby da ronda e compete nas 3
              etapas oficiais (Montagem 3D, Identificação e Placas-mãe).
            </p>
          </div>
          <div className="mt-6 text-sm font-semibold text-emerald-400">Ir para o Jogo →</div>
        </Link>

        <Link
          to="/treino"
          className="group relative rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-sky-500/60 p-7 transition flex flex-col justify-between"
        >
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-sky-400 mb-2">
              Acesso Livre • Estudo
            </div>
            <h2 className="text-2xl font-bold text-white group-hover:text-sky-300 transition">
              Modo Treino (/treino)
            </h2>
            <p className="text-slate-400 mt-2 text-sm leading-relaxed">
              Pratica sem pressão de tempo nem palavra-passe obrigatória. Recebe explicações
              educativas sobre cada peça e aprende a ordem real de montagem.
            </p>
          </div>
          <div className="mt-6 text-sm font-semibold text-sky-400">Iniciar Treino →</div>
        </Link>

        <Link
          to="/admin"
          className="group relative rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-amber-500/60 p-7 transition flex flex-col justify-between"
        >
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2">
              Organização • Docente / Júri
            </div>
            <h2 className="text-2xl font-bold text-white group-hover:text-amber-300 transition">
              Painel de Administração (/admin)
            </h2>
            <p className="text-slate-400 mt-2 text-sm leading-relaxed">
              Gere contas de jogadores (ou importa CSV), configura rondas, controla o início e pausa
              das etapas ao vivo e exporta classificações.
            </p>
          </div>
          <div className="mt-6 text-sm font-semibold text-amber-400">Abrir Painel →</div>
        </Link>

        <Link
          to="/telao"
          className="group relative rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-purple-500/60 p-7 transition flex flex-col justify-between"
        >
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-2">
              Plateia • Projector 1920×1080
            </div>
            <h2 className="text-2xl font-bold text-white group-hover:text-purple-300 transition">
              Telão do Torneio (/telao)
            </h2>
            <p className="text-slate-400 mt-2 text-sm leading-relaxed">
              Ecrã público de alto contraste com ranking animado em tempo real, temporizador gigante
              e feed de jogadas sem revelar as respostas certas.
            </p>
          </div>
          <div className="mt-6 text-sm font-semibold text-purple-400">Abrir Telão →</div>
        </Link>
      </main>

      <footer className="border-t border-slate-800 pt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
        <span>Hardgame — Fase 0 (Esqueleto Monorepo + Socket.IO + Tailwind v4)</span>
        <span>Funciona 100% em rede local (LAN)</span>
      </footer>
    </div>
  );
}

function PlaceholderScreen({
  title,
  route,
  description,
}: {
  title: string;
  route: string;
  description: string;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center max-w-xl mx-auto">
      <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 bg-slate-900 border border-slate-800 px-3 py-1 rounded-full mb-4">
        Rota: {route}
      </span>
      <h1 className="text-3xl font-bold text-white mb-3">{title}</h1>
      <p className="text-slate-400 mb-8 leading-relaxed">{description}</p>
      <Link
        to="/"
        className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold transition"
      >
        ← Voltar ao Ecrã Inicial
      </Link>
    </div>
  );
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastPong, setLastPong] = useState<PongPayload | null>(null);

  useEffect(() => {
    const s = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });
    setSocket(s);

    s.on('connect', () => {
      console.log('[Socket.IO] Ligado ao servidor com ID:', s.id);
      setConnected(true);
      s.emit('ping', { clientTime: Date.now(), message: 'ping inicial do navegador' });
    });

    s.on('disconnect', () => {
      console.log('[Socket.IO] Desligado do servidor');
      setConnected(false);
    });

    s.on('pong', (raw) => {
      const parsed = PongPayloadSchema.safeParse(raw);
      if (parsed.success) {
        console.log('[Socket.IO] Evento pong recebido:', parsed.data);
        setLastPong(parsed.data);
      }
    });

    return () => {
      s.disconnect();
    };
  }, []);

  const handleSendPing = () => {
    if (!socket) return;
    console.log('[Socket.IO] A enviar ping manual...');
    socket.emit(
      'ping',
      { clientTime: Date.now(), message: 'ping manual do utilizador' },
      (ackResponse: unknown) => {
        const parsed = PongPayloadSchema.safeParse(ackResponse);
        if (parsed.success) {
          console.log('[Socket.IO] Ack pong recebido:', parsed.data);
          setLastPong(parsed.data);
        }
      }
    );
  };

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Home connected={connected} lastPong={lastPong} onSendPing={handleSendPing} />
        }
      />
      <Route
        path="/jogar"
        element={
          <PlaceholderScreen
            title="Modo Torneio — Jogador"
            route="/jogar"
            description="Ecrã reservado para o início de sessão do jogador, espera no lobby e participação nas 3 etapas (implementado nas Fases 1, 3, 4 e 5)."
          />
        }
      />
      <Route
        path="/treino"
        element={
          <PlaceholderScreen
            title="Modo Treino Educativo"
            route="/treino"
            description="Ecrã de acesso livre sem limite de tempo e com feedback educativo imediato sobre cada componente (implementado na Fase 7)."
          />
        }
      />
      <Route
        path="/admin"
        element={
          <PlaceholderScreen
            title="Painel de Administração"
            route="/admin"
            description="Gestão de jogadores, criação de rondas, controlo em tempo real e auditoria de pontuações (implementado nas Fases 1 e 2)."
          />
        }
      />
      <Route
        path="/telao"
        element={
          <PlaceholderScreen
            title="Telão da Plateia (1920×1080)"
            route="/telao"
            description="Ecrã para projector com ranking animado em tempo real e feed de jogadas sem revelar respostas (implementado na Fase 6)."
          />
        }
      />
    </Routes>
  );
}

