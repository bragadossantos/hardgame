# skills.md — Competências e padrões técnicos do agente

> Cada skill diz **quando usar**, **como fazer** e **armadilhas a evitar**. Segue estes padrões em vez de improvisar. Regras de negócio estão em `contexto.md`.

---

## Skill 1 — Arrastar e encaixar peças em 3D (R3F)

**Quando**: Etapa 1 (montagem), no torneio e no treino.

**Como**
- Cada peça é um componente `<DraggablePart partId>` que envolve o modelo (`useGLTF`) ou a geometria provisória.
- `onPointerDown`: `e.stopPropagation()`, `e.target.setPointerCapture(e.pointerId)`, marca a peça como activa no Zustand e **desliga os OrbitControls** (`controls.enabled = false`).
- Durante o arrasto, projecta o raio do rato num **plano de arrasto** invisível (`THREE.Plane`) e move a peça para o ponto de intersecção, ligeiramente elevada.
- Destaca o slot mais próximo que aceita a peça (contorno ou cor), para dar feedback antes de largar.
- `onPointerUp`: calcula o slot candidato:
  ```ts
  const candidate = slots
    .filter(s => s.accepts.includes(partId) && !occupied.has(s.id))
    .map(s => ({ s, d: dropPos.distanceTo(s.position) }))
    .filter(({ s, d }) => d <= s.radius)
    .sort((a, b) => a.d - b.d)[0];
  ```
- Envia `assembly:place { partId, slotId: candidate?.s.id ?? null, dropPosition }` e **espera a resposta do servidor** antes de fixar a peça. Enquanto espera, mostra a peça "a encaixar".
- Resposta OK → anima para `slot.position`/`slot.rotation` (interpolação com `maath/easing` em `useFrame`). Resposta KO → anima de volta à posição na bancada.
- Volta a ligar os OrbitControls no fim.

**Armadilhas**
- Esquecer `stopPropagation` → o clique também roda a câmara.
- Não libertar o pointer capture → peça "colada" ao rato.
- Fixar a peça no cliente antes da resposta do servidor → o ecrã mostra algo que não contou para os pontos.
- Usar `setState` do React a cada frame do arrasto → quedas de fps. Mexe directamente no `ref` do objecto em `useFrame`; só o resultado final vai para o estado.

---

## Skill 2 — Definição de slots e dependências

**Quando**: sempre que se mexe na caixa, nas peças ou na lógica de encaixe.

**Como**: um único ficheiro em `packages/shared/src/slots.ts`, usado pelo cliente (destaque e snap) e pelo servidor (validação).
```ts
export interface SlotDef {
  id: string;                    // 'slot-cpu-socket'
  accepts: string[];             // ['cpu']
  position: [number, number, number];
  rotation: [number, number, number];
  radius: number;                // tolerância de encaixe em unidades da cena
  requires?: string[];           // slugs que têm de estar montados antes: ['motherboard']
}
```
- Função pura `validatePlacement(state, partId, slotId, config) → { ok, reason, points }` com motivos tipados: `WRONG_SLOT`, `OCCUPIED`, `MISSING_DEPENDENCY`, `OUT_OF_RANGE`, `STAGE_CLOSED`.
- As posições dos slots dentro da placa-mãe são **relativas à placa-mãe**; calcula a posição global depois de a placa estar montada.

**Armadilhas**: duplicar coordenadas no cliente e no servidor; o servidor confiar no `slotId` do cliente sem verificar o raio com `dropPosition`.

---

## Skill 3 — Pipeline de modelos 3D (.glb)

**Quando**: ao adicionar ou trocar modelos.

**Como**
- Originais em `assets/models/` (não servidos). Optimizados em `apps/web/public/models/`.
- Optimizar: `npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp --texture-size 1024`.
- Carregar com `useGLTF('/models/x.glb')` + `useGLTF.preload(...)`; ficheiros do descodificador Draco servidos localmente (sem CDN, porque a LAN pode não ter internet): copiar para `public/draco/` e usar `useGLTF.setDecoderPath('/draco/')`.
- Normalizar escala e origem: cada peça com origem no ponto de encaixe e escala real em centímetros convertida para a escala da cena (documentar a conversão em `slots.ts`).
- Envolver a cena em `<Suspense>` com ecrã de carregamento com progresso (`useProgress`).
- Registar autor, fonte e licença de cada modelo em `assets/models/CREDITOS.md`.

