#!/usr/bin/env bash
# ==============================================================================
# AegisPanel - Diagnóstico Forense e Auto-Correção do Servidor e Aplicações
# ==============================================================================

echo "======================================================================"
echo "🩺  EXECUTANDO DIAGNÓSTICO DO AEGISPANEL & APLICAÇÕES"
echo "======================================================================"

echo ""
echo "📦 1. STATUS DOS CONTÊINERES DOCKER:"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "📄 2. CONTEÚDO ATUAL DO CADDYFILE (/opt/aegispanel/caddy/Caddyfile):"
if [ -f /opt/aegispanel/caddy/Caddyfile ]; then
    cat /opt/aegispanel/caddy/Caddyfile
else
    echo "❌ Arquivo Caddyfile não encontrado!"
fi

echo ""
echo "🌐 3. TESTE DE RESPOSTA LOCAL NA PORTA 5000 (Aplicação):"
curl -Is --connect-timeout 3 http://localhost:5000 | head -n 5 || echo "❌ Porta 5000 não respondeu no localhost!"

echo ""
echo "📋 4. ÚLTIMOS LOGS DA APLICAÇÃO (aegis-app-catariana):"
docker logs --tail 15 aegis-app-catariana 2>&1 || docker logs --tail 15 aegis-app-catarina 2>&1 || echo "❌ Contêiner do app não encontrado!"

echo ""
echo "📋 5. ÚLTIMOS LOGS DO PROXY CADDY (SSL & Domínios):"
docker logs --tail 15 aegis-caddy 2>&1

echo ""
echo "🌍 6. RESOLUÇÃO DE DNS PÚBLICO (catarina.selvamarketing.com):"
curl -s "https://dns.google/resolve?name=catarina.selvamarketing.com&type=A" | grep -o '"data":"[^"]*"' || echo "❌ Falha ao consultar DNS"

echo ""
echo "======================================================================"
echo "✅ Diagnóstico concluído! Copie todo o texto acima e cole no chat."
echo "======================================================================"
