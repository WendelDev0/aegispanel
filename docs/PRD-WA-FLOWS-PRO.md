# PRD — Fluxos WhatsApp profissionais

**Produto:** AegisPanel (PaaS self-hosted)  
**Versão:** 2.0 · **Data:** 2026-09-05  
**Antecessores:** motor nativo v1 ([PR #19](https://github.com/WendelDev0/aegispanel/pull/19)) · self-update sem 502 ([PR #20](https://github.com/WendelDev0/aegispanel/pull/20))  
**Issue:** [#21](https://github.com/WendelDev0/aegispanel/issues/21)  
**ADR:** [0001 — estado do painel em JSON](./ADR-0001-panel-state-json.md) continua valendo. Redis e Postgres entram como plano de dados dos fluxos, **nunca** como estado do painel.

**Como usar:** `[x]` = feito · `[ ]` = falta. Marque no mesmo PR que fechar o item. Cada fase é um corte vertical: demonstrável sozinha, com teste, sem depender da seguinte.

---

## Onde paramos

Atualizado em **2026-09-05**.

| Fase | Estado | Depende de |
|------|--------|------------|
| 0 — Fundação (portas + log + validação) | ✅ Concluído | — |
| 1 — Instâncias Evolution | ✅ Concluído | 0 |
| 2 — Editor: telefone, simulador, templates | ✅ Concluído | 0 |
| 3 — Plano de dados (Redis + Postgres) | ✅ Concluído | 0 |
| 4 — Agente IA (OpenAI / OpenRouter) | ✅ Concluído | 0, 2, 3 |
| 5 — Blocos de negócio (captura, HTTP, SQL, handoff) | ✅ Concluído | 3 |

**Entregue no v1 (PR #19):** 7 blocos, sessão em `DATA_DIR/wa-sessions`, webhook autenticado por token, gatilho por evento do painel (deploy/backup/queda), publish registrando `MESSAGES_UPSERT` na Evolution, LOCAL_MODE bloqueando envio real, aba **Fluxos** com editor `@xyflow`.

---

## Glossário

| Termo | Significado neste documento |
|-------|----------------------------|
| **Instância** | Uma conexão WhatsApp na Evolution API (um número). O painel já fala com uma Evolution na VPS (`evo.selvamarketing.com`). |
| **Fluxo** | Grafo de blocos (nós + ligações) salvo em `waFlows[]` no `panel_db.json`. |
| **Binding** | Lista de instâncias em que um fluxo publicado recebe mensagens. |
| **Sessão** | Cursor da conversa de um telefone numa instância: fluxo, bloco atual, variáveis, `updatedAt`. |
| **Turno** | Uma mensagem do cliente + o que o fluxo respondeu. Unidade do log e da memória do agente. |
| **Plano de dados** | Redis (sessão viva) e Postgres (log, memória, tabelas do negócio). Opcionais; o painel sobe sem eles. |
| **Porta** | Interface que o motor usa para falar com o mundo (`EvolutionSender`, `FlowSessionStore`, `FlowLogStore`, `AiProvider`, `HttpGateway`). Testes injetam fakes. |
| **Simulador** | Execução do motor com portas falsas; nada sai da VPS. |
| **Handoff** | Bot pausa para aquele telefone e avisa um humano. |
| **Orçamento** | Teto de tokens de IA por fluxo por dia. |

---

## Atores

| Ator | Papel no painel | O que faz aqui |
|------|-----------------|----------------|
| **Admin** | `admin` | Configura Evolution, provedores de IA, Redis/Postgres. Publica fluxos. Vê log completo. |
| **Developer** | `developer` (tem `requireWrite`) | Cria e edita fluxos, simula. **Não** publica em instância nem mexe em chaves. |
| **Viewer** | `viewer` | Lê fluxos e log com telefone mascarado. Nunca vê segredo. |
| **Cliente** | Fora do painel | Manda mensagem no WhatsApp. Só existe como telefone + texto. |
| **Operador humano** | Fora do painel | Recebe o handoff no WhatsApp da loja. |

---

## Métricas de sucesso

Medir na VPS, não em teoria. Reportar em `GET /api/wa-flows/stats` e no card de cada fluxo.

| Métrica | Hoje | Meta |
|---------|------|------|
| Tempo do zero até o primeiro fluxo publicado e testado | sem medida; publish é cego | **< 10 min** usando template + simulador |
| Mensagens respondidas na instância errada | possível (1 instância global) | **0** — roteamento por binding |
| Fluxos publicados com grafo quebrado | possível | **0** — validador recusa |
| Inbound sem resposta por sessão presa | possível (sessão eterna) | **0** — TTL default 30 min |
| Custo de IA fora do orçamento | sem controle | **0** — orçamento por fluxo/dia, bloco degrada para fallback |
| Painel indisponível por queda de Redis/Postgres | n/a | **0** — degradação para disco |
| 502 durante release de fluxo | acontecia (PR #20 fechou) | **0** — self-update por helper |
| p95 do webhook → primeira resposta (sem IA) | sem medida | **< 1,5 s** |
| p95 do webhook → resposta com agente | sem medida | **< 8 s**, com “digitando…” (`presence: composing`) antes |

---

## Problem Statement

O painel já envia e recebe WhatsApp por um canvas de 7 blocos ligado a **uma** instância Evolution global. Isso serve para um “oi” e um alerta de deploy. Não serve para:

1. **Várias instâncias.** A loja, a clínica e o número de ops são instâncias distintas na mesma Evolution. Hoje um único `whatsappInstance` em Settings decide tudo; dois fluxos publicados disputam a mesma mensagem e o primeiro da lista ganha.
2. **Conversa de verdade.** A sessão guarda `nome`, `app`, `evento`. Não guarda o que o cliente respondeu, não expira, e a condição só lê o último texto.
3. **Dados do negócio.** Não há como ler um pedido, consultar estoque ou registrar um lead sem escrever um microserviço.
4. **Linguagem natural.** Sem agente de IA, tudo é menu numerado. Para suporte real isso não fecha.
5. **Confiança do operador.** Não há simulador, não há log por mensagem, publish não valida o grafo, o card só mostra `lastRunAt`. O editor tem três colunas de ferramenta e parece obra de engenheiro, não produto.

Consequência: o operador publica e reza; quando algo dá errado, a única evidência é o WhatsApp do cliente.

## Solution

Um **runtime de fluxos por instância**, ainda nativo no painel, com quatro movimentos:

1. **Instância é dado de primeira classe.** Settings guarda URL + chave da Evolution e lista as instâncias pela API. Cada fluxo faz binding a uma ou mais instâncias. O webhook roteia por `instance` do payload.
2. **Plano de dados opcional.** Redis para sessão viva com TTL; Postgres para log de turnos, memória do agente e tabelas que o fluxo precise consultar. Ambos apontam para bancos que o painel já provisiona (`aegis-db-*`) ou para uma URL. Se caírem, sessão volta para disco e log para buffer local — o painel não cai.
3. **Bloco Agente IA.** Provedor (OpenAI ou OpenRouter), modelo, prompt de sistema, orçamento de tokens. Chaves cifradas em Settings como as demais. LOCAL_MODE bloqueia chamada real. Memória = últimos N turnos da sessão, não o histórico eterno.
4. **Editor que vende confiança.** Coluna direita vira telefone: preview de bolha ao digitar e simulador com portas falsas. Publish valida o grafo. Empty state tem templates. Card mostra instância, última execução, tokens do dia, erros.

### Matriz de degradação

| Componente fora | Efeito | O que **não** acontece |
|-----------------|--------|------------------------|
| Redis | Sessões novas vão para `DATA_DIR/wa-sessions`; TTL vira varredura por arquivo | Painel, Caddy e apps seguem no ar |
| Postgres | Log vai para anel em `DATA_DIR/wa-logs`; bloco SQL segue handle `error` | Painel segue; fluxos sem SQL não notam |
| Evolution | Envio falha → log + handle `error`; inbound não chega | Painel não trava esperando |
| OpenAI / OpenRouter | Bloco agente segue handle `error` ou texto de fallback | Sem retry infinito, sem estourar orçamento |
| Domínio público do painel | Publish recusa (“configure `AEGIS_PUBLIC_BASE_URL`”) | Webhook nunca aponta para `localhost` |

---

## Princípios

- **Painel ≠ plano de dados.** Definição do fluxo, binding, flags e orçamento ficam no JSON (ADR-0001). Tráfego de conversa não entra no `panel_db.json`.
- **LOCAL_MODE continua rei.** Evolution, OpenAI, OpenRouter, HTTP de fluxo e Redis/Postgres não-locais não são tocados sem `AEGIS_ALLOW_OUTBOUND_ALERTS=true`.
- **Segredos nunca saem da API.** `toPublic()` + `hasEvolutionKey`, `hasOpenai`, `hasOpenrouter`, `hasPostgres`. Prefixo `aegis.v1:`.
- **Uma instância, um recorte.** Fluxo sem binding não recebe inbound. Sem fallback “global”.
- **Simular antes de publicar.** O motor recebe portas; a UI usa as falsas. O que aparece no telefone do editor é o que o motor faria.
- **Seguro por construção.** Teto de passos, teto de tokens, TTL de sessão, allowlist de hosts HTTP, SQL só parametrizada, modelo sanitizado, base URL de provedor fixa.
- **Comentários explicam a falha que motivou o código.** Convenção do repo.
- **Strings de UI e erro em português; código e identificadores em inglês.**

---

## Modelo de dados

### JSON (`panel_db.json`) — definição, não tráfego

`waFlows[]` ganha:

```
WaFlowRecord += {
  instanceNames: string[]        // binding; vazio = não recebe inbound
  priority: number               // maior vence dentro da mesma instância; default 0
  sessionTtlMinutes: number      // default 30; 5..1440
  aiBudgetTokensPerDay: number   // default 50_000; 0 = agente desligado
  dataBinding?: {
    postgresDatabaseId?: string  // id de aegis-db-* provisionado no painel
    redisDatabaseId?: string
  }
  stats?: { runsToday: number; aiTokensToday: number; errorsToday: number; day: string }
}
```

`settings` ganha (cifrado onde indicado):

```
evolution: { apiUrl: string; apiKey🔒: string }         // substitui os campos whatsapp* de alertConfig
aiProviders: { openaiKey🔒?: string; openrouterKey🔒?: string; allowedModels: string[] }
flowHttpAllowlist: string[]                             // hosts permitidos no bloco HTTP
flowDataUrls?: { redisUrl🔒?: string; postgresUrl🔒?: string }  // escape hatch, só se não usar aegis-db-*
```

Migração: `alertConfig.whatsapp*` existentes virão para `evolution` + um binding automático dos fluxos v1 à instância antiga. Fluxos v1 sem `instanceNames` ficam **despublicados** até o admin escolher instância — melhor mudo do que na linha errada.

### Redis — sessão viva

| Chave | Valor | TTL |
|-------|-------|-----|
| `wa:sess:{instance}:{phoneHash}` | JSON da sessão (fluxo, nó, `waiting`, vars, `lastText`) | `sessionTtlMinutes` do fluxo |
| `wa:mem:{instance}:{phoneHash}` | lista dos últimos N turnos (`role`, `text`, `at`) | igual à sessão |
| `wa:budget:{flowId}:{YYYY-MM-DD}` | tokens consumidos no dia | 48 h |
| `wa:handoff:{instance}:{phoneHash}` | `1` enquanto humano estiver no controle | `handoffMinutes` (default 120) |

Sem Redis: mesmos objetos em `DATA_DIR/wa-sessions/*.json` (já existe), com TTL aplicado na leitura e varredura periódica.

### Postgres — log, memória durável, negócio

```
wa_turns (
  id bigserial pk,
  at timestamptz,
  instance text,
  flow_id text,
  phone_hash text,          -- sha256(salt + phone)[:16], salt derivado de ENCRYPTION_KEY (igual analytics)
  phone_tail text,          -- últimos 4 dígitos, só para o operador reconhecer
  direction text,           -- in | out
  node_id text, node_type text,
  text_excerpt text,        -- 240 chars
  ai_model text, ai_tokens_in int, ai_tokens_out int,
  error text
)
wa_leads (phone_hash pk, instance, first_seen, last_seen, vars jsonb)   -- só se o fluxo usar `capture` com "salvar lead"
```

Retenção: `wa_turns` 90 dias (job diário no cron do painel, respeita LOCAL_MODE). Sem Postgres: anel em `DATA_DIR/wa-logs/{flowId}.jsonl` com teto de 5 MB por fluxo.

### PII

Telefone completo **nunca** vai para log nem para o provedor de IA. Só `phone_hash` + `phone_tail`. No prompt do agente o cliente é “o cliente”, não o número.

---

## Catálogo de blocos

| Bloco | Rótulo na UI (verbo) | Entradas | Saídas (handles) | Limites |
|-------|----------------------|----------|------------------|---------|
| `trigger_message` | Quando o cliente fala | `match: any\|contains\|regex`, `keyword` | `next` | regex validada no publish; 200 chars |
| `trigger_event` | Quando o painel avisa | `event`, `instance`, `recipient` | `next` | eventos: deploy_ok, deploy_fail, app_down, backup |
| `send_text` | Diga | `text` com `{{vars}}` | `next` | 2000 chars; envia `presence: composing` |
| `menu` | Pergunte com opções | `text`, `buttons[≤3]` | um handle por botão + `fallback` | fallback após 2 respostas inválidas |
| `wait_reply` | Espere a resposta | — | `next`, `timeout` | timeout = TTL da sessão |
| `capture` **(novo)** | Guarde a resposta | `varName`, `type: text\|number\|phone\|email`, `saveLead` | `next`, `invalid` | nome `[a-z_][a-z0-9_]{0,31}`; 3 tentativas |
| `condition` | Decida | `source: lastText\|var`, `varName`, `operator: contains\|equals\|regex\|gt\|lt\|exists`, `value` | `yes`, `no` | lê variável, não só último texto |
| `agent` **(novo)** | Deixe a IA responder | `provider`, `model`, `systemPrompt`, `maxTokens`, `memoryTurns`, `fallbackText` | `next`, `error` | prompt 4000 chars; `maxTokens` ≤ 1024; resposta cortada em 1500 chars |
| `http` **(novo)** | Chame minha API | `method: GET\|POST`, `url`, `headers`, `body` com vars, `saveAs` | `next`, `error` | host na allowlist; timeout 8 s; resposta 64 KB; JSON path simples para `saveAs` |
| `sql` **(novo)** | Consulte o banco | `query` com `$1..$n`, `params` (vars), `saveAs`, `mode: read\|write` | `next`, `empty`, `error` | só Postgres do binding; `read` = `SELECT`; `write` só tabelas `wa_*`/prefixo configurado; timeout 5 s; 50 linhas |
| `handoff` **(novo)** | Passe para um humano | `notifyNumber`, `message`, `resumeMinutes` | `next` | bot silencia para o telefone até expirar ou admin liberar |
| `delay` **(novo)** | Espere um pouco | `seconds` | `next` | ≤ 10 s; mantém `composing` |
| `end` | Encerre | — | — | limpa sessão |

Variáveis reservadas: `{{nome}}`, `{{telefone_final}}` (4 dígitos), `{{instancia}}`, `{{app}}`, `{{evento}}`, `{{ultima_mensagem}}`, `{{agora}}`.

---

## Roteamento do inbound

1. Webhook valida token (timing-safe) e faz parse do `MESSAGES_UPSERT`. Grupo, `fromMe` e mídia sem texto são ignorados.
2. `instance` do payload. Vazio → 200 sem ação e um log `warn` (não 4xx: a Evolution faria retry em loop).
3. Handoff ativo para `(instance, phone)` → registra turno `in`, **não responde**.
4. Sessão existente e `waiting` → continua o fluxo da sessão (menu/wait/capture). TTL vencido → descarta a sessão e segue para 5.
5. Candidatos = fluxos `published` com `instanceNames ∋ instance` e algum `trigger_message` que casa. Ordena por `priority` desc, depois `match` mais específico (`regex` > `contains` > `any`), depois `updatedAt` desc. Primeiro vence.
6. Nenhum candidato → sem resposta; log `unmatched` para a fase 2 mostrar “mensagens sem fluxo” no card.
7. Executa até um bloco que espera (`menu`, `wait_reply`, `capture`, `handoff`) ou `end`. Teto 40 passos por turno.

Eventos do painel (`handlePanelEvent`): mesmo motor, sem sessão, `instance` e `recipient` vêm do bloco `trigger_event`, não mais do global.

---

## Contratos de API

Todas sob `/api`, JWT, gates existentes. Mutação exige `requireWrite`; publish, chaves e binding a instância exigem `requireAdmin`.

| Método | Rota | Gate | Descrição |
|--------|------|------|-----------|
| GET | `/wa-flows` | auth | lista com `stats` e `instanceNames` |
| GET | `/wa-flows/:id` | auth | fluxo completo |
| POST | `/wa-flows` | write | cria (aceita `templateId`) |
| PUT | `/wa-flows/:id` | write | salva grafo e config |
| POST | `/wa-flows/:id/clone` | write | duplica despublicado |
| DELETE | `/wa-flows/:id` | write | apaga + limpa sessões |
| POST | `/wa-flows/:id/validate` | write | retorna lista de problemas sem publicar |
| POST | `/wa-flows/:id/publish` | **admin** | valida, registra webhook em cada instância do binding |
| POST | `/wa-flows/:id/simulate` | write | `{ messages: string[] }` → turnos gerados com portas falsas; nunca envia |
| GET | `/wa-flows/:id/logs?cursor&limit` | auth | turnos (viewer vê `phone_tail` só) |
| GET | `/wa-flows/stats` | auth | agregados por fluxo/instância/dia |
| POST | `/wa-flows/:id/handoff/release` | write | `{ phoneHash }` devolve o telefone ao bot |
| GET | `/wa-flows/templates` | auth | templates embutidos |
| POST | `/wa-flows/webhook?token=` | **público**, token | inbound da Evolution (já existe, listado no allowlist de auditoria) |
| GET | `/system/evolution/instances` | admin | proxy da Evolution: nome + estado de conexão, sem chave |
| POST | `/system/evolution/test` | admin | testa URL + chave |
| GET/PUT | `/system/settings` | admin | ganha `evolution`, `aiProviders`, `flowHttpAllowlist` com `hasX` no `toPublic` |
| POST | `/system/ai/test` | admin | `{ provider, model }` → uma chamada mínima; bloqueada em LOCAL_MODE |

Erros em português, 400 com `{ error }`; validação via Zod como as demais rotas.

---

## Segurança — modelo de ameaças

| Ameaça | Onde | Mitigação |
|--------|------|-----------|
| Webhook forjado | `/wa-flows/webhook` | token aleatório 24 B, comparação timing-safe, rotação em Settings, rate limit por IP |
| SSRF pelo bloco HTTP | `http` | allowlist de hosts em Settings; recusa IP privado/loopback/link-local e `host.docker.internal`; sem redirect automático; timeout |
| SSRF pelo agente | `agent` | base URL do provedor **fixa** no servidor (`api.openai.com`, `openrouter.ai`); o bloco só escolhe `model` |
| Injeção SQL | `sql` | somente `$n` + params; parser recusa `;`, comentários e statements fora do modo; `write` só em tabelas prefixadas; role de banco com grants mínimos recomendado |
| Prompt injection | `agent` | prompt de sistema do admin sempre primeiro; texto do cliente sempre como `user`; saída nunca é interpretada como comando; sem tools |
| Vazamento de chave | Settings, log | cifrada `aegis.v1:`, `toPublic` só `hasX`, `redactSecrets` no log e no stream do simulador |
| Bomba de custo | `agent` | `aiBudgetTokensPerDay` por fluxo; teto global `AEGIS_AI_MAX_TOKENS_PER_CALL`; sem retry em 429; fallback |
| Loop no grafo | motor | 40 passos por turno; `delay` ≤ 10 s; simulador expõe o loop |
| Enumeração de telefones | log | `phone_hash` + `phone_tail`; viewer nunca vê hash completo exportável |
| Publicar na linha errada | publish | binding explícito, `requireAdmin`, confirmação com nome da instância |
| Cópia local pagando gente | tudo | LOCAL_MODE bloqueia Evolution, IA, HTTP e stores não-locais |

---

## Fases

### Fase 0 — Fundação
 
Refatoração sem tela nova. Tudo depois depende disto.

- [x] Portas `FlowSessionStore`, `FlowLogStore`, `AiProvider`, `HttpGateway` com implementação em disco/fake; motor só fala com portas
- [x] `phoneHash` derivado de `ENCRYPTION_KEY` (mesmo padrão do analytics)
- [x] Log de turno em `DATA_DIR/wa-logs` com anel de 5 MB por fluxo
- [x] Validador de grafo puro (sem I/O): gatilho presente, todo caminho alcança `end`/`handoff`/bloco que espera, regex compila, handles obrigatórios ligados, sem nó órfão
- [x] TTL de sessão + prioridade no motor (default 30 min / 0)
- [x] `stats` diários no `WaFlowRecord`
- [x] Migração: `alertConfig.whatsapp*` → `settings.evolution`; fluxos v1 marcados `published: false` até ganharem binding

**Aceite:** suite atual verde; inbound com sessão vencida reinicia pelo gatilho; grafo sem `end` é recusado pelo validador; nenhum telefone completo em `wa-logs`.

### Fase 1 — Instâncias Evolution

- [x] Settings → **WhatsApp**: URL + chave; botão testar; lista de instâncias com estado (`open`, `close`, `connecting`)
- [x] `instanceNames` no fluxo; seletor no editor; card mostra instâncias
- [x] Publish registra webhook em cada instância do binding; unpublish só limpa a instância que nenhum outro fluxo publicado usa
- [x] Roteamento por `instance` conforme seção acima
- [x] `trigger_event` escolhe instância e destinatário
- [x] Alertas legados (Discord/Telegram/WhatsApp direto) seguem funcionando com o novo `settings.evolution`

**Aceite:** dois fluxos publicados em instâncias distintas; inbound na B só aciona B; unpublish de A não apaga o webhook de B.

### Fase 2 — Editor profissional

- [x] Coluna direita = telefone: bolha atualiza ao digitar no bloco selecionado
- [x] Aba **Simular**: campo de texto, histórico de bolhas, variáveis atuais, bloco corrente destacado no canvas; usa `POST /simulate`
- [x] Publicar chama `validate` e mostra problemas clicáveis (seleciona o nó)
- [x] Templates: “Cardápio com pedido”, “Suporte com handoff”, “Deploy falhou (ops)”, “Lead com captura”
- [x] Clonar fluxo; badge Atendimento vs Alerta; empty state com templates
- [x] Aviso de rascunho não salvo ao sair; atalho Ctrl+S
- [x] Paleta em verbos; blocos mostram preview da mensagem; cores só por token (`ok`/`warn`/`crit`/`primary`), zero hex solto
- [x] Card: instâncias, última execução, mensagens hoje, erros hoje, “sem fluxo” hoje

**Aceite:** criar fluxo do template, simular “oi → 1 → nome”, ver bolhas e variável `nome`, publicar com sucesso — sem WhatsApp real, em menos de 10 min.

### Fase 3 — Plano de dados

- [x] Settings → **Dados dos fluxos**: escolher `aegis-db-*` Redis/Postgres já provisionado, ou URL (cifrada); testar conexão
- [x] `FlowSessionStore` Redis com TTL nativo; fallback automático para disco com badge “Redis fora”
- [x] `FlowLogStore` Postgres (`wa_turns`); fallback anel em disco; job de retenção 90 dias
- [x] `wa_mem` (memória de turnos) no Redis; sem Redis, últimos N turnos no arquivo de sessão
- [x] Health no card e em `/wa-flows/stats`
- [x] LOCAL_MODE recusa Redis/Postgres cujo host não seja local

**Aceite:** derrubar o Redis com uma conversa no meio → próxima mensagem reinicia pelo gatilho (aceitável) e o painel responde 200 em `/api/health`; subir de novo → sessões novas voltam ao Redis.

### Fase 4 — Agente IA

- [x] Settings → **Provedores de IA**: chave OpenAI, chave OpenRouter, `allowedModels`; testar
- [x] `AiProvider` com duas implementações (OpenAI Chat Completions; OpenRouter, mesmo formato) e uma fake
- [x] Bloco `agent` no editor: provedor, modelo (select da allowlist + campo livre sanitizado), prompt, `maxTokens`, `memoryTurns`, `fallbackText`
- [x] Contexto = system + N turnos da memória + variáveis capturadas como bloco `Contexto:` no system; sem telefone
- [x] Orçamento diário por fluxo; 429/timeout → handle `error` sem retry
- [x] `presence: composing` enquanto aguarda; resposta cortada em 1500 chars e dividida em até 2 mensagens
- [x] Log grava modelo e tokens; card mostra tokens hoje / orçamento
- [x] Simulador usa a fake por padrão; toggle “usar modelo real” só para admin, fora de LOCAL_MODE

**Aceite:** fluxo “Suporte” com agente; simulado responde com stub; publicado responde em < 8 s p95; estourar orçamento leva ao `fallbackText`; chave nunca aparece em GET settings nem no log.

### Fase 5 — Blocos de negócio

- [x] `capture` com tipos e `invalid`; `saveLead` grava `wa_leads`
- [x] `condition` lendo variável com operadores numéricos
- [x] `http` com allowlist, timeout, `saveAs` por JSON path; LOCAL_MODE bloqueia
- [x] `sql` parametrizado, modos `read`/`write`, `empty`
- [x] `handoff` com aviso ao operador (via Evolution na instância de ops) e liberação pelo painel
- [x] `delay` ≤ 10 s
- [x] Template “Cardápio com pedido” usa `capture` + `sql` + `handoff`

**Aceite:** pedido “2 pizzas” → `capture` → `sql` grava em tabela `wa_orders` → `send_text` confirma → `handoff` avisa o número da loja. Texto do cliente contendo `'; DROP TABLE` chega como parâmetro, nunca como SQL.

---

## User Stories

**Instâncias**
1. Como admin, quero ver todas as instâncias da minha Evolution na tela, para não digitar nome de instância de cabeça.
2. Como admin, quero ligar cada fluxo a instâncias específicas, para o bot da loja nunca responder na linha da clínica.
3. Como admin, quero que o webhook roteie por instância, para dois fluxos publicados não roubarem mensagem um do outro.
4. Como admin, quero alertas de deploy numa instância e número escolhidos, para ops e clientes ficarem em linhas separadas.
5. Como admin, quero ver o estado de conexão da instância no card, para saber que o número caiu antes do cliente reclamar.

**Editor**
6. Como developer, quero clonar um fluxo, para forcar um menu que funciona sem redesenhar.
7. Como admin, quero templates de suporte, cardápio e deploy-falhou, para a página vazia não ser um card em branco.
8. Como developer, quero ver a bolha do WhatsApp enquanto digito o bloco, para saber o que o cliente vai ver.
9. Como developer, quero simular “oi” sem WhatsApp, para publicar com confiança.
10. Como admin, quero que publicar falhe num grafo quebrado, para uma instância viva nunca receber um fluxo morto.
11. Como developer, quero aviso de alteração não salva, para o botão voltar não apagar uma hora de canvas.
12. Como developer, quero a paleta em verbos, para não precisar saber o que é `wait_reply`.
13. Como viewer, quero ver quantas mensagens ficaram sem fluxo hoje, para saber que falta um gatilho.

**Dados**
14. Como admin, quero Redis para sessões vivas quando tiver um, para TTL e muitos chats simultâneos ficarem baratos.
15. Como admin, quero que o painel continue funcionando se o Redis cair, para uma queda de cache não derrubar o controle da VPS.
16. Como admin, quero Postgres para o log de turnos, para ver qual bloco rodou e por que um envio falhou.
17. Como admin, quero escolher um `aegis-db-*` que o painel já criou, para não colar URL de banco na mão.
18. Como admin, quero retenção automática de 90 dias, para o log não crescer sem fim.
19. Como admin, quero telefones truncados e com hash no log, para um export não virar lista telefônica.

**Agente**
20. Como admin, quero um bloco de IA com escolha de modelo, para o suporte falar natural sem árvore gigante de menu.
21. Como admin, quero escolher OpenAI ou OpenRouter por bloco, para trocar preço e modelo sem reescrever o fluxo.
22. Como admin, quero chaves cifradas e nunca devolvidas, para um token de viewer não roubar a chave do provedor.
23. Como admin, quero orçamento de tokens por fluxo por dia, para um loop não drenar a conta.
24. Como admin, quero que LOCAL_MODE bloqueie IA e WhatsApp reais, para um JSON de produção restaurado no notebook ficar mudo.
25. Como admin, quero que o agente leia as variáveis capturadas, para ele saber o número do pedido que o cliente digitou.
26. Como admin, quero uma saída de erro no bloco de IA, para um 429 do provedor não deixar o chat em silêncio.
27. Como admin, quero “digitando…” enquanto a IA pensa, para o cliente não mandar a mesma coisa três vezes.
28. Como admin, quero ver tokens gastos hoje no card, para saber qual bot está caro.

**Negócio**
29. Como admin, quero guardar a resposta numa variável, para blocos seguintes e SQL usarem.
30. Como admin, quero validar tipo (número, e-mail, telefone) na captura, para não gravar lixo.
31. Como admin, quero um bloco HTTP para a API da minha loja, para o fluxo criar um pedido.
32. Como admin, quero hosts HTTP em allowlist, para uma sessão admin roubada não varrer a internet a partir do root.
33. Como admin, quero um bloco SQL parametrizado, para ler um pedido sem microserviço.
34. Como admin, quero que o SQL nunca concatene texto do cliente, para a mensagem não virar query.
35. Como admin, quero handoff humano, para um cliente irritado sair do bot.
36. Como operador humano, quero receber no meu WhatsApp o aviso do handoff com os últimos turnos, para não pedir ao cliente repetir tudo.
37. Como admin, quero devolver o telefone ao bot pelo painel, para o handoff não ficar eterno.
38. Como admin, quero que sessões expirem, para um “aguardando menu” de ontem não engolir o “oi” de hoje.
39. Como admin, quero prioridade entre fluxos, para “horário” vencer “qualquer texto”.

**Operação**
40. Como viewer, quero inspecionar fluxos e log sem publicar nem ver segredo, para o suporte depurar com segurança.
41. Como admin, quero que o self-update continue reconstruindo sem 502, para cada fase sair pelo botão Atualizar.
42. Como admin, quero auditoria de quem publicou e quem trocou chave, para saber quem ligou o bot na linha errada.

---

## Implementation Decisions

- **JSON permanece a fonte das definições.** Grafo, binding, prioridade, TTL, orçamento e `stats` diários ficam em `waFlows[]`. Nada de mover grafo para Postgres.
- **Portas, não singletons novos de I/O.** O motor recebe `{ sender, sessions, logs, ai, http, sql }`. Produção injeta as reais; simulador e testes injetam fakes. `EvolutionSender` já existe e serve de molde.
- **Instância é dado do inbound.** `parseEvolutionUpsert` já expõe `instance`; a seleção de fluxo passa a ser `published ∧ instance ∈ instanceNames ∧ trigger casa`, ordenada por prioridade e especificidade.
- **Webhook continua um URL por painel, autenticado por token.** Registrado por instância no publish. A Evolution manda `instance` no payload; não é preciso um URL por instância.
- **Redis/Postgres são apontados, não nascem no compose do painel.** Preferência por `aegis-db-*` (o painel já provisiona, faz backup e bind em `127.0.0.1`). URL cifrada como escape hatch. Health check no boot é *best effort* e nunca impede a subida.
- **Bloco SQL:** cliente `pg` com `statement_timeout`; parser leve recusa `;`, `--`, `/*`, e statements fora do modo; `write` só em tabelas com prefixo configurado (default `wa_`). Recomendação na UI: criar role só-leitura para `read`.
- **Agente:** `provider ∈ {openai, openrouter}`; `model` sanitizado `^[A-Za-z0-9._:/-]{1,80}$` e, se `allowedModels` não vazio, precisa estar nela. Base URL fixa por provedor. Sem tools, sem streaming (WhatsApp não precisa), sem retry em 429.
- **Memória:** últimos `memoryTurns` (default 12, teto 30) da sessão, não o log inteiro. Variáveis entram como bloco `Contexto:` no system prompt.
- **Handoff:** flag em `wa:handoff` (ou arquivo) com TTL; inbound durante handoff só loga. Aviso ao operador usa a própria Evolution na instância de ops configurada no bloco.
- **Simulador:** mesma função do motor com `sender` que acumula bolhas, `sessions` em memória, `ai` stub (ou real sob toggle admin fora de LOCAL_MODE), `http`/`sql` que devolvem exemplo configurado no bloco.
- **UI:** tab `flows` existente. Settings ganha três seções (WhatsApp, Dados dos fluxos, Provedores de IA). Editor: paleta (verbos) · canvas · telefone com abas **Preview / Simular / Bloco**.
- **Cron e LOCAL_MODE:** retenção e varredura de TTL passam pelo scheduler do painel e respeitam o guard existente.
- **Caddy e domínios:** este PRD não altera hosts. Nada entra ou sai do Caddyfile por este trabalho.

Formas decididas (não são código de produção):

```
type FlowPorts = {
  sender: EvolutionSender
  sessions: FlowSessionStore     // get/set/clear/touch com TTL
  logs: FlowLogStore             // appendTurn, listTurns(cursor)
  ai: AiProvider                 // complete({ provider, model, messages, maxTokens }) → { text, tokensIn, tokensOut }
  http: HttpGateway              // request({ method, url, headers, body }) → { status, json|text }, allowlist dentro
  sql: SqlGateway | null         // query({ text, params, mode }) → rows, timeout dentro
}

type AgentNodeData = {
  provider: 'openai' | 'openrouter'
  model: string
  systemPrompt: string
  maxTokens: number
  memoryTurns: number
  fallbackText: string
}
```

---

## Testing Decisions

Testar **comportamento nas portas**. Nenhum teste sobe Redis, Postgres, Evolution ou provedor de IA.

Um teste bom: entra um inbound (ou um `simulate`), sai um array de bolhas, e a sessão/log ficam no fake. Não espionar `fetch` interno quando a porta já foi injetada.

| Costura | Casos | Prior art |
|---------|-------|-----------|
| `WaFlowEngine.handleInbound(body, ports)` | roteia por instância; prioridade; TTL vencido reinicia; handoff silencia; teto de 40 passos | `backend/test/wa-flow.test.ts` |
| `WaFlowEngine.handlePanelEvent` | instância e destinatário do bloco; não usa global | idem |
| Validador de grafo | sem gatilho; sem `end`; regex inválida; `agent` sem modelo; `menu` com handle solto; nó órfão | `cron-schedule.test.ts` (função pura) |
| `FlowSessionStore` (disco e fake) | TTL na leitura; `clearFlow`; arquivo > 16 KB ignorado | `wa-flow.test.ts` |
| `FlowLogStore` (disco) | anel de 5 MB; nunca telefone completo; viewer recebe só `phone_tail` | `deploy-log-store.test.ts` |
| `AiProvider` fake + orçamento | corta em `maxTokens`; 429 → `error`; orçamento estourado → `fallbackText`; LOCAL_MODE nunca chama rede | `local-mode.test.ts` |
| `HttpGateway` | host fora da allowlist recusa; IP privado recusa; timeout; LOCAL_MODE recusa | `webhook-auth.test.ts` |
| `SqlGateway` parser | `;` e comentários recusados; `write` fora do prefixo recusado; params obrigatórios | `safe-path.test.ts` (função pura) |
| Settings `toPublic` | `hasOpenai`, `hasEvolutionKey`, sem valores; `redactSecrets` no simulador | `node.test.ts` (`toPublic`) |
| Migração v1 → v2 | `alertConfig.whatsapp*` → `evolution`; fluxos v1 ficam despublicados | `storage.test.ts` (merge de `DEFAULT_DATA`) |
| Frontend | simulador renderiza bolhas do `simulate`; validador seleciona nó ao clicar no problema; paleta em verbos | `FlowEditor.test.tsx`, `PanelUpdateButton.test.tsx` |

Cobertura mínima para fechar cada fase: os casos da linha correspondente verdes em `npm run check`.

---

## Riscos

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Evolution muda o payload do `MESSAGES_UPSERT` | média | inbound para de casar | parser tolerante já existe; fixture real da VPS no teste; log `unmatched` visível |
| Botões nativos não chegam em alguns aparelhos | alta | menu vira texto | fallback numerado já existe; `menu` aceita número, id e rótulo |
| OpenRouter/OpenAI mudam contrato | baixa | agente falha | porta única; handle `error`; fallback |
| Operador aponta Postgres de produção da loja e o `write` estraga tabela | média | perda de dados | `write` só em prefixo `wa_`; UI recomenda role separada; default `read` |
| Custo de IA fora de controle por fluxo popular | média | conta alta | orçamento diário por fluxo, teto por chamada, card mostra gasto |
| Sessão em disco não escala com centenas de chats simultâneos | baixa (VPS) | I/O | Redis é a resposta; disco é fallback, não modo principal em produção grande |
| Escopo cresce para “clone do Typebot” | alta | nunca fecha | seção *Fora de escopo* e ordem de fases; uma fatia por PR |

---

## Perguntas abertas

1. O Redis/Postgres dos fluxos deve ser **um por painel** ou **um por fluxo** (via `dataBinding`)? Proposta: por painel com override por fluxo só para Postgres (negócios diferentes têm bancos diferentes).
2. Handoff avisa por WhatsApp na instância de ops, ou também por Discord/Telegram já configurados? Proposta: reutilizar `AlertService` — canal já existente, zero código novo de transporte.
3. Templates ficam embutidos no código ou em `docs/`/JSON versionado? Proposta: embutidos, tipados, com teste que cada um passa no validador.
4. `developer` pode simular com modelo real? Proposta: não — gasta chave do admin; só admin, fora de LOCAL_MODE.
5. Precisamos de `list` (lista nativa WhatsApp) além de `menu` de 3 botões? Proposta: depois — fallback numerado já cobre até 9 opções.

---

## Out of Scope

- Migrar `panel_db.json` para Postgres ou Redis (proibido pelo ADR-0001).
- Redis/Postgres como dependência de boot do `aegis-backend` ou como serviços do `docker-compose.yml` do painel.
- WhatsApp Cloud API oficial, templates Meta, janela de 24 h, verificação de número.
- Mídia (imagem, áudio, documento) em fluxos; transcrição de áudio.
- Agente com tools/function calling, browsing, RAG sobre documentos do cliente.
- Inbox omnichannel, atribuição de atendentes, SLA — o handoff só pausa e avisa.
- Fila de trabalho genérica (Bull/BullMQ), workers separados, Kubernetes.
- Fine-tune, avaliação automática de qualidade de resposta.
- Marketplace de fluxos, importar de Typebot/n8n.
- Trocar links/Caddy de lojas e apps existentes.

---

## Further Notes

- Deploy de cada fase: merge em `main` → botão **Atualizar** no topo do painel (helper irmão, sem 502). Não precisa de SSH.
- A Evolution da VPS (`aegis-app-evolution-api-v2-app`, `evo.selvamarketing.com`) é o único provedor WhatsApp; o painel não vira um segundo servidor WA.
- Primeira fatia recomendada: **Fase 0 + Fase 1 + simulador da Fase 2** num PR só se couber em ~1 dia; senão Fase 0 sozinha. Ligar o agente antes do simulador é o jeito mais caro de achar bug.
- Cada bloco novo entra com: schema Zod, sanitização no service, entrada no validador, preview no telefone, caso no simulador, linha na tabela de testes.
