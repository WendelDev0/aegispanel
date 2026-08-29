# 🛡️ AegisPanel - Painel de Controle de VPS e Servidor Local

Um painel completo, moderno e **100% self-hosted** para transformar qualquer **VPS Ubuntu** (ex: Contabo, Hetzner, AWS) ou **servidor físico local** na sua empresa em uma plataforma completa de deploy e infraestrutura, eliminando a dependência do Vercel, Supabase e Heroku.

---

## ✨ Funcionalidades Principais

- 📊 **Dashboard em Tempo Real**: Monitoramento de CPU, Memória RAM, Discos (SSD/NVMe) e Tráfego de Rede via WebSockets.
- 🚢 **Deploy de Aplicações (Substituto Vercel)**: Hospede APIs Node.js, Next.js, Python, Laravel, Go e imagens Docker com gerenciamento de variáveis de ambiente (`.env`) e logs ao vivo.
- 🗄️ **Bancos de Dados 1-Clique (Substituto Supabase)**: Crie instâncias de **PostgreSQL**, **MySQL**, **MariaDB**, **Redis** e **MongoDB** com persistência de volumes e strings de conexão instantâneas.
- 🐳 **Gerenciador Docker Integrado**: Visualize, inicie, pare, reinicie e inspecione contêineres e seus consumos de recursos.
- 🌐 **Domínios & SSL Automático (HTTPS)**: Mapeie qualquer domínio para as portas de seus serviços com emissão automática de certificados Let's Encrypt via Caddy Proxy.
- 💻 **Terminal Web Interativo (Web SSH)**: Terminal completo direto no navegador com suporte ao shell do host ou terminal interno de contêineres Docker via `xterm.js`.
- 📈 **Monitor de Processos**: Veja em tempo real os processos que mais consom CPU e memória na sua máquina.

---

## 🚀 Como Executar Localmente (Desenvolvimento)

### 1. Iniciar o Backend
```bash
cd backend
npm install
npm run dev
```
O servidor backend iniciará na porta `4000`.

### 2. Iniciar o Frontend
```bash
cd frontend
npm install
npm run dev
```
O painel estará acessível no seu navegador em `http://localhost:3000`.

---

## 📦 Como Instalar na VPS Contabo / Ubuntu (1-Click)

Ao contratar sua VPS na Contabo ou preparar seu servidor na empresa:

1. Acesse o terminal SSH da máquina como root:
```bash
ssh root@SEU_IP_DA_VPS
```

2. Execute o instalador automático:
```bash
curl -fsSL https://raw.githubusercontent.com/seu-usuario/painiel-vps/main/install.sh | bash
```
ou clone o repositório e execute:
```bash
git clone https://github.com/seu-usuario/painiel-vps.git /opt/aegispanel
cd /opt/aegispanel
chmod +x install.sh
./install.sh
```

3. Abra no navegador:
```
http://SEU_IP_DA_VPS:3000
```
No primeiro acesso, você criará a senha mestre do seu usuário Administrador.

---

## 📁 Estrutura do Projeto

```
painiel-vps/
├── backend/                # Backend API & Daemon do Servidor (Node.js + TS + Dockerode)
│   ├── src/
│   │   ├── config.ts       # Configurações de ambiente e portas
│   │   ├── server.ts       # Express + Socket.IO + Servidor Web
│   │   ├── db/             # Banco JSON embutido (Zero dependência externa)
│   │   ├── services/       # Docker, Sistema, Caddy SSL, Bancos e Terminal
│   │   └── routes/         # Endpoints de Autenticação, Docker, Apps, etc.
│   └── Dockerfile
├── frontend/               # Frontend Dashboard (React + Vite + Tailwind + Lucide + XTerm)
│   ├── src/
│   │   ├── components/     # Sidebar, Navbar, etc.
│   │   ├── pages/          # Dashboard, Apps, Databases, Containers, Domínios, Terminal
│   │   └── services/       # Axios API client e WebSockets
│   └── Dockerfile
├── docker-compose.yml      # Stack pronta para produção com Caddy SSL
├── install.sh              # Script 1-Click para Ubuntu/Debian
└── README.md
```