**Armadilhas**: modelos de 50 MB vindos do Sketchfab sem optimizar; descodificador Draco a vir de CDN; origens desalinhadas que fazem a peça encaixar "ao lado" do slot.

---

## Skill 4 — Setas e etiquetas em 3D (Etapa 2)

**Como**
- Para cada marcador: um ponto-alvo na peça (âncora definida no catálogo) e uma posição de etiqueta fora da caixa.
- Linha com `drei` `<Line>` do alvo à etiqueta + cone na ponta.
- Caixa de texto com `drei` `<Html>` (`occlude` desligado, `distanceFactor` ajustado) com o número da seta, `input` e botão "Confirmar". Enter também confirma.
- Estado de cada seta: `pending` → `correct` (verde, bloqueada) / `wrong` (vermelho, mostra tentativas restantes) / `exhausted`.
- Envia `label:answer { markerId, text }`; o servidor responde `label:result`.

**Armadilhas**: enviar o nome certo no payload inicial da etapa (o cliente só recebe `markerId`, âncora e posição); `<Html>` a capturar o scroll e a impedir o zoom da câmara.

---

## Skill 5 — Correcção de respostas escritas

**Como** (`packages/shared/src/answers.ts`, função pura, 100% testada):
```ts
export const normalize = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
   .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const maxTypos = (len: number) => (len <= 4 ? 0 : len <= 8 ? 1 : 2);

export function isCorrect(input: string, accepted: string[], allowTypos: boolean) {
  const a = normalize(input);
  if (!a) return false;
  return accepted.some(raw => {
    const b = normalize(raw);
    return a === b || (allowTypos && levenshtein(a, b) <= maxTypos(b.length));
  });
}
```
- Casos de teste obrigatórios: "Memória RAM" = "memoria ram" = "RAM"; "procesador" (1 erro) aceite; "CPU" ≠ "GPU" (siglas curtas: 0 erros); string vazia rejeitada; respostas muito longas cortadas a 80 caracteres.

**Armadilhas**: tolerância em siglas curtas (CPU/GPU/PSU confundem-se com 1 letra); comparar antes de normalizar.

---

## Skill 6 — Tempo real com Socket.IO (servidor autoritário)

**Como**
- Autenticação no handshake: `io(url, { auth: { token } })`; middleware `io.use` verifica o JWT e põe `socket.data.user`.
- Salas conforme `contexto.md` §11. O telão entra em `round:{id}:display` com `DISPLAY_KEY`.
- Cada handler: validar com Zod → verificar estado da ronda e etapa → aplicar lógica pura de `shared` → gravar em `events` e actualizar `scores` **numa transacção** → responder ao jogador → difundir para telão e admin.
- Usar callbacks de confirmação (`socket.emit('x', payload, ack)`) para acções do jogador.
- **Reconexão**: no `player:join`, reconstruir o estado do jogador a partir de `events` e enviar `round:state` completo.
- Uma sessão por utilizador: guardar `userId → socketId`; num novo login, emitir `session:replaced` e desligar o socket antigo.
- Limitar frequência (ex.: máx. 10 acções/segundo por jogador) para evitar spam.

**Armadilhas**: guardar estado só em memória (perde-se se o servidor reiniciar); difundir o estado completo da ronda a cada acção (manda só o delta; o snapshot completo só ao entrar).

---

## Skill 7 — Temporizador justo

**Como**
- O servidor guarda `stage_ends_at` (epoch ms). Ao iniciar, emite `{ endsAt, serverNow }`.
- O cliente calcula `offset = serverNow - Date.now()` (refinar com `timer:sync` a cada 30 s, compensando metade do RTT) e mostra `endsAt - (Date.now() + offset)`.
- Pausa: o servidor guarda `paused_remaining_ms`; ao retomar, `stage_ends_at = now + paused_remaining_ms`.
- Um `setTimeout` no servidor fecha a etapa; qualquer acção com `now > stage_ends_at` recebe `STAGE_CLOSED`.

**Armadilhas**: confiar no relógio do PC do jogador; contagem decrescente feita com `setInterval` a subtrair 1 (acumula desvio).

---

## Skill 8 — Telão (projector)

