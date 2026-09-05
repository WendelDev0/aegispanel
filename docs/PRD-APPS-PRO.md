# PRD — Aplicações profissionais

**Produto:** AegisPanel (PaaS self-hosted)  
**Versão:** 1.0 · **Data:** 2026-09-05  
**Antecessores:** [PRD-AEGIS-MATURITY](./PRD-AEGIS-MATURITY.md) (modais, logs, observabilidade) · [PRD-AEGIS-INFRA-PRO](./PRD-AEGIS-INFRA-PRO.md) fase 3 (limites, healthcheck, OOM) e fase 5 (fila por nó, build no nó remoto)  
**ADR:** [0001](./ADR-0001-panel-state-json.md) — estado do painel continua em JSON; este PRD não muda isso.

**Como usar:** `[x]` = feito · `[ ]` = falta. Marque no mesmo PR que fechar o item. Cada fase é um corte vertical, com teste, demonstrável sozinha.

---

## Onde paramos

Atualizado em **2026-09-05**.

| Fase | Estado | Depende de |
|------|--------|------------|
| 0 — Build config persistida + `aegis.toml` | ✅ | — |
| 1 — Python de verdade (pip, poetry, uv, workers) | ✅ | 0 |
| 2 — Deploy sem queda (blue/green) + hooks | ✅ | 0 |
| 3 — CI/CD: tags, PR preview, GitLab/Gitea, deploy key SSH | ✅ | 0, 2 |
| 4 — Novos runtimes: Go, Rust, PHP, Java, Ruby, Bun, Deno | ✅ | 0 |
| 5 — Stacks compose e processos sem porta (worker, cron, one-off) | ✅ | 0, 2 |

**Entregue hoje (v1):** três origens (`git`, `dockerfile`, `image`); detector que gera Dockerfile para Node (Vite, Next, Astro, Nuxt, Remix, SvelteKit, Nest, Express, genérico), estático e Python (Flask, FastAPI, Django, genérico, sempre `python:3.11-slim` + `pip`); Dockerfile nativo do repositório; webhook GitHub com HMAC e alternativa via GitHub Actions; fila serial por nó; build no nó remoto via daemon-git; readiness + rollback automático; limites de CPU/RAM/PIDs; healthcheck opt-in; logs e métricas por app; 12 templates de imagem pronta.

---

## Glossário

| Termo | Significado |
|-------|-------------|
| **Origem** (`sourceType`) | De onde vem o código: `git`, `dockerfile` (arquivos já no painel), `image` (imagem pronta), **`compose`** (novo). |
| **Runtime** | Linguagem/plataforma que roda o app: `node`, `python`, `static`, `go`, `rust`, `php`, `java`, `ruby`, `bun`, `deno`, `docker`. |
| **Receita** | Dockerfile gerado pelo painel para um runtime + framework. Sempre auditável no log do deploy. |
| **`aegis.toml`** | Arquivo opcional na raiz do repositório com overrides de build/start/processos. Versionado junto do código. |
| **Processo** | Um container do app: `web` (recebe tráfego), `worker` (sem porta), `cron` (agendado), `release` (roda uma vez antes de trocar). |
| **Release** | Imagem construída + processos ligados a ela. Hoje `aegis-app-<name>:<deploymentId>`. |
| **Slot** | Container ativo (`blue`) vs. candidato (`green`) durante um deploy sem queda. |
| **Preview** | Ambiente temporário por pull request, em subdomínio próprio, removido quando o PR fecha. |
| **Hook** | Comando executado num ponto do pipeline (`pre_deploy`, `post_deploy`). |
| **Cache de build** | Camadas Docker reutilizadas entre deploys do mesmo app. |

---

## Atores

| Ator | Papel | O que faz aqui |
|------|-------|----------------|
| **Admin** | `admin` | Tudo. Configura provedores Git, deploy keys, previews, compose. |
| **Developer** | `developer` | Cria e edita apps, faz deploy, rollback, lê logs. Não mexe em chave SSH nem em compose com volumes de host. |
| **Viewer** | `viewer` | Lê status, logs, histórico. |
| **GitHub / GitLab / Gitea** | Externo | Manda webhook de push, tag e pull request. |

---

## Métricas de sucesso

Medir na VPS. Reportar em `GET /api/apps/stats` e no card do app.

| Métrica | Hoje | Meta |
|---------|------|------|
| Tempo de indisponibilidade num deploy bem-sucedido | old para antes do new subir (segundos a dezenas de segundos) | **0 s** para apps `web` com healthcheck (blue/green) |
| Deploy de repo Python com `requirements.txt` sem tocar em nada | funciona só em 3.11/pip; Poetry/uv falham | **100%** dos projetos pip/poetry/uv/pipenv com lockfile |
| Tempo de rebuild sem mudança de dependências (Node/Python médio) | rebuild completo | **−50%** com cache de camadas |
| Repos de linguagens “sem receita” que precisam de Dockerfile manual | Go, Rust, PHP, Java, Ruby, Deno = 100% | **0%** para os 7 runtimes da fase 4 |
| Preview por PR | não existe | **< 3 min** do PR aberto até URL respondendo |
| Deploys quebrados por migração faltando | sem hook; roda no CMD ou não roda | **0** — `release` roda antes do swap, falha aborta |
| Deploy por tag/release | não existe | push de `v*` faz deploy em produção quando configurado |

