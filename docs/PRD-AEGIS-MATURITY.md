# PRD — AegisPanel Maturity Roadmap

Documento de produto para elevar o painel de “funciona na VPS” para maturidade operacional.

## Fase 1 — Persistência saudável
- Logs de deploy em `DATA_DIR/deploy-logs` (`DeployLogStore`)
- `buildLogs` fora do `panel_db.json`
- Backup/restore do estado do painel (`POST /api/backups/panel`)
- Cron de backup inclui o estado do painel
- Frontend carrega logs via `GET /api/apps/:id/deployments/:depId/logs`

## Fase 2 — Validação e rate limit
- Zod + `validateBody` nas mutações
- `createIpLimiter` compartilhado (login / setup / change-password)

## Fase 3 — Frontend sustentável
- Extrair `DeployHistoryModal` / `BuildLogsModal` de `AppsPage`
- Vitest + Testing Library
- `ServerNode.status` alinhado a 4 estados

## Fase 4 — Deploy por nó
- `AppRecord.nodeId` opcional
- `NodeService.assertDeployTarget`
- Recusar nós ausentes/offline
- Remotes git/dockerfile recusados (intent: image-only em remoto)

## Fase 5 — Autogestão do painel
- `PanelService`: logs allowlisted da stack + `self-update`
- Bloqueado em `LOCAL_MODE`
- Seção correspondente em Settings

## Critérios de aceite
- `npm run check` verde
- Sem regressão de segurança (secrets, path, webhook)
- Commits Conventional Commits por fase
