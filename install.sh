#!/usr/bin/env bash
# ==============================================================================
# AegisPanel - Instalação automatizada para VPS Ubuntu / Debian
# Compatível com Contabo, Hetzner, AWS, DigitalOcean e servidores locais
# Repositório: https://github.com/WendelDev0/aegispanel
# ==============================================================================

set -euo pipefail

INSTALL_DIR="${AEGIS_INSTALL_DIR:-/opt/aegispanel}"
REPO_URL="https://github.com/WendelDev0/aegispanel.git"
RESTORE_FROM=""

while [ $# -gt 0 ]; do
    case "$1" in
        --restore-from)
            RESTORE_FROM="${2:-}"
            shift 2
            ;;
        --restore-from=*)
            RESTORE_FROM="${1#*=}"
            shift
            ;;
        *)
            echo "Uso: install.sh [--restore-from s3://bucket/prefix]"
            echo "     Com --restore-from, exporte ENCRYPTION_KEY da instalação antiga"
            echo "     e AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (e AWS_REGION / AWS_ENDPOINT_URL se preciso)."
            exit 1
            ;;
    esac
done

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

sanitize_update_ref() {
    local ref="$1"
    case "$ref" in
        *..*|*[[:space:]]*|*"@{ "*|*/)
            echo "❌ AEGIS_UPDATE_REF inválido: $ref"
            exit 1
            ;;
    esac
    if ! printf '%s' "$ref" | grep -qE '^[A-Za-z0-9][A-Za-z0-9._/-]*$'; then
        echo "❌ AEGIS_UPDATE_REF inválido: $ref"
        exit 1
    fi
}

ENV_FILE="$INSTALL_DIR/.env"
UPDATE_REF="${AEGIS_UPDATE_REF:-}"
if [ -z "$UPDATE_REF" ] && [ -f "$ENV_FILE" ]; then
    UPDATE_REF="$(grep -E '^AEGIS_UPDATE_REF=' "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
fi
UPDATE_REF="${UPDATE_REF:-main}"
sanitize_update_ref "$UPDATE_REF"

checkout_panel_ref() {
    $SUDO git -c "safe.directory=$INSTALL_DIR" -C "$INSTALL_DIR" fetch origin "$UPDATE_REF"
    $SUDO git -c "safe.directory=$INSTALL_DIR" -C "$INSTALL_DIR" checkout -B "$UPDATE_REF" FETCH_HEAD
}

if [ -d "$INSTALL_DIR/.git" ]; then
    echo "🔄 Atualizando repositório existente (ref: $UPDATE_REF)..."
    checkout_panel_ref
else
    if [ -e "$INSTALL_DIR" ]; then
        echo "❌ $INSTALL_DIR já existe e não é um clone do AegisPanel."
        echo "   Remova ou renomeie o diretório manualmente antes de continuar."
        exit 1
    fi
    $SUDO git clone "$REPO_URL" "$INSTALL_DIR"
    checkout_panel_ref
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

if [ -n "$RESTORE_FROM" ]; then
    if [ -z "${ENCRYPTION_KEY:-}" ]; then
        echo "❌ --restore-from exige ENCRYPTION_KEY da instalação antiga no ambiente."
        echo "   O bucket só abre com a mesma chave que cifrou os dumps. Não use a chave recém-gerada."
        exit 1
    fi
    upsert_env() {
        local key="$1"
        local value="$2"
        local tmp
        tmp=$(mktemp)
        grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
        printf '%s=%s\n' "$key" "$value" >> "$tmp"
        mv "$tmp" "$ENV_FILE"
        chmod 600 "$ENV_FILE"
    }

    upsert_env ENCRYPTION_KEY "$ENCRYPTION_KEY"
    echo "   ✅ ENCRYPTION_KEY da instalação antiga gravada (obrigatória para descriptografar o bucket)."

    copy_env_if_set() {
        local key="$1"
        local value="${!key:-}"
        [ -z "$value" ] && return 0
        upsert_env "$key" "$value"
        echo "   ✅ ${key} copiada para o .env do painel."
    }
    copy_env_if_set AWS_ACCESS_KEY_ID
    copy_env_if_set AWS_SECRET_ACCESS_KEY
    copy_env_if_set AWS_REGION
    copy_env_if_set AWS_ENDPOINT_URL
    if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
        echo "❌ --restore-from exige AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY no ambiente."
        exit 1
    fi
fi

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

if grep -qE "^AEGIS_UPDATE_REF=" "$ENV_FILE"; then
    sed -i "s|^AEGIS_UPDATE_REF=.*|AEGIS_UPDATE_REF=${UPDATE_REF}|" "$ENV_FILE"
else
    printf 'AEGIS_UPDATE_REF=%s\n' "$UPDATE_REF" >> "$ENV_FILE"
fi
echo "   ✅ AEGIS_UPDATE_REF=${UPDATE_REF}"

chmod 600 "$ENV_FILE"

# 6. Subir a stack
cd "$INSTALL_DIR"
echo "🚀 [6/6] Compilando e iniciando os contêineres..."
docker compose up -d --build

if [ -n "$RESTORE_FROM" ]; then
    echo "🛟 Restaurando estado a partir de ${RESTORE_FROM}..."
    echo "   Aguardando o backend ficar saudável..."
    ready=0
    for _ in $(seq 1 90); do
        if docker compose exec -T backend curl -sf http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
            ready=1
            break
        fi
        sleep 2
    done
    if [ "$ready" -ne 1 ]; then
        echo "❌ Backend não ficou pronto a tempo. Veja: docker compose logs backend"
        exit 1
    fi
    docker compose exec -T backend node dist/scripts/dr-restore.js --from "$RESTORE_FROM"
    echo "   ✅ Restore remoto concluído."
fi

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