---

## Problem Statement

O painel já é um PaaS: clona, detecta, gera Dockerfile, builda, sobe, roteia pelo Caddy, faz rollback. Para Node com Dockerfile ou framework conhecido, funciona. Fora disso:

1. **Python é de brinquedo.** Sempre `python:3.11-slim`, sempre `pip install -r requirements.txt`. Poetry e Pipenv são só rótulos; `uv` não existe; não dá para escolher 3.12; não há Celery/worker; Django roda `migrate` dentro do CMD, então uma migração quebrada derruba o app no restart.
2. **Nada de configuração persistida.** `buildCommand`, `startCommand`, versão, subpasta (monorepo): nenhum vive no `AppRecord`. Cada deploy redetecta. O operador não consegue corrigir o que o detector errou sem escrever um Dockerfile.
3. **Deploy derruba o app.** O container antigo é renomeado, parado e só então o novo sobe na mesma porta. Rollback existe, downtime também.
4. **CI/CD só faz push → deploy.** Sem preview por PR, sem deploy por tag, sem hooks, sem GitLab/Gitea, sem deploy key SSH (só PAT HTTPS), sem cache de build.
5. **Só web.** Todo app precisa de porta. Não há worker, cron como processo, one-off, nem stack compose (Redis + app + worker) como uma unidade.
6. **Linguagens fora de Node/Python exigem Dockerfile manual.** Go, Rust, PHP, Java, Ruby, Deno.

## Solution

Transformar “app” em **release com processos**, mantendo a arquitetura atual (rotas → services → JSON, Docker socket, Caddy):

1. **`buildConfig` persistida + `aegis.toml`.** Runtime, versão, comandos, subpasta e processos ficam no app e/ou no repositório. O detector propõe; o operador confirma; o deploy obedece.
2. **Receitas por runtime, não um builder externo.** Dockerfiles gerados pelo painel, um por runtime/framework, com versão parametrizada e cache de dependências. Nixpacks fica como pergunta aberta, não como dependência.
3. **Blue/green com Caddy.** Novo container sobe em porta/nome de slot, passa no readiness, Caddy troca o upstream, o antigo é parado. `release` (migrações) roda antes do swap e aborta se falhar.
4. **CI/CD de verdade.** Deploy por tag, preview por PR com subdomínio, hooks, GitLab/Gitea/Bitbucket, deploy key SSH por app, cache de camadas.
5. **Processos sem porta e stacks compose.** `worker`, `cron`, `one-off` como containers do mesmo release; `compose` como origem para stacks que o cliente já tem.

### Matriz de degradação

| Situação | Efeito | O que não acontece |
|----------|--------|--------------------|
| Readiness do slot `green` falha | `green` removido, `blue` intocado, deploy `failed` | app não cai |
| `release` falha (migração) | deploy aborta antes do swap | banco meio-migrado não recebe tráfego novo |
| Cache de build corrompido | próximo build usa `--no-cache` automaticamente e loga | build não fica em loop |
| Provedor Git fora | webhook não chega; deploy manual continua | fila não trava |
| Nó remoto offline | fila daquele nó pausa; outros nós seguem | painel não trava |
| Preview excede cota | PR novo não ganha ambiente; comentário no PR explica | previews antigos não são removidos à força |

---

## Princípios

- **Detector propõe, `aegis.toml` decide, operador confirma.** Nunca redetectar por cima do que o operador salvou.
- **Receita visível.** O Dockerfile gerado aparece no log e em `GET /apps/:id/recipe`. Sem mágica escondida.
- **Sem queda por padrão** para `web` com healthcheck. Sem healthcheck, o painel avisa e faz o deploy antigo (com aviso), não bloqueia.
- **Seguro por construção.** Deploy key SSH por app, cifrada, só a chave pública sai. Hooks rodam dentro do container do release, nunca no host. Compose passa por allowlist: sem `privileged`, sem `/var/run/docker.sock`, sem bind de host fora de `DATA_DIR/apps/<id>`.
- **LOCAL_MODE continua rei.** Previews não pedem certificado real; webhooks para provedores externos (comentário no PR) não saem.
- **Hardening sobre feature.** Nenhum runtime novo entra sem receita com usuário não-root, `HEALTHCHECK` e limite de tamanho de imagem no log.
- **Comentários explicam a falha que motivou o código.** Convenção do repo.
- **Strings de UI e erro em português; código em inglês.**

---

## Modelo de dados

### JSON (`panel_db.json`)

`AppRecord` ganha:

