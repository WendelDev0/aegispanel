import type { AppRuntime, PackageManager, ResolvedBuildConfig } from './app-build.js';

export type RecipeProjectType =
  | 'vite'
  | 'nextjs'
  | 'astro'
  | 'nuxt'
  | 'remix'
  | 'sveltekit'
  | 'express'
  | 'nestjs'
  | 'static-html'
  | 'dockerfile'
  | 'generic-node'
  | 'python-flask'
  | 'python-fastapi'
  | 'python-django'
  | 'python-generic'
  | 'go'
  | 'rust'
  | 'php-laravel'
  | 'php-symfony'
  | 'php-generic'
  | 'java-spring'
  | 'java-generic'
  | 'ruby-rails'
  | 'ruby-generic'
  | 'bun'
  | 'deno';

export interface RecipeInput {
  type: RecipeProjectType;
  runtime: AppRuntime;
  version: string;
  packageManager: PackageManager;
  outputDir?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  internalPort: number;
  cpuWorkers?: number;
}

export interface RecipeOutput {
  dockerfile: string;
  dockerignore: string;
  internalPort: number;
  warnings: string[];
}

const DEFAULT_DOCKERIGNORE = [
  '.git',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  'node_modules',
  '.venv',
  '__pycache__',
  '*.pyc',
  'data',
  'backups',
  'target',
  'vendor',
  '.next',
].join('\n');

export function generateRecipe(input: RecipeInput): RecipeOutput {
  const warnings: string[] = [];
  if (input.runtime === 'docker' || input.type === 'dockerfile') {
    return {
      dockerfile: '',
      dockerignore: DEFAULT_DOCKERIGNORE,
      internalPort: input.internalPort,
      warnings: ['Dockerfile nativo do repositório; a receita do painel não é aplicada.'],
    };
  }

  const port = input.internalPort || defaultPort(input);
  const dockerfile = render(input, port, warnings);
  return { dockerfile, dockerignore: DEFAULT_DOCKERIGNORE, internalPort: port, warnings };
}

function defaultPort(input: RecipeInput): number {
  if (input.runtime === 'static' || input.type === 'static-html') return 80;
  if (input.runtime === 'python' || input.type.startsWith('python')) return 8000;
  if (input.runtime === 'php') return 8080;
  if (input.runtime === 'java') return 8080;
  if (input.runtime === 'ruby') return 3000;
  return 3000;
}

function render(input: RecipeInput, port: number, warnings: string[]): string {
  switch (input.runtime) {
    case 'python':
      return pythonRecipe(input, port);
    case 'go':
      return goRecipe(input, port);
    case 'rust':
      return rustRecipe(input, port);
    case 'php':
      return phpRecipe(input, port);
    case 'java':
      return javaRecipe(input, port);
    case 'ruby':
      return rubyRecipe(input, port);
    case 'bun':
      return bunRecipe(input, port);
    case 'deno':
      return denoRecipe(input, port);
    case 'static':
      return staticRecipe(input, port);
    case 'node':
    default:
      return nodeRecipe(input, port, warnings);
  }
}

function pythonRecipe(input: RecipeInput, port: number): string {
  const version = input.version || '3.12';
  const workers = Math.max(1, Math.min(4, Math.round(input.cpuWorkers || 2)));
  const install = pythonInstall(input.packageManager, input.installCommand);
  const start = input.startCommand || pythonStart(input.type, port, workers);
  const health = input.type === 'python-fastapi' ? `http://127.0.0.1:${port}/docs` : `http://127.0.0.1:${port}/`;
  const collect =
    input.type === 'python-django'
      ? 'RUN if [ -f manage.py ]; then python manage.py collectstatic --noinput || true; fi\n'
      : '';

  return `FROM python:${version}-slim AS deps
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends curl build-essential libpq-dev && rm -rf /var/lib/apt/lists/*
${pythonCopyLock(input.packageManager)}
${install}

FROM python:${version}-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=${port}
RUN apt-get update && apt-get install -y --no-install-recommends curl libpq5 && rm -rf /var/lib/apt/lists/* \\
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin app
COPY --from=deps /usr/local /usr/local
COPY . .
${collect}USER app
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f ${health} || exit 1
CMD ${jsonCmd(start)}`;
}

function pythonCopyLock(pm: PackageManager): string {
  if (pm === 'uv') return 'COPY pyproject.toml uv.lock* requirements*.txt* ./';
  if (pm === 'poetry') return 'COPY pyproject.toml poetry.lock* ./';
  if (pm === 'pipenv') return 'COPY Pipfile Pipfile.lock* ./';
  return 'COPY requirements*.txt pyproject.toml* ./';
}

