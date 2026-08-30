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

---

## ⚡ Instalação na VPS (Ubuntu 22.04 / 24.04)

Acesse o terminal SSH da máquina e execute:

```bash
curl -fsSL https://raw.githubusercontent.com/WendelDev0/aegispanel/main/install.sh | bash
```

O script instala o Docker, configura o firewall, **gera os segredos exclusivos daquela máquina** em `/opt/aegispanel/.env` e sobe a stack.

Abra no navegador:

```
http://SEU_IP_DA_VPS:3000
```

No primeiro acesso você cria a conta de administrador (senha de no mínimo 12 caracteres).

### Portas abertas pelo instalador

| Porta | Uso |
|-------|-----|
| 22    | SSH |
| 80/443| Caddy (HTTP/HTTPS e emissão de SSL) |
| 3000  | Painel web |

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
| `PANEL_BIND` | Interface do painel. Use `127.0.0.1` depois de publicar o painel por HTTPS via Caddy. |
| `CORS_ORIGINS` | Origens de navegador permitidas. Vazio = apenas mesma origem (padrão correto). |

> ⚠️ Trocar a `ENCRYPTION_KEY` depois que bancos já foram criados torna as senhas gravadas ilegíveis. O painel avisa em vez de gravar um valor corrompido por cima.

### Perfis de acesso

| Perfil | Pode |
|--------|------|
| `admin` | Tudo: usuários, terminal do host, tarefas shell, firewall, import/export do estado do painel. |
| `developer` | Apps, deploys, bancos, domínios, arquivos, backups e terminal de contêineres. |
| `viewer` | Somente leitura. |

---

## 🚀 Executando localmente

```bash
# Backend (gera .env.local automaticamente em desenvolvimento)
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

Abra **`http://localhost:3000`**.

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
