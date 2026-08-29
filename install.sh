#!/usr/bin/env bash
# ==============================================================================
# AegisPanel - Script de Instalação Automatizada 1-Click para VPS Ubuntu / Debian
# Compatível com Contabo, Hetzner, AWS, DigitalOcean, e Servidores Locais
# ==============================================================================

set -e

echo "======================================================================"
echo "🛡️  Instalando AegisPanel - Cloud & Server Management Platform"
echo "======================================================================"

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

# 3. Configurar Firewall básico
echo "🔒 [3/5] Configurando Firewall UFW..."
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw allow 3000/tcp || true
sudo ufw --force enable || true

# 4. Criar diretório de dados
INSTALL_DIR="/opt/aegispanel"
echo "📁 [4/5] Configurando diretório da aplicação em $INSTALL_DIR..."
sudo mkdir -p $INSTALL_DIR/data/caddy
sudo chown -R $USER:$USER $INSTALL_DIR

# Copiar arquivos do projeto para o diretório de instalação
if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    git clone https://github.com/seu-usuario/painiel-vps.git $INSTALL_DIR || cp -r . $INSTALL_DIR
fi

# 5. Iniciar serviços via Docker Compose
cd $INSTALL_DIR
echo "🚀 [5/5] Iniciando contêineres do AegisPanel..."
docker compose up -d

SERVER_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "IP_DO_SERVIDOR")

echo ""
echo "======================================================================"
echo "🎉 AegisPanel instalado e iniciado com sucesso!"
echo "👉 Acesse no seu navegador: http://$SERVER_IP:3000"
echo "======================================================================"