function pythonInstall(pm: PackageManager, override?: string): string {
  if (override) return `RUN ${override}`;
  if (pm === 'uv') {
    return `RUN pip install --no-cache-dir uv && (uv sync --frozen --no-dev || uv pip install --system -r requirements.txt || uv pip install --system .)`;
  }
  if (pm === 'poetry') {
    return `RUN pip install --no-cache-dir poetry \\
  && poetry config virtualenvs.create false \\
  && poetry install --only main --no-interaction --no-ansi`;
  }
  if (pm === 'pipenv') {
    return `RUN pip install --no-cache-dir pipenv && pipenv install --system --deploy`;
  }
  return `RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; \\
  elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; fi`;
}

function pythonStart(type: RecipeProjectType, port: number, workers: number): string {
  if (type === 'python-fastapi') return `uvicorn main:app --host 0.0.0.0 --port ${port}`;
  if (type === 'python-django') {
    return `gunicorn --bind 0.0.0.0:${port} --workers ${workers} core.wsgi:application`;
  }
  if (type === 'python-flask') {
    return `sh -c 'if [ -f web_app.py ]; then gunicorn --bind 0.0.0.0:${port} --workers ${workers} --timeout 120 web_app:app; elif [ -f app.py ]; then gunicorn --bind 0.0.0.0:${port} --workers ${workers} --timeout 120 app:app; else python main.py; fi'`;
  }
  return `sh -c 'if [ -f main.py ]; then python main.py; elif [ -f app.py ]; then python app.py; else python -m http.server ${port}; fi'`;
}

function nodeRecipe(input: RecipeInput, port: number, warnings: string[]): string {
  const version = input.version || '20';
  const pm = input.packageManager === 'bun' ? 'bun' : input.packageManager;
  const outputDir = input.outputDir || 'dist';
  const install = input.installCommand || nodeInstall(pm);
  const build = input.buildCommand || nodeBuild(pm);
  const start = input.startCommand || nodeStart(input.type, pm, outputDir, port);

  if (input.type === 'vite' || input.type === 'astro') {
    return `FROM node:${version}-alpine AS builder
WORKDIR /app
COPY package*.json pnpm-lock.yaml* yarn.lock* bun.lockb* bun.lock* ./
${install}
COPY . .
${build ? `RUN ${build}` : ''}

FROM node:${version}-alpine
WORKDIR /app
RUN npm install -g serve && addgroup -S app && adduser -S -G app app
COPY --from=builder /app/${outputDir} ./${outputDir}
USER app
ENV PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${port}/ || exit 1
CMD ["serve", "-s", "${outputDir}", "-l", "${port}"]`;
  }

  if (input.type === 'nextjs') {
    return `FROM node:${version}-alpine AS builder
WORKDIR /app
COPY package*.json pnpm-lock.yaml* yarn.lock* bun.lockb* bun.lock* ./
${install}
COPY . .
RUN ${build || nodeBuild(pm)}

FROM node:${version}-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S -G app app
COPY --from=builder /app ./
USER app
ENV NODE_ENV=production PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${port}/ || exit 1
CMD ${jsonCmd(start)}`;
  }

  if (input.type === 'static-html') {
    return staticRecipe(input, port);
  }

  warnings.push('Receita Node genérica: confirme startCommand se o detector errou o entrypoint.');
  return `FROM node:${version}-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S -G app app
COPY package*.json pnpm-lock.yaml* yarn.lock* bun.lockb* bun.lock* ./
${install}
COPY . .
${build ? `RUN ${build}` : 'RUN if grep -q \'"build"\' package.json; then ' + nodeBuild(pm) + '; fi'}
USER app
ENV NODE_ENV=production PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${port}/ || exit 1
CMD ${jsonCmd(start)}`;
}

function nodeInstall(pm: PackageManager | string): string {
  if (pm === 'pnpm') return 'RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile || pnpm install';
  if (pm === 'yarn') return 'RUN yarn install --frozen-lockfile || yarn install';
  if (pm === 'bun') return 'RUN npm install -g bun && bun install';
  return 'RUN npm ci --include=dev || npm install --include=dev --legacy-peer-deps';
}

function nodeBuild(pm: PackageManager | string): string {
  if (pm === 'pnpm') return 'pnpm run build';
  if (pm === 'yarn') return 'yarn build';
  if (pm === 'bun') return 'bun run build';
  return 'npm run build';
}

function nodeStart(type: RecipeProjectType, pm: PackageManager | string, outputDir: string, port: number): string {
  if (type === 'nuxt') return 'node .output/server/index.mjs';
  if (type === 'sveltekit') return 'node build';
  if (type === 'vite' || type === 'astro') return `serve -s ${outputDir} -l ${port}`;
  if (pm === 'pnpm') return 'pnpm start';
  if (pm === 'yarn') return 'yarn start';
  if (pm === 'bun') return 'bun run start';
  return 'npm start';
}

function staticRecipe(input: RecipeInput, port: number): string {
  const output = input.outputDir && input.outputDir !== '.' ? input.outputDir : '.';
  return `FROM nginx:alpine
COPY ${output === '.' ? '.' : output} /usr/share/nginx/html
RUN rm -f /usr/share/nginx/html/Dockerfile
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]`;
}

