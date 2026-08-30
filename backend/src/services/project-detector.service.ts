import fs from 'fs';
import path from 'path';

export type ProjectType =
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
  | 'python-generic';

export interface ProjectInspectionResult {
  type: ProjectType;
  frameworkName: string;
  category: 'spa' | 'ssr' | 'api' | 'static' | 'docker';
  icon: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'pipenv' | 'docker';
  hasDockerfile: boolean;
  hasPackageJson: boolean;
  buildCommand: string;
  outputDir: string;
  installCommand: string;
  startCommand: string;
  recommendedPort: number;
  recommendedInternalPort: number;
  suggestedEnv: Record<string, string>;
  dockerfile: string;
  runtimeCmd: string;
  log: string;
}

export class ProjectDetector {
  static inspect(buildDir: string, internalPort: number = 3000): ProjectInspectionResult {
    let type: ProjectType = 'generic-node';
    let frameworkName = 'Node.js Application';
    let category: 'spa' | 'ssr' | 'api' | 'static' | 'docker' = 'api';
    let icon = 'nodejs';
    let packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'pipenv' | 'docker' = 'npm';
    let hasPackageJson = false;
    let hasDockerfile = false;
    let packageJson: any = {};

    // 1. Check Native Dockerfile (Highest Priority)
    const dockerfilePath = path.join(buildDir, 'Dockerfile');
    if (fs.existsSync(dockerfilePath)) {
      hasDockerfile = true;
      try {
        const dockerContent = fs.readFileSync(dockerfilePath, 'utf8');
        let detectedPort = internalPort;
        const portMatch = dockerContent.match(/EXPOSE\s+(\d+)/i);
        if (portMatch && portMatch[1]) {
          detectedPort = parseInt(portMatch[1], 10);
        }

        return {
          type: 'dockerfile',
          frameworkName: 'Dockerfile Nativo (Custom)',
          category: 'docker',
          icon: 'docker',
          packageManager: 'docker',
          hasDockerfile: true,
          hasPackageJson: fs.existsSync(path.join(buildDir, 'package.json')),
          buildCommand: 'docker build -t app .',
          outputDir: '.',
          installCommand: 'docker build',
          startCommand: 'docker run',
          recommendedPort: 5000,
          recommendedInternalPort: detectedPort,
          suggestedEnv: {
            PORT: detectedPort.toString(),
          },
          dockerfile: dockerContent,
          runtimeCmd: 'docker-native',
          log: `🐳 Dockerfile nativo encontrado no repositório. Porta detectada: :${detectedPort}. Compilando conforme configuração do desenvolvedor...`,
        };
      } catch (e) {
        // Continue fallback if read fails
      }
    }

    // 2. Check Package Manager locks (Node.js ecosystem)
    if (fs.existsSync(path.join(buildDir, 'pnpm-lock.yaml'))) {
      packageManager = 'pnpm';
    } else if (fs.existsSync(path.join(buildDir, 'yarn.lock'))) {
      packageManager = 'yarn';
    } else if (fs.existsSync(path.join(buildDir, 'bun.lockb')) || fs.existsSync(path.join(buildDir, 'bun.lock'))) {
      packageManager = 'bun';
    } else {
      packageManager = 'npm';
    }

    // 3. Parse package.json
    const packageJsonPath = path.join(buildDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      hasPackageJson = true;
      try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      } catch (e) {
        // ignore
      }
    }

    const scripts = packageJson.scripts || {};
    const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
    const checkFiles = (files: string[]) => files.some(f => fs.existsSync(path.join(buildDir, f)));

    let buildCommand = scripts.build ? `${packageManager} run build` : '';
    let outputDir = 'dist';
    let installCommand = `${packageManager} install`;
    let startCommand = scripts.start ? `${packageManager} start` : 'node server.js';
    let log = '';

    // Helper for Python files scan
    let rootFiles: string[] = [];
    try {
      rootFiles = fs.readdirSync(buildDir);
    } catch (e) {}

    const pyFiles = rootFiles.filter(f => f.endsWith('.py'));
    const hasPythonRequirements = fs.existsSync(path.join(buildDir, 'requirements.txt'));
    const hasPyproject = fs.existsSync(path.join(buildDir, 'pyproject.toml'));
    const hasPipfile = fs.existsSync(path.join(buildDir, 'Pipfile'));
    const isPythonProject = !hasPackageJson && (pyFiles.length > 0 || hasPythonRequirements || hasPyproject || hasPipfile);

