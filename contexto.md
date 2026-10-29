# Hardgame — Contexto do Produto

> Documento de contexto do produto. O agente deve lê-lo **antes de qualquer tarefa** e tratá-lo como fonte de verdade sobre regras, dados e arquitectura. Se algo aqui estiver ambíguo ou em conflito com um pedido, o agente pergunta em vez de inventar.

---

## 1. O que é

**Hardgame** é um jogo 3D, no navegador, para **aprender e competir em hardware de computadores**. Tem dois escopos:

1. **Modo Torneio** — competição académica em tempo real, em rondas controladas por um administrador, com ranking projectado num telão para a plateia.
2. **Modo Treino** — o mesmo conteúdo, sem pressão de tempo nem ranking, com feedback educativo imediato (o que é cada peça, para que serve, porque o encaixe está errado).

Público: estudantes universitários e do ensino médio técnico. Idioma da interface: **português (variante de Angola/Portugal)**.

---

## 2. Actores e ecrãs

| Actor | Ecrã | Rota | Descrição |
|---|---|---|---|
| Jogador | Jogo | `/jogar` | Faz login, espera no lobby, joga as 3 etapas. |
| Administrador | Painel | `/admin` | Gere jogadores, rondas, etapas, pontuação; controla o fluxo ao vivo. |
| Plateia | Telão | `/telao` | Só leitura. Ranking em cima, feed de jogadas em baixo. Optimizado para projector 1920×1080. |
| Qualquer pessoa | Treino | `/treino` | Sem login obrigatório. Feedback educativo, sem ranking. |

---

## 3. Fluxo do torneio

1. O admin cria (ou importa por CSV) as **contas dos jogadores**.
2. O admin cria uma **Ronda**, escolhe os jogadores autorizados e configura as etapas (tempo, pontos, peças, placas-mãe).
3. Só jogadores **autorizados nessa ronda** conseguem entrar. Outros, mesmo com conta, recebem "Não estás inscrito nesta ronda".
4. Jogadores entram no **lobby**; o admin vê quem está ligado.
5. O admin carrega em **Iniciar** → todos começam a Etapa 1 ao mesmo tempo (o servidor define o instante de início e fim).
6. Ao fim do tempo de cada etapa (ou quando o admin avança), todos passam à etapa seguinte.
7. No fim, ranking final, exportação CSV e opção de encerrar a ronda.

O admin pode **pausar/retomar** (o temporizador congela para todos), **expulsar** um jogador, **ajustar pontos manualmente** (com motivo obrigatório, registado em auditoria) e **reiniciar** uma ronda.

Uma sessão activa por jogador: um novo login com a mesma conta desliga a sessão anterior.

---

## 4. As três etapas

### Etapa 1 — Montagem

- Cena 3D com uma **caixa de PC aberta** (painel lateral removido) e as **peças fora da caixa**, numa bancada.
- O jogador **arrasta cada peça com o rato** até ao **slot exacto** dentro da caixa.
- Se largar perto do slot certo (dentro do raio de encaixe), a peça **encaixa com animação**. Se for o slot errado ou fora do raio, a peça volta à bancada.
- **Dependências de montagem** (configuráveis, ligadas por defeito, porque ensinam a ordem real):
  - Placa-mãe antes de processador, memória RAM, SSD M.2 e placa gráfica.
  - Processador antes do cooler.
  - Fonte de alimentação independente.
- Tentar montar fora de ordem: a peça é rejeitada com dica ("Primeiro instala a placa-mãe"), sem penalização (configurável).
- A câmara pode rodar/zoom (OrbitControls), mas fica bloqueada enquanto se arrasta uma peça.

### Etapa 2 — Identificação

- A mesma caixa, agora montada, aparece com **setas numeradas** a apontar para as peças.
- Cada seta tem uma **caixa de texto** onde o jogador escreve o nome da peça.
- Acertou → pontos. Errou → sem pontos (ou penalização, configurável).
- Número de tentativas por seta: configurável (por defeito 2: 1.ª tentativa vale 100%, 2.ª vale 50%).
- A correcção aceita **sinónimos** e **pequenos erros ortográficos** (ver secção 6).

### Etapa 3 — Placas-mãe

- Aparece um **modelo 3D (ou foto de alta resolução, se não houver 3D) de uma placa-mãe real**, que o jogador pode rodar e ampliar.
- O jogador identifica campos, cada um com pontos próprios (pontuação parcial):
  - Fabricante (ex.: ASUS, Gigabyte, MSI, ASRock)
  - Formato (ATX, Micro-ATX, Mini-ITX)
  - Socket (ex.: AM4, AM5, LGA1700)
  - Chipset (ex.: B550, B650, Z790)
  - Modelo completo (opcional, pontuação extra)
- Cada campo pode ser **escrita livre** ou **escolha múltipla** (configurável por placa).
- Várias placas por ronda, em sequência.

