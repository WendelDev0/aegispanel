#!/usr/bin/env bash
# ==============================================================================
# AegisPanel - Instalação automatizada para VPS Ubuntu / Debian
# Compatível com Contabo, Hetzner, AWS, DigitalOcean e servidores locais
# Repositório: https://github.com/WendelDev0/aegispanel
# ==============================================================================

set -euo pipefail

INSTALL_DIR="${AEGIS_INSTALL_DIR:-/opt/aegispanel}"
REPO_URL="https://github.com/WendelDev0/aegispanel.git"

echo "======================================================================"
echo "🛡️  Instalando AegisPanel - Cloud & Server Management Platform"
echo "======================================================================"

if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
    echo "❌ Execute como root ou instale o sudo."
    exit 1
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
fi

# 0. Fuso horário
$SUDO timedatectl set-timezone America/Sao_Paulo || true

# 1. Pacotes base
echo "📦 [1/6] Atualizando repositórios do sistema..."
$SUDO apt-get update
$SUDO apt-get install -y curl git ufw ca-certificates gnupg openssl

# 2. Docker
if ! command -v docker >/dev/null 2>&1; then
    echo "🐳 [2/6] Instalando Docker Engine e Docker Compose..."
    curl -fsSL https://get.docker.com | $SUDO bash
    $SUDO systemctl enable --now docker
    $SUDO usermod -aG docker "${SUDO_USER:-$USER}" || true
else
    echo "✅ [2/6] Docker já está instalado."
fi

# 3. Firewall
#
# Apenas as portas realmente necessárias são abertas. A versão anterior deste
# script liberava a faixa inteira 3000-9999/tcp, o que expunha a API interna e
# qualquer contêiner de aplicação diretamente à internet. Aplicações publicadas
# devem ser acessadas pelo domínio, através do Caddy nas portas 80/443.
echo "🔒 [3/6] Configurando firewall UFW..."
$SUDO ufw default deny incoming
$SUDO ufw default allow outgoing
$SUDO ufw allow 22/tcp    comment 'SSH'
$SUDO ufw allow 80/tcp    comment 'HTTP'
$SUDO ufw allow 443/tcp   comment 'HTTPS'
$SUDO ufw --force enable

echo "   ℹ️  Para publicar uma aplicação em uma porta específica, libere-a"
echo "      manualmente com: sudo ufw allow <porta>/tcp"

# 4. Código
echo "📁 [4/6] Preparando $INSTALL_DIR..."
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "🔄 Atualizando repositório existente..."
    $SUDO git -C "$INSTALL_DIR" pull --ff-only origin main
else
    if [ -e "$INSTALL_DIR" ]; then
        echo "❌ $INSTALL_DIR já existe e não é um clone do AegisPanel."
        echo "   Remova ou renomeie o diretório manualmente antes de continuar."
        exit 1
    fi
    $SUDO git clone "$REPO_URL" "$INSTALL_DIR"
fi

$SUDO mkdir -p "$INSTALL_DIR/caddy" "$INSTALL_DIR/data"
$SUDO chown -R "${SUDO_USER:-$USER}:${SUDO_USER:-$USER}" "$INSTALL_DIR"
$SUDO chmod 700 "$INSTALL_DIR/data"

if [ ! -f "$INSTALL_DIR/docker-compose.yml" ] && [ ! -f "$INSTALL_DIR/compose.yml" ]; then
    echo "❌ docker-compose.yml não encontrado em $INSTALL_DIR"
    echo "   O self-update do painel precisa desse arquivo."
    echo "   Defina AEGIS_INSTALL_DIR para o clone correto, ou copie o compose para cá."
    echo "   Depois grave no .env: AEGIS_COMPOSE_DIR=$INSTALL_DIR"
    exit 1
fi

if [ ! -f "$INSTALL_DIR/caddy/Caddyfile" ]; then
    printf '# AegisPanel Default Caddyfile\n' > "$INSTALL_DIR/caddy/Caddyfile"