```
AppRecord += {
  sourceType: 'git' | 'dockerfile' | 'image' | 'compose'
  buildConfig?: {
    runtime: 'node' | 'python' | 'static' | 'go' | 'rust' | 'php' | 'java' | 'ruby' | 'bun' | 'deno' | 'docker'
    version?: string            // '3.12', '20', '1.22', '8.3'; validada por runtime
    rootDir?: string            // monorepo; seguro-por-segmento, sem '..'
    dockerfilePath?: string     // quando runtime = docker
    installCommand?: string
    buildCommand?: string
    startCommand?: string
    packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'uv' | 'pipenv' | 'go' | 'cargo' | 'composer' | 'maven' | 'gradle' | 'bundler'
    source: 'detected' | 'toml' | 'manual'   // de onde veio; manual vence
  }
  processes?: Array<{
    name: string                // 'web' | 'worker' | 'beat' ...; [a-z][a-z0-9-]{0,23}
    type: 'web' | 'worker' | 'cron' | 'release'
    command: string
    schedule?: string           // só cron; mesma validação do cron.service
    replicas?: number           // só worker; 1..4
    limits?: ResourceLimits     // herda do app se ausente
  }>
  deploy?: {
    strategy: 'blue-green' | 'recreate'      // default blue-green se web tem healthcheck
    onTag?: string                           // glob 'v*' → deploy produção
    previews?: { enabled: boolean; maxConcurrent: number; ttlHours: number; domainPattern: string }
    hooks?: { preDeploy?: string; postDeploy?: string }   // rodam no container do release
    cache: boolean                           // default true
  }
  gitProvider?: 'github' | 'gitlab' | 'gitea' | 'bitbucket' | 'generic'
  deployKey?: { publicKey: string; privateKey🔒: string; fingerprint: string }
}
```

`deployments[]` ganha `slot`, `processes[]` (container por processo), `previewOf?` (número do PR), `tag?`, `recipeHash`, `cacheHit: boolean`.

Nova coleção `appPreviews[]`: `{ id, appId, prNumber, branch, headSha, domain, containerIds[], createdAt, expiresAt, status }`. Entra em `DEFAULT_DATA` e `DatabaseSchema` juntas.

### `aegis.toml` (no repositório, opcional)

```toml
[build]
runtime = "python"
version = "3.12"
root = "services/api"
install = "uv sync --frozen"
start = "uvicorn app.main:app --host 0.0.0.0 --port 8000"

[processes.worker]
command = "celery -A app worker -l info"
replicas = 1

[processes.beat]
type = "cron"
schedule = "*/5 * * * *"
command = "python manage.py send_digest"

[release]
command = "python manage.py migrate --noinput"

[deploy]
strategy = "blue-green"
on_tag = "v*"
```

Precedência: `manual` (painel) > `toml` > `detected`. Um campo vindo do toml aparece no editor como somente leitura com o aviso “definido em aegis.toml”.

### Disco

- `DATA_DIR/builds/<appId>` (já existe) — clone.
- `DATA_DIR/apps/<appId>/volumes/*` — único caminho de host permitido para bind em compose.
- Cache de build: imagem `aegis-cache-<name>:deps` por app; pruning já coberto pelo `BuildsCleanupService`.

---

## Catálogo de runtimes e receitas

| Runtime | Detecção | Gerenciadores | Versão default / permitidas | Receita (resumo) | Fase |
|---------|----------|---------------|-----------------------------|------------------|------|
| `node` | `package.json` | npm, pnpm, yarn, bun | 20 / 18, 20, 22 (`engines.node` respeitado) | já existe; ganha `version`, cache de `node_modules`, usuário `node` | 0 |
| `static` | `index.html` sem `package.json`, ou `buildCommand` com `outputDir` | — | nginx:alpine | já existe; ganha `outputDir` e cabeçalhos de cache | 0 |
| `python` | `requirements.txt`, `pyproject.toml`, `Pipfile`, `uv.lock`, `*.py` | pip, poetry, **uv**, pipenv | 3.12 / 3.10–3.13 (`requires-python` respeitado) | multi-stage: deps em camada própria; `gunicorn`/`uvicorn` conforme framework; `release` sugerido para Django/Alembic; usuário não-root | 1 |
| `go` | `go.mod` | go modules | do `go.mod` / 1.21+ | build estático em `golang:<v>-alpine`, runtime `gcr.io/distroless/static` ou `alpine`; `CGO_ENABLED=0` | 4 |
| `rust` | `Cargo.toml` | cargo | stable | `cargo build --release` com cache de `target`; runtime `debian-slim` | 4 |
| `php` | `composer.json` | composer | 8.3 / 8.1–8.3 | Laravel/Symfony detectados; `php-fpm` + nginx na mesma imagem; `release` = `artisan migrate --force` | 4 |
| `java` | `pom.xml`, `build.gradle(.kts)` | maven, gradle | 21 / 17, 21 | build em `eclipse-temurin:<v>-jdk`, runtime `-jre`; Spring Boot detectado pela porta 8080 | 4 |
| `ruby` | `Gemfile` | bundler | 3.3 / 3.2, 3.3 | Rails detectado; `puma`; `release` = `rails db:migrate` | 4 |
| `bun` | `bun.lockb` + `bun` em `engines`/scripts | bun | latest LTS | `oven/bun`; distinto de `node+bun` só quando o start é `bun run` | 4 |
| `deno` | `deno.json(c)` | deno | 2.x | `denoland/deno`; `deno task start` | 4 |
| `docker` | `Dockerfile` (ou `dockerfilePath`) | — | — | já existe; ganha `dockerfilePath` e `buildArgs` públicos | 0 |
| `compose` | `docker-compose.yml`/`compose.yaml` como origem | — | — | ver fase 5; allowlist de chaves | 5 |

