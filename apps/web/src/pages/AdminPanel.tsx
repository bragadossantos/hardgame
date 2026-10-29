import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Socket } from 'socket.io-client';
import {
  DEFAULT_ROUND_CONFIG,
  parsePlayersCsv,
  type CsvPreviewRow,
  type RoundConfig,
  type RoundSnapshot,
} from '@hardgame/shared';
import { useAuthStore } from '../store/authStore.js';

interface PlayerRecord {
  id: number;
  username: string;
  displayName: string;
  institution: string | null;
  createdAt: number;
}

interface CatalogPart {
  id: number;
  slug: string;
  namePt: string;
  category: string;
}

interface MotherboardItem {
  id: number;
  manufacturer: string;
  modelName: string;
  formFactor: string;
  socket: string;
  chipset: string;
}

interface AuditEntry {
  id: number;
  adminId: number;
  action: string;
  target: string;
  reason: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

function formatRemainingTime(round: RoundSnapshot | null, nowMs: number): string {
  if (!round) return '--:--';
  if (round.status === 'paused' && round.pausedRemainingMs !== null) {
    const sec = Math.ceil(round.pausedRemainingMs / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} (PAUSADO)`;
  }
  if (round.status === 'running' && round.stageEndsAt !== null) {
    const rem = Math.max(0, round.stageEndsAt - nowMs);
    const sec = Math.ceil(rem / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return '--:--';
}

export function AdminPanel({ socket }: { socket: Socket | null }) {
  const { token, user, clearSession } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'live' | 'players' | 'config' | 'audit'>('live');
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [rounds, setRounds] = useState<RoundSnapshot[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);
  const [partsCatalog, setPartsCatalog] = useState<CatalogPart[]>([]);
  const [motherboards, setMotherboards] = useState<MotherboardItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);

  // Novo jogador
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newInstitution, setNewInstitution] = useState('');

  // Importação CSV
  const [csvText, setCsvText] = useState('');
  const [csvPreview, setCsvPreview] = useState<CsvPreviewRow[]>([]);

  // Nova ronda
  const [newRoundName, setNewRoundName] = useState('');
  const [newRoundAllowedIds, setNewRoundAllowedIds] = useState<number[]>([]);
  const [configDraft, setConfigDraft] = useState<RoundConfig>(DEFAULT_ROUND_CONFIG);

  // Ajuste manual de pontos
  const [adjustUserId, setAdjustUserId] = useState<number>(0);
  const [adjustDelta, setAdjustDelta] = useState<number>(10);
  const [adjustReason, setAdjustReason] = useState<string>('');

  const authHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? ''}`,
    }),
    [token]
  );

  const loadAllData = useCallback(async () => {
    if (!token) return;
    try {
      const [pRes, rRes, partsRes, moboRes, auditRes] = await Promise.all([
        fetch('/api/admin/players', { headers: authHeaders() }),
        fetch('/api/admin/rounds', { headers: authHeaders() }),
        fetch('/api/parts'),
        fetch('/api/motherboards', { headers: authHeaders() }),
        fetch('/api/admin/audit-log', { headers: authHeaders() }),
      ]);

      if (pRes.ok) {
        const d = (await pRes.json()) as { players: PlayerRecord[] };
        setPlayers(d.players);
      }
      if (rRes.ok) {
        const d = (await rRes.json()) as { rounds: RoundSnapshot[] };
        setRounds(d.rounds);
        if (d.rounds[0]) {
          setServerOffset(d.rounds[0].serverNow - Date.now());
          setSelectedRoundId((prev) => prev ?? d.rounds[0]!.id);
          setConfigDraft(d.rounds[0].config);
        }
      }
      if (partsRes.ok) {
        const d = (await partsRes.json()) as { parts: CatalogPart[] };
        setPartsCatalog(d.parts);
      }
      if (moboRes.ok) {
        const d = (await moboRes.json()) as { motherboards: MotherboardItem[] };
        setMotherboards(d.motherboards);
      }
      if (auditRes.ok) {
        const d = (await auditRes.json()) as { auditLog: AuditEntry[] };
        setAuditLogs(d.auditLog);
      }
    } catch {
      setErrorMessage('Falha ao carregar dados do servidor.');
    }
  }, [token, authHeaders]);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  // Relógio para temporizador ao vivo
  useEffect(() => {
    const interval = setInterval(() => {
      setClockNow(Date.now() + serverOffset);
    }, 250);
    return () => clearInterval(interval);
  }, [serverOffset]);

  // Escutar actualizações em tempo real da ronda via Socket.IO
  useEffect(() => {
    if (!socket) return;
    const handleRoundState = (snapshot: RoundSnapshot) => {
      setServerOffset(snapshot.serverNow - Date.now());
      setRounds((prev) => {
        const idx = prev.findIndex((r) => r.id === snapshot.id);
        if (idx === -1) return [snapshot, ...prev];
        const copy = [...prev];
        copy[idx] = snapshot;
        return copy;
      });
    };

    socket.on('round:state', handleRoundState);
    return () => {
      socket.off('round:state', handleRoundState);
    };
  }, [socket]);

  const currentRound = rounds.find((r) => r.id === selectedRoundId) ?? rounds[0] ?? null;

  useEffect(() => {
    if (currentRound) {
      setConfigDraft(currentRound.config);
      if (adjustUserId === 0 && currentRound.players[0]) {
        setAdjustUserId(currentRound.players[0].userId);
      }
    }
  }, [currentRound?.id]);

  const showFeedback = (msg: string, isError = false) => {
    if (isError) {
      setErrorMessage(msg);
      setStatusMessage(null);
    } else {
      setStatusMessage(msg);
      setErrorMessage(null);
    }
  };

  // Criar jogador individual
  const handleCreatePlayer = async (e: FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/players', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        username: newUsername,
        displayName: newDisplayName,
        password: newPassword,
        institution: newInstitution || null,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      showFeedback(data.error ?? 'Erro ao criar jogador.', true);
      return;
    }
    setNewUsername('');
    setNewDisplayName('');
    setNewPassword('');
    setNewInstitution('');
    showFeedback('Conta de jogador criada com sucesso.');
    await loadAllData();
  };

  const handleDeletePlayer = async (id: number, name: string) => {
    if (!window.confirm(`Tens a certeza que queres remover o jogador "${name}"?`)) return;
    const res = await fetch(`/api/admin/players/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.ok) {
      showFeedback(`Jogador "${name}" removido.`);
      await loadAllData();
    }
  };

  // Pré-visualizar e importar CSV
  const handlePreviewCsv = (text: string) => {
    setCsvText(text);
    setCsvPreview(parsePlayersCsv(text));
  };

  const handleImportCsvConfirm = async () => {
    const validPlayers = csvPreview.filter((r) => r.data).map((r) => r.data!);
    if (validPlayers.length === 0) {
      showFeedback('Nenhuma linha válida para importar.', true);
      return;
    }
    const res = await fetch('/api/admin/players/import', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ players: validPlayers }),
    });
    const data = (await res.json()) as {
      created?: unknown[];
      skipped?: Array<{ username: string; reason: string }>;
      error?: string;
    };
    if (!res.ok) {
      showFeedback(data.error ?? 'Erro ao importar CSV.', true);
      return;
    }
    setCsvText('');
    setCsvPreview([]);
    showFeedback(
      `Importação concluída: ${data.created?.length ?? 0} criados, ${data.skipped?.length ?? 0} ignorados.`
    );
    await loadAllData();
  };

  // Criar nova ronda
  const handleCreateRound = async (e: FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/rounds', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: newRoundName,
        allowedPlayerIds:
          newRoundAllowedIds.length > 0 ? newRoundAllowedIds : players.map((p) => p.id),
        config: configDraft,
      }),
    });
    const data = (await res.json()) as { round?: RoundSnapshot; error?: string };
    if (!res.ok || !data.round) {
      showFeedback(data.error ?? 'Erro ao criar ronda.', true);
      return;
    }
    setNewRoundName('');
    setSelectedRoundId(data.round.id);
    showFeedback(`Ronda "${data.round.name}" criada com sucesso!`);
    await loadAllData();
  };

  // Guardar configuração da ronda seleccionada
  const handleSaveRoundConfig = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentRound) return;
    const res = await fetch(`/api/admin/rounds/${currentRound.id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ config: configDraft }),
    });
    if (res.ok) {
      showFeedback('Configuração da ronda actualizada.');
      await loadAllData();
    } else {
      showFeedback('Erro ao guardar configuração.', true);
    }
  };

  // Controlos ao vivo da ronda
  const triggerRoundAction = async (
    action: 'start' | 'pause' | 'resume' | 'next-stage' | 'finish' | 'reset',
    confirmPrompt?: string
  ) => {
    if (!currentRound) return;
    if (confirmPrompt && !window.confirm(confirmPrompt)) return;

    const res = await fetch(`/api/admin/rounds/${currentRound.id}/${action}`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (res.ok) {
      const d = (await res.json()) as { round: RoundSnapshot };
      setRounds((prev) => prev.map((r) => (r.id === d.round.id ? d.round : r)));
      showFeedback(`Acção "${action}" executada na ronda.`);
      await loadAllData();
    } else {
      showFeedback(`Falha ao executar "${action}".`, true);
    }
  };

  // Alternar autorização de um jogador na ronda
  const handleToggleAllowPlayer = (userId: number, allowed: boolean) => {
    if (!currentRound) return;
    if (socket?.connected) {
      socket.emit('admin:player:allow', {
        roundId: currentRound.id,
        userId,
        allowed,
      });
    } else {
      const currentAllowed = currentRound.players
        .filter((p) => (p.userId === userId ? allowed : p.allowed))
        .map((p) => p.userId);
      void fetch(`/api/admin/rounds/${currentRound.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ allowedPlayerIds: currentAllowed }),
      }).then(() => loadAllData());
    }
  };

  // Expulsar jogador
  const handleKickPlayer = async (userId: number, displayName: string) => {
    if (!currentRound) return;
    if (!window.confirm(`Expulsar "${displayName}" desta ronda?`)) return;
    const res = await fetch(`/api/admin/rounds/${currentRound.id}/kick`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        userId,
        reason: 'Expulso pelo administrador durante a ronda',
      }),
    });
    if (res.ok) {
      showFeedback(`Jogador "${displayName}" expulso da ronda.`);
      await loadAllData();
    }
  };

  // Ajuste manual de pontos com motivo obrigatório
  const handleScoreAdjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentRound || !adjustUserId) return;
    const res = await fetch(`/api/admin/rounds/${currentRound.id}/score-adjust`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        userId: adjustUserId,
        delta: Number(adjustDelta),
        reason: adjustReason,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      showFeedback(data.error ?? 'Motivo obrigatório para ajustar pontos.', true);
      return;
    }
    setAdjustReason('');
    showFeedback('Ajuste de pontuação aplicado e registado na auditoria.');
    await loadAllData();
  };

  // Exportar CSV
  const handleExportCsv = async () => {
    if (!currentRound) return;
    const res = await fetch(`/api/admin/rounds/${currentRound.id}/export-csv`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      showFeedback('Erro ao exportar resultados.', true);
      return;
    }
    const csvBlob = await res.blob();
    const url = URL.createObjectURL(csvBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hardgame-ronda-${currentRound.id}-resultados.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 max-w-7xl mx-auto">
      {/* Cabeçalho Admin */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-5 mb-6">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-amber-400 bg-amber-950/60 border border-amber-800/60 px-3 py-1 rounded-full">
            Painel de Administração • {user?.displayName}
          </span>
          <h1 className="text-3xl font-extrabold text-white mt-2">
            Controlo do Torneio Hardgame
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/telao?key=telao2026"
            target="_blank"
            className="px-3.5 py-2 rounded-xl bg-purple-950/80 hover:bg-purple-900 text-purple-200 border border-purple-700/60 text-xs font-semibold transition"
          >
            Abrir Telão ↗
          </Link>
          <Link
            to="/"
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
          >
            ← Ecrã Inicial
          </Link>
          <button
            type="button"
            onClick={() => clearSession()}
            className="px-3.5 py-2 rounded-xl bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-800 text-xs font-semibold transition cursor-pointer"
          >
            Terminar Sessão
          </button>
        </div>
      </header>

      {/* Alertas de Feedback */}
      {statusMessage && (
        <div className="mb-5 rounded-xl bg-emerald-950/80 border border-emerald-700 px-4 py-3 text-sm text-emerald-200 flex justify-between items-center">
          <span>✓ {statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-xs underline ml-4 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="mb-5 rounded-xl bg-rose-950/80 border border-rose-700 px-4 py-3 text-sm text-rose-200 flex justify-between items-center">
          <span>✗ {errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs underline ml-4 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Navegação por Separadores */}
      <nav className="flex flex-wrap gap-2 mb-6 border-b border-slate-800 pb-3">
        {(
          [
            { id: 'live', label: '1. Rondas & Controlo ao Vivo' },
            { id: 'players', label: `2. Jogadores & Importação CSV (${players.length})` },
            { id: 'config', label: '3. Configurar Etapas & Pontuação' },
            { id: 'audit', label: `4. Registo de Auditoria (${auditLogs.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold transition cursor-pointer ${
              activeTab === tab.id
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* SEPARADOR 1: CONTROLO AO VIVO & LOBBY */}
      {activeTab === 'live' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Coluna Esquerda: Criar / Seleccionar Ronda */}
          <div className="space-y-6">
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
              <h2 className="text-lg font-bold text-white mb-3">Seleccionar Ronda Activa</h2>
              {rounds.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Ainda não existem rondas. Cria a primeira ronda abaixo.
                </p>
              ) : (
                <select
                  value={currentRound?.id ?? ''}
                  onChange={(e) => setSelectedRoundId(Number(e.target.value))}
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white"
                >
                  {rounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      #{r.id} — {r.name} ({r.status.toUpperCase()} • Etapa {r.currentStage})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <form
              onSubmit={handleCreateRound}
              className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4"
            >
              <h2 className="text-lg font-bold text-white">Criar Nova Ronda</h2>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
                  Nome da Ronda
                </label>
                <input
                  type="text"
                  required
                  value={newRoundName}
                  onChange={(e) => setNewRoundName(e.target.value)}
                  placeholder="Ex.: Eliminatória 1 — Engenharia Informática"
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                />
              </div>
              <p className="text-xs text-slate-400">
                Por defeito, todos os jogadores registados ({players.length}) serão inscritos e
                podes activar/desactivar qualquer um no lobby ao lado.
              </p>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition cursor-pointer"
              >
                + Criar Ronda
              </button>
            </form>

            {/* Ajuste manual de pontos */}
            {currentRound && (
              <form
                onSubmit={handleScoreAdjust}
                className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4"
              >
                <h2 className="text-lg font-bold text-white">Ajuste Manual de Pontos</h2>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
                    Jogador
                  </label>
                  <select
                    value={adjustUserId}
                    onChange={(e) => setAdjustUserId(Number(e.target.value))}
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                  >
                    {currentRound.players.map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.displayName} (@{p.username}) — {p.total} pts
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
                    Delta de Pontos (+ ou -)
                  </label>
                  <input
                    type="number"
                    required
                    value={adjustDelta}
                    onChange={(e) => setAdjustDelta(Number(e.target.value))}
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
                    Motivo Obrigatório (Auditoria)
                  </label>
                  <input
                    type="text"
                    required
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="Ex.: Resposta sinónima válida na seta 2"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition cursor-pointer"
                >
                  Aplicar Ajuste de Pontos
                </button>
              </form>
            )}
          </div>

          {/* Coluna Direita (2/3): Controlos ao Vivo + Lobby e Ranking */}
          <div className="lg:col-span-2 space-y-6">
            {currentRound ? (
              <>
                <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4 mb-5">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        Ronda #{currentRound.id} • Estado: {currentRound.status.toUpperCase()}
                      </span>
                      <h2 className="text-2xl font-extrabold text-white mt-1">
                        {currentRound.name}
                      </h2>
                    </div>
                    <div className="text-right bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5">
                      <div className="text-xs uppercase text-slate-400">
                        Etapa {currentRound.currentStage} de 3
                      </div>
                      <div className="text-2xl font-mono font-extrabold text-amber-400">
                        {formatRemainingTime(currentRound, clockNow)}
                      </div>
                    </div>
                  </div>

                  {/* Botões Grandes de Controlo ao Vivo */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => triggerRoundAction('start')}
                      className="py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition cursor-pointer"
                    >
                      ▶ Iniciar Ronda (Etapa 1)
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerRoundAction('pause')}
                      className="py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition cursor-pointer"
                    >
                      ⏸ Pausar Tempo
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerRoundAction('resume')}
                      className="py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold text-sm transition cursor-pointer"
                    >
                      ⏯ Retomar Tempo
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        triggerRoundAction(
                          'next-stage',
                          'Avançar todos os jogadores para a próxima etapa?'
                        )
                      }
                      className="py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition cursor-pointer"
                    >
                      ⏭ Próxima Etapa
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        triggerRoundAction('finish', 'Tens a certeza que queres encerrar a ronda?')
                      }
                      className="py-3 px-4 rounded-xl bg-rose-700 hover:bg-rose-600 text-white font-bold text-sm transition cursor-pointer"
                    >
                      ⏹ Terminar Ronda
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        triggerRoundAction(
                          'reset',
                          'ATENÇÃO: Reiniciar a ronda apaga todos os eventos e pontuações desta ronda. Confirmar?'
                        )
                      }
                      className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-rose-950 text-rose-300 border border-rose-800/60 font-bold text-sm transition cursor-pointer"
                    >
                      ↺ Reiniciar Ronda
                    </button>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-800 flex justify-end">
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-bold transition cursor-pointer"
                    >
                      ⬇ Exportar Resultados em CSV
                    </button>
                  </div>
                </div>

                {/* Tabela do Lobby ao Vivo e Pontuações */}
                <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">
                      Lobby ao Vivo &amp; Jogadores Autorizados
                    </h3>
                    <span className="text-xs text-slate-400">
                      Ligados:{' '}
                      <strong className="text-emerald-400">
                        {currentRound.players.filter((p) => p.connected).length}
                      </strong>{' '}
                      / Autorizados:{' '}
                      <strong>{currentRound.players.filter((p) => p.allowed).length}</strong>
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                          <th className="py-2.5 pr-3">Estado</th>
                          <th className="py-2.5 pr-3">Jogador</th>
                          <th className="py-2.5 pr-3">Inscrito</th>
                          <th className="py-2.5 pr-3">E1 / E2 / E3</th>
                          <th className="py-2.5 pr-3">Total</th>
                          <th className="py-2.5 text-right">Acções</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {currentRound.players.map((p) => (
                          <tr key={p.userId}>
                            <td className="py-3 pr-3">
                              <span
                                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                                  p.connected
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                                    : 'bg-slate-950 text-slate-500 border border-slate-800'
                                }`}
                              >
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    p.connected ? 'bg-emerald-400' : 'bg-slate-600'
                                  }`}
                                />
                                {p.connected ? 'Ligado' : 'Offline'}
                              </span>
                            </td>
                            <td className="py-3 pr-3">
                              <div className="font-semibold text-white">{p.displayName}</div>
                              <div className="text-xs text-slate-400">
                                @{p.username} {p.institution ? `• ${p.institution}` : ''}
                              </div>
                            </td>
                            <td className="py-3 pr-3">
                              <input
                                type="checkbox"
                                checked={p.allowed}
                                onChange={(e) =>
                                  handleToggleAllowPlayer(p.userId, e.target.checked)
                                }
                                className="h-4 w-4 accent-emerald-500 cursor-pointer"
                              />
                            </td>
                            <td className="py-3 pr-3 font-mono text-xs text-slate-300">
                              {p.stage1} / {p.stage2} / {p.stage3}
                            </td>
                            <td className="py-3 pr-3 font-mono font-bold text-emerald-400">
                              {p.total} pts
                            </td>
                            <td className="py-3 text-right">
                              {p.allowed && (
                                <button
                                  type="button"
                                  onClick={() => handleKickPlayer(p.userId, p.displayName)}
                                  className="px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs font-semibold cursor-pointer"
                                >
                                  Expulsar
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-10 text-center text-slate-400">
                Cria uma ronda na coluna da esquerda para activar os controlos ao vivo.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SEPARADOR 2: CRUD DE JOGADORES & IMPORTAÇÃO CSV */}
      {activeTab === 'players' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <form
              onSubmit={handleCreatePlayer}
              className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4"
            >
              <h2 className="text-lg font-bold text-white">Criar Conta de Jogador</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
                    Username (único)
                  </label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="ex: carlos_silva"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
                    Nome de Apresentação
                  </label>
                  <input
                    type="text"
                    required
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="ex: Carlos Silva"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
                    Palavra-passe
                  </label>
                  <input
                    type="text"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 4 caracteres"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
                    Instituição / Turma
                  </label>
                  <input
                    type="text"
                    value={newInstitution}
                    onChange={(e) => setNewInstitution(e.target.value)}
                    placeholder="ex: ISPTEC / UAN"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition cursor-pointer"
              >
                + Registar Jogador
              </button>
            </form>

            {/* Importação CSV com Pré-visualização */}
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">
                Importar Jogadores por CSV (Pré-visualização)
              </h2>
              <p className="text-xs text-slate-400">
                Formato por linha:{' '}
                <code className="text-amber-300">username,display_name,password,institution</code>
              </p>
              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => handlePreviewCsv(e.target.value)}
                placeholder={
                  'username,display_name,password,institution\nana01,Ana Mateus,senha123,ISPTEC\npedro02,Pedro Costa,senha123,UAN'
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-xs font-mono text-white"
              />

              {csvPreview.length > 0 && (
                <div className="space-y-3">
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 p-3 bg-slate-950 text-xs space-y-1.5">
                    {csvPreview.map((r) => (
                      <div
                        key={r.lineNumber}
                        className={`flex justify-between ${
                          r.error ? 'text-rose-400' : 'text-emerald-300'
                        }`}
                      >
                        <span>
                          Linha {r.lineNumber}:{' '}
                          {r.data
                            ? `${r.data.username} (${r.data.displayName}) — ${r.data.institution ?? 'Sem inst.'}`
                            : r.raw}
                        </span>
                        <span>{r.error ? `✗ ${r.error}` : '✓ Válido'}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleImportCsvConfirm}
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition cursor-pointer"
                  >
                    Confirmar Importação ({csvPreview.filter((r) => r.data).length} jogadores
                    válidos)
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Lista de Jogadores */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
            <h2 className="text-lg font-bold text-white mb-4">
              Contas Registadas ({players.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                    <th className="py-2">Username</th>
                    <th className="py-2">Nome</th>
                    <th className="py-2">Instituição</th>
                    <th className="py-2 text-right">Acções</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {players.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2.5 font-mono text-emerald-400">@{p.username}</td>
                      <td className="py-2.5 font-medium text-white">{p.displayName}</td>
                      <td className="py-2.5 text-slate-400">{p.institution ?? '—'}</td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeletePlayer(p.id, p.displayName)}
                          className="text-xs text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SEPARADOR 3: CONFIGURAÇÃO DE ETAPAS, PEÇAS E PONTUAÇÃO */}
      {activeTab === 'config' && (
        <form
          onSubmit={handleSaveRoundConfig}
          className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-xl font-bold text-white">
                Configuração de Tempos, Pontuação e Tolerâncias
              </h2>
              <p className="text-xs text-slate-400">
                Estes parâmetros aplicam-se à ronda seleccionada (ou à próxima ronda a criar).
              </p>
            </div>
            {currentRound && (
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition cursor-pointer"
              >
                Guardar na Ronda #{currentRound.id}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Tempos */}
            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-amber-400 text-sm uppercase">
                Duração das Etapas (segundos)
              </h3>
              <div>
                <label className="block text-xs text-slate-400">Etapa 1 — Montagem 3D</label>
                <input
                  type="number"
                  value={configDraft.stage1DurationSec}
                  onChange={(e) =>
                    setConfigDraft({ ...configDraft, stage1DurationSec: Number(e.target.value) })
                  }
                  className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Etapa 2 — Identificação</label>
                <input
                  type="number"
                  value={configDraft.stage2DurationSec}
                  onChange={(e) =>
                    setConfigDraft({ ...configDraft, stage2DurationSec: Number(e.target.value) })
                  }
                  className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Etapa 3 — Placas-mãe</label>
                <input
                  type="number"
                  value={configDraft.stage3DurationSec}
                  onChange={(e) =>
                    setConfigDraft({ ...configDraft, stage3DurationSec: Number(e.target.value) })
                  }
                  className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            {/* Pontos Etapa 1 e 2 */}
            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-emerald-400 text-sm uppercase">
                Montagem &amp; Identificação
              </h3>
              <div>
                <label className="block text-xs text-slate-400">
                  Peça no slot certo (+pontos)
                </label>
                <input
                  type="number"
                  value={configDraft.correctPlacementPoints}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      correctPlacementPoints: Number(e.target.value),
                    })
                  }
                  className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">
                  Penalização slot errado (-pontos)
                </label>
                <input
                  type="number"
                  value={configDraft.wrongPlacementPenalty}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      wrongPlacementPenalty: Number(e.target.value),
                    })
                  }
                  className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">
                  Etiqueta certa 1.ª / 2.ª tentativa
                </label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <input
                    type="number"
                    value={configDraft.labelFirstTryPoints}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        labelFirstTryPoints: Number(e.target.value),
                      })
                    }
                    className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    value={configDraft.labelSecondTryPoints}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        labelSecondTryPoints: Number(e.target.value),
                      })
                    }
                    className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300 pt-2">
                <input
                  type="checkbox"
                  checked={configDraft.enforceAssemblyDependencies}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      enforceAssemblyDependencies: e.target.checked,
                    })
                  }
                />
                Exigir ordem real de dependências na montagem
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={configDraft.allowTypos}
                  onChange={(e) =>
                    setConfigDraft({ ...configDraft, allowTypos: e.target.checked })
                  }
                />
                Tolerância ortográfica Levenshtein activa
              </label>
            </div>

            {/* Pontos Etapa 3 e Catálogo */}
            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-sky-400 text-sm uppercase">
                Etapa 3 (Placas-mãe) &amp; Peças
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400">Fabricante</span>
                  <input
                    type="number"
                    value={configDraft.moboManufacturerPoints}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        moboManufacturerPoints: Number(e.target.value),
                      })
                    }
                    className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1"
                  />
                </div>
                <div>
                  <span className="text-slate-400">Formato</span>
                  <input
                    type="number"
                    value={configDraft.moboFormFactorPoints}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        moboFormFactorPoints: Number(e.target.value),
                      })
                    }
                    className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1"
                  />
                </div>
                <div>
                  <span className="text-slate-400">Socket</span>
                  <input
                    type="number"
                    value={configDraft.moboSocketPoints}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        moboSocketPoints: Number(e.target.value),
                      })
                    }
                    className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1"
                  />
                </div>
                <div>
                  <span className="text-slate-400">Chipset</span>
                  <input
                    type="number"
                    value={configDraft.moboChipsetPoints}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        moboChipsetPoints: Number(e.target.value),
                      })
                    }
                    className="w-full mt-1 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1"
                  />
                </div>
              </div>
              <div className="pt-2 text-xs text-slate-400">
                Peças no catálogo: <strong>{partsCatalog.length}</strong> • Placas-mãe:{' '}
                <strong>{motherboards.length}</strong>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* SEPARADOR 4: AUDITORIA */}
      {activeTab === 'audit' && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
          <h2 className="text-lg font-bold text-white mb-4">
            Registo Imutável de Auditoria (`audit_log`)
          </h2>
          {auditLogs.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma acção administrativa registada ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                    <th className="py-2">Data / Hora</th>
                    <th className="py-2">Acção</th>
                    <th className="py-2">Alvo</th>
                    <th className="py-2">Motivo</th>
                    <th className="py-2">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2.5 text-xs text-slate-400">
                        {new Date(log.createdAt).toLocaleTimeString('pt-PT')}
                      </td>
                      <td className="py-2.5 font-mono text-xs text-amber-400">{log.action}</td>
                      <td className="py-2.5 font-mono text-xs text-slate-300">{log.target}</td>
                      <td className="py-2.5 text-white">{log.reason}</td>
                      <td className="py-2.5 font-mono text-xs text-slate-400">
                        {JSON.stringify(log.payload)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

