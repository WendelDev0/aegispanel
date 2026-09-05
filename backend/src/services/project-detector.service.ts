import fs from 'fs';
import path from 'path';
import {
  DEFAULT_RUNTIME_VERSION,
  type AppBuildConfig,
  type AppProcess,
  type AppRuntime,
  type PackageManager,
} from '../utils/app-build.js';
import {
  generateRecipe,
  runtimeFromProjectType,
  type RecipeProjectType,
} from '../utils/app-recipes.js';

export type ProjectType = RecipeProjectType;

export interface ProjectInspectionResult {
  type: ProjectType;
  frameworkName: string;
  category: 'spa' | 'ssr' | 'api' | 'static' | 'docker' | 'compiled';
  icon: string;
  packageManager: PackageManager;
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
  dockerignore: string;
  runtimeCmd: string;
  log: string;
  runtime: AppRuntime;
  runtimeVersion: string;
  proposedBuildConfig: AppBuildConfig;
  suggestedProcesses: AppProcess[];
}

export class ProjectDetector {
  static inspect(buildDir: string, internalPort: number = 3000): ProjectInspectionResult {
    const dockerfilePath = path.join(buildDir, 'Dockerfile');
    const hasDockerfile = fs.existsSync(dockerfilePath);
    if (hasDockerfile) {
      try {
        const dockerContent = fs.readFileSync(dockerfilePath, 'utf8');
        let detectedPort = internalPort;
        const portMatch = dockerContent.match(/EXPOSE\s+(\d+)/i);
        if (portMatch?.[1]) detectedPort = parseInt(portMatch[1], 10);
        return finish({
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
          suggestedEnv: { PORT: String(detectedPort) },
          dockerfile: dockerContent,
          runtimeCmd: 'docker-native',
          log: `Dockerfile nativo encontrado. Porta detectada: :${detectedPort}.`,
        }, buildDir, detectedPort);
      } catch {
        // fall through to language detection if the Dockerfile cannot be read
      }
    }

    const rootFiles = safeReaddir(buildDir);
    const packageJson = readJson(path.join(buildDir, 'package.json'));
    const hasPackageJson = Boolean(packageJson);
    const scripts = packageJson?.scripts || {};
    const deps = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
    const checkFiles = (files: string[]) => files.some((f) => fs.existsSync(path.join(buildDir, f)));

    if (checkFiles(['go.mod'])) {
      const goMod = safeRead(path.join(buildDir, 'go.mod'));
      const goVer = (goMod.match(/^go\s+(\d+\.\d+)/m) || [])[1] || '1.23';
      const version = goVer.startsWith('1.21') ? '1.21' : goVer.startsWith('1.22') ? '1.22' : goVer.startsWith('1.24') ? '1.24' : '1.23';
      return finish({
        type: 'go',
        frameworkName: 'Go',
        category: 'compiled',
        icon: 'go',
        packageManager: 'go',
        runtimeVersion: version,
        startCommand: './app',
        log: `Go detectado (go.mod). Versão ${version}.`,
        recommendedInternalPort: 8080,
      }, buildDir, 8080);
    }

    if (checkFiles(['Cargo.toml'])) {
      return finish({
        type: 'rust',
        frameworkName: 'Rust',
        category: 'compiled',
        icon: 'rust',
        packageManager: 'cargo',
        startCommand: './app',
        log: 'Rust detectado (Cargo.toml).',
        recommendedInternalPort: 8080,
      }, buildDir, 8080);
    }

    if (checkFiles(['composer.json'])) {
      const composer = readJson(path.join(buildDir, 'composer.json')) || {};
      const require = { ...(composer.require || {}), ...(composer['require-dev'] || {}) };
      const laravel = Boolean(require['laravel/framework'] || checkFiles(['artisan']));
      const symfony = Boolean(require['symfony/framework-bundle'] || checkFiles(['bin/console']));
      return finish({
        type: laravel ? 'php-laravel' : symfony ? 'php-symfony' : 'php-generic',
        frameworkName: laravel ? 'Laravel' : symfony ? 'Symfony' : 'PHP',
        category: 'api',
        icon: 'php',
        packageManager: 'composer',
        startCommand: laravel
          ? 'php artisan serve --host=0.0.0.0 --port=8080'
          : 'php -S 0.0.0.0:8080 -t public',
        log: `PHP detectado (${laravel ? 'Laravel' : symfony ? 'Symfony' : 'genérico'}).`,
        recommendedInternalPort: 8080,
        suggestedProcesses: laravel
          ? [{ name: 'release', type: 'release', command: 'php artisan migrate --force' }]
          : [],
      }, buildDir, 8080);
    }

    if (checkFiles(['pom.xml', 'build.gradle', 'build.gradle.kts'])) {
      const gradle = checkFiles(['build.gradle', 'build.gradle.kts']);
      const spring = /springframework|spring-boot/i.test(
        safeRead(path.join(buildDir, gradle ? 'build.gradle' : 'pom.xml')) ||
          safeRead(path.join(buildDir, 'build.gradle.kts'))
      );
      return finish({
        type: spring ? 'java-spring' : 'java-generic',
        frameworkName: spring ? 'Spring Boot' : 'Java',
        category: 'api',
        icon: 'java',
        packageManager: gradle ? 'gradle' : 'maven',
        log: `Java detectado (${gradle ? 'Gradle' : 'Maven'}${spring ? ', Spring Boot' : ''}).`,
        recommendedInternalPort: 8080,
      }, buildDir, 8080);
    }

    if (checkFiles(['Gemfile'])) {
      const gemfile = safeRead(path.join(buildDir, 'Gemfile'));
      const rails = /gem\s+['"]rails['"]/.test(gemfile) || checkFiles(['config/application.rb']);
      return finish({
        type: rails ? 'ruby-rails' : 'ruby-generic',
        frameworkName: rails ? 'Ruby on Rails' : 'Ruby',
        category: 'api',
        icon: 'ruby',
        packageManager: 'bundler',
        startCommand: 'bundle exec puma -b tcp://0.0.0.0:3000',
        log: `Ruby detectado${rails ? ' (Rails)' : ''}.`,
        suggestedProcesses: rails
          ? [{ name: 'release', type: 'release', command: 'bundle exec rails db:migrate' }]
          : [],
      }, buildDir, 3000);
    }

    if (checkFiles(['deno.json', 'deno.jsonc'])) {
      return finish({
        type: 'deno',
        frameworkName: 'Deno',
        category: 'api',
        icon: 'deno',
        packageManager: 'deno',
        startCommand: 'deno task start',
        log: 'Deno detectado (deno.json).',
      }, buildDir, 8000);
    }

    const pyFiles = rootFiles.filter((f) => f.endsWith('.py'));
    const hasPythonRequirements = fs.existsSync(path.join(buildDir, 'requirements.txt'));
    const hasPyproject = fs.existsSync(path.join(buildDir, 'pyproject.toml'));
    const hasPipfile = fs.existsSync(path.join(buildDir, 'Pipfile'));
    const hasUvLock = fs.existsSync(path.join(buildDir, 'uv.lock'));
    const isPython =
      !hasPackageJson &&
      (pyFiles.length > 0 || hasPythonRequirements || hasPyproject || hasPipfile || hasUvLock);

    if (isPython) {
      return inspectPython(buildDir, rootFiles, hasPyproject, hasPipfile, hasUvLock);
    }

    let packageManager: PackageManager = 'npm';
    if (fs.existsSync(path.join(buildDir, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
    else if (fs.existsSync(path.join(buildDir, 'yarn.lock'))) packageManager = 'yarn';
    else if (
      fs.existsSync(path.join(buildDir, 'bun.lockb')) ||
      fs.existsSync(path.join(buildDir, 'bun.lock'))
    ) {
      packageManager = 'bun';
    }

    const enginesNode = String(packageJson?.engines?.node || '');
    const nodeVersion = enginesNode.includes('22') ? '22' : enginesNode.includes('18') ? '18' : '20';
    const bunStart = String(scripts.start || '').startsWith('bun ') || packageManager === 'bun' && !hasPackageJson;

    if (bunStart && !checkFiles(['vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs'])) {
      return finish({
        type: 'bun',
        frameworkName: 'Bun',
        category: 'api',
        icon: 'bun',
        packageManager: 'bun',
        startCommand: scripts.start || 'bun run start',
        log: 'Bun detectado como runtime.',
        runtimeVersion: '1',
      }, buildDir, internalPort);
    }

    const base: Partial<Draft> = {
      packageManager,
      hasPackageJson,
      runtimeVersion: nodeVersion,
      buildCommand: scripts.build ? `${packageManager} run build` : '',
      installCommand:
        packageManager === 'pnpm'
          ? 'pnpm install'
          : packageManager === 'yarn'
            ? 'yarn install'
            : 'npm install',
      startCommand: scripts.start ? `${packageManager} start` : 'node index.js',
    };

    if (checkFiles(['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'])) {
      return finish({
        ...base,
        type: 'vite',
        frameworkName: 'Vite (React / Vue / Svelte SPA)',
        category: 'spa',
        icon: 'vite',
        outputDir: 'dist',
        startCommand: `serve -s dist -l ${internalPort}`,
        log: 'Vite SPA detectado.',
      }, buildDir, internalPort);
    }
    if (checkFiles(['next.config.js', 'next.config.mjs', 'next.config.ts'])) {
      return finish({
        ...base,
        type: 'nextjs',
        frameworkName: 'Next.js',
        category: 'ssr',
        icon: 'nextjs',
        outputDir: '.next',
        log: 'Next.js detectado.',
      }, buildDir, internalPort);
    }
    if (checkFiles(['astro.config.mjs', 'astro.config.ts', 'astro.config.js'])) {
      return finish({
        ...base,
        type: 'astro',
        frameworkName: 'Astro',
        category: 'spa',
        icon: 'astro',
        outputDir: 'dist',
        log: 'Astro detectado.',
      }, buildDir, internalPort);
    }
    if (checkFiles(['nuxt.config.ts', 'nuxt.config.js'])) {
      return finish({
        ...base,
        type: 'nuxt',
        frameworkName: 'Nuxt.js 3',
        category: 'ssr',
        icon: 'nuxt',
        outputDir: '.output',
        startCommand: 'node .output/server/index.mjs',
        log: 'Nuxt 3 detectado.',
      }, buildDir, internalPort);
    }
    if (checkFiles(['remix.config.js', 'remix.config.ts'])) {
      return finish({
        ...base,
        type: 'remix',
        frameworkName: 'Remix',
        category: 'ssr',
        icon: 'remix',
        log: 'Remix detectado.',
      }, buildDir, internalPort);
    }
    if (checkFiles(['svelte.config.js', 'svelte.config.ts'])) {
      return finish({
        ...base,
        type: 'sveltekit',
        frameworkName: 'SvelteKit',
        category: 'ssr',
        icon: 'svelte',
        startCommand: 'node build',
        log: 'SvelteKit detectado.',
      }, buildDir, internalPort);
    }
    if (hasPackageJson && deps['@nestjs/core']) {
      return finish({
        ...base,
        type: 'nestjs',
        frameworkName: 'NestJS',
        category: 'api',
        icon: 'nestjs',
        startCommand: scripts.start ? `${packageManager} start` : 'node dist/main.js',
        log: 'NestJS detectado.',
      }, buildDir, internalPort);
    }
    if (hasPackageJson && (deps.express || deps.fastify || deps.koa || deps.hapi)) {
      return finish({
        ...base,
        type: 'express',
        frameworkName: 'Express.js / Fastify',
        category: 'api',
        icon: 'express',
        startCommand: scripts.start
          ? `${packageManager} start`
          : fs.existsSync(path.join(buildDir, 'server.js'))
            ? 'node server.js'
            : 'node index.js',
        log: 'API Node detectada.',
      }, buildDir, internalPort);
    }
    if (hasPackageJson) {
      return finish({
        ...base,
        type: 'generic-node',
        frameworkName: 'Node.js',
        category: 'api',
        icon: 'nodejs',
        log: 'Projeto Node.js genérico.',
      }, buildDir, internalPort);
    }

    const htmlFiles = rootFiles.filter((f) => f.endsWith('.html'));
    if (htmlFiles.length > 0) {
      return finish({
        type: 'static-html',
        frameworkName: 'HTML / CSS / JS Estático',
        category: 'static',
        icon: 'html5',
        packageManager: 'docker',
        startCommand: 'nginx -g "daemon off;"',
        recommendedInternalPort: 80,
        log: 'Projeto estático detectado. Nginx na porta 80.',
      }, buildDir, 80);
    }

    return finish({
      type: 'generic-node',
      frameworkName: 'Node.js Application',
      category: 'api',
      icon: 'nodejs',
      packageManager: 'npm',
      log: 'Estrutura padrão Node.js.',
    }, buildDir, internalPort);
  }

  static detect(buildDir: string, internalPort: number = 3000): {
    type: ProjectType;
    dockerfile: string;
    runtimeCmd: string;
    log: string;
  } {
    const res = this.inspect(buildDir, internalPort);
    return { type: res.type, dockerfile: res.dockerfile, runtimeCmd: res.runtimeCmd, log: res.log };
  }
}

type Draft = Partial<ProjectInspectionResult> & { type: ProjectType };

function inspectPython(
  buildDir: string,
  rootFiles: string[],
  hasPyproject: boolean,
  hasPipfile: boolean,
  hasUvLock: boolean
): ProjectInspectionResult {
  const pyproject = hasPyproject ? safeRead(path.join(buildDir, 'pyproject.toml')) : '';
  let packageManager: PackageManager = 'pip';
  if (hasUvLock || /\[tool\.uv\]/.test(pyproject)) packageManager = 'uv';
  else if (
    fs.existsSync(path.join(buildDir, 'poetry.lock')) ||
    /\[tool\.poetry\]/.test(pyproject)
  ) {
    packageManager = 'poetry';
  } else if (hasPipfile) packageManager = 'pipenv';

  const req = safeRead(path.join(buildDir, 'requirements.txt')).toLowerCase();
  const mainPy = safeRead(path.join(buildDir, 'main.py'));
  const hasDjango = rootFiles.includes('manage.py') || req.includes('django') || /django/i.test(pyproject);
  const hasFastApi =
    req.includes('fastapi') ||
    /fastapi/i.test(pyproject) ||
    (rootFiles.includes('main.py') && mainPy.includes('FastAPI'));
  const hasFlask = req.includes('flask') || /flask/i.test(pyproject) || rootFiles.includes('web_app.py') || rootFiles.includes('app.py');

  const requires = pyproject.match(/requires-python\s*=\s*["']>=?\s*3\.(\d+)/);
  const runtimeVersion =
    requires && Number(requires[1]) >= 13
      ? '3.13'
      : requires && Number(requires[1]) >= 12
        ? '3.12'
        : requires && Number(requires[1]) === 11
          ? '3.11'
          : requires && Number(requires[1]) === 10
            ? '3.10'
            : '3.12';

  const suggestedProcesses: AppProcess[] = [];
  const wantsWorker = /celery|rq|arq|dramatiq/.test(req) || /celery|rq|arq/.test(pyproject);
  if (hasDjango) {
    suggestedProcesses.push({
      name: 'release',
      type: 'release',
      command: 'python manage.py migrate --noinput',
    });
  } else if (/alembic/.test(req) || /alembic/.test(pyproject)) {
    suggestedProcesses.push({
      name: 'release',
      type: 'release',
      command: 'alembic upgrade head',
    });
  }
  if (wantsWorker) {
    suggestedProcesses.push({
      name: 'worker',
      type: 'worker',
      command: hasDjango ? 'celery -A core worker -l info' : 'celery -A app worker -l info',
      replicas: 1,
    });
  }

  if (hasDjango) {
    return finish({
      type: 'python-django',
      frameworkName: 'Django',
      category: 'api',
      icon: 'django',
      packageManager,
      runtimeVersion,
      startCommand: 'gunicorn --bind 0.0.0.0:8000 --workers 2 core.wsgi:application',
      recommendedInternalPort: 8000,
      suggestedEnv: { PYTHONUNBUFFERED: '1', PORT: '8000' },
      suggestedProcesses,
      log: `Django detectado com ${packageManager} / Python ${runtimeVersion}.`,
    }, buildDir, 8000);
  }
  if (hasFastApi) {
    return finish({
      type: 'python-fastapi',
      frameworkName: 'FastAPI',
      category: 'api',
      icon: 'fastapi',
      packageManager,
      runtimeVersion,
      startCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000',
      recommendedInternalPort: 8000,
      suggestedEnv: { PYTHONUNBUFFERED: '1', PORT: '8000' },
      suggestedProcesses,
      log: `FastAPI detectado com ${packageManager} / Python ${runtimeVersion}.`,
    }, buildDir, 8000);
  }
  if (hasFlask) {
    return finish({
      type: 'python-flask',
      frameworkName: 'Flask',
      category: 'api',
      icon: 'flask',
      packageManager,
      runtimeVersion,
      startCommand: 'python web_app.py',
      recommendedInternalPort: 5000,
      suggestedEnv: { PYTHONUNBUFFERED: '1', PORT: '5000', FLASK_ENV: 'production' },
      suggestedProcesses,
      log: `Flask detectado com ${packageManager} / Python ${runtimeVersion}.`,
    }, buildDir, 5000);
  }
  return finish({
    type: 'python-generic',
    frameworkName: 'Python',
    category: 'api',
    icon: 'python',
    packageManager,
    runtimeVersion,
    startCommand: rootFiles.includes('main.py') ? 'python main.py' : 'python app.py',
    recommendedInternalPort: 5000,
    suggestedEnv: { PYTHONUNBUFFERED: '1', PORT: '5000' },
    suggestedProcesses,
    log: `Python genérico com ${packageManager} / Python ${runtimeVersion}.`,
  }, buildDir, 5000);
}

function finish(draft: Draft, _buildDir: string, fallbackPort: number): ProjectInspectionResult {
  const type = draft.type;
  const runtime = draft.runtime || runtimeFromProjectType(type);
  const runtimeVersion = draft.runtimeVersion || DEFAULT_RUNTIME_VERSION[runtime];
  const packageManager = (draft.packageManager || 'npm') as PackageManager;
  const internalPort = draft.recommendedInternalPort || fallbackPort;
  const recipe = generateRecipe({
    type,
    runtime,
    version: runtimeVersion,
    packageManager,
    outputDir: draft.outputDir,
    installCommand: draft.installCommand,
    buildCommand: draft.buildCommand,
    startCommand: draft.startCommand,
    internalPort,
  });

  const proposedBuildConfig: AppBuildConfig = {
    runtime,
    version: runtimeVersion,
    outputDir: draft.outputDir,
    installCommand: draft.installCommand,
    buildCommand: draft.buildCommand,
    startCommand: draft.startCommand,
    packageManager,
    source: 'detected',
  };

  return {
    type,
    frameworkName: draft.frameworkName || runtime,
    category: draft.category || 'api',
    icon: draft.icon || runtime,
    packageManager,
    hasDockerfile: Boolean(draft.hasDockerfile),
    hasPackageJson: Boolean(draft.hasPackageJson),
    buildCommand: draft.buildCommand || '',
    outputDir: draft.outputDir || '.',
    installCommand: draft.installCommand || '',
    startCommand: draft.startCommand || '',
    recommendedPort: draft.recommendedPort || 5000,
    recommendedInternalPort: recipe.internalPort,
    suggestedEnv: draft.suggestedEnv || { PORT: String(recipe.internalPort) },
    dockerfile: draft.dockerfile || recipe.dockerfile,
    dockerignore: recipe.dockerignore,
    runtimeCmd: draft.runtimeCmd || draft.startCommand || '',
    log: draft.log || '',
    runtime,
    runtimeVersion,
    proposedBuildConfig,
    suggestedProcesses: draft.suggestedProcesses || [],
  };
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeRead(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
