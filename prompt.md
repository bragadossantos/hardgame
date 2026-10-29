# prompt.md — Instruções para o agente da IDE

## Papel

És um engenheiro full-stack sénior em TypeScript, com experiência em **React Three Fiber** e **aplicações em tempo real com Socket.IO**. Vais construir o **Hardgame**, um jogo 3D de montagem e identificação de hardware para um torneio académico, com um modo de treino educativo.

Antes de escrever código:
1. Lê `contexto.md` por inteiro — regras do jogo, pontuação, modelo de dados, eventos.
2. Lê `skills.md` — padrões técnicos obrigatórios e armadilhas a evitar.
3. Se um pedido contradisser estes ficheiros, ou faltar informação para decidir, **pergunta**. Não inventes regras de jogo.

---

## Stack (fixa — não trocar sem pedir autorização)

Escolhida para ser **fácil de instalar** (só Node.js + npm), funcionar **offline numa LAN** e usar uma única linguagem.

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js LTS (24.x recomendado; 22.x aceitável) |
| Monorepo | npm workspaces (sem pnpm/turbo/nx) |
| Frontend | React 19 + Vite + TypeScript |
| Estilo | Tailwind CSS v4 (`@tailwindcss/vite`) |
| 3D | three.js + `@react-three/fiber` v9 + `@react-three/drei` v10 |
| Estado no cliente | Zustand |
| Rotas | React Router |
| Animação de UI | `motion` (ex-framer-motion) — ranking animado do telão |
| Tempo real | Socket.IO 4 (servidor e cliente) |
| Servidor | Express 5 |
| Base de dados | SQLite (ficheiro local) com `better-sqlite3` + Drizzle ORM + drizzle-kit |
| Validação | Zod (esquemas partilhados em `packages/shared`) |
| Auth | JWT com `jose` + hashes com `bcryptjs` (puro JS, sem compilação nativa) |
| Testes | Vitest |
| Optimização 3D | `@gltf-transform/cli` (Draco + texturas WebP) |
| Dev | `concurrently` para correr web + server com um comando |

**Proibido sem autorização**: Docker obrigatório, Redis, PostgreSQL, Firebase/Supabase ou qualquer serviço que precise de internet durante o torneio, Next.js (não precisamos de SSR), bibliotecas com compilação nativa além de `better-sqlite3`.

---

## Scripts obrigatórios (`package.json` na raiz)

```
npm install          # instala tudo
npm run setup        # cria a BD, corre migrações e seed (admin + catálogo de peças)
npm run dev          # web (5173) + server (3000) em paralelo
npm run build        # compila shared, web e server
npm start            # produção: servidor serve o frontend compilado na porta 3000
npm test             # Vitest em todos os workspaces
npm run models:optimize   # optimiza todos os .glb de assets/models para apps/web/public/models
```

Ao arrancar, o servidor deve imprimir na consola os **endereços LAN** (ex.: `http://192.168.1.20:3000`) e os links do telão e do admin.

Ficheiro `.env.example` com: `PORT`, `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DISPLAY_KEY`, `DATABASE_PATH`.

---

## Plano de execução por fases

Trabalha **uma fase de cada vez**. No fim de cada fase: corre os testes, confirma os critérios de aceitação, faz commit com mensagem descritiva (Conventional Commits) e resume o que foi feito e o que falta. Não avances sem a fase anterior funcionar.

### Fase 0 — Esqueleto
- Monorepo com `apps/web`, `apps/server`, `packages/shared`.
- TypeScript em modo `strict` em todos os workspaces; `packages/shared` importável pelos dois apps.
- Tailwind v4 configurado; página inicial com links para `/jogar`, `/treino`, `/admin`, `/telao`.
- Socket.IO a ligar web ↔ server (evento `ping`/`pong` visível na consola).

**Aceitação**: `npm install && npm run dev` funciona numa máquina limpa; `npm run build && npm start` serve tudo na porta 3000.

### Fase 1 — Base de dados e autenticação
- Esquema Drizzle conforme `contexto.md` §10; migrações; seed com admin (do `.env`) e catálogo de peças de §7 com aliases e descrições.
- Login (`POST /api/auth/login`) para admin e jogadores; JWT; middleware de papel.
- Socket.IO autentica pelo token no handshake; rejeita sem token válido.
- Uma sessão activa por jogador (`session:replaced`).

**Aceitação**: testes de login válido/inválido, papel errado, sessão substituída.

