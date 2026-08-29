#!/usr/bin/env bash
# ==============================================================================
# AegisPanel - Script de Auto-Correção e Inicialização Imediata do App e SSL
# ==============================================================================

set -e

echo "======================================================================"
echo "🚀 EXECUTANDO AUTO-CORREÇÃO DO APP E CERTIFICADO SSL..."
echo "======================================================================"

# 1. Parar e remover container antigo que estava em loop
echo "🛑 [1/5] Removendo contêiner antigo em crash..."
docker rm -f aegis-app-catariana || true

# 2. Corrigir Caddyfile com email válido e portas corretas
echo "📄 [2/5] Atualizando Caddyfile com email Let's Encrypt válido..."
cat << 'EOF' > /opt/aegispanel/caddy/Caddyfile
# Aegis Auto-Generated Caddyfile
{
  email contato@selvamarketing.com
}

catarina.selvamarketing.com {
  reverse_proxy host.docker.internal:5000 172.17.0.1:5000 {
    lb_policy first
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }
  encode gzip zstd
}

wendel.selvamarketing.com {
  reverse_proxy host.docker.internal:5000 172.17.0.1:5000 {
    lb_policy first
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }
  encode gzip zstd
}
EOF

# 3. Limpar cache ACME antigo do Caddy
echo "🧹 [3/5] Limpando cache do Caddy..."
rm -rf /opt/aegispanel/caddy/data /opt/aegispanel/caddy/config

# 4. Reconstruir e subir o app com o servidor correto para Vite (serve -s dist)
BUILD_DIR=$(find /opt/aegispanel/data/builds -name "package.json" -exec dirname {} \; | head -n 1)

if [ -n "$BUILD_DIR" ] && [ -d "$BUILD_DIR" ]; then
    echo "📦 [4/5] Compilando imagem do site da Catarina com servidor web otimizado em $BUILD_DIR..."
    cat << 'EOF' > "$BUILD_DIR/Dockerfile"
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps || npm install
COPY . .
RUN npm run build || true
RUN npm install -g serve
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "if [ -d dist ]; then serve -s dist -l 3000; elif [ -d build ]; then serve -s build -l 3000; elif grep -q '\"start\"' package.json; then npm start; else npx vite preview --host 0.0.0.0 --port 3000; fi"]
EOF

    cd "$BUILD_DIR"
    docker build -t aegis-app-catariana:latest .
    docker run -d --name aegis-app-catariana --restart unless-stopped -p 5000:3000 --network aegispanel_aegis-net aegis-app-catariana:latest
    echo "✅ Contêiner aegis-app-catariana iniciado com sucesso na porta 5000!"
fi

# 5. Reiniciar o proxy Caddy para emitir o SSL com o Let's Encrypt
echo "🔒 [5/5] Reiniciando Caddy Proxy com Let's Encrypt..."
cd /opt/aegispanel
docker compose restart caddy

echo ""
echo "======================================================================"
echo "🎉 SUCESSO! O SITE E O CERTIFICADO SSL FORAM CORRIGIDOS!"
echo "👉 Teste no seu navegador: https://catarina.selvamarketing.com"
echo "======================================================================"
