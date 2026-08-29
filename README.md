# 🛡️ AegisPanel - Painel de Controle de VPS e Servidor Local (Open Source)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/WendelDev0/aegispanel?style=social)](https://github.com/WendelDev0/aegispanel)

Um painel completo, moderno e **100% self-hosted e open-source** para transformar qualquer **VPS Ubuntu** (ex: Contabo, Hetzner, AWS) ou **servidor físico local** na sua empresa em uma plataforma completa de infraestrutura e deploy contínuo, eliminando a dependência do Vercel, Supabase e Heroku.

---

## ✨ Funcionalidades Principais

- 📊 **Dashboard em Tempo Real**: Monitoramento de CPU, Memória RAM, Discos (SSD/NVMe) e Tráfego de Rede via WebSockets.
- 🔄 **CI/CD com GitHub & Auto-Deploy**: Deploys automáticos no `git push` com Webhooks, histórico de builds e gerador de GitHub Actions (`deploy.yml`).
- 🗄️ **Bancos de Dados Seguros (Substituto Supabase)**: Provisionamento em 1-clique de **PostgreSQL 16**, **MySQL 8.4**, **MariaDB 11**, **Redis 7** e **MongoDB 7** com **criptografia AES-256-GCM** em repouso e gerador de senhas de alta entropia.
- 💻 **Database Studio Embutido**: Executor de consultas SQL interativo com visualização de tabelas e esquemas direto pelo navegador.
- 📂 **Gerenciador de Arquivos & Editor de Código**: Explorador de pastas e editor de arquivos `.env` com proteção contra *Path Traversal*.
- 🌐 **Domínios & SSL Automático (Hostinger Ready)**: Mapeamento de domínios com assistente de DNS para Hostinger e emissão de HTTPS grátis (Let's Encrypt / TLS 1.3) via Caddy.
- 🛡️ **Segurança & Firewall UFW**: Gerenciador visual de portas abertas/bloqueadas e auditoria de segurança.
- 💾 **Backups & Restauração**: Geração de dumps `.sql` e download seguro com 1 clique.
- 🖥️ **Terminal Web Interativo (Web SSH)**: Terminal completo direto no navegador com suporte ao shell do host ou terminal interno de contêineres Docker via `xterm.js`.
- 🔔 **Alertas Discord / Telegram**: Notificações automáticas caso a CPU, Memória ou Disco atinjam limites configuráveis.
- 🌍 **Cluster Multi-Servidor**: Gerencie sua VPS na nuvem e seu servidor físico local no mesmo painel.

---

## ⚡ Instalação Automatizada 1-Click na VPS (Ubuntu 22.04 / 24.04)

Ao contratar sua VPS na **Contabo** ou configurar o **servidor da empresa**:

Acesse o terminal SSH da sua máquina como root e execute:

```bash
curl -fsSL https://raw.githubusercontent.com/WendelDev0/aegispanel/main/install.sh | bash
```

Abra no navegador:
```
http://SEU_IP_DA_VPS:3000
```
No primeiro acesso, você criará a senha mestre do seu usuário Administrador.

---

## 🚀 Como Executar Localmente no seu Computador

### 1. Iniciar o Backend API
```bash
cd backend
npm install
npm run dev
```

### 2. Iniciar o Frontend Web Dashboard
```bash
cd frontend
npm install
npm run dev
```

Abra no navegador: **`http://localhost:3000`**

---

## 📁 Estrutura do Projeto

```
aegispanel/
├── backend/                # Backend API & Daemon (Node.js + Express + Socket.IO + Dockerode)
│   ├── src/
│   │   ├── config.ts       # Configurações de ambiente e portas
│   │   ├── server.ts       # Servidor HTTP, WebSockets e Alertas
│   │   ├── db/             # Armazenamento embutido (Zero dependência externa)
│   │   ├── utils/crypto.ts # Criptografia AES-256-GCM e gerador de senhas
│   │   ├── services/       # CI/CD, Docker, Sistema, Caddy SSL, Bancos e Arquivos
│   │   └── routes/         # Endpoints REST e Webhooks do GitHub
│   └── Dockerfile
├── frontend/               # Frontend Dashboard (React + Vite + Tailwind + Lucide + XTerm)
│   ├── src/
│   │   ├── components/     # Sidebar, Navbar com tooltips explicativos
│   │   ├── pages/          # 12 Módulos completos do painel
│   │   └── services/       # Axios API client e WebSockets
│   └── Dockerfile
├── docker-compose.yml      # Stack pronta para produção com Caddy SSL
├── install.sh              # Script 1-Click para Ubuntu/Debian
├── LICENSE                 # Licença MIT
└── README.md
```

---

## 📄 Licença

Distribuído sob a licença **MIT Open-Source**. Veja `LICENSE` para mais informações.
Desenvolvido por **[Wendel (WendelDev0)](https://github.com/WendelDev0)**.