Toda receita: `HEALTHCHECK`, usuário não-root, `EXPOSE` coerente com `internalPort`, `.dockerignore` gerado se ausente, tamanho final da imagem no log.

---

## Pipeline de deploy (alvo)

1. **Gatilho**: manual, webhook push, webhook tag (casa `deploy.onTag`), webhook PR (`opened`/`synchronize`/`closed`), redeploy, rollback.
2. **Fila** por nó (já existe). Preview e produção do mesmo app não se supersedem.
3. **Fonte**: daemon-git no nó (já existe) ou clone no painel; `rootDir` aplicado; `aegis.toml` lido e validado.
4. **Resolver `buildConfig`**: manual > toml > detector. Diferença em relação ao deploy anterior vai para o log (“runtime mudou de 3.11 para 3.12”).
5. **Receita**: Dockerfile gerado (ou nativo). `recipeHash` gravado.
6. **Build** com cache (`--cache-from aegis-cache-<name>:deps`), args públicos apenas (já existe).
7. **`release`** (se houver): container efêmero com a imagem nova, mesma env, sem porta; falha → deploy `failed`, nada trocado.
8. **Slot `green`**: `aegis-app-<name>--<deploymentId>` sobe em porta livre do `PortService`; readiness pelo healthcheck.
9. **Swap**: Caddy regenera com upstream do `green`, valida, recarrega (já existe o fluxo validar-depois-recarregar). Para apps sem domínio, a porta pública é remapeada: `recreate` obrigatório e avisado.
10. **Processos**: `worker`/`cron` novos sobem; antigos param depois do swap.
11. **Drenagem**: `blue` recebe `SIGTERM`, `t: 15`, removido. Imagem anterior fica para rollback (keep-3 já existe).
12. **`post_deploy` hook** e notificação (já existe).

Rollback continua por imagem `:<deploymentId>`; agora também troca slot via Caddy em vez de parar-e-subir.

---

## Contratos de API

Sob `/api`, JWT, gates existentes. Mutação exige `requireWrite`; deploy key, compose e previews em domínio exigem `requireAdmin`.

| Método | Rota | Gate | Descrição |
|--------|------|------|-----------|
| POST | `/apps/inspect-repo` | write | já existe; passa a devolver `buildConfig` proposto + `aegis.toml` encontrado + processos sugeridos |
| GET | `/apps/:id/recipe` | auth | Dockerfile que o próximo deploy usaria + origem de cada campo |
| PUT | `/apps/:id/build-config` | write | salva `buildConfig` manual; valida versão por runtime |
| PUT | `/apps/:id/processes` | write | lista de processos; `cron` valida `schedule` |
| PUT | `/apps/:id/deploy-config` | write (previews/domínio: admin) | estratégia, `onTag`, hooks, cache, previews |
| POST | `/apps/:id/deploy-key` | **admin** | gera par ED25519; devolve só a pública + fingerprint |
| DELETE | `/apps/:id/deploy-key` | **admin** | remove |
| POST | `/apps/:id/run` | write | one-off: `{ command }` no container efêmero da release atual; stream via socket; timeout |
| GET | `/apps/:id/previews` | auth | previews ativos |
| DELETE | `/apps/:id/previews/:prNumber` | write | remove ambiente |
| POST | `/webhooks/deploy/:appId` | público + HMAC | já existe; passa a aceitar eventos `push` (branch e tag), `pull_request`, e cabeçalhos GitLab (`X-Gitlab-Token`), Gitea (`X-Gitea-Signature`), Bitbucket |
| GET | `/apps/stats` | auth | agregados: deploys hoje, cache hit, downtime, previews |
| POST | `/apps/:id/deployments/:depId/promote` | write | promove imagem de preview para produção (sem rebuild) |

Compose (fase 5):

| POST | `/apps` com `sourceType: 'compose'` | **admin** | valida arquivo pela allowlist antes de salvar |
| GET | `/apps/:id/compose/plan` | auth | serviços, portas, volumes, o que foi bloqueado e por quê |

Erros em português, 400 `{ error }`, Zod como as demais rotas.

---

## Segurança — modelo de ameaças

