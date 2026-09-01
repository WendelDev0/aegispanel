# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AegisPanel: self-hosted control panel that turns an Ubuntu VPS (or a local machine) into a PaaS — CI/CD from GitHub, one-click databases, domains with automatic SSL via Caddy, file manager, backups, cron, firewall, and a web terminal. The backend talks to the **Docker daemon of the machine it runs on** via the mounted socket; remote nodes are reached over SSH.

Because the backend container mounts `/var/run/docker.sock`, code running in it is effectively root on the host. Treat every route, socket handler and shell invocation with that in mind.

## Commands

From the repo root:

```bash
npm run dev            # backend (tsx watch) + frontend (vite) concurrently
npm run check          # typecheck backend + frontend, then backend tests  ← run before committing
npm run typecheck
npm test               # backend tests only
npm run build          # tsc (backend) + vite build (frontend)

npm run local:up       # full containerised local stack on 127.0.0.1:3001
npm run local:down
npm run local:logs
```

Backend (`cd backend`):

```bash
npm test                                              # node:test via tsx, test/**/*.test.ts
node --import tsx --test test/safe-path.test.ts       # a single test file
node --import tsx --test --test-name-pattern "local mode" test/**/*.test.ts
npm run typecheck                                     # tsc --noEmit AND tsc --noEmit -p tsconfig.test.json
npm run reset-admin                                   # dist/scripts/reset-admin.js (needs a build first)
```

Dev URLs: hot-reload frontend on `http://localhost:3000` (Vite proxies `/api` and `/socket.io` to `:4000`); containerised local stack on `http://localhost:3001`. Production compose serves the panel on `:3000` through nginx, which proxies to the backend — port 4000 is never published.

CI (`.github/workflows/ci.yml`) runs backend typecheck/test/build, frontend typecheck/build, and a grep that fails the build if a literal default is ever assigned to `JWT_SECRET` or `ENCRYPTION_KEY`.

## Architecture

### Backend (`backend/src`, Node 22, ESM, `module: NodeNext`)

Relative imports **must** carry the `.js` extension (`from './config.js'`) even though the sources are `.ts`. Compiled output goes to `dist/`.

Layering: `routes/*.routes.ts` (HTTP + role gates + input validation) → `services/*.service.ts` (all logic, Docker/shell/filesystem) → `db/storage.ts` (single JSON document).

- **`config.ts`** — resolved once at module load. `requireSecret()` **exits the process** in production when `JWT_SECRET`/`ENCRYPTION_KEY` are missing; outside production it generates one and appends it to `backend/.env.local`. Anything importing a service transitively imports this, which is why tests must import `test/setup.js` first.
- **`db/storage.ts`** — the whole panel state is one file, `<DATA_DIR>/panel_db.json`, held in memory and rewritten atomically (temp file + `fsync` + `rename`) on every mutation. A JSON parse failure quarantines the file and aborts startup instead of resetting to defaults. `load()` merges the stored document one level into `DEFAULT_DATA` so an old file gains newly added collections — **add new collections to `DEFAULT_DATA` and to `DatabaseSchema` together**. Never write `panel_db.json` from outside this singleton; the running process would keep serving stale state.
- **`realtime.ts`** — holds the Socket.IO instance so services can `emit()` without importing `server.ts` (which would create a cycle `server → routes → services → server`). Use `emit()` from services; never import `io` from `server.ts` in a service.
- **`server.ts`** — mounts routers under `/api/*`, authenticates the Socket.IO **handshake** before any listener is attached (an open socket here is an unauthenticated root shell), and runs a 2s metrics loop that skips when no client is connected and never lets two collections overlap.
- **`middleware/auth.ts`** — JWT (7d) plus `requireWrite` (admin+developer) and `requireAdmin`. A token says who the caller is, never what they may do: every state-changing route needs one of these gates.

Services worth knowing before touching adjacent code:

| Service | Notes |
|---|---|
| `docker.service.ts` | Singleton `dockerService`, probes several socket/pipe candidates at boot. New containers join the Compose-generated `*aegis-net*` network so Caddy can reach them by container name. |
| `cicd.service.ts` | The deploy pipeline. Uses a local `run()` helper wrapping `spawn` with `shell: false` — never `exec`, because a repo URL or branch would be live shell code and the 1 MB `maxBuffer` broke large builds. Streams logs to `deploy:<appId>:stream`, always through `redactSecrets()`. Each deploy also tags `name:<deploymentId>` so `rollback()` can restart the exact image. |
| `caddy.service.ts` | Regenerates the whole Caddyfile from panel state, validates it inside the `aegis-caddy` container, and only then reloads. No hardcoded ACME email — it comes from settings or the first admin. |
| `analytics.service.ts` | Parses Caddy's shared JSON access log (mounted read-only) to attribute traffic per host. Visitor IPs are stored only as truncated salted hashes. |
| `port.service.ts` | Allocates host ports in 4100–9999 from the Docker daemon's view plus panel records — not by binding a socket, which would test the container's namespace, not the host's. |
| `node.service.ts` | Remote nodes via dockerode's SSH transport (`docker system dial-stdio`), keys encrypted at rest and never echoed back (`toPublic`). Admin-only; the UI exists but the panel still manages only its own Docker. |
| `terminal.service.ts` | Host shell is admin-only; container shells deny `viewer`. Container refs are regex-constrained. |

Utilities are leaf modules with no service imports: `utils/naming.ts` (the single source for `aegis-app-*` / `aegis-db-*` container names — derive names here, not with a local regex), `utils/safe-path.ts` (segment comparison + symlink resolution, not `startsWith`), `utils/crypto.ts` (AES-256-GCM, `aegis.v1:` prefix; `decrypt` throws rather than returning a placeholder that a later save would persist over the real secret).

### Frontend (`frontend/src`, React 18 + Vite + Tailwind)

- No router dependency. `hooks/useRoute.ts` maps `/<tab>/<param>` to a `NavTab`; **a new page must be added to its `TABS` array** as well as to `App.tsx` and `Sidebar.tsx`.
- Every page is `lazy()`-imported in `App.tsx`. Keep it that way — the terminal emulator and charting library are large.
- `services/api.ts` — axios instance on `/api`, injects the bearer token, clears storage and fires `aegis_auth_change` on 401. `services/socket.ts` passes the token in the handshake.
- Design system: `components/ui.tsx` primitives (`Panel`, `SectionHeader`, `StatCard`, tone scale) over the semantic Tailwind tokens in `tailwind.config.js` (`surface-container`, `on-surface`, `outline-variant`, `ok`/`warn`/`crit`). Depth comes from layered surfaces and 1px hairlines — no shadows or gradients. Prefer these tokens over the legacy `brand.*`/`dark.*` colours kept only for unmigrated markup.

### Local mode

`CONFIG.LOCAL_MODE` is **on by default whenever `NODE_ENV !== 'production'`**, because the dangerous path is silent: a developer restores a production `panel_db.json` locally and the copy starts requesting real certificates and firing real alerts. It makes Caddy issue internal certs, blocks outbound Discord/Telegram/WhatsApp notifications, and disables the cron scheduler. Any new outbound or scheduled side effect should check it (see the guards in `alert.service.ts`, `caddy.service.ts`, `cron.service.ts`). Escape hatch: `AEGIS_ALLOW_OUTBOUND_ALERTS=true`.

## Conventions

- **Comments explain the failure that motivated the code**, not what the line does. Much of this codebase is hardening on top of earlier bugs (unsigned webhooks accepted, ports published on 0.0.0.0, backups marked complete after a failed dump). When changing such code, keep the reasoning comment accurate or update it.
- User-facing strings and error messages are **Portuguese**; code, identifiers and comments are English.
- Commits follow Conventional Commits (`fix(databases): …`), subject in English or Portuguese.
- Secrets never leave the API: services expose a `toPublic()` that strips them and returns `hasX: boolean` (see `AppService`, `NodeService`).
- Defaults are safe by construction: databases bind `127.0.0.1` (`AEGIS_DB_BIND_IP`) because Docker's iptables rules run before ufw; CORS empty means same-origin; the installer opens only 22/80/443/3000.

## Tests

`backend/test/*.test.ts`, plain `node:test` with no test framework. Every suite starts with `import './setup.js'` — it sets `NODE_ENV=test`, injects test secrets, and redirects `DATA_DIR` to a temp dir, all before `config.ts` is evaluated. Coverage is focused on the security-critical seams: `safe-path`, `crypto`, `webhook-auth`, `cron-schedule`, `storage`, `local-mode`, `node`, `analytics`.