fi

# 5. Segredos
#
# Gerados por instalação. Um valor padrão embutido no repositório seria idêntico
# em todo servidor do mundo, permitindo forjar um token de administrador e
# descriptografar as senhas de banco de qualquer instalação.
ENV_FILE="$INSTALL_DIR/.env"
echo "🔑 [5/6] Configurando segredos em $ENV_FILE..."

if [ ! -f "$ENV_FILE" ]; then
    cp "$INSTALL_DIR/.env.example" "$ENV_FILE"
fi

ensure_secret() {
    local key="$1"
    local current
    current=$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true)
    if [ -z "$current" ]; then
        local generated
        generated=$(openssl rand -hex 32)
        if grep -qE "^${key}=" "$ENV_FILE"; then
            sed -i "s|^${key}=.*|${key}=${generated}|" "$ENV_FILE"
        else
            printf '%s=%s\n' "$key" "$generated" >> "$ENV_FILE"
        fi
        echo "   ✅ ${key} gerada."
    else
        echo "   ↩️  ${key} já configurada, mantida."
    fi
}

ensure_secret JWT_SECRET
ensure_secret ENCRYPTION_KEY

# Optional panel hostname. The installer never binds :3000 on 0.0.0.0;
# HTTPS is published by Caddy after the operator sets panelDomain in Settings.
PANEL_DOMAIN_HINT=""
if [ -t 0 ]; then
    echo ""
    echo "🌐 Domínio HTTPS do painel (opcional)."
    echo "   Enter para manter só o túnel SSH (ssh -L 3000:127.0.0.1:3000)."
    printf "   Domínio: "
    read -r PANEL_DOMAIN_HINT || true
    PANEL_DOMAIN_HINT="${PANEL_DOMAIN_HINT#https://}"
    PANEL_DOMAIN_HINT="${PANEL_DOMAIN_HINT#http://}"
    PANEL_DOMAIN_HINT="${PANEL_DOMAIN_HINT%%/*}"
fi

# Same path on the host and inside the backend container. Without this,
# `docker compose` from the panel cannot find the project (cwd is /app).
if grep -qE "^AEGIS_COMPOSE_DIR=" "$ENV_FILE"; then
    sed -i "s|^AEGIS_COMPOSE_DIR=.*|AEGIS_COMPOSE_DIR=${INSTALL_DIR}|" "$ENV_FILE"
else
    printf 'AEGIS_COMPOSE_DIR=%s\n' "$INSTALL_DIR" >> "$ENV_FILE"
fi
echo "   ✅ AEGIS_COMPOSE_DIR=${INSTALL_DIR}"

chmod 600 "$ENV_FILE"

# 6. Subir a stack
cd "$INSTALL_DIR"
echo "🚀 [6/6] Compilando e iniciando os contêineres..."
docker compose up -d --build

SERVER_IP=$(curl -s --max-time 5 ifconfig.me || curl -s --max-time 5 icanhazip.com || echo "IP_DO_SERVIDOR")

echo ""
echo "======================================================================"
echo "🎉 AegisPanel instalado com sucesso!"
echo "👉 Painel (local): ssh -L 3000:127.0.0.1:3000 usuario@${SERVER_IP}"
echo "   A porta 3000 continua em 127.0.0.1 — curl de fora deve recusar conexão."
if [ -n "$PANEL_DOMAIN_HINT" ]; then
    echo "👉 Depois do primeiro login: Configurações → Domínio próprio do painel = ${PANEL_DOMAIN_HINT}"
    echo "   O Caddy emite HTTPS nesse hostname. Não altere PANEL_BIND para 0.0.0.0."
else
    echo "   Sem domínio, o acesso público fica só por túnel SSH. Você pode definir"
    echo "   o hostname depois em Configurações → Domínio próprio do painel."
fi
echo ""
echo "   No primeiro acesso você define a senha do administrador."
echo "======================================================================"
