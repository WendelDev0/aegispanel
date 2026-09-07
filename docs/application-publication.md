# Deploy e publicação de aplicações

## URLs automáticas

No ambiente do backend, configure `AEGIS_APPS_BASE_DOMAIN=apps.seudominio.com`
usando um domínio sob seu controle. Antes de ativar:

1. Crie DNS wildcard `*.apps.seudominio.com` apontando para a VPS; só publique
   AAAA se IPv6 também alcançar esse servidor.
2. Garanta que as portas 80 e 443 chegam ao Caddy. O domínio-base deve ser
   separado do hostname administrativo do painel.
3. Atualize/recrie o backend para carregar a variável. Faça um deploy de teste
   para sincronizar as rotas; salvar um domínio também dispara a sincronização.
4. Abra a URL retornada no painel e confira DNS, certificado e resposta HTTP
   a partir de fora da VPS. Um reload aceito não prova propagação DNS/TLS.

Cada app recebe `https://app-<identificador-estável>.apps.seudominio.com`.
O hostname depende do ID, não do nome: renomear o app não altera a URL.
Um domínio personalizado tem preferência como URL principal; a URL automática
continua roteada. Sem domínio-base nem domínio personalizado, o painel não
inventa um link público por porta.

O DNS wildcard não implica certificado wildcard: Caddy solicita certificados
individuais para os hostnames configurados. Certificados wildcard exigem
configuração separada de DNS challenge/provider. Confira a documentação:
https://caddyserver.com/docs/automatic-https

`AEGIS_APP_BIND_IP` continua em `127.0.0.1`. A porta do host é informação de
diagnóstico, não garantia de acesso externo. Não abra todas as portas para
contornar erros de publicação. Acesso público por porta é uma configuração
de rede explícita, não oferecida automaticamente por esta implementação.

## Garantias desta etapa

- Receita Node transforma instalação em `RUN` e prepara o package manager.
- Build vazio significa sem build; configuração detectada não é uma escolha
  manual persistente.
- A porta efetiva da receita é salva para proxy e checagem de saúde.
- API e Caddy usam uma regra única de URL; proxy e saúde usam a release ativa.
- Falha de sincronização do Caddy falha o deploy antes de registrar sucesso.
- Atualizações do Caddy são serializadas; configuração rejeitada é restaurada
  no disco. O inode é mantido por causa do bind mount de arquivo em produção.

## Limitações deliberadas

Blue-green está temporariamente substituído por `recreate`, com aviso no log.
O executor anterior reutilizava portas e retirava a versão antiga antes de
validar a nova. **Recreate pode interromper a aplicação durante a atualização**;
esta etapa não promete zero downtime nem preservação contínua da versão antiga.
A implementação transacional precisa de endpoint candidato, readiness antes
da promoção, confirmação pública, drenagem e compensação testadas com Docker.

Compose, previews, ciclo completo de workers e fila durável ainda precisam das
correções arquiteturais identificadas na análise. Não considerar esses caminhos
validados por esta entrega. O suporte completo a Dockerfile customizado e a
todos os frameworks também não é uma garantia desta etapa.

## Verificação

Execute `npm run check` e `npm run build`. Os testes de regressão exercitam
detecção → configuração → receita, API → Caddy → saúde e o deploy enfileirado
com falha de publicação. Docker e reload são simulados nos testes locais.

Antes de produção, valide em Docker real: Vite, Express sem build, HTML estático,
aplicação com domínio personalizado e aplicação só com URL automática; repita
o deploy e simule falha do proxy. Valide assets, refresh de SPA e WebSocket.
Não houve alteração de DNS nem deploy na VPS durante a implementação local.
