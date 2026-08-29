#!/usr/bin/env bash
# ==============================================================================
# AegisPanel - Script de Instalação Automatizada 1-Click para VPS Ubuntu / Debian
# Compatível com Contabo, Hetzner, AWS, DigitalOcean, e Servidores Locais
# Repositório: https://github.com/WendelDev0/aegispanel
# ==============================================================================

set -e

echo "======================================================================"
echo "🛡️  Instalando AegisPanel - Cloud & Server Management Platform"
echo "======================================================================"

# 0. Configurar fuso horário de Brasília
sudo timedatectl set-timezone America/Sao_Paulo || true

# 1. Atualizar pacotes do sistema
echo "📦 [1/5] Atualizando repositórios do sistema..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw htop ca-certificates gnupg

# 2. Instalar Docker se não existir
if ! command -v docker &> /dev/null; then
    echo "🐳 [2/5] Instalando Docker Engine e Docker Compose..."
    curl -fsSL https://get.docker.com | bash
    sudo systemctl enable --now docker
    sudo usermod -aG docker $USER
else
    echo "✅ Docker já está instalado."
fi

# 3. Configurar Firewall (Liberando portas de aplicações de 3000 até 9999)
echo "🔒 [3/5] Configurando Firewall UFW..."
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw allow 3000:9999/tcp || true
sudo ufw --force enable || true

# 4. Baixar repositório do AegisPanel
INSTALL_DIR="/opt/aegispanel"
echo "📁 [4/5] Configurando diretório da aplicação em $INSTALL_DIR..."

if [ -d "$INSTALL_DIR/.git" ]; then
    echo "🔄 Atualizando repositório existente..."
    cd $INSTALL_DIR
    git pull origin main
else
    sudo rm -rf $INSTALL_DIR
    sudo git clone https://github.com/WendelDev0/aegispanel.git $INSTALL_DIR
    cd $INSTALL_DIR
fi

sudo mkdir -p $INSTALL_DIR/caddy
sudo mkdir -p $INSTALL_DIR/data
sudo chown -R $USER:$USER $INSTALL_DIR

# Criar Caddyfile inicial se não existir
if [ ! -f "$INSTALL_DIR/caddy/Caddyfile" ]; then
    echo "# AegisPanel Default Caddyfile" > "$INSTALL_DIR/caddy/Caddyfile"
fi

# 5. Iniciar serviços via Docker Compose
cd $INSTALL_DIR
echo "🚀 [5/5] Compilando e iniciando contêineres do AegisPanel..."
docker compose up -d --build

SERVER_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "IP_DO_SERVIDOR")

echo ""
echo "======================================================================"
echo "🎉 AegisPanel instalado e iniciado com sucesso na sua VPS Contabo!"
echo "👉 Acesse no seu navegador: http://$SERVER_IP:3000"
echo "======================================================================"