| Ameaça | Onde | Mitigação |
|--------|------|-----------|
| Comando de build/start arbitrário | `buildConfig`, `aegis.toml`, hooks | roda **dentro** do container de build/release, nunca no host; sem shell do painel; `spawn` sem `shell: true`; sem acesso ao socket |
| `rootDir`/`dockerfilePath` com `..` | build config | mesma validação segmento-a-segmento de `utils/safe-path.ts`; sempre dentro do clone |
| Chave SSH vazando | deploy key | privada cifrada `aegis.v1:`; `toPublic` devolve pública + fingerprint; `known_hosts` fixo por provedor; `StrictHostKeyChecking=yes` |
| Webhook forjado (GitLab/Gitea) | webhook | segredo por app; GitLab token em comparação timing-safe; Gitea HMAC; sem aceitar payload sem assinatura |
| Preview como porta de entrada | previews | subdomínio isolado; sem acesso ao `env` de produção — variáveis `PREVIEW_*` separadas; TTL; cota por app; `admin` liga |
| Compose escalando privilégio | `sourceType: compose` | allowlist: recusa `privileged`, `cap_add`, `pid: host`, `network_mode: host`, `devices`, bind fora de `DATA_DIR/apps/<id>`, `/var/run/docker.sock`; portas sempre `127.0.0.1` a menos que haja domínio |
| Cache envenenado entre apps | build cache | imagem de cache por app (`aegis-cache-<name>`); nunca compartilhada |
| Imagem base maliciosa via `version` | receitas | `version` só escolhe tag numa lista por runtime; imagem base fixa por runtime, nunca livre |
| Migração rodando duas vezes | `release` | lock por app na fila (já existe); `release` só depois do build, uma vez por deployment |
| One-off `run` como shell root | `/apps/:id/run` | mesmo container/usuário não-root da receita; timeout 10 min; `developer` pode, `viewer` não; auditoria |
| Preview comentando no PR fora de LOCAL_MODE | integração provedor | guardado por LOCAL_MODE como alertas |

---

## Fases

### Fase 0 — Build config persistida + `aegis.toml`

- [x] `buildConfig` no `AppRecord`, schema Zod, `toPublic` inalterado (não há segredo aí)
- [x] Parser e validador de `aegis.toml` (função pura; erros em português com linha)
- [x] Precedência manual > toml > detector; log de diferença por deploy
- [x] `inspect-repo` devolve proposta + campos do toml + processos sugeridos
- [x] `GET /apps/:id/recipe`
- [x] `version` para Node (18/20/22) e `outputDir` para estático
- [x] Editor: aba **Build** no detalhe do app (runtime, versão, comandos, subpasta) com selo de origem por campo
- [x] Cache de build por app (`--cache-from`), `cacheHit` no deployment; `--no-cache` automático após falha de cache

**Aceite:** monorepo com `rootDir: apps/api` deploya; mudar `version` para 22 aparece no Dockerfile do `recipe`; segundo deploy sem mudança de deps é pelo menos 50% mais rápido no log.

### Fase 1 — Python de verdade

- [x] Receita multi-stage: `pip`, `poetry` (export ou `poetry install --only main`), **`uv`** (`uv sync --frozen`), `pipenv`
- [x] `version` 3.10–3.13; `requires-python` do `pyproject` respeitado
- [x] Django: `release = migrate --noinput` sugerido; `collectstatic` na build quando `STATIC_ROOT` existir; `gunicorn` com workers pela CPU do limite
- [x] FastAPI/Flask: `uvicorn`/`gunicorn` com porta do `internalPort`
- [x] Processos: `worker` (Celery/RQ/arq) e `cron` (`manage.py <cmd>`) na mesma imagem
- [x] `.dockerignore` gerado (`.venv`, `__pycache__`, `*.pyc`, `.git`)
- [x] Usuário não-root; `PYTHONDONTWRITEBYTECODE`, `PYTHONUNBUFFERED`

**Aceite:** três repos reais — Django com Poetry, FastAPI com uv, Flask com requirements — deployam sem Dockerfile; Django com migração quebrada falha no `release` e o app anterior continua respondendo.

### Fase 2 — Deploy sem queda + hooks

- [x] `deploy.strategy`; default `blue-green` quando `web` tem healthcheck
- [x] Slot `green` em porta livre; readiness; Caddy troca upstream; `blue` drena com `SIGTERM` e `t: 15`
- [x] App sem domínio: aviso e `recreate`
- [x] Processo `release` antes do swap; falha aborta
- [x] Hooks `pre_deploy`/`post_deploy` dentro do container da release
- [x] Rollback via swap de slot
- [x] `downtimeMs` medido pelo probe e gravado no deployment; card mostra “sem queda” ou os ms

**Aceite:** deploy de app `web` com healthcheck sob `curl` em loop: zero erros 5xx; readiness falhando deixa o `blue` no ar e o deploy `failed`.

### Fase 3 — CI/CD

- [x] Webhook aceita `push` de tag; `deploy.onTag` glob decide produção
- [x] Previews por PR: `opened`/`synchronize` cria/atualiza, `closed` remove; subdomínio `pr-<n>.<app>.<dominio-base>`; TTL; cota; `PREVIEW_*` env
- [x] `promote` de imagem de preview para produção
- [x] Deploy key SSH ED25519 por app; clone via `git@`; `known_hosts` fixo por provedor
- [x] GitLab, Gitea, Bitbucket: verificação de assinatura/token e parse de eventos
- [x] Comentário no PR com URL do preview (GitHub/GitLab/Gitea), bloqueado em LOCAL_MODE
- [x] Aba **CI/CD** mostra: branch de produção, tag pattern, previews ativos, chave pública para colar no provedor, workflow YAML (já existe)