function goRecipe(input: RecipeInput, port: number): string {
  const version = input.version || '1.23';
  const start = input.startCommand || './app';
  return `FROM golang:${version}-alpine AS builder
WORKDIR /src
ENV CGO_ENABLED=0
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN go build -o /out/app .

FROM alpine:3.20
RUN adduser -D -u 10001 app && apk add --no-cache wget ca-certificates
WORKDIR /app
COPY --from=builder /out/app ./app
USER app
ENV PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${port}/ || exit 1
CMD ${jsonCmd(start)}`;
}

function rustRecipe(input: RecipeInput, port: number): string {
  const start = input.startCommand || './app';
  return `FROM rust:1-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN useradd --create-home --uid 10001 app && apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /src/target/release /out
RUN BIN=$(find /out -maxdepth 1 -type f -executable | head -1) && cp "$BIN" /app/app
USER app
ENV PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${port}/ || exit 1
CMD ${jsonCmd(start === './app' ? './app' : start)}`;
}

function phpRecipe(input: RecipeInput, port: number): string {
  const version = input.version || '8.3';
  const start =
    input.startCommand ||
    (input.type === 'php-laravel'
      ? `php artisan serve --host=0.0.0.0 --port=${port}`
      : `php -S 0.0.0.0:${port} -t public`);
  return `FROM php:${version}-cli-alpine
WORKDIR /app
RUN apk add --no-cache wget git unzip libpng libzip icu-libs \\
  && docker-php-ext-install pdo_mysql opcache \\
  && adduser -D -u 10001 app
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY . .
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress || true
USER app
ENV PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${port}/ || exit 1
CMD ${jsonCmd(start)}`;
}

function javaRecipe(input: RecipeInput, port: number): string {
  const version = input.version || '21';
  const start = input.startCommand || `sh -c 'java -jar /app/app.jar'`;
  const build =
    input.packageManager === 'gradle'
      ? 'RUN ./gradlew bootJar --no-daemon || gradle bootJar --no-daemon'
      : 'RUN ./mvnw -DskipTests package || mvn -DskipTests package';
  return `FROM eclipse-temurin:${version}-jdk AS builder
WORKDIR /src
COPY . .
${build}

FROM eclipse-temurin:${version}-jre
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=builder /src /src
RUN JAR=$(find /src/target /src/build/libs -name '*.jar' -not -name '*sources*' -not -name '*javadoc*' 2>/dev/null | head -1) \\
  && test -n "$JAR" && cp "$JAR" /app/app.jar
USER app
ENV PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${port}/ || exit 1
CMD ${jsonCmd(start)}`;
}

function rubyRecipe(input: RecipeInput, port: number): string {
  const version = input.version || '3.3';
  const start = input.startCommand || `bundle exec puma -b tcp://0.0.0.0:${port}`;
  return `FROM ruby:${version}-alpine
WORKDIR /app
RUN apk add --no-cache build-base wget curl tzdata postgresql-dev \\
  && adduser -D -u 10001 app
COPY Gemfile Gemfile.lock* ./
RUN bundle install --without development test
COPY . .
USER app
ENV PORT=${port} RAILS_ENV=production
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${port}/ || exit 1
CMD ${jsonCmd(start)}`;
}

function bunRecipe(input: RecipeInput, port: number): string {
  const start = input.startCommand || 'bun run start';
  return `FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb* bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
${input.buildCommand ? `RUN ${input.buildCommand}` : ''}

FROM oven/bun:1-slim
WORKDIR /app
RUN useradd --create-home --uid 10001 app
COPY --from=builder /app ./
USER app
ENV PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD bun -e "fetch('http://127.0.0.1:${port}/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ${jsonCmd(start)}`;
}

function denoRecipe(input: RecipeInput, port: number): string {
  const start = input.startCommand || 'deno task start';
  return `FROM denoland/deno:2
WORKDIR /app
COPY . .
RUN deno cache main.ts || true
USER deno
ENV PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s CMD deno eval "await fetch('http://127.0.0.1:${port}/')"
CMD ${jsonCmd(start)}`;
}

function jsonCmd(command: string): string {
  const trimmed = command.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed;
  if (trimmed.startsWith('sh -c ') || /[|&;<>]/.test(trimmed) || trimmed.includes('||')) {
    const script = trimmed.replace(/^sh -c\s+/, '').replace(/^'|'$/g, '');
    return `["sh", "-c", ${JSON.stringify(script)}]`;
  }
  return JSON.stringify(trimmed.split(/\s+/));
}

export function runtimeFromProjectType(type: RecipeProjectType): AppRuntime {
  if (type === 'dockerfile') return 'docker';
  if (type === 'static-html') return 'static';
  if (type.startsWith('python')) return 'python';
  if (type === 'go') return 'go';
  if (type === 'rust') return 'rust';
  if (type.startsWith('php')) return 'php';
  if (type.startsWith('java')) return 'java';
  if (type.startsWith('ruby')) return 'ruby';
  if (type === 'bun') return 'bun';
  if (type === 'deno') return 'deno';
  return 'node';
}
