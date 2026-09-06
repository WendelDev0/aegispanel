export type HelpFamily = 'node' | 'python';

export interface HelpStack {
  id: string;
  family: HelpFamily;
  label: string;
  title: string;
  desc: string;
  prompt: string;
}

export const HELP_STACKS: HelpStack[] = [
  {
    id: 'universal',
    family: 'node',
    label: 'Universal (Vercel → Aegis)',
    title: 'Prompt universal (Node / frontend da Vercel para o AegisPanel)',
    desc: 'Use em qualquer IA para adaptar um projeto feito para a Vercel ao deploy em container no AegisPanel.',
    prompt: `Estou hospedando meu projeto no painel AegisPanel (PaaS self-hosted em VPS Linux com Docker e Caddy).
A maioria dos meus projetos foi desenvolvida para a Vercel. Preciso que você adapte o código para rodar no AegisPanel sem erro de build ou deploy.

Faça as verificações e ajustes:

1. SCRIPTS NO PACKAGE.JSON:
   - Os scripts "build" e "start" devem existir e funcionar.
   - "start" inicia o servidor de produção (ex: "next start", "node dist/index.js").
   - Se for SPA (Vite/React), "build" deve gerar a pasta "dist".

2. HOST E PORTA:
   - O servidor escuta em 0.0.0.0 (nunca só localhost ou 127.0.0.1).
   - Use a porta da variável de ambiente: process.env.PORT || 3000.

3. DEPENDÊNCIAS:
   - Ferramentas de compilação (typescript, vite, tailwindcss) precisam estar disponíveis no build.
   - Troque adaptadores exclusivos da Vercel Edge/Serverless por equivalentes Node.js padrão.

4. VARIÁVEIS DE AMBIENTE:
   - Liste as variáveis (.env) necessárias em produção.

Revise a configuração e entregue o código pronto para commit e deploy no AegisPanel.`,
  },
  {
    id: 'nextjs',
    family: 'node',
    label: 'Next.js',
    title: 'Next.js (App Router e Pages Router)',
    desc: 'Standalone, host 0.0.0.0 e scripts de produção para o Next.js fora da Vercel.',
    prompt: `Estou hospedando minha aplicação Next.js no AegisPanel (VPS Docker PaaS).
Prepare o projeto para rodar fora da Vercel:

1. NEXT.CONFIG:
   - Adicione output: 'standalone' no next.config.js (ou next.config.mjs).
   - Remova dependências de Vercel Serverless Functions proprietárias.

2. SCRIPTS NO PACKAGE.JSON:
   - "build": "next build"
   - "start": "next start -H 0.0.0.0 -p \${PORT:-3000}"

3. VARIÁVEIS:
   - Públicas começam com NEXT_PUBLIC_.
   - Liste todas as variáveis necessárias em produção.

Entregue as alterações prontas para o deploy no AegisPanel subir de primeira.`,
  },
  {
    id: 'vite',
    family: 'node',
    label: 'Vite / React SPA',
    title: 'Vite / React / Vue / Svelte (SPA)',
    desc: 'O painel roda npm run build e serve a pasta dist. Rotas do client-side não podem quebrar.',
    prompt: `Estou hospedando meu frontend SPA (Vite/React) no AegisPanel.
O painel compila com "npm run build" e serve a pasta "dist".

Verifique:

1. VITE.CONFIG:
   - base: '/' para rotas absolutas.
   - Segredos não entram no build; use o prefixo VITE_ só para valores públicos.

2. PACKAGE.JSON:
   - "build" executa "vite build" ou "tsc && vite build".
   - Bibliotecas usadas nos componentes estão em dependencies.

3. ROTAS:
   - Com react-router-dom, não use caminhos relativos que quebrem no refresh.

Entregue o código ajustado para deploy imediato no AegisPanel.`,
  },
  {
    id: 'nodeapi',
    family: 'node',
    label: 'Express / Nest / Node API',
    title: 'Node.js / Express / Fastify / NestJS API',
    desc: 'Binding em 0.0.0.0, PORT dinâmica e DATABASE_URL dos bancos do painel.',
    prompt: `Estou hospedando minha API Node.js no AegisPanel.
Revise o servidor para rodar em Docker:

1. BINDING:
   - Escutar em 0.0.0.0 (app.listen(PORT, '0.0.0.0') ou fastify.listen({ port: PORT, host: '0.0.0.0' })).
   - Porta dinâmica: const PORT = process.env.PORT || 3000.

2. SCRIPT DE START:
   - TypeScript: "build" gera dist e "start" executa "node dist/index.js" (ou o entrypoint real).

3. BANCO:
   - Conexão via DATABASE_URL para PostgreSQL/MySQL criados no AegisPanel.

Entregue as correções para commit e deploy.`,
  },
  {
    id: 'python',
    family: 'python',
    label: 'Python (geral)',
    title: 'Prompt universal Python (Flask, FastAPI, Django)',
    desc: 'O Aegis detecta o framework e gera o Dockerfile. O código precisa estar pronto para container.',
    prompt: `Estou hospedando meu projeto Python no AegisPanel (PaaS self-hosted com Docker e Caddy).
O painel detecta Flask, FastAPI e Django a partir de requirements.txt, pyproject.toml, Pipfile ou uv.lock e gera um Dockerfile com python:3.10–3.13-slim (padrão 3.12). Não preciso escrever Dockerfile, mas o código precisa rodar em container.

Prepare o projeto:

1. DEPENDÊNCIAS:
   - Deixe requirements.txt, pyproject.toml (Poetry ou uv) ou Pipfile com as libs de produção.
   - Inclua o servidor WSGI/ASGI: gunicorn (Flask/Django) ou uvicorn[standard] (FastAPI).
   - Não dependa de .venv local. O painel instala no build com pip, poetry, uv ou pipenv.

2. HOST E PORTA:
   - Escute em 0.0.0.0 (nunca só localhost).
   - Use a variável PORT (padrão 8000 no FastAPI/Django, 5000 no Flask).
   - Exemplo: port = int(os.environ.get("PORT", "8000"))

3. COMANDO DE START:
   - FastAPI: uvicorn main:app --host 0.0.0.0 --port $PORT (ASGI em main.py).
   - Django: gunicorn --bind 0.0.0.0:$PORT --workers 2 <projeto>.wsgi:application.
   - Flask: gunicorn --bind 0.0.0.0:$PORT --workers 2 app:app (ou web_app:app).
   - Não use "flask run" nem o servidor de desenvolvimento em produção.

4. BANCO E MIGRAÇÕES:
   - Conecte via DATABASE_URL (PostgreSQL/MySQL do painel).
   - Django: python manage.py migrate --noinput como processo release — não no CMD de start.
   - Alembic: alembic upgrade head no release.

5. WORKERS:
   - Se usa Celery/RQ/ARQ, deixe o comando explícito (ex: celery -A app worker -l info). O painel sobe o worker como processo extra da mesma imagem.

6. VARIÁVEIS:
   - Liste SECRET_KEY, DATABASE_URL, ALLOWED_HOSTS e as demais de produção.
   - PYTHONUNBUFFERED=1.

Opcional: um aegis.toml na raiz pode fixar runtime, versão, start e processos.

Revise o código e entregue pronto para commit e deploy no AegisPanel.`,
  },
  {
    id: 'fastapi',
    family: 'python',
    label: 'FastAPI',
    title: 'FastAPI + Uvicorn',
    desc: 'ASGI em main:app, host 0.0.0.0, PORT 8000 e uvicorn no manifesto.',
    prompt: `Estou hospedando uma API FastAPI no AegisPanel.
O detector procura fastapi nas dependências ou FastAPI() em main.py e sobe com:
  uvicorn main:app --host 0.0.0.0 --port 8000
Healthcheck em /docs. Python 3.10–3.13 (padrão 3.12). pip, poetry, uv ou pipenv.

Ajuste o projeto:

1. ENTRYPOINT:
   - A instância FastAPI deve se chamar "app" em main.py (from fastapi import FastAPI; app = FastAPI()).
   - Se o módulo for outro (ex: app.main:app), deixe isso explícito no comando de start.

2. BINDING:
   - Nunca escute só em 127.0.0.1.
   - Porta via os.environ.get("PORT", "8000").

3. DEPENDÊNCIAS:
   - fastapi e uvicorn[standard] em requirements.txt ou pyproject.toml.
   - Inclua gunicorn só se for o processo de start escolhido; o padrão do painel é uvicorn.

4. BANCO:
   - DATABASE_URL. Se usa Alembic, o processo release deve ser "alembic upgrade head".

5. CORS / DOCS:
   - /docs e /openapi.json devem responder no mesmo host/porta (o healthcheck usa /docs).

Entregue o código pronto para o AegisPanel detectar FastAPI e fazer o deploy.`,
  },
  {
    id: 'django',
    family: 'python',
    label: 'Django',
    title: 'Django + Gunicorn + migrate no release',
    desc: 'WSGI com gunicorn, collectstatic no build e migrate como processo release — não no start.',
    prompt: `Estou hospedando um projeto Django no AegisPanel.
O detector acha Django por manage.py ou pela dependência "django" e sobe com:
  gunicorn --bind 0.0.0.0:8000 --workers 2 core.wsgi:application
collectstatic roda no build. migrate NÃO entra no CMD: vai no processo release
  python manage.py migrate --noinput
para uma migração quebrada não derrubar o container no restart.

Ajuste o projeto:

1. WSGI:
   - Confirme o módulo WSGI real. Se não for core.wsgi:application, corrija o start
     (ex: meu_projeto.wsgi:application) no painel ou num aegis.toml.

2. SETTINGS:
   - ALLOWED_HOSTS deve aceitar o domínio do Aegis (ou "*" só se você controlar a rede).
   - SECRET_KEY e DATABASE_URL vêm de variáveis de ambiente, nunca hardcoded.
   - CSRF_TRUSTED_ORIGINS com https://seu-dominio.

3. ESTÁTICOS:
   - STATIC_ROOT definido. O build já tenta "python manage.py collectstatic --noinput".

4. DEPENDÊNCIAS:
   - django, gunicorn e o driver do banco (psycopg[binary] ou mysqlclient) no manifesto.
   - pip, poetry, uv ou pipenv são detectados automaticamente.

5. WORKERS:
   - Celery: processo extra "celery -A core worker -l info" (ajuste o -A).

Entregue settings, wsgi e dependências prontos para deploy no AegisPanel.`,
  },
  {
    id: 'flask',
    family: 'python',
    label: 'Flask',
    title: 'Flask + Gunicorn',
    desc: 'app:app ou web_app:app, PORT 5000 e gunicorn em produção — sem flask run.',
    prompt: `Estou hospedando uma aplicação Flask no AegisPanel.
O detector acha Flask pela dependência, por app.py ou por web_app.py. Em produção o painel prefere gunicorn:
  gunicorn --bind 0.0.0.0:$PORT --workers 2 app:app
ou web_app:app se o arquivo for web_app.py. Porta sugerida: 5000.

Ajuste o projeto:

1. APP FACTORY / INSTÂNCIA:
   - Exponha a instância Flask como "app" (app = Flask(__name__) ou create_app()).
   - Se usa factory, o start deve ser "gunicorn --bind 0.0.0.0:$PORT 'app:create_app()'" — deixe isso explícito.

2. BINDING:
   - Se ainda houver app.run(), use host="0.0.0.0" e port=int(os.environ.get("PORT", "5000")).
   - Em produção NÃO use flask run nem debug=True.

3. DEPENDÊNCIAS:
   - flask e gunicorn em requirements.txt ou pyproject.toml.

4. BANCO:
   - DATABASE_URL. Flask-Migrate/Alembic: "flask db upgrade" ou "alembic upgrade head" no release.

5. VARIÁVEIS:
   - FLASK_ENV=production, SECRET_KEY, PYTHONUNBUFFERED=1.

Entregue o código pronto para o AegisPanel detectar Flask e fazer o deploy.`,
  },
];

export const DEFAULT_HELP_STACK_ID = 'universal';

export function stacksForFamily(family: HelpFamily): HelpStack[] {
  return HELP_STACKS.filter((stack) => stack.family === family);
}

export function findHelpStack(id: string): HelpStack {
  return HELP_STACKS.find((stack) => stack.id === id) ?? HELP_STACKS[0];
}
