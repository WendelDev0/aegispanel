# 🛡️ AegisPanel - Painel de Controle de VPS e Servidor Local (Open Source)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/WendelDev0/aegispanel?style=social)](https://github.com/WendelDev0/aegispanel)

Um painel completo, moderno e **100% self-hosted e open-source** para transformar qualquer **VPS Ubuntu** (ex: Contabo, Hetzner, AWS) ou **servidor físico local** em uma plataforma de infraestrutura e deploy contínuo, eliminando a dependência do Vercel, Supabase e Heroku.

---

## ✨ Funcionalidades Principais

- 📊 **Dashboard em Tempo Real**: Monitoramento de CPU, Memória RAM, Discos (SSD/NVMe) e Tráfego de Rede via WebSockets autenticados.
- 🔄 **CI/CD com GitHub & Auto-Deploy**: Deploys automáticos no `git push` via webhook assinado (HMAC SHA-256), histórico de builds com log completo em streaming e gerador de GitHub Actions (`deploy.yml`).
- ↩️ **Rollback em 1 clique**: Cada deploy é publicado com uma tag versionada; voltar para uma versão anterior reinicia a imagem exata daquele commit.
- 🗄️ **Bancos de Dados (Substituto Supabase)**: Provisionamento em 1-clique de **PostgreSQL 16**, **MySQL 8.4**, **MariaDB 11**, **Redis 7** e **MongoDB 7**, com senhas geradas com alta entropia e **criptografadas com AES-256-GCM em repouso**.
- 💻 **Database Studio Embutido**: Executor de consultas com visualização de tabelas, executado via API do Docker (sem shell intermediário).
- 📂 **Gerenciador de Arquivos & Editor de Código**: Explorador e editor com proteção contra *path traversal* e contra escapes por link simbólico.
- 🌐 **Domínios & SSL Automático**: Mapeamento de domínios, verificação real de propagação de DNS e inspeção real do certificado TLS servido, com emissão de HTTPS grátis (Let's Encrypt) via Caddy.
- 🛡️ **Perfis de Acesso (RBAC)**: `admin`, `developer` e `viewer`, com o terminal do host e a execução de comandos restritos ao administrador.
- 💾 **Backups & Restauração**: Dumps reais via `pg_dump`/`mysqldump`; um backup que falha é registrado como `failed`, nunca como concluído.
- ⏰ **Agendador de Tarefas**: Rotinas cron de backup, shell e webhook realmente executadas pelo daemon.
- 🖥️ **Terminal Web Interativo**: Terminal no navegador com `xterm.js`, no shell do host ou dentro de contêineres.
- 🔔 **Alertas Discord / Telegram / WhatsApp**: Notificações quando CPU, memória **ou disco** ultrapassam os limites configurados.

> 🚧 **Em desenvolvimento — Cluster Multi-Servidor**: a API para registrar nós já existe (`/api/nodes`), mas ainda **não há interface** e o painel administra apenas o Docker da máquina onde roda. Não conte com esse recurso ainda.

---

## ⚡ Instalação na VPS (Ubuntu 22.04 / 24.04)

Acesse o terminal SSH da máquina e execute:

```bash
curl -fsSL https://raw.githubusercontent.com/WendelDev0/aegispanel/main/install.sh | bash
```

O script instala o Docker, configura o firewall, **gera os segredos exclusivos daquela máquina** em `/opt/aegispanel/.env`, grava `AEGIS_COMPOSE_DIR` (para o self-update achar o compose de dentro do container) e sobe a stack.

O painel fica preso ao loopback durante o bootstrap. Acesse por um túnel SSH:

```
ssh -L 3000:127.0.0.1:3000 usuario@SEU_IP_DA_VPS
# depois abra http://localhost:3000
```

No primeiro acesso você cria a conta de administrador (senha de no mínimo 12 caracteres).

Instalação em outro diretório:

```bash
AEGIS_INSTALL_DIR=/srv/aegispanel bash install.sh
```

O script recusa continuar se não houver `docker-compose.yml` nesse caminho, e grava `AEGIS_COMPOSE_DIR` no `.env` — sem isso o self-update dentro do container não acha o projeto.

### Portas abertas pelo instalador

| Porta | Uso |
|-------|-----|
| 22    | SSH |
| 80/443| Caddy (HTTP/HTTPS e emissão de SSL) |

A API (porta 4000) **não é publicada**: ela só é acessível pela rede interna do Docker, através do proxy do painel. Aplicações publicadas devem ser acessadas pelo domínio, via Caddy. Para expor uma porta específica, libere-a manualmente com `sudo ufw allow <porta>/tcp`.

---

## 🔐 Configuração de segurança obrigatória

O backend **não inicia em produção** sem estas duas variáveis. Isso é intencional: um valor padrão embutido no repositório seria idêntico em toda instalação do mundo, permitindo forjar um token de administrador e descriptografar as senhas de banco de qualquer servidor.

```bash
cp .env.example .env
openssl rand -hex 32   # cole em JWT_SECRET
openssl rand -hex 32   # cole em ENCRYPTION_KEY
chmod 600 .env
```

| Variável | Função |
|----------|--------|
| `JWT_SECRET` | Assina os tokens de sessão. |
| `ENCRYPTION_KEY` | Criptografa senhas de banco e tokens do GitHub em repouso. **Separada do JWT** para que rotacionar sessões não torne ilegível o que já foi gravado. |
| `PANEL_BIND` | Interface do painel. `127.0.0.1` é o padrão seguro; publique por HTTPS via Caddy ou túnel SSH. |
| `GEOIP_ENABLED` | Geolocalização externa de IPs. `false` é o padrão; ative apenas após revisar a política de privacidade. |
| `CORS_ORIGINS` | Origens de navegador permitidas. Vazio = apenas mesma origem (padrão correto). |
| `AEGIS_COMPOSE_DIR` | Caminho absoluto do clone com `docker-compose.yml`. Necessário para o self-update (o backend no container não vê o compose pelo cwd). O `install.sh` define como o diretório de instalação. Se o compose não existir nesse path, a instalação e o self-update falham em vez de adivinhar. |

> ⚠️ Trocar a `ENCRYPTION_KEY` depois que bancos já foram criados torna as senhas gravadas ilegíveis. O painel avisa em vez de gravar um valor corrompido por cima.

### Perfis de acesso

| Perfil | Pode |
|--------|------|
| `admin` | Tudo: usuários, terminal do host, tarefas shell, firewall, import/export do estado do painel. |
| `developer` | Apps, deploys, bancos, domínios de aplicações gerenciadas, arquivos, criação/remoção de backups e terminal de contêineres. Downloads, restauração de dumps e publicação de portas arbitrárias ficam com `admin`. |
| `viewer` | Somente leitura. |

---

## 🚀 Executando localmente

Rodar o painel na sua máquina **não interfere** na VPS nem em servidores de
terceiros. Fora de produção o painel entra em **modo local**, que é ligado por
padrão justamente porque o caminho perigoso é o silencioso: você restaura um
backup da VPS para depurar algo e a cópia local começa a pedir certificados
para domínios que não são dela e a disparar alertas nos canais reais da equipe.

Em modo local o painel:

| Comportamento | Motivo |
|---|---|
| Caddy emite certificados **internos** (`local_certs`), nunca fala com o Let's Encrypt | Pedir certificado para um domínio que aponta para a VPS falha, e falhas repetidas consomem o limite daquele domínio no servidor de verdade |
| Notificações Discord/Telegram/WhatsApp são **bloqueadas** e apenas registradas no log | Uma cópia local restaurada de produção carrega os webhooks e tokens reais |
| Agendador de cron **desligado** | O backup noturno e tarefas shell rodariam na sua máquina no horário do servidor |

Para permitir envios reais a partir da máquina local:
`AEGIS_ALLOW_OUTBOUND_ALERTS=true`. Para desligar o modo local por completo:
`AEGIS_LOCAL_MODE=false`.

> O painel só administra o Docker da **máquina onde ele roda**. Não existe
> caminho pelo qual uma instância local altere containers de outro servidor.

### Opção 1 — desenvolvimento com hot reload

```bash
# Backend (gera .env.local com segredos próprios na primeira execução)
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

Abra **`http://localhost:3000`**.

### Opção 2 — stack completa isolada em contêineres

```bash
npm run local:up      # sobe tudo
npm run local:logs    # acompanha o backend
npm run local:down    # derruba
```

Abra **`http://localhost:3001`**.

Essa stack usa nome de projeto, rede, volumes e dados (`./data-local`)
próprios, e publica tudo **apenas em `127.0.0.1`** nas portas 3001/8080/8443 —
então convive com uma instalação de produção na mesma máquina sem colidir e
sem ficar exposta na rede.

### Qualidade

```bash
npm run check     # typecheck do backend e do frontend + testes
npm test          # testes do backend (node:test, sem dependências extras)
```

---

## 📁 Estrutura do Projeto

```
aegispanel/
├── backend/                     # API & Daemon (Node.js + Express + Socket.IO + Dockerode)
│   ├── src/
│   │   ├── config.ts            # Ambiente e segredos (falha rápido se ausentes)
│   │   ├── server.ts            # HTTP, WebSocket autenticado, loop de métricas
│   │   ├── realtime.ts          # Instância do Socket.IO isolada (evita ciclo de imports)
│   │   ├── middleware/auth.ts   # authMiddleware, requireWrite, requireAdmin
│   │   ├── db/storage.ts        # Armazenamento JSON com escrita atômica
│   │   ├── utils/               # crypto (AES-256-GCM), safe-path, naming
│   │   ├── services/            # CI/CD, Docker, Sistema, Caddy, Bancos, Cron, Arquivos
│   │   └── routes/              # Endpoints REST e webhook do GitHub
│   ├── test/                    # Testes (node:test)
│   └── Dockerfile
├── frontend/                    # Dashboard (React + Vite + Tailwind + XTerm)
│   ├── src/
│   │   ├── hooks/useRoute.ts    # Rotas com histórico (deep link + botão voltar)
│   │   ├── components/
│   │   ├── pages/
│   │   └── services/            # Cliente Axios e WebSocket autenticado
│   └── Dockerfile
├── .github/workflows/ci.yml     # Typecheck, testes, build e verificação de segredos
├── docker-compose.yml
├── .env.example
├── install.sh
└── LICENSE
```

---

## 📄 Licença

Distribuído sob a licença **MIT Open-Source**. Veja `LICENSE`.
Desenvolvido por **[Wendel (WendelDev0)](https://github.com/WendelDev0)**.