**Aceite:** PR aberto no GitHub gera URL em < 3 min; fechar remove; push `v1.2.0` faz deploy de produção; repo privado clona com deploy key sem PAT.

### Fase 4 — Novos runtimes

- [x] Go, Rust, PHP (Laravel/Symfony), Java (Spring/Maven/Gradle), Ruby (Rails), Bun, Deno — receita, detecção, versão, `release` sugerido onde faz sentido
- [x] Cada receita com teste de geração (snapshot do Dockerfile) e usuário não-root
- [x] Ícone e rótulo no card e no `inspect`

**Aceite:** um repo exemplo de cada runtime deploya sem Dockerfile e responde no healthcheck.

### Fase 5 — Stacks compose e processos sem porta

- [x] `sourceType: 'compose'` (admin): upload/colar ou do repositório; validador com allowlist e `plan` explicando bloqueios
- [x] Serviços do compose viram containers `aegis-app-<name>-<service>`, rede do painel, portas `127.0.0.1` salvo domínio
- [x] Um serviço marcado `web` recebe o Caddy; os outros são internos
- [x] `worker` com `replicas` (1–4) e `cron` com `schedule` como processos de qualquer app
- [x] One-off `POST /apps/:id/run` com stream
- [x] Métricas e logs por processo (o `AppLogStore` já existe; ganha `process`)

**Aceite:** stack `app + redis + worker` sobe de um compose; `privileged: true` é recusado com mensagem clara; `run "python manage.py createsuperuser"` executa e encerra.

---

## User Stories

**Build**
1. Como developer, quero que o painel guarde runtime, versão e comandos do meu app, para o próximo deploy não redetectar errado.
2. Como developer, quero um `aegis.toml` no repositório, para a configuração de deploy andar com o código e passar por code review.
3. Como developer, quero ver o Dockerfile que o painel vai usar, para confiar no que roda.
4. Como developer, quero apontar uma subpasta do monorepo, para deployar `apps/api` sem separar o repo.
5. Como developer, quero cache de dependências, para um deploy de uma linha de código não reinstalar tudo.

**Python**
6. Como developer, quero deployar um projeto Poetry ou uv sem escrever Dockerfile, para usar a ferramenta que já uso.
7. Como developer, quero escolher Python 3.12, para não ficar preso ao 3.11.
8. Como developer, quero que as migrações do Django rodem antes de trocar o tráfego, para uma migração quebrada não derrubar o app.
9. Como developer, quero um worker Celery da mesma imagem, para não criar um segundo app só para a fila.
10. Como developer, quero um comando agendado (`manage.py send_digest`) como processo do app, para não configurar cron à parte.

**Deploy**
11. Como admin, quero deploy sem queda, para o cliente não ver 502 a cada push.
12. Como developer, quero ver quantos milissegundos o app ficou fora, para saber se o deploy foi limpo.
13. Como developer, quero hooks antes e depois do deploy, para aquecer cache ou avisar um serviço.
14. Como developer, quero rollback que troca de slot, para voltar em segundos.

**CI/CD**
15. Como developer, quero um ambiente por pull request com URL própria, para revisar antes do merge.
16. Como developer, quero que fechar o PR apague o ambiente, para não acumular containers.
17. Como developer, quero promover a imagem do preview para produção, para não rebuildar o que já testei.
18. Como admin, quero deploy de produção só por tag `v*`, para push na main não ir direto ao cliente.
19. Como admin, quero uma deploy key SSH por app, para não colar meu token pessoal do GitHub no painel.
20. Como developer, quero usar GitLab ou Gitea, para não depender do GitHub.
21. Como developer, quero o link do preview no próprio PR, para o revisor não abrir o painel.

**Runtimes**
22. Como developer, quero deployar Go, Rust, PHP, Java, Ruby, Bun e Deno sem Dockerfile, para o painel servir mais que Node e Python.
23. Como developer, quero que Laravel rode `artisan migrate` no release, para o mesmo padrão do Django valer no PHP.
24. Como developer, quero Spring Boot detectado pela porta 8080, para não ajustar `internalPort` na mão.

**Processos e stacks**
25. Como admin, quero subir um `docker-compose.yml` que o cliente já tem, para migrar uma stack sem reescrever.
26. Como admin, quero que o painel recuse `privileged` e socket do Docker no compose, para uma stack de cliente não virar root no host.
27. Como developer, quero um worker sem porta, para processar fila sem fingir que é site.
28. Como developer, quero rodar um comando único na release atual, para criar o superusuário sem terminal de host.
29. Como viewer, quero logs por processo, para separar o `web` do `worker`.