---

## 5. Pontuação (valores por defeito, todos configuráveis por ronda)

| Evento | Pontos |
|---|---|
| Peça encaixada no slot certo | +100 |
| Peça largada num slot errado | −20 |
| Montagem completa antes do fim do tempo | +2 por segundo restante |
| Etiqueta certa na 1.ª tentativa | +50 |
| Etiqueta certa na 2.ª tentativa | +25 |
| Placa-mãe: fabricante | +30 |
| Placa-mãe: formato | +30 |
| Placa-mãe: socket | +40 |
| Placa-mãe: chipset | +50 |
| Placa-mãe: modelo completo | +50 |

Regras:
- A pontuação de uma etapa nunca fica abaixo de 0.
- **Desempate**: menor tempo total gasto; depois, maior número de acertos à 1.ª tentativa.
- **Toda a pontuação é calculada no servidor.** O cliente nunca envia pontos, só acções.

---

## 6. Correcção de respostas escritas

1. Normalizar: remover acentos, minúsculas, trocar pontuação por espaço, colapsar espaços.
2. Comparar com o nome oficial e a lista de **aliases** da peça.
3. Tolerância Levenshtein (configurável, ligada por defeito):
   - até 4 caracteres: 0 erros
   - 5 a 8 caracteres: 1 erro
   - mais de 8: 2 erros
4. Guardar sempre a resposta original do jogador (para auditoria e para o admin aceitar manualmente uma resposta válida que o sistema rejeitou).

---

## 7. Catálogo inicial de peças

| slug | Nome oficial | Aliases (exemplos) | Slot |
|---|---|---|---|
| `motherboard` | Placa-mãe | motherboard, board, placa mae, mobo | `slot-motherboard` |
| `cpu` | Processador | CPU, microprocessador, unidade central de processamento | `slot-cpu-socket` |
| `cpu-cooler` | Cooler do processador | cooler, dissipador, dissipador de calor, ventoinha do processador | `slot-cpu-cooler` |
| `ram` | Memória RAM | RAM, memória, pente de memória, DIMM, módulo de memória | `slot-ram-1`, `slot-ram-2` |
| `gpu` | Placa gráfica | placa de vídeo, GPU, placa de video, gráfica | `slot-pcie-x16` |
| `ssd-m2` | SSD M.2 | M.2, NVMe, SSD NVMe | `slot-m2` |
| `ssd-sata` | SSD SATA | SSD, disco SSD, disco sólido | `slot-drive-bay` |
| `hdd` | Disco rígido | HDD, disco duro, disco rígido | `slot-drive-bay-2` |
| `psu` | Fonte de alimentação | fonte, PSU, fonte de energia | `slot-psu` |
| `case-fan` | Ventoinha da caixa | ventoinha, fan, cooler da caixa | `slot-fan-front`, `slot-fan-rear` |

O catálogo vive na base de dados e é editável no painel de admin. Cada peça tem também uma **descrição educativa** (2–3 frases) usada no Modo Treino.

---

## 8. Telão (projector)

Resolução alvo: 1920×1080, fundo escuro, alto contraste, letra grande (mínimo 28px para texto corrido, 48px+ para números).

**Metade de cima (≈55%)**
- Nome da ronda, etapa actual, temporizador grande.
- Ranking animado (as linhas reordenam-se com animação quando a posição muda), com pontos, acertos e % de precisão.
- Destaques ("Ana subiu para 1.º!").

**Metade de baixo (≈45%)**
- Grelha de cartões, um por jogador: nome, etapa, barra de progresso (ex.: 6/10 peças), última acção, indicador ligado/desligado.
- Feed em tempo real das jogadas ("Carlos encaixou a placa gráfica ✓", "Marta errou a seta 3 ✗").

**Regra crítica**: o telão **nunca revela respostas** (não mostra o nome que corresponde a uma seta, nem o socket certo de uma placa). Mostra apenas *quem* acertou ou errou *o quê* (número da seta, nome genérico da etapa). Os jogadores podem conseguir ver o projector.

Acesso: `/telao?key=<DISPLAY_KEY>` (chave definida no `.env`), sem login.

---

## 9. Arquitectura

```
Navegadores (jogadores, admin, telão)
          │  HTTP (REST) + WebSocket (Socket.IO)
          ▼
Servidor Node.js (Express 5 + Socket.IO)  ← autoridade única: tempo, estado, pontos
          │
          ▼
SQLite (ficheiro local) via Drizzle ORM
```

- **Corre numa rede local (LAN)**. Um portátil serve tudo; os jogadores acedem por `http://<IP-do-servidor>:3000`. Não depende de internet durante o torneio.
- Em produção, o servidor serve também o frontend já compilado (uma só porta).
- Em desenvolvimento: Vite em `5173`, servidor em `3000`, com proxy.

### Estrutura do repositório (npm workspaces)

