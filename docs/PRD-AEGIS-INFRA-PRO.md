# PRD — AegisPanel Infra Profissional

**Produto:** AegisPanel (PaaS self-hosted)  
**Versão:** 1.0 · **Data:** 2026-09-03  
**Antecessor:** [PRD-AEGIS-MATURITY.md](./PRD-AEGIS-MATURITY.md) (fases 1–5 e #5/#6 entregues)  
**Fora deste PRD:** Kubernetes, microserviços, Redis, Postgres para o estado do painel, CLI (#11), marketplace (#9), mobile (#10)

**Como usar:** `[x]` = feito · `[ ]` = falta. Marque aqui quando fechar um item, no mesmo PR.

## Onde paramos

Atualizado em **2026-09-04**. Estado local: `npm run check` verde — typecheck backend + frontend, **202 testes backend** (1 pulado no Windows: symlink), **19 testes frontend**.

| Fase | Estado | Falta |
|------|--------|-------|
| 1 — Acesso | ✅ código completo | 1.5: billing do GitHub Actions (ação humana) |
| 2 — Backup offsite | ✅ código completo | Ensaio de DR numa VPS descartável (ação humana) |
| 3 — Apps com teto | ✅ completa | — |
| 4 — Estado | ✅ completa | — |
| 5 — Cluster | ✅ completa | — |

**Todo o código do PRD está entregue.** O que resta é humano: destravar o billing do GitHub Actions (1.5) e ensaiar o DR numa VPS descartável (2.3).

> ⚠️ Fases 1 e 2 ainda **não estão no `main`**. Abrir o PR desta branch antes de seguir.

---

## Problem statement

O painel já é um PaaS de verdade: CI/CD, bancos, domínios/SSL, backups, cron, firewall, terminal, deploy em nó remoto, métricas por app. O desenho (rotas → services → JSON atômico) está certo para um processo com Docker socket.

O que separa “funciona na VPS” de “um cliente confia nisso” não é stack. São cinco costuras:

| # | Costura | Risco hoje |
|---|---------|------------|
| 1 | Acesso | Backend monta `/var/run/docker.sock` = root no host. Login senha-única, JWT 7 dias, revoke só por usuário (`tokenVersion`), sem trilha de quem fez o quê. |
| 2 | Backup | `DATA_DIR/backups` mora no **mesmo disco** do painel. Disco morre → apps, `panel_db.json` e dumps somem juntos. Restore nunca foi ensaiado fora da VPS. |
| 3 | Limite | Apps mostram CPU/RAM (#6) mas não têm teto. Sem `Memory`/`NanoCpus`, sem healthcheck. Um Vite descontrolado derruba a VPS inteira. |
| 4 | Estado | `panel_db.json` é a escolha certa, mas um save ruim não tem “desfazer”. Só existe a quarentena de JSON corrompido. |
| 5 | Cluster | Git remoto já builda no nó, mas o clone fica no painel, o Caddy só no host do painel, e dois deploys no mesmo nó brigam pelo Docker. |

Ordem de valor: **1 → 2 → 3 → 4 → 5**. As duas primeiras são o que um cliente pergunta antes de pagar: *quem entra* e *o que sobrevive*.

---

## Princípios

- **Hardening sobre features.** Nenhuma fase adiciona tela nova sem fechar um risco.
- **Cada fase é um corte vertical**: demonstrável sozinha, com teste, sem depender da seguinte.
- **Seguro por construção**, não por config: default fechado, escape hatch explícito por env.
- **Comentários explicam a falha que motivou o código** (convenção do repo).
- **`LOCAL_MODE` continua rei**: qualquer efeito colateral novo (upload S3, restore automático, kill de container) checa o guard.

---

## Fase 1 — Acesso: quem entra e o que ficou registrado

**Issue:** [#7](https://github.com/WendelDev0/aegispanel/issues/7)

### Estado atual

- [x] JWT assinado, claims validadas contra o registro atual do usuário (`middleware/auth.ts`)
- [x] `tokenVersion` — trocar senha / role revoga **todas** as sessões do usuário
- [x] Rate limit de login por IP (5 / 15 min)
- [x] Painel nasce em `127.0.0.1:3000`; ufw só abre 22/80/443 (`install.sh`)
- [x] Terminal do host admin-only; container shell nega `viewer`

### 1.1 — 2FA TOTP

- [x] `users[].totpSecret` cifrado (`utils/crypto.ts`, prefixo `aegis.v1:`), nunca em `toPublic()`
- [x] Fluxo: `POST /api/auth/2fa/setup` (QR + segredo) → `POST /api/auth/2fa/confirm` (código válido) → ativo
- [x] Login em duas etapas: senha OK → token curto `pending2fa` (5 min, sem acesso a rotas) → `POST /api/auth/2fa/verify` → JWT completo
- [x] Códigos de recuperação (10, hash bcrypt, uso único)
- [x] **Obrigatório para `admin`** quando `AEGIS_REQUIRE_2FA_ADMIN=true` (default `true` em produção)
- [x] Desativar 2FA exige senha + código atual
- [x] Tela em Settings → Segurança; banner no dashboard enquanto admin estiver sem 2FA

### 1.2 — Sessões revogáveis por dispositivo

- [x] Coleção `sessions[]` em `DEFAULT_DATA` + `DatabaseSchema`: `id, userId, createdAt, lastSeenAt, ip, userAgent, revokedAt?`
- [x] JWT carrega `sid`; `authMiddleware` rejeita `sid` ausente/revogado (além do `tokenVersion` já existente)
- [x] `GET /api/auth/sessions` (próprias) · `DELETE /api/auth/sessions/:id` · admin pode listar/revogar de qualquer usuário
- [x] Expiração: JWT 24h + refresh silencioso pelo `sid` (substitui os 7 dias fixos)
- [x] Logout revoga o `sid`, não só limpa o `localStorage`
- [x] Socket.IO: handshake valida `sid`; sessão revogada derruba o socket em até 30s
- [x] Prune de sessões expiradas junto com `pruneDeployments()`

### 1.3 — Audit log imutável

Hoje `activities[]` é feed de UI (“deploy feito”), não auditoria: não tem ator, IP, nem garantia de não-edição.

- [x] `AuditStore` em `DATA_DIR/audit/YYYY-MM.jsonl` — append-only, uma linha por evento, fora do `panel_db.json`
- [x] Evento: `ts, actor{id,username,role}, sid, ip, action, target{type,id,name}, outcome, meta`
- [x] Middleware em toda rota `requireWrite`/`requireAdmin`: grava **sucesso e falha** (403 também é evento)
- [x] Eventos fora de HTTP: login OK/falha, 2FA falha, sessão revogada, terminal aberto, self-update, restore, import de estado, webhook aceito/rejeitado
- [x] `meta` passa por `redactSecrets()` — token, senha, env values nunca entram
- [x] `GET /api/system/audit?from&to&actor&action` (admin) + tela em Settings → Auditoria com filtro e export CSV
- [x] Retenção: 12 meses; arquivos antigos entram no backup do painel antes de serem removidos
- [x] Teste: rota mutante sem evento de auditoria **falha o teste** (varredura das rotas registradas)

### 1.4 — Painel só por HTTPS

Hoje o acesso é `ssh -L 3000:127.0.0.1:3000`. Funciona, mas cliente quer URL.

- [x] `settings.panelDomain` opcional; `CaddyService` gera site `panelDomain → aegis-frontend:80` com TLS automático
- [x] Quando `panelDomain` está definido: `PANEL_BIND` continua `127.0.0.1` (Caddy fala pela rede interna), 3000 **nunca** vai para `0.0.0.0`
- [x] Headers no site do painel: HSTS, `X-Frame-Options: DENY`, CSP mínima, sem `Server`
- [x] `install.sh` pergunta o domínio do painel; sem domínio, mantém o túnel e avisa
- [x] `CORS_ORIGINS` passa a ser derivado de `panelDomain` quando vazio
- [x] Alerta no dashboard se o painel responder em HTTP puro fora de `LOCAL_MODE`

### 1.5 — CI de volta ao verde

- [ ] Desbloquear billing do GitHub Actions (ação humana — Settings → Billing)
- [ ] Re-rodar workflow do `main`; `npm run check` verde no CI, não só local
- [ ] Branch protection em `main`: PR obrigatório + CI verde + 1 review (mesmo que seja o próprio autor via conta secundária)
- [x] CI grep já falha com default literal de `JWT_SECRET`/`ENCRYPTION_KEY`; adicionar `TOTP_*` e chaves S3 à mesma verificação

### Critérios de aceite — Fase 1

- [x] Admin sem 2FA não consegue abrir o terminal do host (403 + evento de auditoria)
- [x] Revogar uma sessão no painel derruba a aba correspondente em ≤ 30s
- [x] Toda rota `requireWrite` tem evento no audit (teste automatizado)
- [x] Painel acessível em `https://painel.dominio` sem porta, `curl :3000` de fora → connection refused
- [ ] CI verde no `main`

---

## Fase 2 — Backup que sobrevive à VPS

**Issue:** [#8](https://github.com/WendelDev0/aegispanel/issues/8)

### Estado atual

- [x] Dump por banco com validação de header/magic no restore
- [x] Backup do estado do painel (`backup_panel_state_*.json`) + restore
- [x] Cron diário inclui o estado do painel
- [x] **Tudo em `DATA_DIR/backups`, mesmo disco do painel** — cópia offsite cifrada em S3-compatível

### 2.1 — Destino offsite S3-compatível

- [x] `settings.backupTarget`: `{ provider: 's3', endpoint, region, bucket, prefix, accessKeyId, secretAccessKey(cifrado) }` — cobre AWS S3, Cloudflare R2, Backblaze B2, MinIO
- [x] SDK: `@aws-sdk/client-s3` (única dependência nova); upload multipart para dumps > 100 MB
- [x] Cada backup: gravado local → **enviado** → só então `status: 'completed'`; falha de upload = `completed_local_only` com alerta
- [x] `sha256` calculado antes do upload e verificado no `HEAD` do objeto
- [x] Criptografia em repouso: dumps cifrados com `ENCRYPTION_KEY` antes de sair (AES-256-GCM, `utils/crypto.ts`) — o bucket não vê dado em claro
- [x] Retenção no bucket: diário 14 · semanal 8 · mensal 12 (lifecycle via painel, não regra do provedor)
- [x] `POST /api/backups/target/test` — escreve e lê um objeto de 1 KB, retorna latência
- [x] `LOCAL_MODE` bloqueia upload (mesmo guard de `alert.service.ts`); escape `AEGIS_ALLOW_OFFSITE_BACKUP=true`
- [x] Tela em Backups → Destino: provedor, teste, último upload, tamanho total no bucket

### 2.2 — Restore a partir do bucket

- [x] `GET /api/backups/remote` lista objetos do bucket (não só o índice local)
- [x] Restore de dump remoto: download → checksum → decrypt → validação de magic (já existe) → restore
- [x] **Disaster recovery**: `install.sh --restore-from s3://bucket/prefix` em VPS nova → baixa `panel_state` mais recente → recria bancos → restaura dumps → sincroniza Caddy
- [x] Script `backend/src/scripts/dr-restore.ts` idempotente, com `--dry-run`
- [x] Documento `docs/DISASTER-RECOVERY.md`: passo a passo em 1 página, testado

### 2.3 — Ensaio mensal “no escuro”

Backup que nunca foi restaurado é hipótese, não backup.

- [x] Cron `restore-drill` (mensal, admin ativa): sobe container efêmero do mesmo engine, restaura o dump mais recente, roda `SELECT 1` / `PING`, derruba o container
- [x] Resultado gravado em `backups[].drill: { at, ok, durationMs, error? }` + evento de auditoria + alerta em falha
- [x] Dashboard: “Último ensaio de restore: há 12 dias · OK” — vermelho se > 45 dias ou falhou
- [x] Drill do estado do painel: parse + validação de schema do `panel_state` mais recente (sem sobrescrever o atual)
- [ ] Runbook trimestral (humano): DR completo numa VPS descartável usando `install.sh --restore-from`

### Critérios de aceite — Fase 2

- [x] Apagar `DATA_DIR/backups` inteiro e restaurar um banco a partir do bucket funciona
- [ ] `install.sh --restore-from` em VPS limpa reconstrói painel + bancos em < 30 min
- [x] Ensaio mensal roda sozinho e aparece no dashboard
- [x] Nenhum dump chega ao bucket em claro (verificado lendo o objeto)

---

## Fase 3 — Apps com teto, não só métrica

### Estado atual

- [x] CPU/RAM por app na UI, poll 8s (#6)
- [x] Retenção de logs de runtime com teto 80 MB (#6)
- [x] `RestartPolicy: unless-stopped`
- [x] `Memory`, `MemorySwap`, `NanoCpus`, `PidsLimit` aplicados (3.1); saúde e rollback automático (3.2)

### 3.1 — Limites por app ✅

- [x] `AppRecord.limits?: { memoryMb, cpus, pidsLimit }` — default global em `settings.defaultAppLimits` (`512 MB · 1.0 cpu · 256 pids`)
- [x] `docker.service.createAndStartContainer` aplica `HostConfig.Memory`, `MemorySwap = Memory` (sem swap), `NanoCpus`, `PidsLimit`
- [x] Vale para local e nó remoto (mesmo `HostConfig`) — aplicado em `buildCreateOptions`, o único ponto onde um contêiner gerenciado é descrito
- [x] `oom-kill` detectado via `inspect().State.OOMKilled` → alerta “app matou por memória” + evento de auditoria + sugestão de subir o teto (`services/watchdog.service.ts`, varredura de 30s)
- [x] UI em EditAppModal → “Recursos”: slider RAM/CPU com o consumo atual ao lado (dado do #6)
- [x] Bancos: mesmo mecanismo, default maior (`1 GB · 2 cpus`)
- [x] Soma dos limites > RAM do host → aviso (não bloqueio) na criação (`AppService.overcommitStatus()`)

Notas de implementação:

- O limite resolvido **nunca é gravado** no registro: `limits` só existe quando o usuário definiu um. Assim, subir o padrão global passa a valer para os apps que nunca escolheram teto, no próximo deploy.
- Trocar o teto entra em `needsRedeploy`: `Memory`/`NanoCpus`/`PidsLimit` são fixados na criação do contêiner.
- O watchdog roda **fora** do loop de métricas de 2s, que pula quando ninguém tem o painel aberto — exatamente quando um app sem supervisão está morrendo.
- Dedup por `RestartCount`: `State.OOMKilled` continua `true` no registro de saída de um contêiner já reiniciado, então alertar pela flag sozinha repetiria a mesma morte para sempre.

### 3.2 — Healthcheck e restart inteligente ✅

- [x] `AppRecord.healthcheck?: { path, intervalSec, timeoutSec, retries }` — default `GET /` em `internalPort`, 30s/5s/3
- [x] Aplicado em `Healthcheck` do contêiner (`CMD-SHELL wget … || curl …`) — **opt-in, não default** (ver desvio abaixo)
- [x] Status do card usa a saúde observada (`healthy | unhealthy | starting | unknown`), não só `running`
- [x] Deploy: novo container só vira “sucesso” após responder (timeout 120s → falha + rollback automático para a imagem anterior)
- [x] Caddy só roteia app que não está `unhealthy`; `unhealthy` → 503 com `Retry-After` do painel em vez de 502 cru
- [x] Watchdog: sem responder por > 3 ciclos → restart (máx. 3/h, depois alerta e para)

**Desvio consciente do PRD — a sonda principal é do painel, não do contêiner.**

O PRD pedia `HostConfig.Healthcheck` com `wget` como sinal padrão. Implementar assim seria ativamente perigoso: essa sonda roda **dentro** do contêiner e precisa de `wget` ou `curl` lá — uma imagem distroless, scratch ou slim não tem nenhum dos dois. Com rollback automático ligado nesse sinal, toda imagem enxuta seria marcada como doente e teria **deploys que funcionaram revertidos em loop**.

A sonda principal virou `services/health.service.ts`: o painel consulta o app pela rede, exatamente no mesmo endereço que o Caddy usa (nome do contêiner na rede compartilhada localmente; `hostIp:porta` em nó remoto). Funciona com qualquer imagem. A sonda do Docker continua disponível como **opt-in por app**, para quem quer o status também no `docker ps`.

Notas de implementação:

- **Qualquer resposta HTTP conta como no ar — inclusive 404 e 500.** A pergunta é “o processo subiu”, não “a aplicação está correta”. Uma API cujo `/` responde 404 é saudável e isso é comuníssimo; tratar como falha reverteria deploy bom. E 500 é bug de aplicação para o painel mostrar, não para mascarar reiniciando o contêiner por baixo.
- `unknown` **roteia normalmente**. É o estado de todo app logo após o painel reiniciar, antes da primeira sondagem — tirar todos os sites do ar a cada restart do painel seria muito pior que proxiar brevemente para algo que se revela fora.
- O cap de reinícios importa mais que o gatilho: app que quebra no boot fica doente de novo segundos após cada restart, então watchdog sem teto transforma um deploy ruim em loop infinito que queima CPU e inunda o canal de alertas. Depois do teto ele alerta uma vez e deixa quieto — que é o estado diagnosticável.
- O rollback automático sobe **apenas o deploy bem-sucedido mais recente**. Ir mais para trás colocaria uma versão bem antiga em produção sem ninguém pedir.
- O `path` do healthcheck é interpolado num `CMD-SHELL`, então valor com aspas ou `$( )` seria código vivo dentro do contêiner a cada intervalo. É **recusado**, não escapado (Zod + `normalizeHealthcheck`).

### 3.3 — Teto de disco para builds ✅

`DATA_DIR/builds/<appId>` cresce a cada deploy (clone + `node_modules`). Logs já têm teto; builds não.

- [x] `settings.buildsDiskCapMb` (default 5 GB) — após cada deploy, remove `node_modules`/`.next`/`dist` de clones antigos até caber (`utils/disk-usage.ts` + `services/builds-cleanup.service.ts`)
- [ ] ~~`git clone --depth 1 --single-branch` (já é o padrão em `cicd.service.ts`)~~ — **este item estava marcado errado.** O `--depth 1` existe só em `inspectRepository` (clone descartável de inspeção). O clone de deploy usa apenas `--single-branch`. E **não deve** virar shallow: o deploy fixado em commit e o rollback fazem `git cat-file -e <hash>` / `git reset --hard <hash>` em commits antigos, que um clone raso não tem. Se quisermos economizar aí, é `--depth` grande + `fetch` sob demanda, não `--depth 1`. Fica como decisão em aberto.
- [x] Imagens `aegis-app-*` órfãs (sem deployment apontando) → `prune` semanal, preserva as 3 últimas por app para rollback
- [x] `GET /api/system/storage-health` passa a reportar `builds`, `deploy-logs`, `app-logs`, `backups`, `audit` separados + `hostDisk`
- [x] Alerta quando disco do host < 10% livre (estendido no monitor de `panel_db.json`)

Notas de implementação:

- A decisão de despejo é **pura** (`planArtifactEviction`), então as regras que importam são testáveis sem filesystem: nunca despejar o app que está fazendo deploy agora (apagaria o `node_modules` embaixo do build que disparou a limpeza) e despejar o **menos recentemente** buildado primeiro (senão o próximo deploy é sempre o lento).
- O working copy em si nunca é apagado — só `node_modules`, `.next`, `dist` e afins. A árvore Git é o que permite o rollback fazer checkout de um commit antigo.
- `directorySizeBytes` não segue symlink: um repositório clonado pode trazer um link para `/`, e segui-lo percorreria o host inteiro. Mesma classe de problema do `resolveSafePath`, aqui como laço de contagem em vez de bypass de acesso.
- O prune semanal roda pelo timer de saúde, **não** por cron: cron `shell` é admin-gated e vem desligado, então um operador que nunca ligasse acumularia uma imagem por deploy para sempre.
- `removeImage` usa `force: false`: uma imagem que ainda tem contêiner rodando deve permanecer, e o daemon já recusa. Forçar mataria o alvo de rollback que o operador está prestes a precisar.
- Disco cheio não degrada o painel, **para** o painel: o save atômico grava um temp antes do rename, então sem espaço ele não consegue nem registrar que acabou o espaço.

### Critérios de aceite — Fase 3

- [ ] App com `memoryMb: 128` rodando `stress` é morto pelo kernel; painel mostra “OOM” e o host segue estável — **código pronto (3.1), falta validar numa VPS de verdade**
- [x] Deploy de imagem que não sobe faz rollback sozinho em ≤ 2 min (janela de prontidão de 120s)
- [x] `DATA_DIR/builds` nunca passa do teto após 20 deploys seguidos — teto aplicado após cada deploy, com teste da regra de despejo (`test/disk-usage.test.ts`)

---

## Fase 4 — Estado único: manter o JSON, isolar o perigo

### Decisão

`panel_db.json` **fica**. Um processo, escrita atômica (`tmp + fsync + rename`), leitura em memória. Postgres aqui é complexidade sem ganho. SQLite só quando o gatilho da 4.3 disparar.

### Estado atual

- [x] Escrita atômica com `fsync`
- [x] JSON corrompido → quarentena `.corrupt-<ts>` e abort (nunca reseta para default)
- [x] `load()` faz merge de coleções novas em `DEFAULT_DATA`
- [x] Monitor de crescimento do arquivo
- [x] Histórico versionado: `state-history` + rollback em 1 clique (4.1)

### 4.1 — Snapshots versionados

- [x] `DATA_DIR/state-history/panel_db.<ts>.<motivo>.json` gravado **antes** de `importState`, `removeApp`, `removeDatabase` e no boot (`utils/state-history.ts`)
- [x] Retenção: últimos 20 + 1 por dia nos últimos 7 dias; cópia, nunca hardlink nem move
- [x] `POST /api/system/state/rollback/:name` (admin + **2FA**) — restaura o snapshot e ressincroniza o Caddy
- [x] Tela em Settings → Estado do Painel: lista de snapshots com o diff de contagens por coleção
- [x] Snapshot também no boot, **antes** de `load()` aplicar o merge de schema novo

### 4.2 — Um writer, provado ✅

- [x] Lock file `DATA_DIR/panel_db.lock` (pid + hostname); segundo processo **recusa subir** com mensagem clara (`utils/panel-lock.ts`, tomado no construtor do `JsonStorage`)
- [x] `docker compose` do painel: `deploy.replicas: 1` explícito + comentário do porquê
- [x] Teste: abrir segundo `JsonStorage` no mesmo `DATA_DIR` lança erro (`test/panel-lock-storage.test.ts`)
- [x] Self-update: recreate do backend libera o lock (`shutdown()` libera antes de tudo; lock sem heartbeat é considerado stale após 30s)
- [x] **`install.sh --restore-from` ajustado**: `dr-restore` rodava via `docker compose exec` com o daemon de pé. Agora para o backend, roda o script num contêiner one-off e sobe de volta.

Notas de implementação:

- O risco não é corrupção — toda escrita é atômica. É **perda silenciosa**: cada processo guarda o documento inteiro em memória e reescreve tudo a partir da sua cópia, então quem salvar por último descarta os registros do outro. `dr-restore` e `reset-admin` faziam exatamente isso ao lado do daemon vivo.
- Dentro de um contêiner, `hostname` é o id do contêiner: depois de um self-update o processo novo não consegue perguntar se o pid antigo está vivo, porque ele pertencia a um contêiner que não existe mais. Por isso o heartbeat existe, e por isso o `shutdown()` libera primeiro.
- Pid reutilizado depois de um boot é tratado como arquivo órfão — senão o painel ficaria permanentemente sem subir.
- `reset-admin` agora falha alto se o daemon estiver de pé, dizendo para parar o backend. É melhor que o comportamento anterior, que gravava por cima e deixava o processo servindo estado velho.

### 4.3 — Gatilho para SQLite (não agora) ✅

Migrar **só** quando **um** destes for verdade em produção:

- [ ] `panel_db.json` > 8 MB, ou
- [ ] > 150 apps + bancos somados, ou
- [ ] `save()` p95 > 200 ms no monitor

Quando disparar: `better-sqlite3`, mesmo `JsonStorage` como fachada, migração 1:1 por coleção, JSON vira export. **Nunca** cluster/Postgres para o estado do painel.

- [x] Métrica `save()` p95 no `storage-health`, com o valor atual ao lado do limite (`migrationTrigger`)
- [x] Documento [`docs/ADR-0001-panel-state-json.md`](./ADR-0001-panel-state-json.md) registrando a decisão e o gatilho

### Critérios de aceite — Fase 4

- [x] Importar um estado quebrado e voltar ao anterior em 1 clique
- [x] Segundo backend no mesmo volume não sobe
- [x] `storage-health` mostra tamanho do JSON, p95 de save e distância até o gatilho

---

## Fase 5 — Cluster: de “painel no meio” para fleet

### Estado atual

- [x] Deploy image/git/dockerfile no Docker do nó via SSH (#5)
- [x] Caddy aponta `hostIp:port` para apps remotas
- [x] Chaves SSH cifradas, nunca ecoadas
- [x] Fila por nó, health do nó, Caddy ciente e clone no nó entregues (5.1 a 5.4)

### 5.1 — Fila: um deploy por vez por nó ✅

- [x] `DeployQueue` em memória por `nodeId`: FIFO, `maxConcurrent: 1` remoto e 2 no host local
- [x] `deployments[].status` ganha `queued` de verdade; posição na fila em `GET /api/apps/queue` e no evento `deploy:queue`
- [x] `abandonInFlightDeploys()` já cobre `queued` — a fila é em memória e não sobrevive ao restart, então relançar seria pior que marcar como falha
- [x] Cancelar deploy na fila (`DELETE /api/apps/:id/deployments/:depId/queue`) sem tocar no Docker
- [x] Rajada de pushes colapsa para o último commit; os intermediários viram evento `deploy.superseded` na auditoria

### 5.2 — Health do nó no card ✅

- [x] `NodeService.probe(nodeId)` a cada 60s: latência SSH, `docker info`, contêineres rodando, RAM total e disco do Docker
- [x] `serverNodes[].health: { at, sshMs, dockerOk, containersRunning, aegisRunning, memTotalBytes, cpuCount, dockerDiskBytes, consecutiveFailures }`

**Desvio do PRD:** o PRD pedia `diskFreePct` e `memFreePct` do host. **A API do Docker não expõe nenhum dos dois.** O único jeito de obtê-los é rodar um contêiner no nó para ler `/proc` — o que transforma uma sondagem read-only numa carga que o painel agenda sem ninguém pedir, e num nó já sobrecarregado é justamente o que não se quer fazer. Reportamos o que o Docker realmente dá (RAM total, CPUs, disco ocupado pelo Docker) e não inventamos número para preencher a lacuna.

Outras notas:

- `error` só a partir de **3** falhas: uma conexão SSH derrubada acontece em qualquer link, e virar `error` na primeira tiraria todos os apps do nó do Caddy — a indisponibilidade seria do painel, não do nó.
- `unknown` roteia normalmente, mesma razão do 3.2: é o estado antes da primeira sondagem.
- [x] `error` após 3 sondagens falhas consecutivas
- [x] Nó `error` → apps dele aparecem em cinza no AppsPage com “nó inacessível”, não “rodando”
- [x] Alerta quando o nó cai e quando volta (respeita `LOCAL_MODE` pelo guard do `AlertService`)
- [x] Deploy para nó `error` continua recusado (`assertDeployTarget`)

### 5.3 — Clone no nó, não no painel ✅

Hoje: clone no painel → tar do contexto → stream para o Docker remoto. Custa disco e rede do painel.

- [x] Modo `remoteClone`: o **daemon do nó** busca o repositório sozinho (contexto Git do builder do Docker, `remote=`); o painel não clona nem envia contexto
- [x] Token do GitHub **não** chega ao nó — ver desvio abaixo
- [x] Logs do build streamam de volta pelo mesmo canal (`followProgress` sobre o transporte SSH), passando por `redactSecrets()`
- [x] Fallback automático para o clone no painel quando o contexto remoto não serve
- [x] `DATA_DIR/builds/<appId>` deixa de ser criado quando o nó faz o clone

**Desvio do PRD — não usamos SSH exec, e o token não vai para o nó.**

O PRD pedia: painel manda `gitUrl + ref + token efêmero` por SSH, e o nó roda `git clone` + `docker build`. Isso exigiria um segundo canal de execução remota (`ssh2` como dependência direta, com verificação de host próprio) e colocaria um token do GitHub numa máquina que hoje só recebe chamadas de API do Docker.

O builder do Docker já aceita uma URL Git como contexto, então o daemon do nó faz o clone **usando o canal que já existe** — sem dependência nova, sem shell remoto, sem token no nó. O `ref` é resolvido para um SHA exato via `git ls-remote` a partir do painel (uma chamada de rede, zero disco), então o build fica fixado no commit e o histórico registra um hash de verdade em vez de um nome de branch que se move.

**Limitação consciente: repositório privado continua clonando no painel.** O contexto remoto é buscado pelo daemon *antes* do build começar, então não há mecanismo de segredo para ele — autenticar significaria embutir o token na URL, que vira query parameter registrado no log do daemon do nó. O painel já clona privado com o token num header de config do Git (nunca em argv, nunca em disco), e manter essa propriedade vale mais que o disco economizado.

**Repositório sem Dockerfile próprio também cai no painel**, e isso só se descobre tentando: a detecção de framework lê os arquivos, então só roda sobre uma cópia de trabalho. O fallback distingue "o daemon não conseguiu buscar o repositório" de "o build falhou" — um Dockerfile quebrado falha igual depois de um clone local, e repetir dobraria a duração de todo deploy quebrado imprimindo o mesmo erro duas vezes.

### 5.4 — Caddy ciente do nó ✅

- [x] `CaddyService` serve a página 503 do painel quando o nó está `error`, em vez de esperar por uma máquina que sumiu
- [x] `lb_try_duration` / `fail_duration` / `max_fails` já no `reverse_proxy` (health check passivo do Caddy). `health_uri` ativo não foi adicionado: a sondagem do painel já decide roteamento, e duas sondagens independentes divergiriam sem que ninguém soubesse qual manda.
- [x] Nó volta → sync do Caddyfile automático, ligado ao evento de recuperação
- [ ] Fora de escopo: Caddy em cada nó, failover de app entre nós (isso é orquestrador, não painel)

### Critérios de aceite — Fase 5

- [x] 3 deploys disparados juntos para o mesmo nó rodam em série; UI recebe a posição pelo evento `deploy:queue` (teste da regra em `test/deploy-queue.test.ts`)
- [x] Nó desligado → `error` em ≤ 3 min (3 sondagens de 60s), apps saem do Caddy, site mostra 503 do painel
- [x] Deploy git para nó remoto não cria nada em `DATA_DIR/builds` do painel (repositório público com Dockerfile próprio; privado ou sem Dockerfile continua clonando — ver 5.3)

---

## Sequência de entrega

| Ordem | Fase | Issue | Depende de | Toca em |
|-------|------|-------|-----------|---------|
| 1 | 1.5 CI verde | — | billing GitHub (humano) | `.github/workflows` |
| 2 | 1.3 Audit log | #7 | — | `middleware`, `AuditStore`, Settings |
| 3 | 1.2 Sessões | #7 | 1.3 (audita revoke) | `auth.ts`, `storage`, Socket handshake |
| 4 | 1.1 2FA | #7 | 1.2 | `auth.routes`, `crypto`, Login |
| 5 | 1.4 HTTPS do painel | — | — | `caddy.service`, `install.sh` |
| 6 | 2.1 S3 | #8 | — | `backup.service`, Settings |
| 7 | 2.2 Restore remoto + DR | #8 | 2.1 | `backup.service`, `install.sh`, `scripts/` |
| 8 | 2.3 Ensaio mensal | #8 | 2.2 | `cron.service`, Dashboard |
| 9 | 3.1 Limites | — | — | `docker.service`, EditAppModal |
| 10 | 3.2 Healthcheck | — | 3.1 | `docker.service`, `cicd`, `caddy` |
| 11 | 3.3 Teto de builds | — | — | `cicd`, `storage-health` |
| 12 | 4.1 Snapshots | — | — | `storage.ts`, Settings |
| 13 | 4.2 Lock | — | — | `storage.ts`, compose |
| 14 | 5.1 Fila | — | — | `cicd.service` |
| 15 | 5.2 Health do nó | — | — | `node.service`, NodesPage |
| 16 | 5.4 Caddy ciente | — | 5.2 | `caddy.service` |
| 17 | 5.3 Clone no nó | — | 5.1, 5.2 | `cicd`, `node.service` |

Um PR por linha. Fases 1–2 antes de qualquer feature nova.

---

## Fora de escopo (decidido)

- Kubernetes, Swarm, Nomad — o painel gerencia Docker; orquestração é outro produto
- Postgres/Redis para o estado do painel — ver gatilho 4.3
- Caddy por nó / failover de app entre nós — é orquestrador
- SSO/OIDC — depois de 2FA estar em produção há 3 meses
- CLI (#11), marketplace (#9), mobile (#10) — polish, seguem no PRD anterior

---

## Riscos

| Risco | Mitigação |
|-------|-----------|
| 2FA obrigatório tranca o único admin | Códigos de recuperação + `npm run reset-admin` já existente ganha `--disable-2fa` |
| Upload S3 lento segura o cron de backup | Upload assíncrono após o dump; `completed_local_only` não bloqueia o próximo |
| Limite de RAM default baixo quebra app existente | Apps já criadas ficam **sem** limite até o admin definir; só apps novas herdam o default |
| Lock file stale após crash | Stale por pid morto + 30s; `docker compose restart` sempre limpa |
| Fila em memória perde estado no restart | `queued` persiste em `deployments[]`; `abandonInFlightDeploys()` reenfileira |
| Clone no nó expõe token do GitHub | Token só via stdin, `git -c credential.helper=` vazio, `remoteClone` opt-in por nó |

---

## Métricas de sucesso

- 100% das rotas mutantes com evento de auditoria (teste falha se não)
- 0 admins sem 2FA em produção
- Último restore-drill OK há ≤ 45 dias, sempre
- 0 incidentes de VPS derrubada por app sem limite
- `panel_db.json` com snapshot antes de toda mutação destrutiva
- Nenhum deploy concorrente no mesmo nó

---

## Legenda

| Símbolo | Significado |
|---------|-------------|
| `[x]` | Implementado e em produção |
| `[ ]` | Ainda falta |
| #7 / #8 | Issues já abertas no GitHub |
