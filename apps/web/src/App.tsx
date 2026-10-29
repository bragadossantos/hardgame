import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Routes, Route, Link } from 'react-router';
import { io, Socket } from 'socket.io-client';
import {
  APP_NAME,
  LoginResponseSchema,
  PongPayloadSchema,
  type PongPayload,
  type UserRole,
} from '@hardgame/shared';
import { useAuthStore } from './store/authStore.js';
import { AdminPanel } from './pages/AdminPanel.js';
import { PlayerLobby } from './pages/PlayerLobby.js';

function Home({
  connected,
  lastPong,
  onSendPing,
}: {
  connected: boolean;
  lastPong: PongPayload | null;
  onSendPing: () => void;
}) {
  const { user, clearSession, sessionReplacedMessage } = useAuthStore();
  const rtt = lastPong ? Math.max(0, lastPong.serverTime - lastPong.clientTime) : null;

  return (
    <div className="min-h-screen flex flex-col justify-between p-6 md:p-12 max-w-6xl mx-auto">
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 rounded-full px-3 py-1 mb-2">
            Competição Académica &amp; Laboratório 3D
          </span>
          <h1 className="text-4xl font-extrabold tracking-tight text-white">{APP_NAME}</h1>
          <p className="text-slate-400 mt-1">
            Montagem 3D, identificação de componentes e diagnóstico de placas-mãe em tempo real.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <span
            className={`h-3 w-3 rounded-full ${
              connected ? 'bg-emerald-400 shadow-[0_0_12px_#34d399]' : 'bg-amber-400'
            }`}
          />
          <div className="text-sm">
            <div className="font-medium text-slate-200">
              {connected
                ? `Socket Autenticado (${user?.displayName ?? 'Ligado'})`
                : user
                  ? 'A ligar ao servidor...'
                  : 'Inicia sessão para ligar ao Socket'}
            </div>
            {lastPong && (
              <div className="text-xs text-slate-400">
                Último pong: {rtt !== null ? `${rtt} ms` : 'OK'}
              </div>
            )}
          </div>
          {connected && (
            <button
              type="button"
              onClick={onSendPing}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 transition cursor-pointer"
            >
              Testar Ping
            </button>
          )}
          {user && (
            <button
              type="button"
              onClick={() => clearSession()}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-200 border border-rose-800 transition cursor-pointer"
            >
              Sair
            </button>
          )}
        </div>
      </header>

      {sessionReplacedMessage && (
        <div className="mt-6 rounded-xl bg-amber-950/60 border border-amber-700 px-4 py-3 text-amber-200 text-sm">
          {sessionReplacedMessage}
        </div>
      )}

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
        <span>Hardgame — Fase 2 (Painel de Administração, Lobby ao Vivo, Auditoria e CSV)</span>
        <span>Funciona 100% em rede local (LAN)</span>
      </footer>
    </div>
  );
}

function AuthGate({
  requiredRole,
  title,
  route,
  children,
}: {
  requiredRole: UserRole;
  title: string;
  route: string;
  children: ReactNode;
}) {
  const { user, setSession, clearSession, sessionReplacedMessage } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Falha ao iniciar sessão.');
        return;
      }
      const parsed = LoginResponseSchema.parse(data);
      setSession(parsed.token, parsed.user);
      setUsername('');
      setPassword('');
    } catch {
      setError('Não foi possível contactar o servidor.');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 max-w-md mx-auto">
        <div className="w-full rounded-2xl bg-slate-900 border border-slate-800 p-8 shadow-xl">
          <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 bg-slate-950 border border-slate-800 px-3 py-1 rounded-full">
            Rota: {route}
          </span>
          <h1 className="text-2xl font-bold text-white mt-4 mb-1">{title}</h1>
          <p className="text-sm text-slate-400 mb-6">
            Inicia sessão para continuar ({requiredRole === 'admin' ? 'Administrador' : 'Jogador'}).
          </p>

          {sessionReplacedMessage && (
            <div className="mb-4 rounded-xl bg-amber-950/70 border border-amber-700 px-3 py-2 text-xs text-amber-200">
              {sessionReplacedMessage}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl bg-rose-950/70 border border-rose-800 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                Nome de utilizador
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                placeholder={requiredRole === 'admin' ? 'admin' : 'ex: estudante01'}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                Palavra-passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm transition cursor-pointer"
            >
              {loading ? 'A verificar...' : 'Iniciar Sessão'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800 text-center">
            <Link to="/" className="text-xs text-slate-400 hover:text-white transition">
              ← Voltar ao Ecrã Inicial
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (requiredRole === 'admin' && user.role !== 'admin') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-rose-400 mb-2">Acesso Restrito ao Administrador</h1>
        <p className="text-slate-400 mb-6 text-sm">
          Estás autenticado como <strong>{user.displayName}</strong> ({user.role}), mas este ecrã
          requer privilégios de administrador.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => clearSession()}
            className="px-4 py-2 rounded-xl bg-rose-900 hover:bg-rose-800 text-white text-sm font-semibold cursor-pointer"
          >
            Terminar Sessão
          </button>
          <Link
            to="/"
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold"
          >
            ← Voltar
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
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
  const { token, clearSession } = useAuthStore();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastPong, setLastPong] = useState<PongPayload | null>(null);

  useEffect(() => {
    if (!token) {
      setConnected(false);
      setSocket(null);
      return;
    }

    const s = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
    });
    setSocket(s);

    s.on('connect', () => {
      setConnected(true);
      s.emit('ping', { clientTime: Date.now(), message: 'ping inicial autenticado' });
    });

    s.on('disconnect', () => {
      setConnected(false);
    });

    s.on('session:replaced', (payload?: { reason?: string }) => {
      clearSession(
        payload?.reason ?? 'A tua sessão foi terminada porque entraste noutro computador ou separador.'
      );
    });

    s.on('pong', (raw) => {
      const parsed = PongPayloadSchema.safeParse(raw);
      if (parsed.success) {
        setLastPong(parsed.data);
      }
    });

    return () => {
      s.disconnect();
    };
  }, [token, clearSession]);

  const handleSendPing = () => {
    if (!socket) return;
    socket.emit(
      'ping',
      { clientTime: Date.now(), message: 'ping manual do utilizador' },
      (ackResponse: unknown) => {
        const parsed = PongPayloadSchema.safeParse(ackResponse);
        if (parsed.success) {
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
          <AuthGate requiredRole="player" title="Modo Torneio — Jogador" route="/jogar">
            <PlayerLobby socket={socket} />
          </AuthGate>
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
          <AuthGate requiredRole="admin" title="Painel de Administração" route="/admin">
            <AdminPanel socket={socket} />
          </AuthGate>
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
