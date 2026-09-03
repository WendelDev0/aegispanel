# PRD — AegisPanel Infra Profissional

**Produto:** AegisPanel (PaaS self-hosted)  
**Versão:** 1.0 · **Data:** 2026-09-03  
**Antecessor:** [PRD-AEGIS-MATURITY.md](./PRD-AEGIS-MATURITY.md) (fases 1–5 e #5/#6 entregues)  
**Fora deste PRD:** Kubernetes, microserviços, Redis, Postgres para o estado do painel, CLI (#11), marketplace (#9), mobile (#10)

**Como usar:** `[x]` = feito · `[ ]` = falta. Marque aqui quando fechar um item, no mesmo PR.

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
- [ ] **Tudo em `DATA_DIR/backups`, mesmo disco do painel**

### 2.1 — Destino offsite S3-compatível

- [ ] `settings.backupTarget`: `{ provider: 's3', endpoint, region, bucket, prefix, accessKeyId, secretAccessKey(cifrado) }` — cobre AWS S3, Cloudflare R2, Backblaze B2, MinIO
- [ ] SDK: `@aws-sdk/client-s3` (única dependência nova); upload multipart para dumps > 100 MB
- [ ] Cada backup: gravado local → **enviado** → só então `status: 'completed'`; falha de upload = `completed_local_only` com alerta
- [ ] `sha256` calculado antes do upload e verificado no `HEAD` do objeto
- [ ] Criptografia em repouso: dumps cifrados com `ENCRYPTION_KEY` antes de sair (AES-256-GCM, `utils/crypto.ts`) — o bucket não vê dado em claro
- [ ] Retenção no bucket: diário 14 · semanal 8 · mensal 12 (lifecycle via painel, não regra do provedor)
- [ ] `POST /api/backups/target/test` — escreve e lê um objeto de 1 KB, retorna latência
- [ ] `LOCAL_MODE` bloqueia upload (mesmo guard de `alert.service.ts`); escape `AEGIS_ALLOW_OFFSITE_BACKUP=true`
- [ ] Tela em Backups → Destino: provedor, teste, último upload, tamanho total no bucket

### 2.2 — Restore a partir do bucket

- [ ] `GET /api/backups/remote` lista objetos do bucket (não só o índice local)
- [ ] Restore de dump remoto: download → checksum → decrypt → validação de magic (já existe) → restore
- [ ] **Disaster recovery**: `install.sh --restore-from s3://bucket/prefix` em VPS nova → baixa `panel_state` mais recente → recria bancos → restaura dumps → sincroniza Caddy
- [ ] Script `backend/scripts/dr-restore.ts` idempotente, com `--dry-run`
- [ ] Documento `docs/DISASTER-RECOVERY.md`: passo a passo em 1 página, testado

### 2.3 — Ensaio mensal “no escuro”

Backup que nunca foi restaurado é hipótese, não backup.

- [ ] Cron `restore-drill` (mensal, admin ativa): sobe container efêmero do mesmo engine, restaura o dump mais recente, roda `SELECT 1` / `PING`, derruba o container
- [ ] Resultado gravado em `backups[].drill: { at, ok, durationMs, error? }` + evento de auditoria + alerta em falha
- [ ] Dashboard: “Último ensaio de restore: há 12 dias · OK” — vermelho se > 45 dias ou falhou
- [ ] Drill do estado do painel: parse + validação de schema do `panel_state` mais recente (sem sobrescrever o atual)
- [ ] Runbook trimestral (humano): DR completo numa VPS descartável usando `install.sh --restore-from`

### Critérios de aceite — Fase 2

- [ ] Apagar `DATA_DIR/backups` inteiro e restaurar um banco a partir do bucket funciona
- [ ] `install.sh --restore-from` em VPS limpa reconstrói painel + bancos em < 30 min
- [ ] Ensaio mensal roda sozinho e aparece no dashboard
- [ ] Nenhum dump chega ao bucket em claro (verificado lendo o objeto)

---

## Fase 3 — Apps com teto, não só métrica

### Estado atual

- [x] CPU/RAM por app na UI, poll 8s (#6)
- [x] Retenção de logs de runtime com teto 80 MB (#6)
- [x] `RestartPolicy: unless-stopped`
- [ ] Sem `Memory`, `NanoCpus`, `PidsLimit`, healthcheck

### 3.1 — Limites por app

- [ ] `AppRecord.limits?: { memoryMb, cpus, pidsLimit }` — default global em `settings.defaultAppLimits` (`512 MB · 1.0 cpu · 256 pids`)
- [ ] `docker.service.createAndStartContainer` aplica `HostConfig.Memory`, `MemorySwap = Memory` (sem swap), `NanoCpus`, `PidsLimit`
- [ ] Vale para local e nó remoto (mesmo `HostConfig`)
- [ ] `oom-kill` detectado via `inspect().State.OOMKilled` → alerta “app matou por memória” + evento de auditoria + sugestão de subir o teto
- [ ] UI em EditAppModal → “Recursos”: slider RAM/CPU com o consumo atual ao lado (dado do #6)
- [ ] Bancos: mesmo mecanismo, default maior (`1 GB · 2 cpus`)
- [ ] Soma dos limites > RAM do host → aviso (não bloqueio) na criação

### 3.2 — Healthcheck e restart inteligente

- [ ] `AppRecord.healthcheck?: { path, intervalSec, timeoutSec, retries }` — default `GET /` em `internalPort`, 30s/5s/3
- [ ] Aplicado em `HostConfig.Healthcheck` (`CMD-SHELL wget -qO- http://127.0.0.1:${internalPort}${path}`)
- [ ] Status do card usa `State.Health.Status` (`healthy | unhealthy | starting`), não só `running`
- [ ] Deploy: novo container só vira “sucesso” após `healthy` (ou timeout 120s → falha + rollback automático para a imagem anterior)
- [ ] Caddy só inclui upstream `healthy`; `unhealthy` → página 503 do painel em vez de erro cru
- [ ] Watchdog no loop de métricas: `unhealthy` por > 3 ciclos → restart (máx. 3/h, depois alerta e para)

### 3.3 — Teto de disco para builds

`DATA_DIR/builds/<appId>` cresce a cada deploy (clone + `node_modules`). Logs já têm teto; builds não.

- [ ] `settings.buildsDiskCapMb` (default 5 GB) — após cada deploy, remove `node_modules`/`.next`/`dist` de clones antigos até caber
- [x] `git clone --depth 1 --single-branch` (já é o padrão em `cicd.service.ts`)
- [ ] Imagens `aegis-app-*` órfãs (sem deployment apontando) → `prune` semanal, preserva as 3 últimas por app para rollback
- [ ] `GET /api/system/storage-health` passa a reportar `builds`, `images`, `logs`, `backups` separados
- [ ] Alerta quando disco do host < 10% livre (já existe monitor de `panel_db.json`; estender)

### Critérios de aceite — Fase 3

- [ ] App com `memoryMb: 128` rodando `stress` é morto pelo kernel; painel mostra “OOM” e o host segue estável
- [ ] Deploy de imagem que não sobe faz rollback sozinho em ≤ 2 min
- [ ] `DATA_DIR/builds` nunca passa do teto após 20 deploys seguidos (teste)

---

## Fase 4 — Estado único: manter o JSON, isolar o perigo

### Decisão

`panel_db.json` **fica**. Um processo, escrita atômica (`tmp + fsync + rename`), leitura em memória. Postgres aqui é complexidade sem ganho. SQLite só quando o gatilho da 4.3 disparar.

### Estado atual

- [x] Escrita atômica com `fsync`
- [x] JSON corrompido → quarentena `.corrupt-<ts>` e abort (nunca reseta para default)
- [x] `load()` faz merge de coleções novas em `DEFAULT_DATA`
- [x] Monitor de crescimento do arquivo
- [ ] Sem histórico: um save errado (ex.: import de estado ruim) não tem volta

### 4.1 — Snapshots versionados

- [ ] `DATA_DIR/state-history/panel_db.<ts>.json` gravado **antes** de mutações grandes: `importState`, `restorePanelState`, `removeApp`, `removeDatabase`, `saveSettings`, migração de schema
- [ ] Retenção: últimos 20 + 1 por dia nos últimos 7 dias; hardlink/copy, nunca move
- [ ] `POST /api/system/state/rollback/:ts` (admin, 2FA) — restaura snapshot, reinicia serviços dependentes (Caddy sync)
- [ ] Tela em Settings → Estado do Painel: lista de snapshots com “o que mudou” (diff de contagens por coleção)
- [ ] Snapshot também no boot, **antes** de `load()` aplicar merge de schema novo

### 4.2 — Um writer, provado

- [ ] Lock file `DATA_DIR/panel_db.lock` (pid + hostname); segundo processo **recusa subir** com mensagem clara
- [ ] `docker compose` do painel: `deploy.replicas: 1` explícito + comentário do porquê
- [ ] Teste: abrir segundo `JsonStorage` no mesmo `DATA_DIR` lança erro
- [ ] Self-update: recreate do backend libera o lock (lock com pid morto é considerado stale após 30s)

### 4.3 — Gatilho para SQLite (não agora)

Migrar **só** quando **um** destes for verdade em produção:

- [ ] `panel_db.json` > 8 MB, ou
- [ ] > 150 apps + bancos somados, ou
- [ ] `save()` p95 > 200 ms no monitor

Quando disparar: `better-sqlite3`, mesmo `JsonStorage` como fachada, migração 1:1 por coleção, JSON vira export. **Nunca** cluster/Postgres para o estado do painel.

- [ ] Métrica `save()` duration no `storage-health` para observar o gatilho
- [ ] Documento `docs/ADR-0001-panel-state-json.md` registrando a decisão e o gatilho

### Critérios de aceite — Fase 4

- [ ] Importar um estado quebrado e voltar ao anterior em 1 clique
- [ ] Segundo backend no mesmo volume não sobe
- [ ] Dashboard mostra tamanho do JSON, p95 de save e distância até o gatilho

---

## Fase 5 — Cluster: de “painel no meio” para fleet

### Estado atual

- [x] Deploy image/git/dockerfile no Docker do nó via SSH (#5)
- [x] Caddy aponta `hostIp:port` para apps remotas
- [x] Chaves SSH cifradas, nunca ecoadas
- [ ] Clone continua no painel; sem fila; Caddy não sabe se o nó caiu

### 5.1 — Fila: um deploy por vez por nó

- [ ] `DeployQueue` em memória por `nodeId`: FIFO, `maxConcurrent: 1` (host local pode ser 2 — configurável)
- [ ] `deployments[].status` ganha `queued` **de verdade** (já existe no tipo, não é usado): UI mostra “na fila, posição N”
- [ ] `abandonInFlightDeploys()` no boot já marca `building` como falha; estender para reenfileirar `queued`
- [ ] Cancelar deploy na fila (antes de começar) sem tocar no Docker
- [ ] Webhook em rajada (5 pushes em 1 min) → colapsa para o último commit, ignora os intermediários (evento de auditoria)

### 5.2 — Health do nó no card

- [ ] `NodeService.probe(nodeId)` a cada 60s: latência SSH, `docker info` OK, disco livre, RAM livre, containers `aegis-*` rodando
- [ ] `serverNodes[].health: { at, sshMs, dockerOk, diskFreePct, memFreePct, appsRunning }`
- [ ] Card do nó: semáforo + últimos 3 números; `error` após 3 probes falhos consecutivos
- [ ] Nó `error` → apps dele aparecem em cinza no AppsPage com “nó inacessível”, não “rodando”
- [ ] Alerta quando nó cai / volta (respeita `LOCAL_MODE`)
- [ ] Deploy para nó `error` continua recusado (`assertDeployTarget` já faz) — agora com o motivo do probe

### 5.3 — Clone no nó, não no painel

Hoje: clone no painel → tar do contexto → stream para o Docker remoto. Custa disco e rede do painel.

- [ ] Modo `remoteClone`: painel envia só `gitUrl + ref + token efêmero` por SSH; nó roda `git clone --depth 1` + `docker build` localmente
- [ ] Token do GitHub **não** persiste no nó: passado via stdin, nunca argv nem arquivo
- [ ] Logs do build streamam de volta pelo mesmo canal SSH para `deploy:<appId>:stream` (com `redactSecrets()`)
- [ ] Fallback automático para o modo atual se o nó não tiver `git`
- [ ] `DATA_DIR/builds/<appId>` só existe para apps locais (libera disco do painel)

### 5.4 — Caddy ciente do nó

- [ ] `CaddyService` só emite upstream de app cujo nó está `online`; nó `error` → página 503 do painel (“serviço temporariamente indisponível”) em vez de timeout
- [ ] `health_uri` / `lb_try_duration` no `reverse_proxy` para upstreams remotos
- [ ] Nó volta → sync do Caddyfile automático (já existe o sync; ligar ao evento de health)
- [ ] Fora de escopo: Caddy em cada nó, failover de app entre nós (isso é orquestrador, não painel)

### Critérios de aceite — Fase 5

- [ ] 3 deploys disparados juntos para o mesmo nó rodam em série, UI mostra a fila
- [ ] Desligar um nó: card fica `error` em ≤ 3 min, apps dele saem do Caddy, site mostra 503 do painel
- [ ] Deploy git para nó remoto não cria nada em `DATA_DIR/builds` do painel

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