```
hardgame/
├── apps/
│   ├── web/            # React + Vite + R3F (jogo, admin, telão, treino)
│   └── server/         # Express + Socket.IO + Drizzle + SQLite
├── packages/
│   └── shared/         # tipos, esquemas Zod, eventos Socket, definição de slots, lógica de correcção
├── assets/
│   └── models/         # .glb originais (antes de optimizar) + CREDITOS.md
├── prompt.md
├── contexto.md
├── skills.md
└── package.json
```

---

## 10. Modelo de dados (SQLite)

- `users` — id, username (único), display_name, password_hash, role (`admin` | `player`), institution, created_at
- `rounds` — id, name, status (`draft` | `lobby` | `running` | `paused` | `finished`), current_stage (1–3), stage_started_at, stage_ends_at, paused_remaining_ms, config (JSON: tempos, pontos, peças, placas, tolerâncias), created_at
- `round_players` — round_id, user_id, allowed (bool), joined_at, connected (bool)
- `parts` — id, slug, name_pt, aliases (JSON), description_pt, model_path, category
- `motherboards` — id, manufacturer, model_name, form_factor, socket, chipset, model_path, image_path, aliases (JSON)
- `events` — id, round_id, user_id, stage, type, payload (JSON), correct (bool), points, created_at — **registo imutável de todas as acções**
- `scores` — round_id, user_id, stage1, stage2, stage3, total, time_spent_ms, first_try_hits, updated_at — cache derivada dos `events`
- `audit_log` — id, admin_id, action, target, reason, payload (JSON), created_at

O estado de cada jogador numa ronda (peças colocadas, setas respondidas) é **reconstruível a partir de `events`**, para permitir reconexão sem perder progresso.

---

## 11. Eventos em tempo real (Socket.IO)

Salas: `round:{id}`, `round:{id}:players`, `round:{id}:display`, `round:{id}:admin`, `user:{id}`.

**Cliente jogador → servidor**
- `player:join` `{ roundId }`
- `assembly:place` `{ partId, slotId | null, dropPosition: [x,y,z] }`
- `label:answer` `{ markerId, text }`
- `mobo:answer` `{ boardId, field, value }`

**Servidor → jogador**
- `round:state` (estado completo; enviado ao entrar e ao reconectar)
- `stage:started` `{ stage, endsAt, serverNow }`
- `stage:paused` / `stage:resumed`
- `assembly:result` `{ partId, slotId, ok, reason?, points }`
- `label:result` `{ markerId, ok, attemptsLeft, points }`
- `mobo:result` `{ boardId, field, ok, points }`
- `score:update` `{ total, byStage }`
- `session:replaced` (outra sessão entrou com a mesma conta)

**Servidor → telão**
- `display:snapshot` (estado completo)
- `display:feed` `{ playerName, text, ok, at }`
- `display:ranking` `[...]`
- `display:progress` `{ userId, stage, done, total }`

**Admin → servidor**
- `admin:round:start`, `admin:round:pause`, `admin:round:resume`, `admin:stage:next`, `admin:round:finish`, `admin:round:reset`
- `admin:player:allow`, `admin:player:kick`
- `admin:score:adjust` `{ userId, delta, reason }`

Todos os payloads são validados com **Zod** no servidor (esquemas em `packages/shared`).

---

## 12. Requisitos não funcionais

- **Instalação simples**: Node.js LTS + `npm install` + `npm run setup` + `npm start`. Sem Docker obrigatório, sem serviços externos.
- **Capacidade**: pelo menos 30 jogadores em simultâneo + 1 telão + 1 admin numa LAN comum.
- **Desempenho 3D**: 60 fps em portáteis com gráfica integrada; cada modelo `.glb` ≤ 3 MB após optimização; cena da Etapa 1 ≤ 15 MB no total.
- **Reconexão**: se o Wi-Fi falhar, o jogador recupera o estado ao voltar, sem perder pontos.
- **Tempo justo**: o fim de cada etapa é decidido pelo servidor; acções que cheguem depois de `stage_ends_at` são rejeitadas.
- **Segurança mínima**: respostas certas nunca são enviadas ao cliente do jogador antes de ele responder; passwords com hash; rotas de admin protegidas.
- **Sem modelos 3D ainda?** A aplicação tem de funcionar com **geometria provisória** (caixas coloridas com o nome da peça). Os `.glb` reais substituem-nas sem mudar código de lógica.

---

## 13. Direitos e conteúdo 3D

- Modelos de fontes com licença compatível (ex.: Sketchfab com CC-BY, Poly Pizza) e créditos em `assets/models/CREDITOS.md` e numa página "Créditos" no jogo.
- Para a Etapa 3, a opção mais segura e realista é **fotografar placas-mãe reais do laboratório** da instituição e usar as fotos (ou fotogrametria) em vez de imagens de terceiros.