**Operação**
30. Como admin, quero estatísticas de deploy (hoje, cache, downtime, previews), para saber se o pipeline está saudável.
31. Como admin, quero que tudo isso respeite LOCAL_MODE, para a cópia do notebook não comentar em PR nem pedir certificado.
32. Como admin, quero que o self-update continue reconstruindo sem 502, para cada fase sair pelo botão Atualizar.

---

## Implementation Decisions

- **Receitas próprias, não Nixpacks/Buildpacks.** Manter `ProjectDetector` gerando Dockerfiles: auditável, sem binário extra na imagem do backend, sem dependência de rede no build. Cada receita vira função pura `(inspection, buildConfig) → Dockerfile` com teste de snapshot. Nixpacks fica em *Perguntas abertas*.
- **`buildConfig` é do app; `aegis.toml` é do repositório.** Precedência manual > toml > detector, resolvida numa função pura `resolveBuildConfig` e registrada no deployment (`configSource` por campo).
- **Processo é container, release é imagem.** Nome `aegis-app-<name>` para `web` (compatibilidade com Caddy e `naming.ts`), `aegis-app-<name>-<process>` para os demais, `aegis-app-<name>--<deploymentId>` para slot em transição. `naming.ts` continua a única fonte.
- **Blue/green pelo Caddy, não por proxy novo.** O `CaddyService` já regenera, valida e recarrega. A troca de upstream reaproveita `app-upstream.ts`. Sem domínio, não há como trocar porta pública sem queda: `recreate` com aviso.
- **`release` e hooks rodam em container efêmero da imagem nova**, com a env do app, sem porta, com os mesmos limites. Nunca `exec` no host, nunca no container do painel.
- **Deploy key:** ED25519 gerado no backend com `crypto`; privada cifrada; clone via `GIT_SSH_COMMAND` com `IdentityFile` em arquivo temporário `0600` apagado depois; `known_hosts` embutido por provedor (github.com, gitlab.com, bitbucket.org) e configurável para Gitea self-hosted.
- **Previews:** app-filho lógico do app pai (`previewOf`), mesma `buildConfig`, env `PREVIEW_*` + `AEGIS_PREVIEW=1`, domínio `pr-<n>.<base>` com certificado do Caddy (interno em LOCAL_MODE). Cota default 3 por app, TTL 72 h, limpeza pelo scheduler do painel.
- **Webhooks multi-provedor:** um parser por provedor devolvendo `{ kind: 'push'|'tag'|'pr', branch, tag, pr: { number, action, headSha } }`; verificação antes do parse; rota única já existente.
- **Compose:** `docker compose` já está na imagem do backend (self-update usa). O painel gera um `compose.override.yml` com nomes, rede, labels `aegis.managed`, portas em `127.0.0.1` e recusa o arquivo se a allowlist falhar. Project name = `aegis-app-<name>`.
- **Cache:** `docker build --cache-from aegis-cache-<name>:deps` + `--build-arg BUILDKIT_INLINE_CACHE=1`; após build, tag da camada de deps. Falha de cache → retry `--no-cache` uma vez.
- **UI:** detalhe do app ganha abas **Build** e **Processos**; **CI/CD** existente cresce (tag, previews, deploy key). Card mostra runtime/versão, estratégia e downtime do último deploy. Nada de tela nova de topo.
- **Auditoria:** `run`, `deploy-key`, `compose` e `promote` entram no `AuditStore` como as mutações sensíveis existentes.

Formas decididas (não são código de produção):

```
type ResolvedBuildConfig = BuildConfig & { sourceByField: Record<keyof BuildConfig, 'manual'|'toml'|'detected'> }

type Recipe = (inspection: ProjectInspectionResult, cfg: ResolvedBuildConfig) => { dockerfile: string; internalPort: number; warnings: string[] }

type WebhookEvent =
  | { kind: 'push'; branch: string; headSha: string }
  | { kind: 'tag'; tag: string; headSha: string }
  | { kind: 'pr'; number: number; action: 'opened'|'synchronize'|'closed'; branch: string; headSha: string }
```

---

## Testing Decisions

Testar funções puras e costuras já existentes. Nenhum teste faz build Docker real.