    // 4. Framework Detection Tree
    if (isPythonProject) {
      if (fs.existsSync(path.join(buildDir, 'poetry.lock')) || (hasPyproject && fs.readFileSync(path.join(buildDir, 'pyproject.toml'), 'utf8').includes('tool.poetry'))) {
        packageManager = 'poetry';
      } else if (hasPipfile) {
        packageManager = 'pipenv';
      } else {
        packageManager = 'pip';
      }

      let reqContent = '';
      if (hasPythonRequirements) {
        try {
          reqContent = fs.readFileSync(path.join(buildDir, 'requirements.txt'), 'utf8').toLowerCase();
        } catch (e) {}
      }

      const hasDjango = rootFiles.includes('manage.py') || reqContent.includes('django');
      const hasFastApi = reqContent.includes('fastapi') || rootFiles.includes('main.py') && fs.existsSync(path.join(buildDir, 'main.py')) && fs.readFileSync(path.join(buildDir, 'main.py'), 'utf8').includes('FastAPI');
      const hasFlask = reqContent.includes('flask') || rootFiles.includes('web_app.py') || rootFiles.includes('app.py');

      if (hasDjango) {
        type = 'python-django';
        frameworkName = 'Django (Python Web Framework)';
        category = 'api';
        icon = 'django';
        buildCommand = 'python manage.py collectstatic --noinput';
        startCommand = 'python manage.py runserver 0.0.0.0:8000';
        log = `🐍 Framework detectado: Django. Preparando ambiente Python com migrações e servidor WSGI...`;
        return {
          type,
          frameworkName,
          category,
          icon,
          packageManager,
          hasDockerfile: false,
          hasPackageJson: false,
          buildCommand,
          outputDir: '.',
          installCommand: 'pip install -r requirements.txt',
          startCommand,
          recommendedPort: 8000,
          recommendedInternalPort: 8000,
          suggestedEnv: {
            PYTHONUNBUFFERED: '1',
            PORT: '8000',
            DJANGO_SETTINGS_MODULE: 'core.settings',
          },
          dockerfile: `FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl dnsutils gcc libpq-dev && rm -rf /var/lib/apt/lists/*
COPY requirements*.txt Pipfile* pyproject.toml* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; else pip install --no-cache-dir django gunicorn; fi
COPY . .
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8000/ || exit 1
CMD ["sh", "-c", "python manage.py migrate --noinput && (gunicorn --bind 0.0.0.0:8000 --workers 2 core.wsgi:application || python manage.py runserver 0.0.0.0:8000)"]`,
          runtimeCmd: startCommand,
          log,
        };
      } else if (hasFastApi) {
        type = 'python-fastapi';
        frameworkName = 'FastAPI (Python REST Framework)';
        category = 'api';
        icon = 'fastapi';
        buildCommand = '';
        startCommand = 'uvicorn main:app --host 0.0.0.0 --port 8000';
        log = `⚡ Framework detectado: FastAPI. Preparando servidor assíncrono Uvicorn na porta 8000...`;
        return {
          type,
          frameworkName,
          category,
          icon,
          packageManager,
          hasDockerfile: false,
          hasPackageJson: false,
          buildCommand,
          outputDir: '.',
          installCommand: 'pip install -r requirements.txt',
          startCommand,
          recommendedPort: 8000,
          recommendedInternalPort: 8000,
          suggestedEnv: {
            PYTHONUNBUFFERED: '1',
            PORT: '8000',
          },
          dockerfile: `FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl dnsutils gcc && rm -rf /var/lib/apt/lists/*
COPY requirements*.txt Pipfile* pyproject.toml* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; else pip install --no-cache-dir fastapi uvicorn; fi
COPY . .
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8000/docs || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`,
          runtimeCmd: startCommand,
          log,
        };
      } else if (hasFlask) {
        type = 'python-flask';
        frameworkName = 'Flask (Python Web HUD & API)';
        category = 'api';
        icon = 'flask';
        buildCommand = '';
        startCommand = 'python web_app.py';
        log = `🌶️ Framework detectado: Flask (web_app.py / app.py). Preparando servidor Python HUD na porta 5000...`;
        return {
          type,
          frameworkName,
          category,
          icon,
          packageManager,
          hasDockerfile: false,
          hasPackageJson: false,
          buildCommand,
          outputDir: '.',
          installCommand: 'pip install -r requirements.txt',
          startCommand,
          recommendedPort: 5000,
          recommendedInternalPort: 5000,
          suggestedEnv: {
            PYTHONUNBUFFERED: '1',
            PORT: '5000',
            FLASK_ENV: 'production',
          },
          dockerfile: `FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl dnsutils whois net-tools gcc && rm -rf /var/lib/apt/lists/*
COPY requirements*.txt Pipfile* pyproject.toml* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; else pip install --no-cache-dir flask rich dnspython gunicorn; fi
COPY . .
ENV PYTHONUNBUFFERED=1
ENV PORT=5000
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:5000/ || exit 1
CMD ["sh", "-c", "if [ -f web_app.py ]; then (gunicorn --bind 0.0.0.0:5000 --workers 2 --timeout 120 web_app:app || python web_app.py); elif [ -f app.py ]; then (gunicorn --bind 0.0.0.0:5000 --workers 2 --timeout 120 app:app || python app.py); else python main.py; fi"]`,
          runtimeCmd: startCommand,
          log,
        };
      } else {
        type = 'python-generic';
        frameworkName = 'Python Application';
        category = 'api';
        icon = 'python';
        buildCommand = '';
        startCommand = rootFiles.includes('main.py') ? 'python main.py' : 'python app.py';
        log = `🐍 Aplicação Python detectada. Configurando runtime Python 3.11 com gerenciador PIP...`;
        return {
          type,
          frameworkName,
          category,
          icon,
          packageManager,
          hasDockerfile: false,
          hasPackageJson: false,
          buildCommand,
          outputDir: '.',
          installCommand: 'pip install -r requirements.txt',
          startCommand,
          recommendedPort: 5000,
          recommendedInternalPort: 5000,
          suggestedEnv: {
            PYTHONUNBUFFERED: '1',
            PORT: '5000',
          },
          dockerfile: `FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl dnsutils whois net-tools gcc && rm -rf /var/lib/apt/lists/*
COPY requirements*.txt Pipfile* pyproject.toml* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; else pip install --no-cache-dir rich dnspython; fi
COPY . .
ENV PYTHONUNBUFFERED=1
ENV PORT=5000
EXPOSE 5000
CMD ["sh", "-c", "if [ -f main.py ]; then python main.py; elif [ -f app.py ]; then python app.py; else python -m http.server 5000; fi"]`,
          runtimeCmd: startCommand,
          log,
        };
      }
    } else if (checkFiles(['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'])) {
      type = 'vite';
      frameworkName = 'Vite (React / Vue / Svelte SPA)';
      category = 'spa';
      icon = 'vite';
      buildCommand = `${packageManager} run build`;
      outputDir = 'dist';
      startCommand = `serve -s dist -l ${internalPort}`;
      log = `⚡ Framework detectado: Vite SPA (vite.config encontrado). Compilando bundle estático e servindo via 'serve' com Healthcheck...`;
    } else if (checkFiles(['next.config.js', 'next.config.mjs', 'next.config.ts'])) {
      type = 'nextjs';
      frameworkName = 'Next.js (App & Pages Router)';
      category = 'ssr';
      icon = 'nextjs';
      buildCommand = `${packageManager} run build`;
      outputDir = '.next';
      startCommand = `${packageManager} start`;
      log = `▲ Framework detectado: Next.js (next.config encontrado). Compilando build otimizado com SSR e rotas API...`;
    } else if (checkFiles(['astro.config.mjs', 'astro.config.ts', 'astro.config.js'])) {
      type = 'astro';
      frameworkName = 'Astro (Content & Web Apps)';
      category = 'spa';
      icon = 'astro';
      buildCommand = `${packageManager} run build`;
      outputDir = 'dist';
      startCommand = `serve -s dist -l ${internalPort}`;
      log = `🚀 Framework detectado: Astro. Compilando páginas e servindo estático via 'serve'...`;
    } else if (checkFiles(['nuxt.config.ts', 'nuxt.config.js'])) {
      type = 'nuxt';
      frameworkName = 'Nuxt.js 3 (Vue SSR Framework)';
      category = 'ssr';
      icon = 'nuxt';
      buildCommand = `${packageManager} run build`;
      outputDir = '.output';
      startCommand = `node .output/server/index.mjs`;
      log = `💚 Framework detectado: Nuxt 3 (nuxt.config encontrado). Compilando servidor Nitro...`;
    } else if (checkFiles(['remix.config.js', 'remix.config.ts'])) {
      type = 'remix';
      frameworkName = 'Remix (Fullstack React)';
      category = 'ssr';
      icon = 'remix';
      buildCommand = `${packageManager} run build`;
      outputDir = 'build';
      startCommand = `${packageManager} start`;
      log = `💿 Framework detectado: Remix. Compilando servidor e cliente...`;
    } else if (checkFiles(['svelte.config.js', 'svelte.config.ts'])) {
      type = 'sveltekit';
      frameworkName = 'SvelteKit / Svelte';
      category = 'ssr';
      icon = 'svelte';
      buildCommand = `${packageManager} run build`;
      outputDir = 'build';
      startCommand = `node build`;
      log = `🧡 Framework detectado: SvelteKit. Compilando adaptador...`;
    } else if (hasPackageJson && deps['@nestjs/core']) {
      type = 'nestjs';
      frameworkName = 'NestJS (TypeScript Enterprise API)';
      category = 'api';
      icon = 'nestjs';
      buildCommand = `${packageManager} run build`;
      outputDir = 'dist';
      startCommand = scripts.start ? `${packageManager} start` : 'node dist/main.js';
      log = `🦁 Framework detectado: NestJS. Compilando código TypeScript e iniciando API...`;
    } else if (hasPackageJson && (deps['express'] || deps['fastify'] || deps['koa'] || deps['hapi'])) {
      type = 'express';
      frameworkName = 'Express.js / Fastify REST API';
      category = 'api';
      icon = 'express';
      buildCommand = scripts.build ? `${packageManager} run build` : '';
      outputDir = 'dist';
      startCommand = scripts.start ? `${packageManager} start` : (fs.existsSync(path.join(buildDir, 'server.js')) ? 'node server.js' : 'node index.js');
      log = `🚂 Framework detectado: Express/Fastify API. Preparando servidor Node.js...`;
    } else if (hasPackageJson) {
      type = 'generic-node';
      frameworkName = 'Node.js Generic Application';
      category = 'api';
      icon = 'nodejs';
      buildCommand = scripts.build ? `${packageManager} run build` : '';
      outputDir = 'dist';
      startCommand = scripts.start ? `${packageManager} start` : 'node index.js';
      log = `📦 Projeto Node.js detectado (package.json). Gerando pipeline padrão...`;
    } else {
      let htmlFiles: string[] = [];
      try {
        htmlFiles = fs.readdirSync(buildDir).filter(f => f.endsWith('.html'));
      } catch (e) {}

      if (htmlFiles.length > 0) {
        type = 'static-html';
        frameworkName = 'HTML / CSS / JS Estático';
        category = 'static';
        icon = 'html5';
        buildCommand = '';
        outputDir = '.';
        startCommand = 'nginx -g "daemon off;"';
        log = `📄 Projeto HTML/CSS estático detectado. Servindo via Nginx de alta performance na porta 80...`;
      } else {
        type = 'generic-node';
        frameworkName = 'Node.js Application';
        category = 'api';
        icon = 'nodejs';
        log = `📦 Estrutura padrão Node.js detectada...`;
      }
    }