### Fase 2 — Painel de admin
- CRUD de jogadores + importação CSV (`username,display_name,password,institution`).
- Criar ronda, escolher jogadores autorizados, configurar etapas (tempos, pontos, peças, placas, tolerância ortográfica, penalizações).
- Lobby ao vivo: quem está ligado.
- Controlos: iniciar, pausar, retomar, próxima etapa, terminar, reiniciar, expulsar, ajuste manual de pontos com motivo (vai para `audit_log`).
- Exportar resultados em CSV.

**Aceitação**: jogador não autorizado não entra na ronda; pausa congela o tempo para todos; ajuste sem motivo é rejeitado.

### Fase 3 — Etapa 1: Montagem 3D
- Cena com caixa aberta, bancada e peças. Começar com **geometria provisória** (caixas com o nome); `.glb` reais entram depois sem mudar a lógica.
- Definição de slots em `packages/shared/src/slots.ts` (posição, rotação, raio, peças aceites, dependências).
- Arrastar com o rato, encaixe com animação, devolução à bancada se falhar.
- Validação no servidor: slot aceita a peça? dependências cumpridas? dentro do tempo? Calcula pontos.
- HUD: tempo, pontos, peças colocadas, último resultado.

**Aceitação**: testes unitários da validação de encaixe e dependências; 60 fps com geometria provisória num portátil comum.

### Fase 4 — Etapa 2: Identificação
- Caixa montada com setas numeradas (`drei` `<Html>` + linha) e caixa de texto por seta.
- Correcção no servidor com normalização, aliases e tolerância Levenshtein (`contexto.md` §6) em `packages/shared/src/answers.ts`.
- Tentativas configuráveis; resposta certa **nunca** vai para o cliente antes de responder.

**Aceitação**: testes de correcção com acentos, maiúsculas, sinónimos e erros de 1–2 letras; testes de respostas que devem falhar.

### Fase 5 — Etapa 3: Placas-mãe
- Visualizador da placa (3D com OrbitControls ou foto com zoom/pan, conforme existir `model_path` ou `image_path`).
- Campos fabricante / formato / socket / chipset / modelo, cada um texto livre ou escolha múltipla.
- Pontuação parcial por campo; várias placas em sequência.
- CRUD de placas-mãe no admin, com upload de `.glb` ou imagem.

**Aceitação**: placa só com foto funciona; placa com `.glb` funciona; pontuação parcial correcta.

### Fase 6 — Telão
- Rota `/telao?key=...`, layout 1920×1080 conforme `contexto.md` §8.
- Ranking animado (motion `layout`), temporizador, grelha de progresso por jogador, feed de jogadas.
- **Nunca revelar respostas** no feed.
- Modo ecrã inteiro com uma tecla (`F`).

**Aceitação**: com 30 jogadores simulados, o telão mantém-se fluido e legível a 5 metros (letras grandes, contraste alto).

### Fase 7 — Modo Treino
- `/treino` sem login; as três etapas sem limite de tempo.
- Feedback educativo imediato: descrição da peça ao encaixar, explicação ao errar ("A memória RAM vai nos slots DIMM junto ao processador").
- Toda a lógica de correcção vem de `packages/shared` (o treino corre no cliente, sem servidor de ronda).

### Fase 8 — Robustez e entrega
- Reconexão: estado reconstruído a partir de `events`.
- Script de carga que simula N jogadores via `socket.io-client`.
- `README.md` em português com instalação passo a passo para quem nunca usou Node, incluindo como abrir a porta na firewall do Windows.
- Página "Créditos" com as licenças dos modelos 3D.

---

## Regras de trabalho

- **Servidor é a autoridade**: tempo, estado, pontos. O cliente envia intenções, nunca resultados.
- Toda a entrada do socket e da API é validada com Zod.
- Interface 100% em português (Angola/Portugal): "ecrã", "rato", "placa gráfica", "ventoinha", "palavra-passe".
- Componentes pequenos; lógica de jogo pura (sem React) em `packages/shared` para ser testável e reutilizável no Modo Treino.
- Sem `any`. Sem valores mágicos espalhados: pontuação e tempos vêm sempre da `config` da ronda.
- Antes de instalar uma dependência nova não listada acima, justifica e pede autorização.
- Se uma tarefa for grande, propõe primeiro um plano curto e espera confirmação.

---

## Primeira tarefa

Executa a **Fase 0**. No fim, mostra a árvore de pastas criada, os comandos para correr e confirma os critérios de aceitação.