**Como**
- Layout fixo 16:9 com CSS grid; escalar com `transform: scale()` para caber em qualquer ecrã mantendo a proporção.
- Ranking com `motion` (`<motion.li layout>`) para reordenação animada; destaque visual de quem subiu.
- Feed limitado às últimas ~15 entradas; entradas novas entram por cima com animação curta.
- Throttle das actualizações do ranking (ex.: no máximo 2 por segundo) para não tremer com 30 jogadores.
- Tema escuro, verde = acerto, vermelho = erro, **sempre com ícone (✓/✗) além da cor**.
- Tecla `F` para ecrã inteiro (`document.documentElement.requestFullscreen()`).

**Armadilhas**: mostrar respostas no feed; texto pequeno (ilegível ao fundo da sala); animações pesadas que fazem o projector "arrastar".

---

## Skill 9 — Painel de admin

**Como**
- Rotas protegidas por papel `admin`. Layout simples com Tailwind (tabelas, formulários, botões grandes para os controlos ao vivo).
- Botões perigosos (reiniciar, terminar, expulsar) pedem confirmação.
- Ajuste de pontos: formulário com `delta` e `motivo` obrigatório → `audit_log`.
- Importação CSV: pré-visualização com erros linha a linha antes de gravar.
- Exportação CSV: ranking final com pontos por etapa, tempo total e acertos à 1.ª tentativa.
- Editor de configuração da ronda com valores por defeito de `contexto.md` §5, validado com o mesmo esquema Zod do servidor.

---

## Skill 10 — Base de dados (Drizzle + SQLite)

**Como**
- Esquema em `apps/server/src/db/schema.ts`; migrações com `drizzle-kit`; `npm run setup` aplica migrações e seed.
- Activar `PRAGMA journal_mode = WAL` e `foreign_keys = ON` no arranque.
- Campos JSON com `text({ mode: 'json' }).$type<T>()`.
- Escritas de acção (evento + pontos) sempre numa transacção.
- Backup: copiar o ficheiro `.db` no fim de cada ronda para `backups/` com data/hora.

**Armadilhas**: guardar respostas certas em campos que a API pública devolve; esquecer índices em `events(round_id, user_id)`.

---

## Skill 11 — Autenticação

**Como**
- `bcryptjs` com custo 10. JWT assinado com `jose` (HS256, expira em 8 h).
- Token guardado em `sessionStorage` (cada separador é uma sessão; adequado a computadores partilhados de laboratório).
- Botão "Sair" limpa o token e desliga o socket.

**Armadilhas**: usar `bcrypt` nativo (falha a compilar em algumas máquinas Windows); `JWT_SECRET` por defeito em produção (o servidor deve recusar arrancar).

---

## Skill 12 — Desempenho 3D

**Como**
- `<Canvas dpr={[1, 1.5]} gl={{ antialias: true }}>`; `frameloop="demand"` no Modo Treino e no telão (se tiver 3D).
- Iluminação simples: `<Environment preset>` local (ficheiro HDR em `public/`, não de CDN) + 1 luz direccional; sombras só se a máquina aguentar (`<AdaptiveDpr>`, `<PerformanceMonitor>`).
- Reutilizar geometrias e materiais; `useGLTF` com cache.
- Medir com `r3f-perf` em desenvolvimento.

**Armadilhas**: `Environment preset="city"` vai buscar o HDR à internet — falha offline.

---

## Skill 13 — Testes

**Como**
- Vitest para toda a lógica pura de `packages/shared`: encaixe, dependências, correcção de respostas, pontuação, desempate.
- Testes de integração do servidor com `socket.io-client` contra um servidor em memória (BD SQLite `:memory:`).
- Script `scripts/load-test.ts` que liga N jogadores falsos e faz jogadas aleatórias, para testar o telão e o servidor com 30+ ligações.

---

## Skill 14 — Distribuição numa LAN

**Como**
- `npm run build && npm start` num portátil ligado ao router/switch da sala (cabo de preferência).
- O servidor ouve em `0.0.0.0` e imprime os IPs locais.
- README explica: abrir a porta 3000 na firewall do Windows; ligar o projector ao portátil do telão em modo "Duplicar" ou "Expandir"; testar com 2–3 jogadores antes do evento.

---

## Skill 15 — Linguagem e tom da interface

- Português de Angola/Portugal: "ecrã", "rato", "palavra-passe", "placa gráfica", "ventoinha", "transferir", "iniciar sessão".
- Mensagens curtas e encorajadoras: "Boa! Placa gráfica no sítio certo." / "Quase — esse não é o slot da memória."
- No Modo Treino, cada peça tem uma explicação de 2–3 frases, linguagem acessível.