    // 5. Generate Multi-Stage Dockerfile for JS/TS/Static
    let dockerfile = '';
    let runtimeCmd = startCommand;

    // Helper for PM install commands
    const installSteps =
      packageManager === 'pnpm'
        ? `RUN corepack enable && corepack prepare pnpm@latest --activate\nRUN pnpm install --frozen-lockfile || pnpm install`
        : packageManager === 'yarn'
        ? `RUN yarn install --network-timeout 100000 || yarn install`
        : `RUN npm install --include=dev --legacy-peer-deps || npm install`;

    const rawBuildCmd =
      packageManager === 'pnpm'
        ? `pnpm run build`
        : packageManager === 'yarn'
        ? `yarn build`
        : `npm run build`;

    const buildStep = `RUN ${rawBuildCmd}`;

    if (type === 'vite' || type === 'astro') {
      dockerfile = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json pnpm-lock.yaml* yarn.lock* ./
ENV NODE_ENV=development
${installSteps}
COPY . .
ENV PATH="/app/node_modules/.bin:$PATH"
${buildStep}

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/${outputDir} ./${outputDir}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:${internalPort}/ || exit 1
EXPOSE ${internalPort}
CMD ["serve", "-s", "${outputDir}", "-l", "${internalPort}"]`;
      runtimeCmd = `serve -s ${outputDir} -l ${internalPort}`;
    } else if (type === 'nextjs') {
      dockerfile = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json pnpm-lock.yaml* yarn.lock* ./
ENV NODE_ENV=development
${installSteps}
COPY . .
ENV PATH="/app/node_modules/.bin:$PATH"
${buildStep}

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app ./
ENV NODE_ENV=production
ENV PORT=${internalPort}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:${internalPort}/ || exit 1
EXPOSE ${internalPort}
CMD ["${packageManager}", "start"]`;
      runtimeCmd = `${packageManager} start`;
    } else if (type === 'nuxt' || type === 'remix' || type === 'sveltekit') {
      dockerfile = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json pnpm-lock.yaml* yarn.lock* ./
ENV NODE_ENV=development
${installSteps}
COPY . .
ENV PATH="/app/node_modules/.bin:$PATH"
${buildStep}

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app ./
ENV NODE_ENV=production
ENV PORT=${internalPort}
EXPOSE ${internalPort}
CMD ["sh", "-c", "if [ -d .output/server ]; then node .output/server/index.mjs; elif [ -d dist ]; then serve -s dist -l ${internalPort}; elif [ -d build ]; then serve -s build -l ${internalPort}; else ${packageManager} start; fi"]`;
      runtimeCmd = `sh -c "if [ -d .output/server ]; then node .output/server/index.mjs; else ${packageManager} start; fi"`;
    } else if (type === 'express' || type === 'nestjs' || (type === 'generic-node' && scripts.start)) {
      dockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json pnpm-lock.yaml* yarn.lock* ./
ENV NODE_ENV=development
${installSteps}
COPY . .
ENV PATH="/app/node_modules/.bin:$PATH"
RUN if grep -q '"build"' package.json; then ${rawBuildCmd}; fi
ENV NODE_ENV=production
ENV PORT=${internalPort}
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:${internalPort}/ || exit 1
EXPOSE ${internalPort}
CMD ["${packageManager}", "start"]`;
      runtimeCmd = `${packageManager} start`;
    } else if (type === 'generic-node') {
      dockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json pnpm-lock.yaml* yarn.lock* ./
ENV NODE_ENV=development
${installSteps}
COPY . .
ENV PATH="/app/node_modules/.bin:$PATH"
RUN if grep -q '"build"' package.json; then ${rawBuildCmd}; fi
RUN npm install -g serve
ENV PORT=${internalPort}
EXPOSE ${internalPort}
CMD ["sh", "-c", "if [ -d dist ]; then serve -s dist -l ${internalPort}; elif [ -d build ]; then serve -s build -l ${internalPort}; elif [ -f server.js ]; then node server.js; elif [ -f index.js ]; then node index.js; elif [ -f app.js ]; then node app.js; elif [ -f main.js ]; then node main.js; else echo 'No entry point found' && exit 1; fi"]`;
      runtimeCmd = `sh -c "if [ -d dist ]; then serve -s dist -l ${internalPort}; elif [ -f server.js ]; then node server.js; else node index.js; fi"`;
    } else if (type === 'static-html') {
      dockerfile = `FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN rm -f /usr/share/nginx/html/Dockerfile
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:80/ || exit 1
EXPOSE 80`;
      runtimeCmd = `nginx -g 'daemon off;'`;
    }

    return {
      type,
      frameworkName,
      category,
      icon,
      packageManager,
      hasDockerfile,
      hasPackageJson,
      buildCommand,
      outputDir,
      installCommand,
      startCommand,
      recommendedPort: type === 'static-html' ? 80 : 5000,
      recommendedInternalPort: type === 'static-html' ? 80 : 3000,
      suggestedEnv: {
        NODE_ENV: 'production',
      },
      dockerfile,
      runtimeCmd,
      log,
    };
  }

  static detect(buildDir: string, internalPort: number = 3000): { type: ProjectType; dockerfile: string; runtimeCmd: string; log: string } {
    const res = this.inspect(buildDir, internalPort);
    return {
      type: res.type,
      dockerfile: res.dockerfile,
      runtimeCmd: res.runtimeCmd,
      log: res.log,
    };
  }
}
