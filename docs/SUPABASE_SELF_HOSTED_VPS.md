# 🚀 Guia de Implantação: Supabase Self-Hosted no AegisPanel / VPS Linux

Este guia detalha como subir a infraestrutura completa e 100% gratuita do **Supabase Self-Hosted** na sua VPS Linux com Docker, conectando ao seu projeto **BomDeBolão (Neon-Bet)**.

---

## 🏗️ 1. Arquitetura da Solução

Ao rodar o Supabase na sua VPS, você terá:
* **PostgreSQL (v15):** Banco de dados relacional com extensões ativadas.
* **GoTrue (Auth):** Autenticação de usuários, cadastro, login, tokens JWT e recuperação de senha.
* **PostgREST (REST API):** Gera a API REST instantânea que o frontend consome com `@supabase/supabase-js`.
* **Supabase Studio:** Painel administrativo web (interface visual) para executar SQL, gerenciar tabelas, visualizar usuários e dados.
* **Kong / API Gateway:** Roteador unificado de requisições.
* **Storage & Realtime:** Armazenamento de arquivos e websockets em tempo real.

```
                    ┌─────────────────────────┐
                    │    Usuário / Browser    │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ Caddy (Proxy Reverso)   │
                    │   (SSL Automático)      │
                    └────┬───────────────┬────┘
                         │               │
        https://seudominio.com           │ https://api-supabase.seudominio.com
                         │               │
                         ▼               ▼
               ┌────────────────┐   ┌───────────────────────────┐
               │ Frontend React │   │   Supabase Self-Hosted    │
               │ (neon-bet:3000)│   │   (Kong Gateway :8000)    │
               └────────────────┘   │   ├─ PostgreSQL (:5432)   │
                                    │   ├─ GoTrue (Auth)        │
                                    │   ├─ PostgREST (API)      │
                                    │   ├─ Supabase Studio:3000 │
                                    │   └─ Storage / Realtime   │
                                    └───────────────────────────┘
```

---

## 🛠️ 2. Como Subir o Supabase no AegisPanel / VPS

### Opção A: Pelo Marketplace / Template do AegisPanel / Docker Compose

1. No AegisPanel, crie um novo **Docker Compose Service** (ou selecione o template do Supabase se disponível no Marketplace).
2. Utilize a estrutura de diretório recomendada:
   ```bash
   mkdir -p /opt/supabase && cd /opt/supabase
   ```
3. Baixe o repositório oficial de self-hosting do Supabase ou crie o arquivo `docker-compose.yml`:
   ```bash
   git clone --depth 1 https://github.com/supabase/supabase
   cd supabase/docker
   cp .env.example .env
   ```

---

## 🔑 3. Configuração das Variáveis de Ambiente (`.env` do Supabase)

No arquivo `.env` do Supabase na sua VPS, configure as chaves de segurança principais:

1. **Gere chaves seguras (JWT e Senhas):**
   * `POSTGRES_PASSWORD`: Senha forte para o banco de dados PostgreSQL.
   * `JWT_SECRET`: Chave secreta de pelo menos 32 caracteres (usada para assinar os tokens dos usuários).
   * `ANON_KEY`: Token JWT gerado a partir do seu `JWT_SECRET` com payload `{"role": "anon"}`.
   * `SERVICE_ROLE_KEY`: Token JWT com payload `{"role": "service_role"}` para tarefas administrativas e Edge Functions.
   * `DASHBOARD_USERNAME` e `DASHBOARD_PASSWORD`: Login e senha para acessar o painel web **Supabase Studio**.

2. **URLs Públicas:**
   * `API_EXTERNAL_URL`: `https://api-supabase.seudominio.com`
   * `SITE_URL`: `https://seudominio.com` (URL do seu frontend)
   * `STUDIO_DEFAULT_ORGANIZATION`: `BomDeBolao`
   * `STUDIO_DEFAULT_PROJECT`: `neon-bet`

---

## 🌐 4. Configuração de Domínio e SSL no Caddy (AegisPanel)

No Caddy da sua VPS, crie os subdomínios apontando para as portas dos containers:

```caddy
# API do Supabase (Kong Gateway)
api-supabase.seudominio.com {
    reverse_proxy localhost:8000
}

# Painel Supabase Studio (Interface Web)
studio-supabase.seudominio.com {
    reverse_proxy localhost:3000
}
```

---

## 🗄️ 5. Inicialização e Execução do Banco de Dados

1. Inicie os containers:
   ```bash
   docker compose up -d
   ```
2. Acesse o **Supabase Studio** no seu navegador: `https://studio-supabase.seudominio.com` (ou `http://SEU_IP:3000`).
3. Faça login com seu `DASHBOARD_USERNAME` e `DASHBOARD_PASSWORD`.
4. Vá no menu **SQL Editor** e execute os scripts do projeto nesta ordem:
   
   1. `supabase/schema.sql` (Cria todas as tabelas, RLS, triggers e funções principais)
   2. `supabase/patches/2026-05-02-admin-salvar-goleadores-rpc.sql`
   3. `supabase/patches/2026-05-02-fix-admin-salvar-goleadores-rpc.sql`

---

## 🔗 6. Conectando o Frontend (`neon-bet`) ao seu Supabase

No AegisPanel, adicione as variáveis de ambiente na aplicação do Frontend:

```env
VITE_SUPABASE_URL=https://api-supabase.seudominio.com
VITE_SUPABASE_ANON_KEY=sua_anon_key_gerada_no_env
VITE_SITE_URL=https://seudominio.com
PORT=3000
```

Após configurar, clique em **Deploy / Rebuild** do Frontend no AegisPanel.

---

## ✅ 7. Testes e Verificação

1. **Acesso Público:** Acesse `https://seudominio.com` e verifique a landing page.
2. **Cadastro e Login:** Teste criar uma conta nova e logar para validar a comunicação com o GoTrue/PostgREST.
3. **Painel do Usuário:** Acesse o painel `/dashboard` e valide palpites e saldo.
4. **Painel Admin:** Conceda permissão de admin para seu usuário na tabela `usuarios` (`role = 'admin'`) e teste o acesso a `/dashboard/admin`.
