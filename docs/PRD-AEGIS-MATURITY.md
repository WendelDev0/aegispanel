# PRD — AegisPanel Maturity Roadmap

Documento de produto para elevar o painel de “funciona na VPS” para maturidade operacional.

**Como usar:** marque `[x]` = feito · `[ ]` = falta. Atualize este arquivo quando fechar um item.

**Entrega fases 1–5:** [PR #1](https://github.com/WendelDev0/aegispanel/pull/1) **mergeado** em `main` · VPS atualizada em `/opt/aegispanel`.  
**Bloco 2 (gaps leves):** [PR #2](https://github.com/WendelDev0/aegispanel/pull/2) **mergeado** (Zod expandido + split Create/Edit/Files + seletor de nó) · VPS atualizada.

---

## Baseline (antes do PRD) — hardening

- [x] Validação de header/magic no restore de dump (`backup.service`)
- [x] Verificação de conectividade pós-restore
- [x] `getStorageHealth()` + `pruneDeployments()`
- [x] Monitor periódico de crescimento do `panel_db.json` (`server.ts`)
- [x] `GET /api/system/storage-health` (admin)
- [x] Rate limit de login por IP (5 tentativas / 15 min)

---



## Fase 1 — Persistência saudável

- [x] `DeployLogStore` gravando em `DATA_DIR/deploy-logs`
- [x] `buildLogs` fora do `panel_db.json` (só metadata no JSON)
- [x] Backup do estado do painel (`POST /api/backups/panel`)
- [x] Restore do estado do painel (via restore de backup `targetType=full`)
- [x] Cron de backup inclui o estado do painel
- [x] Frontend carrega logs via `GET /api/apps/:id/deployments/:depId/logs`
- [x] Documento `docs/PRD-AEGIS-MATURITY.md` no repo
- [x] Teste `deploy-log-store.test.ts`

---



## Fase 2 — Validação e rate limit

- [x] Dependência `zod` no backend
- [x] Middleware `validateBody`
- [x] Schemas nas mutações principais (auth setup/login/change-password, apps, databases, cron)
- [x] `createIpLimiter` compartilhado (login / setup / change-password)
- [x] Expandir Zod nas mutações body-heavy restantes (users, update app/env/domain, inspect-repo, files, nodes, domains, firewall, query, templates, settings, import-state, test-alert)
- [x] Rotas só-ação sem body (`start`/`stop`/`restart`/`delete`/`run`/`toggle` + afins) com `emptyBodySchema`

---



## Fase 3 — Frontend sustentável

- [x] Extrair `DeployHistoryModal` de `AppsPage`
- [x] Extrair `BuildLogsModal` de `AppsPage`
- [x] Extrair `CreateAppModal` / `EditAppModal` / `AppFilesModal`
- [x] Vitest + Testing Library no frontend
- [x] Testes dos modais de deploy + CreateAppModal (seletor de nó)
- [x] `ServerNode.status` alinhado a 4 estados (`online | offline | unknown | error`) no tipo compartilhado
- [x] Continuar a quebrar `AppsPage` (env/webhook/workflow/live deploy/logs ainda inline)
- [x] Cobertura de testes UI além dos modais já extraídos

---



## Fase 4 — Deploy por nó

- [x] `AppRecord.nodeId` opcional
- [x] `NodeService.assertDeployTarget`
- [x] Recusar nós ausentes / offline / error
- [x] Remotes git/dockerfile recusados (intent: image-only em remoto)
- [x] Seletor de nó na UI de criar/editar app
- [x] Deploy remoto **real** (build/start no Docker do nó via SSH, não só gate) — **bloco 3**
- [x] Sync Caddy / rede quando o app roda em outro host — **bloco 3** (`reverse_proxy hostIp|sshHost:port`; bind `0.0.0.0` no nó; sem aegis-net remoto)

---



## Fase 5 — Autogestão do painel

- [x] `PanelService` com logs allowlisted (`aegis-backend`, `aegis-frontend`, `aegis-caddy`, `aegis-nginx`)
- [x] Self-update via `docker compose up -d --build`
- [x] Self-update bloqueado em `LOCAL_MODE`
- [x] Seção “Autogestão do Painel” em Settings
- [x] Testes de bloqueio LOCAL_MODE / alvo de log inválido
- [x] Documentar / exigir `AEGIS_COMPOSE_DIR` no install quando o cwd não achar o compose — **bloco 4**
- [x] Feedback de progresso do self-update em tempo real (stream), não só resposta HTTP — **bloco 4**

---



## Critérios de aceite / entrega

- [x] Typecheck backend OK
- [x] Testes backend OK
- [x] Typecheck frontend OK
- [x] Vitest frontend OK
- [x] Commits Conventional Commits por fase
- [x] Merge do PR #1 em `main`
- [x] Pull + `docker compose up -d --build` na VPS
- [x] Checar logs da stack na VPS pós-deploy (backend healthy)
- [ ] `npm run check` verde no CI do `main` — **local verde** (2026-09-03: typecheck backend+frontend + 79 testes backend). GitHub Actions no `main` **não chega a executar jobs**: conta locked por billing (`The job was not started because your account is locked due to a billing issue.`, run [33789764014](https://github.com/WendelDev0/aegispanel/actions/runs/33789764014)). Re-rodar o workflow após desbloquear em Settings → Billing.

---



## Próximos blocos (ainda no PRD)



### Bloco 3 — Deploy remoto real

- [x] Build/start no Docker do nó via SSH (image-only; git/dockerfile ainda locais)
- [x] Sync Caddy cross-host (`hostIp|sshHost:port` para apps remotas)



### Bloco 4 — Polish Fase 5

- [x] `AEGIS_COMPOSE_DIR` no install
- [x] Stream do self-update



### Bloco 5 — Resto / evolução

- [x] Itens restantes do AppsPage + testes UI
- [ ] Evolução pós-PRD abaixo

---



## Próxima evolução (fora deste PRD)



### Alta

- [ ] Cluster multi-servidor completo (deploy remoto de verdade)
- [ ] Observabilidade por app (métricas, retenção de logs, histórico de alertas)



### Média

- [ ] Auth mais forte (2FA, sessão revogável, audit log)
- [ ] Backup offsite (S3/R2) + restore testado
- [ ] Mais templates 1-click no marketplace



### Baixa

- [ ] Polish de UI (mobile, empty states, onboarding pós-install)
- [ ] CLI local espelhando o painel

---



## Legenda rápida


| Símbolo   | Significado                         |
| --------- | ----------------------------------- |
| `[x]`     | Implementado                        |
| `[ ]`     | Ainda falta                         |
| Baseline  | Já estava no `main` antes deste PRD |
| Bloco 3–5 | Próximas frentes após gaps leves    |