| Costura | Casos | Prior art |
|---------|-------|-----------|
| `parseAegisToml` / `resolveBuildConfig` | precedência manual > toml > detector; `rootDir` com `..` recusado; versão fora da lista recusada; erro com linha | `safe-path.test.ts`, `cron-schedule.test.ts` |
| Receitas (`Recipe`) | snapshot do Dockerfile por runtime/framework/versão; sempre `USER` não-root e `HEALTHCHECK`; `EXPOSE` = `internalPort` | `build-env.test.ts` |
| Detector Python | Poetry, uv, pipenv, requirements; `requires-python`; Django/FastAPI/Flask | novo, mesmo estilo de `remote-build.test.ts` (fixtures em tmp) |
| Plano blue/green (função pura) | com healthcheck → blue-green; sem → recreate + aviso; sem domínio → recreate; ordem release → green → swap → drain | `health-probe.test.ts` |
| `CaddyService` upstream por slot | Caddyfile aponta para `green` após swap; rollback volta | `app-upstream.test.ts` |
| Parsers de webhook | GitHub push/tag/PR; GitLab token; Gitea HMAC; Bitbucket; payload sem assinatura recusado | `webhook-auth.test.ts` |
| Previews (função pura de ciclo de vida) | opened cria; synchronize atualiza; closed remove; cota; TTL expirado | `deploy-queue.test.ts` |
| Deploy key | par gerado; `toPublic` sem privada; fingerprint estável | `node.test.ts` (`toPublic`) |
| Validador de compose | recusa `privileged`, socket, bind fora de `DATA_DIR/apps/<id>`, `network_mode: host`; portas forçadas a `127.0.0.1`; `plan` explica | `safe-path.test.ts` |
| `processes` | nomes válidos; `cron` exige `schedule` válido; `replicas` 1–4; nomes de container via `naming.ts` | `cron-schedule.test.ts`, `naming` |
| Fila | preview e produção do mesmo app não se supersedem | `deploy-queue.test.ts` |
| Frontend | aba Build mostra selo de origem por campo; aba CI/CD mostra chave pública e previews | `EditAppModal.test.tsx` |

Um teste bom: entra inspeção + config, sai Dockerfile/plano; entra payload, sai `WebhookEvent`. Sem Docker, sem rede.

---

## Riscos

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Receitas viram manutenção infinita (cada framework um caso) | alta | lentidão | `aegis.toml` cobre o que a receita não cobre; receita só para o comum |
| Blue/green dobra RAM durante o deploy | média | OOM em VPS pequena | checar `resourceLimits` × RAM livre antes; se não couber, `recreate` com aviso |
| Previews consomem portas e disco | média | VPS cheia | cota, TTL, `BuildsCleanupService` estendido |
| Compose de cliente depende de recurso bloqueado | média | migração frustrada | `plan` explica cada bloqueio e sugere alternativa (volume nomeado) |
| Deploy key SSH e `known_hosts` de Gitea self-hosted | baixa | clone falha | campo de fingerprint no app, mesmo padrão do `ServerNode.sshHostFingerprint` |
| Cache de build esconde bug de dependência | baixa | build “verde” errado | botão “deploy sem cache” e `--no-cache` automático após falha |

---

## Perguntas abertas

1. **Nixpacks/Railpack como builder opcional** para runtimes sem receita? Proposta: não agora — binário extra na imagem do backend e Dockerfile menos auditável. Reavaliar depois da fase 4.
2. **Domínio base para previews**: um por app (`pr-<n>.<app>.preview.<painel>`) ou configurado globalmente em Settings? Proposta: global em Settings com override por app.
3. **`developer` pode criar deploy key?** Proposta: não — a chave dá acesso ao repositório; admin gera e o developer só copia a pública.
4. **Compose: aceitar `build:` no serviço** (builda no painel) ou só imagens prontas? Proposta: aceitar `build:` com contexto dentro do clone, mesma allowlist de caminho.
5. **Blue/green para apps sem domínio**: vale criar um `web` interno + porta pública trocada pelo Caddy em `:porta`? Proposta: não; sem domínio é `recreate` e ponto.

---

## Out of Scope

- Kubernetes, Swarm, autoscaling horizontal, múltiplas réplicas de `web` com balanceamento.
- Registry privado do painel para imagens; imagens continuam locais ao nó (keep-3).
- Build em runner externo (GitHub Actions builda e o painel só puxa) — o helper de workflow já cobre o gatilho; build remoto por Actions fica para outro PRD.
- Marketplace de templates novos (o catálogo de 12 continua; template é imagem, não pipeline).
- Serverless/functions, edge, WebAssembly.
- Bancos gerenciados como parte do app (continuam na aba Bancos; compose pode trazer Redis/Postgres da stack do cliente).
- Migrar o estado do painel para banco (ADR-0001).
- Trocar Caddy por outro proxy.

---

## Further Notes

- Respostas curtas às perguntas que originaram este PRD:
  - **Python/pip:** já roda, mas preso a 3.11 + `pip`. A fase 1 fecha Poetry, uv, versão, worker e migração no `release`.
  - **CI/CD:** hoje é push → webhook → build → deploy, com rollback. Faltam preview por PR, deploy por tag, hooks, GitLab/Gitea, deploy key SSH e cache. Fases 2 e 3.
  - **Tipos mais “tecnológicos”:** Go, Rust, PHP/Laravel, Java/Spring, Ruby/Rails, Bun, Deno (fase 4); worker, cron, one-off e stacks compose (fase 5); blue/green (fase 2).
- Deploy de cada fase: merge em `main` → botão **Atualizar** no topo do painel.
- Primeira fatia recomendada: **Fase 0 + Fase 1** — é o que destrava Python profissional e cria a base (`buildConfig`, `aegis.toml`, `release`) que as outras fases usam. Blue/green (fase 2) logo depois, porque é o que o cliente sente.
- Cada runtime novo entra com: detecção, receita com snapshot, versão permitida, `release` sugerido, ícone, linha na tabela de testes.
