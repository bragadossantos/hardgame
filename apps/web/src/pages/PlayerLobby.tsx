import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Socket } from 'socket.io-client';
import type { RoundSnapshot } from '@hardgame/shared';
import { useAuthStore } from '../store/authStore.js';

interface RoundListItem {
  id: number;
  name: string;
  status: string;
  currentStage: number;
  allowed: boolean;
}

export function PlayerLobby({ socket }: { socket: Socket | null }) {
  const { token, user, clearSession } = useAuthStore();
  const [availableRounds, setAvailableRounds] = useState<RoundListItem[]>([]);
  const [joinedRound, setJoinedRound] = useState<RoundSnapshot | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [kickedReason, setKickedReason] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);

  useEffect(() => {
    if (!token) return;
    fetch('/api/rounds/active', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d: { rounds?: RoundListItem[] }) => {
        if (d.rounds) setAvailableRounds(d.rounds);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    const t = setInterval(() => setClockNow(Date.now() + serverOffset), 250);
    return () => clearInterval(t);
  }, [serverOffset]);

  useEffect(() => {
    if (!socket) return;
    const onState = (snapshot: RoundSnapshot) => {
      setServerOffset(snapshot.serverNow - Date.now());
      setJoinedRound(snapshot);
    };
    const onKicked = (payload: { reason?: string }) => {
      setJoinedRound(null);
      setKickedReason(payload.reason ?? 'Foste removido desta ronda pelo administrador.');
    };

    socket.on('round:state', onState);
    socket.on('player:kicked', onKicked);
    return () => {
      socket.off('round:state', onState);
      socket.off('player:kicked', onKicked);
    };
  }, [socket]);

  const handleJoinRound = (roundId: number) => {
    if (!socket) return;
    setJoinError(null);
    setKickedReason(null);
    socket.emit(
      'player:join',
      { roundId },
      (ack: { ok: boolean; error?: string; round?: RoundSnapshot }) => {
        if (!ack.ok) {
          setJoinError(ack.error ?? 'Não estás inscrito nesta ronda');
          return;
        }
        if (ack.round) {
          setServerOffset(ack.round.serverNow - Date.now());
          setJoinedRound(ack.round);
        }
      }
    );
  };

  const myEntry = joinedRound?.players.find((p) => p.userId === user?.id);

  let timerDisplay = '--:--';
  if (joinedRound) {
    if (joinedRound.status === 'paused' && joinedRound.pausedRemainingMs !== null) {
      const s = Math.ceil(joinedRound.pausedRemainingMs / 1000);
      timerDisplay = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} (PAUSADO)`;
    } else if (joinedRound.status === 'running' && joinedRound.stageEndsAt !== null) {
      const s = Math.ceil(Math.max(0, joinedRound.stageEndsAt - clockNow) / 1000);
      timerDisplay = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 max-w-4xl mx-auto flex flex-col justify-between">
      <header className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <span className="text-xs font-mono uppercase text-emerald-400">
            Jogador: {user?.displayName} (@{user?.username})
          </span>
          <h1 className="text-2xl font-extrabold text-white">Modo Torneio — Hardgame</h1>
        </div>
        <div className="flex gap-3">
          <Link
            to="/"
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold"
          >
            ← Ecrã Inicial
          </Link>
          <button
            type="button"
            onClick={() => clearSession()}
            className="px-3.5 py-2 rounded-xl bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-800 text-xs font-semibold cursor-pointer"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="my-8 space-y-6">
        {joinError && (
          <div className="rounded-xl bg-rose-950/80 border border-rose-700 p-4 text-rose-200 text-sm font-semibold">
            ✗ {joinError}
          </div>
        )}

        {kickedReason && (
          <div className="rounded-xl bg-amber-950/80 border border-amber-700 p-4 text-amber-200 text-sm font-semibold">
            ⚠ {kickedReason}
          </div>
        )}

        {!joinedRound ? (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
            <h2 className="text-xl font-bold text-white">Escolhe a Ronda para Entrar no Lobby</h2>
            {availableRounds.length === 0 ? (
              <p className="text-sm text-slate-400">
                Ainda não há rondas criadas pelo administrador. Aguarda um momento.
              </p>
            ) : (
              <div className="space-y-3">
                {availableRounds.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 p-4"
                  >
                    <div>
                      <div className="font-bold text-white">
                        #{r.id} — {r.name}
                      </div>
                      <div className="text-xs text-slate-400">
                        Estado: {r.status.toUpperCase()} • Etapa {r.currentStage}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleJoinRound(r.id)}
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition cursor-pointer"
                    >
                      Entrar na Ronda →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center space-y-6">
            <span className="inline-block text-xs font-bold uppercase tracking-widest text-emerald-400 bg-emerald-950/70 border border-emerald-800 px-3 py-1 rounded-full">
              Ronda #{joinedRound.id} • {joinedRound.status.toUpperCase()}
            </span>
            <h2 className="text-3xl font-extrabold text-white">{joinedRound.name}</h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl mx-auto">
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                <div className="text-xs uppercase text-slate-400">Etapa Actual</div>
                <div className="text-2xl font-extrabold text-white mt-1">
                  Etapa {joinedRound.currentStage} / 3
                </div>
              </div>
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                <div className="text-xs uppercase text-slate-400">Temporizador</div>
                <div className="text-2xl font-mono font-extrabold text-amber-400 mt-1">
                  {timerDisplay}
                </div>
              </div>
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                <div className="text-xs uppercase text-slate-400">A Tua Pontuação</div>
                <div className="text-2xl font-mono font-extrabold text-emerald-400 mt-1">
                  {myEntry?.total ?? 0} pts
                </div>
              </div>
            </div>

            {joinedRound.status === 'lobby' && (
              <p className="text-slate-300 text-sm">
                Estás ligado no lobby! Aguarda que o administrador inicie a Etapa 1.
              </p>
            )}

            {joinedRound.status === 'paused' && (
              <p className="text-amber-300 text-sm font-semibold">
                ⏸ A ronda está em pausa pelo administrador. O temporizador está congelado.
              </p>
            )}

            {joinedRound.status === 'running' && (
              <p className="text-emerald-300 text-sm font-semibold">
                ▶ Etapa {joinedRound.currentStage} em curso! (A cena 3D interactiva entra na Fase
                3).
              </p>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-slate-800 pt-4 text-xs text-slate-500 text-center">
        Hardgame — Sincronizado em tempo real com o servidor autoritário
      </footer>
    </div>
  );
}

