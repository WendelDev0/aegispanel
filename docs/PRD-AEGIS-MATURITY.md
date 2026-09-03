# PRD — AegisPanel Maturity Roadmap

Documento de produto para elevar o painel de “funciona na VPS” para maturidade operacional.

**Como usar:** marque `[x]` = feito · `[ ]` = falta. Atualize este arquivo quando fechar um item.

**Onde está o código das fases 1–5:** branch `cursor/prd-operational-maturity-4b81` / [PR #1](https://github.com/WendelDev0/aegispanel/pull/1)  
**Status de entrega:** código implementado no PR · **ainda falta mergear no `main` e atualizar a VPS**.

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
- [ ] Expandir Zod para **todas** as rotas de mutação restantes (nodes, domains, firewall, templates, settings patch, etc.)

---

## Fase 3 — Frontend sustentável

- [x] Extrair `DeployHistoryModal` de `AppsPage`
- [x] Extrair `BuildLogsModal` de `AppsPage`
- [x] Vitest + Testing Library no frontend
- [x] Testes dos dois modais
- [x] `ServerNode.status` alinhado a 4 estados (`online | offline | unknown | error`) no tipo compartilhado
- [ ] Continuar a quebrar `AppsPage` (ainda grande: create/env/files/webhook/workflow)
- [ ] Cobertura de testes UI além dos modais de deploy

---

## Fase 4 — Deploy por nó

- [x] `AppRecord.nodeId` opcional
- [x] `NodeService.assertDeployTarget`
- [x] Recusar nós ausentes / offline / error
- [x] Remotes git/dockerfile recusados (intent: image-only em remoto)
- [ ] Deploy remoto **real** (build/start no Docker do nó via SSH, não só gate)
- [ ] Seletor de nó na UI de criar/editar app
- [ ] Sync Caddy / rede quando o app roda em outro host

---

## Fase 5 — Autogestão do painel

- [x] `PanelService` com logs allowlisted (`aegis-backend`, `aegis-frontend`, `aegis-caddy`, `aegis-nginx`)
- [x] Self-update via `docker compose up -d --build`
- [x] Self-update bloqueado em `LOCAL_MODE`
- [x] Seção “Autogestão do Painel” em Settings
- [x] Testes de bloqueio LOCAL_MODE / alvo de log inválido
- [ ] Documentar / exigir `AEGIS_COMPOSE_DIR` no install quando o cwd não achar o compose
- [ ] Feedback de progresso do self-update em tempo real (stream), não só resposta HTTP

---

## Critérios de aceite / entrega

- [x] Typecheck backend OK (na branch do PR)
- [x] Testes backend OK (na branch do PR)
- [x] Typecheck frontend OK (na branch do PR)
- [x] Vitest frontend OK (na branch do PR)
- [x] Commits Conventional Commits por fase
- [ ] Merge do PR #1 em `main`
- [ ] Pull + `docker compose up -d --build` na VPS
- [ ] Checar logs da stack na VPS pós-deploy
- [ ] `npm run check` verde no CI do `main` após merge

---

## Próxima evolução (fora deste PRD)

Prioridade sugerida depois de merge + VPS:

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

| Símbolo | Significado |
|---------|-------------|
| `[x]` | Implementado (código no PR / branch) |
| `[ ]` | Ainda falta |
| Baseline | Já estava no `main` antes deste PRD |
| Entrega | Só fecha de verdade após merge + update na VPS |
