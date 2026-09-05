import crypto from 'crypto';
import type Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { dbStorage, DeploymentRecord, AppRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { CaddyService } from './caddy.service.js';
import { ProjectDetector, ProjectInspectionResult } from './project-detector.service.js';
import { AlertService } from './alert.service.js';
import { AppService } from './app.service.js';
import { PortService } from './port.service.js';
import { NodeService } from './node.service.js';
import { containerNameForApp, containerNameForAppProcess, containerNameForAppSlot } from '../utils/naming.js';
import { cacheImageName, recipeHash, matchTagGlob, type AppProcess } from '../utils/app-build.js';
import { planDeployStrategy } from '../utils/app-deploy-plan.js';
import { PROVIDER_KNOWN_HOSTS } from '../utils/app-deploy-key.js';
import {
  applyRecipeToDir,
  mergeResolvedConfig,
  mergeResolvedProcesses,
  readAegisTomlFile,
  recipeFromResolved,
  resolveWorkDir,
} from '../utils/app-deploy-build.js';
import { validateCompose } from '../utils/app-compose.js';
import { emit } from '../realtime.js';
import { CONFIG } from '../config.js';
import { assertSafeGitUrl, SafeGitTarget } from '../utils/url-security.js';
import { injectPublicBuildArgs, publicBuildArgMap, publicBuildArgs } from '../utils/build-env.js';
import { remoteWorkloadPlacement } from '../utils/app-upstream.js';
import { redactSecrets as redactSecretText } from '../utils/redact.js';
import { BuildsCleanupService } from './builds-cleanup.service.js';
import { HealthService } from './health.service.js';
import { DeployQueueService } from './deploy-queue.service.js';
import {
  gitBuildContext,
  planBuildContext,
  shouldFallBackToPanelClone,
} from '../utils/remote-build.js';

const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
const BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const activeDeployments = new Set<string>();

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function appendBounded(current: string, chunk: string, limit = MAX_LOG_BYTES): string {
  if (current.length >= limit) return current;
  return (current + chunk).slice(-limit);
}

function safeBranchName(value: unknown): string {
  const branch = typeof value === 'string' && value.trim() ? value.trim() : 'main';
  if (
    branch.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.includes('@{') ||
    branch.endsWith('/') ||
    branch.endsWith('.')
  ) {
    throw new Error('Nome de branch inválido. Use apenas o formato padrão do Git, sem opções ou caminhos especiais.');
  }
  return branch;
}

function safeCommitHash(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '' || value === 'unknown') return undefined;
  const hash = String(value).trim();
  if (!/^[a-f0-9]{7,64}$/i.test(hash)) {
    throw new Error('Hash de commit inválido.');
  }
  return hash;
}

/**
 * Runs a command without a shell, streaming output to an optional callback.
 *
 * `exec` was used here before, which has two problems for builds: it evaluates
 * a shell string (so any interpolated repository URL or branch name is live
 * code), and it buffers into a 1 MB default maxBuffer, so any build producing
 * more output than that failed with ENOBUFS and was reported as a build error.
 */
function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; onOutput?: (chunk: string) => void; env?: NodeJS.ProcessEnv } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          settled = true;
          child.kill('SIGKILL');
          reject(new Error(`"${command}" excedeu o tempo limite de ${Math.round(options.timeoutMs! / 1000)}s`));
        }, options.timeoutMs)
      : null;

    child.stdout.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8');
      stdout = appendBounded(stdout, text);
      options.onOutput?.(text);
    });

    child.stderr.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8');
      stderr = appendBounded(stderr, text);
      // Docker and git write progress to stderr; it is part of the build log,
      // not necessarily an error.
      options.onOutput?.(text);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

export class CicdService {
  /**
   * Verifies the GitHub HMAC SHA-256 signature over the raw request body.
   *
   * Returns false when either the signature or the secret is missing: an
   * earlier version returned true in that case, which meant an unsigned
   * request passed verification.
   */
  static verifyGitHubSignature(rawBody: string, signatureHeader?: string, secret?: string): boolean {
    if (!signatureHeader || !secret) return false;

    try {
      const digest = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const a = Buffer.from(digest);
      const b = Buffer.from(signatureHeader);
      // timingSafeEqual throws on length mismatch, so compare lengths first.
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** Removes embedded credentials from anything that may reach a log or the UI. */
  static redactSecrets(text: string): string {
    return redactSecretText(text);
  }

  private static redactAppSecrets(text: string, app: AppRecord): string {
    let safe = this.redactSecrets(text);
    for (const value of Object.values(app.env || {})) {
      if (value && value.length >= 4) safe = safe.split(value).join('***');
    }
    return safe;
  }

  private static emitProgress(
    appId: string,
    data: { step: number; stepName: string; line: string; status: 'running' | 'success' | 'failed'; percentage: number }
  ) {
    const safe = { ...data, line: this.redactSecrets(data.line) };
    emit(`deploy:${appId}:stream`, safe);
    emit('deploy:stream', { appId, ...safe });
  }

  /** Keeps credentials out of git's argv and out of process listings. */
  private static gitAuthEnv(
    gitUrl: string,
    token?: string,
    ssh?: { keyPath: string; knownHostsPath: string }
  ): NodeJS.ProcessEnv | undefined {
    if (ssh) {
      return {
        GIT_SSH_COMMAND: `ssh -i ${ssh.keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${ssh.knownHostsPath}`,
      };
    }
    if (!token || !gitUrl.trim().startsWith('https://')) return undefined;

    // Token stays in GIT_CONFIG_* so it never appears in `ps`. GitHub wants
    // x-access-token; GitLab/Gitea accept oauth2.
    const user = /github\.com/i.test(gitUrl) ? 'x-access-token' : 'oauth2';
    const basic = Buffer.from(`${user}:${token}`, 'utf-8').toString('base64');
    return {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    };
  }

  private static buildCloneUrl(gitUrl: string): string {
    return gitUrl.trim();
  }

  /** Pins Git's HTTPS connection to the address checked by assertSafeGitUrl. */
  private static gitNetworkArgs(target: SafeGitTarget): string[] {
    const address = target.address.includes(':') ? `[${target.address}]` : target.address;
    return [
      '-c',
      `http.curloptResolve=${target.hostname}:${target.port}:${address}`,
      '-c',
      'http.followRedirects=false',
    ];
  }

  /** Keeps repository metadata and common secret files out of Docker builds. */
  private static ensureBuildContextIgnore(buildsDir: string): void {
    const ignorePath = path.join(buildsDir, '.dockerignore');
    const required = ['.git', '.env', '.env.*', '*.pem', '*.key', 'data', 'backups'];
    const existing = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf-8').split(/\r?\n/) : [];
    const merged = [...existing.filter(Boolean)];
    for (const entry of required) {
      if (!merged.includes(entry)) merged.push(entry);
    }
    fs.writeFileSync(ignorePath, `${merged.join('\n')}\n`, 'utf-8');
  }

  /**
   * Pre-Deploy Inspector: shallow-clones a repository to detect its framework,
   * build commands and latest commit, then deletes the working copy.
   */
  static async inspectRepository(options: {
    gitUrl: string;
    branch?: string;
    githubToken?: string;
  }): Promise<{
    success: boolean;
    inspection: ProjectInspectionResult;
    commit?: { hash: string; message: string; author: string; date: string };
    toml?: { found: boolean; error?: string };
    proposedBuildConfig?: ReturnType<typeof mergeResolvedConfig>['resolved'];
    proposedProcesses?: AppProcess[];
    recipe?: { dockerfile: string; dockerignore: string; warnings: string[] };
  }> {
    const safeGitTarget = await assertSafeGitUrl(options.gitUrl);
    const tempDir = path.join(
      CONFIG.DATA_DIR,
      'temp',
      `inspect-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`
    );

    try {
      fs.mkdirSync(tempDir, { recursive: true });

      const cloneUrl = this.buildCloneUrl(options.gitUrl);
      const gitEnv = this.gitAuthEnv(options.gitUrl, options.githubToken);
      const branch = safeBranchName(options.branch);
      const gitNetworkArgs = this.gitNetworkArgs(safeGitTarget);

      const cloned = await run(
        'git',
        [...gitNetworkArgs, 'clone', '--depth', '1', '-b', branch, '--single-branch', cloneUrl, tempDir],
        { timeoutMs: CLONE_TIMEOUT_MS, env: gitEnv }
      );

      if (cloned.exitCode !== 0) {
        // Fall back to the repository's default branch.
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        const fallback = await run('git', [...gitNetworkArgs, 'clone', '--depth', '1', cloneUrl, tempDir], {
          timeoutMs: CLONE_TIMEOUT_MS,
          env: gitEnv,
        });
        if (fallback.exitCode !== 0) {
          throw new Error(this.redactSecrets(fallback.stderr.trim() || 'git clone falhou'));
        }
      }

      let commit: { hash: string; message: string; author: string; date: string } | undefined;
      const logResult = await run('git', ['log', '-1', '--format=%H|%h|%s|%an|%cI'], { cwd: tempDir });
      if (logResult.exitCode === 0 && logResult.stdout.includes('|')) {
        const [fullHash, shortHash, subject, authName, commitIso] = logResult.stdout.trim().split('|');
        commit = {
          hash: shortHash || fullHash.substring(0, 7),
          message: subject,
          author: authName,
          date: commitIso,
        };
      }

      const { toml, error: tomlError } = readAegisTomlFile(tempDir);
      const workDir = resolveWorkDir(tempDir, toml?.build?.rootDir);
      const inspection = ProjectDetector.inspect(workDir);
      const { resolved } = mergeResolvedConfig(undefined, toml, inspection.proposedBuildConfig);
      const processes = mergeResolvedProcesses(undefined, toml, inspection.suggestedProcesses);
      const recipe = recipeFromResolved(inspection.type, resolved, inspection.recommendedInternalPort);
      return {
        success: true,
        inspection,
        commit,
        toml: { found: Boolean(toml), error: tomlError },
        proposedBuildConfig: resolved,
        proposedProcesses: processes,
        recipe: { dockerfile: recipe.dockerfile, dockerignore: recipe.dockerignore, warnings: recipe.warnings },
      };
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }

  /**
   * Runs the build and deployment pipeline for an app.
   */
  static async executeDeploy(
    app: AppRecord,
    options: {
      commitHash?: string;
      commitMessage?: string;
      authorName?: string;
      branch?: string;
      triggeredBy: 'webhook' | 'manual' | 'github_action';
      noCache?: boolean;
      tag?: string;
      preview?: { prNumber: number; branch: string; headSha: string };
    }
  ): Promise<DeploymentRecord> {
    /**
     * Queued, not rejected.
     *
     * Throwing "já existe um deploy em execução" is right for a button click
     * and wrong for a webhook: a push arriving during a build was dropped, so
     * the panel silently kept serving an older commit than the branch head with
     * nothing in the UI saying so. The queue also stops two builds from
     * fighting over the same Docker daemon, and two deploys of one app from
     * racing over its container name and host port.
     */
    const queued = this.createQueuedDeployment(app, options);
    return DeployQueueService.enqueue(app, options, queued);
  }

  /**
   * Records the deploy as `queued` before it can start.
   *
   * The row has to exist while waiting: the UI opens the live stream as soon as
   * the request returns, and a deploy with no record until it starts looks to
   * the operator like the click did nothing.
   */
  private static createQueuedDeployment(
    app: AppRecord,
    options: {
      commitHash?: string;
      commitMessage?: string;
      authorName?: string;
      branch?: string;
      triggeredBy: 'webhook' | 'manual' | 'github_action';
      tag?: string;
      preview?: { prNumber: number; branch: string; headSha: string };
    }
  ): DeploymentRecord {
    const deployment: DeploymentRecord = {
      id: `dep-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      appId: app.id,
      appName: app.name,
      commitHash: options.commitHash,
      commitMessage: String(options.commitMessage || 'Manual CI/CD Trigger from AegisPanel').slice(0, 500),
      authorName: String(options.authorName || 'Developer').slice(0, 160),
      branch: safeBranchName(options.branch || app.branch),
      status: 'queued',
      buildLogs: `[${new Date().toISOString()}] ⏳ Deploy na fila...\n`,
      durationSeconds: 0,
      triggeredBy: options.triggeredBy,
      createdAt: new Date().toISOString(),
      previewOf: (options as { preview?: { prNumber: number } }).preview?.prNumber,
      tag: (options as { tag?: string }).tag,
    };
    dbStorage.saveDeployment(deployment);
    return deployment;
  }

  /** Runs one queued deploy. Called only by the queue. */
  static async runQueuedDeploy(
    app: AppRecord,
    options: {
      commitHash?: string;
      commitMessage?: string;
      authorName?: string;
      branch?: string;
      triggeredBy: 'webhook' | 'manual' | 'github_action';
      noCache?: boolean;
      tag?: string;
      preview?: { prNumber: number; branch: string; headSha: string };
    },
    deploymentId: string
  ): Promise<DeploymentRecord> {
    const lane = options.preview ? `preview-${options.preview.prNumber}` : 'production';
    const lockKey = `${app.id}::${lane}`;
    if (activeDeployments.has(lockKey)) {
      throw new Error(`Já existe um deploy em execução para a aplicação "${app.name}".`);
    }
    activeDeployments.add(lockKey);
    try {
      return await this.executeDeployUnlocked(app, options, deploymentId);
    } finally {
      activeDeployments.delete(lockKey);
    }
  }

  /**
   * Rows left `building` belong to a process that died (container recreate,
   * crash). The in-memory lock does not survive that, so the next click is
   * allowed — but the UI still showed a live pipeline. Mark them failed on boot.
   */
  static abandonInFlightDeploys(): number {
    const now = new Date().toISOString();
    let abandoned = 0;
    for (const dep of dbStorage.getDeployments()) {
      if (dep.status !== 'building' && dep.status !== 'queued') continue;
      const previous = dbStorage.getDeploymentLogs(dep.appId, dep.id);
      dbStorage.saveDeployment({
        ...dep,
        status: 'failed',
        finishedAt: now,
        buildLogs:
          `${previous}` +
          `[${now}] ❌ Deploy interrompido: o painel reiniciou antes de concluir.\n`,
      });
      abandoned++;
    }
    return abandoned;
  }

  private static async executeDeployUnlocked(
    app: AppRecord,
    options: {
      commitHash?: string;
      commitMessage?: string;
      authorName?: string;
      branch?: string;
      triggeredBy: 'webhook' | 'manual' | 'github_action';
      noCache?: boolean;
      tag?: string;
      preview?: { prNumber: number; branch: string; headSha: string };
    },
    queuedDeploymentId?: string
  ): Promise<DeploymentRecord> {
    // Reuses the row created while queued, so the id in the live stream the UI
    // already subscribed to stays the same one that ends up in the history.
    const deploymentId =
      queuedDeploymentId || `dep-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const startTime = Date.now();
    const branch = safeBranchName(options.branch || app.branch);

    if (app.sourceType === 'git' && app.gitUrl) await assertSafeGitUrl(app.gitUrl);

    const target = await NodeService.assertDeployTarget(app);
    const dockerClient = await NodeService.getClient(target.nodeId);
    const isRemote = target.isRemote;
    const portOpts = isRemote
      ? { client: dockerClient, nodeId: target.nodeId, excludeAppId: app.id }
      : { nodeId: target.nodeId, excludeAppId: app.id };

    const requestedCommitHash = safeCommitHash(options.commitHash);
    let commitHash = requestedCommitHash || 'unknown';
    let commitMsg = String(options.commitMessage || 'Manual CI/CD Trigger from AegisPanel').slice(0, 500);
    let author = String(options.authorName || 'Developer').slice(0, 160);
    let commitDate = new Date().toISOString();

    const deployment: DeploymentRecord = {
      id: deploymentId,
      appId: app.id,
      appName: app.name,
      commitHash,
      commitMessage: commitMsg,
      authorName: author,
      branch,
      status: 'building',
      buildLogs: `[${new Date().toISOString()}] 🚀 CI/CD Pipeline iniciado para "${app.name}" via ${options.triggeredBy.toUpperCase()}...\n`,
      durationSeconds: 0,
      triggeredBy: options.triggeredBy,
      createdAt: new Date().toISOString(),
    };

    dbStorage.saveDeployment(deployment);

    let logs = deployment.buildLogs;

    /** Appends to the build log and streams the same line to connected clients. */
    const log = (
      line: string,
      progress?: { step: number; stepName: string; percentage: number }
    ) => {
      line = this.redactAppSecrets(line, app);
      logs = appendBounded(logs, line);
      if (progress) {
        this.emitProgress(app.id, { ...progress, line, status: 'running' });
      } else {
        this.emitProgress(app.id, {
          step: 4,
          stepName: 'Compilando',
          line,
          status: 'running',
          percentage: 70,
        });
      }
    };

    this.emitProgress(app.id, {
      step: 1,
      stepName: 'Inicializando Pipeline',
      line: logs,
      status: 'running',
      percentage: 10,
    });

    if (isRemote) {
      try {
        await dockerClient.ping();
      } catch (err: any) {
        logs += `[${new Date().toISOString()}] ❌ Erro: Docker remoto indisponível: ${err.message}\n`;
        deployment.status = 'failed';
        deployment.buildLogs = logs;
        dbStorage.saveDeployment(deployment);
        this.emitProgress(app.id, {
          step: 1,
          stepName: 'Falha Docker Remoto',
          line: 'Docker remoto offline',
          status: 'failed',
          percentage: 100,
        });
        throw new Error(`Docker Engine offline no nó remoto: ${err.message}`);
      }
      log(
        `[${new Date().toISOString()}] 🖥️ Deploy no nó remoto "${target.nodeId}" (build e start no Docker do nó)...\n`,
        {
          step: 1,
          stepName: 'Nó remoto',
          percentage: 12,
        }
      );
    } else if (!(await dockerService.testConnection())) {
      logs += `[${new Date().toISOString()}] ❌ Erro: Docker Engine não está disponível no servidor.\n`;
      deployment.status = 'failed';
      deployment.buildLogs = logs;
      dbStorage.saveDeployment(deployment);
      this.emitProgress(app.id, {
        step: 1,
        stepName: 'Falha Docker Engine',
        line: 'Docker offline',
        status: 'failed',
        percentage: 100,
      });
      throw new Error('Docker Engine offline no servidor.');
    }

    const containerName = containerNameForApp(app.name);
    const buildImageTag = `${containerName}:latest`;
    const versionedTag = `${containerName}:${deploymentId}`;
    const envList = Object.entries(app.env || {}).map(([k, v]) => `${k}=${v}`);

    try {
      // Resolve the host port before building anything.
      //
      // An automatically assigned port that has since been taken by another
      // container is moved to a free one, so a deploy never fails over
      // bookkeeping the panel can redo itself. A port the user chose explicitly
      // is left alone: silently moving it would break whatever they pointed at
      // it, so that case fails with the name of the container holding it.
      //
      // This check lives inside the try so a conflict emits `deploy:stream` as
      // failed. Sitting outside left the row `building` forever and the UI on
      // "Inicializando Pipeline".
      if (!(await PortService.isAvailable(app.port, app.containerId, portOpts))) {
        if (app.autoPort !== false) {
          const previousPort = app.port;
          app.port = await PortService.allocate(undefined, app.containerId, portOpts);
          dbStorage.saveApp(app);
          log(
            `[${new Date().toISOString()}] 🔀 Porta :${previousPort} ocupada; a aplicação foi realocada automaticamente para :${app.port}.
`,
            { step: 1, stepName: 'Porta realocada', percentage: 15 }
          );
        } else {
          const conflict = await PortService.describeConflict(app.port, app.containerId, portOpts);
          throw new Error(
            `${conflict || `A porta :${app.port} está em uso.`} Escolha outra porta nas configurações da aplicação, ou deixe o campo vazio para atribuição automática.`
          );
        }
      }

      const ports: { [intPort: string]: number } = { [`${app.internalPort || 3000}/tcp`]: app.port };

      if (app.sourceType === 'git' && app.gitUrl) {
        /**
         * Let the node's own daemon fetch the repository when it can.
         *
         * The panel used to clone every remote deploy into its own disk, tar
         * the result and stream it over SSH — paying for the same bytes twice
         * and keeping a working copy for a machine that never needed it here.
         */
        const daemon = await this.tryDaemonGitBuild(app, {
          isRemote,
          branch,
          requestedCommitHash,
          dockerClient,
          buildImageTag,
          versionedTag,
          log,
        });
        logs += daemon.logs;
        const daemonBuilt = daemon.built;
        if (daemon.commitHash) commitHash = daemon.commitHash;

        /**
         * Panel-side clone: needed whenever the daemon cannot fetch the
         * repository itself, and whenever the repository has no Dockerfile of
         * its own — framework detection reads the files, so it can only run
         * against a working copy.
         */
        if (!daemonBuilt) {
          const buildsDir = path.join(CONFIG.DATA_DIR, 'builds', app.id);
          fs.mkdirSync(buildsDir, { recursive: true });

          const token = AppService.getGithubToken(app);
          const safeGitTarget = await assertSafeGitUrl(app.gitUrl);
          const gitAuth = this.prepareGitAuth(app, token);
          const cloneUrl = gitAuth.cloneUrl;
          const gitEnv = gitAuth.env;
          const gitNetworkArgs = gitAuth.ssh
            ? []
            : this.gitNetworkArgs(safeGitTarget);

          log(
            token
              ? `[${new Date().toISOString()}] 🔑 [Step 1/5] Autenticando com GitHub Personal Access Token (PAT)...\n`
              : `[${new Date().toISOString()}] 📦 [Step 1/5] Conectando ao repositório: ${app.gitUrl}\n`,
            { step: 1, stepName: token ? 'Autenticação GitHub' : 'Conectando Repositório', percentage: 20 }
          );

          // Step 2: clone or update
          if (fs.existsSync(path.join(buildsDir, '.git'))) {
            log(`[${new Date().toISOString()}] 🌿 [Step 2/5] Atualizando código existente (branch ${branch})...\n`, {
              step: 2,
              stepName: 'Git Fetch',
              percentage: 35,
            });

            // fetch + hard reset rather than pull: a rebased or force-pushed
            // branch makes a merge-based pull fail, and the previous fallback was
            // to delete the whole working copy and clone again.
            // Never leave a PAT in .git/config. It is used only for this fetch,
            // then the remote is immediately restored to the public URL.
            await run('git', ['remote', 'set-url', 'origin', cloneUrl], { cwd: buildsDir });
            const fetched = await run('git', [...gitNetworkArgs, 'fetch', '--prune', 'origin', branch], {
              cwd: buildsDir,
              timeoutMs: CLONE_TIMEOUT_MS,
              onOutput: (c) => log(this.redactSecrets(c)),
              env: gitEnv,
            });

            if (fetched.exitCode !== 0) {
              log(`[Git] Fetch falhou, re-clonando repositório...\n`);
              fs.rmSync(buildsDir, { recursive: true, force: true });
              const cloned = await run('git', [...gitNetworkArgs, 'clone', '-b', branch, '--single-branch', cloneUrl, buildsDir], {
                timeoutMs: CLONE_TIMEOUT_MS,
                env: gitEnv,
              });
              if (cloned.exitCode !== 0) {
                throw new Error(`Falha ao clonar repositório: ${this.redactSecrets(cloned.stderr.trim())}`);
              }
            } else {
              await run('git', ['reset', '--hard', `origin/${branch}`], { cwd: buildsDir });
              await run('git', ['clean', '-fdx'], { cwd: buildsDir });
            }
            await run('git', ['remote', 'set-url', 'origin', app.gitUrl], { cwd: buildsDir });
          } else {
            log(`[${new Date().toISOString()}] 🌿 [Step 2/5] Clonando branch [${branch}]...\n`, {
              step: 2,
              stepName: 'Git Clone',
              percentage: 35,
            });
            const cloned = await run('git', [...gitNetworkArgs, 'clone', '-b', branch, '--single-branch', cloneUrl, buildsDir], {
              timeoutMs: CLONE_TIMEOUT_MS,
              env: gitEnv,
            });
            if (cloned.exitCode !== 0) {
              throw new Error(`Falha ao clonar repositório: ${this.redactSecrets(cloned.stderr.trim())}`);
            }
            await run('git', ['remote', 'set-url', 'origin', app.gitUrl], { cwd: buildsDir });
          }

          this.ensureBuildContextIgnore(buildsDir);

          if (requestedCommitHash) {
            const target = await run('git', ['cat-file', '-e', `${requestedCommitHash}^{commit}`], { cwd: buildsDir });
            if (target.exitCode !== 0) {
              throw new Error(`O commit solicitado para rollback não está disponível localmente: ${requestedCommitHash}`);
            }
            const checkedOut = await run('git', ['reset', '--hard', requestedCommitHash], { cwd: buildsDir });
            if (checkedOut.exitCode !== 0) {
              throw new Error(`Não foi possível selecionar o commit ${requestedCommitHash} para o deploy.`);
            }
          }

          // Real commit metadata
          const logResult = await run('git', ['log', '-1', '--format=%H|%h|%s|%an|%cI'], { cwd: buildsDir });
          if (logResult.exitCode === 0 && logResult.stdout.includes('|')) {
            const [fullHash, shortHash, subject, authName, commitIso] = logResult.stdout.trim().split('|');
            commitHash = shortHash || fullHash?.substring(0, 7) || commitHash;
            commitMsg = subject || commitMsg;
            author = authName || author;
            commitDate = commitIso || commitDate;
            log(`[${new Date().toISOString()}] 🏷️ [Git Commit] ${commitHash} - "${commitMsg}" por ${author}\n`, {
              step: 2,
              stepName: 'Commit Extraído',
              percentage: 40,
            });
          }

          // Step 3: Dockerfile resolution
          const { toml, error: tomlError } = readAegisTomlFile(buildsDir);
          if (tomlError) log(`[${new Date().toISOString()}] ⚠️ aegis.toml: ${tomlError}\n`);
          const workDir = resolveWorkDir(buildsDir, app.buildConfig?.rootDir || toml?.build?.rootDir);
          const dockerfilePath = path.join(workDir, app.buildConfig?.dockerfilePath || 'Dockerfile');
          const internalPort = app.internalPort || 3000;

          let hasGitCommittedDockerfile = false;
          if (fs.existsSync(dockerfilePath)) {
            const tracked = await run('git', ['ls-files', '--error-unmatch', path.relative(buildsDir, dockerfilePath) || 'Dockerfile'], { cwd: buildsDir });
            hasGitCommittedDockerfile = tracked.exitCode === 0;
          }

          const detection = ProjectDetector.inspect(workDir, internalPort);
          const { resolved, diffs } = mergeResolvedConfig(
            app.buildConfig,
            toml,
            detection.proposedBuildConfig,
            app.buildConfig
          );
          const processes = mergeResolvedProcesses(app.processes, toml, detection.suggestedProcesses);
          app.lastInspection = {
            type: detection.type,
            frameworkName: detection.frameworkName,
            packageManager: detection.packageManager,
            outputDir: detection.outputDir,
            hasDockerfile: detection.hasDockerfile,
          };
          if (!app.buildConfig || app.buildConfig.source !== 'manual') {
            app.buildConfig = { ...resolved, source: resolved.source };
          }
          if (!app.processes?.length && processes.length) app.processes = processes;
          dbStorage.saveApp(app);
          for (const line of diffs) {
            log(`[${new Date().toISOString()}] 🔧 buildConfig ${line}\n`);
          }

          const useNative = hasGitCommittedDockerfile && resolved.runtime === 'docker';
          if (!useNative) {
            if (fs.existsSync(dockerfilePath) && !hasGitCommittedDockerfile) {
              fs.rmSync(dockerfilePath, { force: true });
            }

            const recipe = recipeFromResolved(
              detection.type,
              resolved,
              detection.recommendedInternalPort || internalPort,
              AppService.resolveLimits(app).cpus
            );
            log(
              `[${new Date().toISOString()}] ${detection.log}\n` +
                `[${new Date().toISOString()}] 📦 [Step 3/5] Runtime: ${resolved.runtime} ${resolved.version} | ${detection.frameworkName} | Porta :${recipe.internalPort}\n`,
              { step: 3, stepName: `Receita: ${detection.frameworkName}`, percentage: 50 }
            );
            for (const warning of recipe.warnings) log(`[${new Date().toISOString()}] ⚠️ ${warning}\n`);

            if (detection.type === 'static-html') {
              delete ports[`${internalPort}/tcp`];
              ports['80/tcp'] = app.port;
            } else if (recipe.internalPort && recipe.internalPort !== internalPort && (!app.internalPort || app.internalPort === 3000)) {
              delete ports[`${internalPort}/tcp`];
              ports[`${recipe.internalPort}/tcp`] = app.port;
              app.internalPort = recipe.internalPort;
              dbStorage.saveApp(app);
            }

            applyRecipeToDir(workDir, recipe.dockerfile, recipe.dockerignore, app.env || {}, injectPublicBuildArgs);
            deployment.recipeHash = recipeHash(recipe.dockerfile);
          } else {
            try {
              const dockerContent = fs.readFileSync(dockerfilePath, 'utf8');
              const portMatch = dockerContent.match(/EXPOSE\s+(\d+)/i);
              if (portMatch && portMatch[1]) {
                const exposedPort = parseInt(portMatch[1], 10);
                if (exposedPort && exposedPort !== internalPort && (!app.internalPort || app.internalPort === 3000)) {
                  delete ports[`${internalPort}/tcp`];
                  ports[`${exposedPort}/tcp`] = app.port;
                  app.internalPort = exposedPort;
                  dbStorage.saveApp(app);
                }
              }
            } catch (e) {
              // ignore
            }

            log(
              `[${new Date().toISOString()}] 🔍 [Step 3/5] Dockerfile nativo do repositório encontrado. Compilando com o Dockerfile do desenvolvedor...\n`,
              { step: 3, stepName: 'Dockerfile Nativo Git', percentage: 50 }
            );
          }

          // Step 4: build, streaming output line by line
          log(`[${new Date().toISOString()}] 🐳 [Step 4/5] Executando docker build -t ${buildImageTag}...\n`, {
            step: 4,
            stepName: 'Compilando Imagem Docker',
            percentage: 65,
          });

          const cacheHit = await this.buildAppImage({
            app,
            contextDir: workDir,
            buildImageTag,
            versionedTag,
            isRemote,
            dockerClient,
            noCache: Boolean((options as { noCache?: boolean }).noCache),
            log,
          });
          deployment.cacheHit = cacheHit;

        }

        await this.startRelease({
          app,
          deployment,
          containerName,
          buildImageTag,
          envList,
          ports,
          isRemote,
          dockerClient,
          log,
        });
      } else if (app.sourceType === 'compose') {
        await this.deployCompose(app, log);
      } else if (app.sourceType === 'dockerfile') {
        const buildsDir = path.join(CONFIG.DATA_DIR, 'builds', app.id);
        const dockerfilePath = path.join(buildsDir, 'Dockerfile');
        if (!fs.existsSync(dockerfilePath)) {
          throw new Error(
            'Não há Dockerfile no contexto desta aplicação. Envie os arquivos ou use uma origem Git.'
          );
        }
        this.ensureBuildContextIgnore(buildsDir);
        log(
          `[${new Date().toISOString()}] 🐳 [Step 4/5] Compilando Dockerfile nativo em ${buildsDir}...\n`,
          { step: 4, stepName: 'Dockerfile nativo', percentage: 65 }
        );
        if (isRemote) {
          await dockerService.buildImage({
            contextDir: buildsDir,
            tags: [buildImageTag, versionedTag],
            buildArgs: publicBuildArgMap(app.env || {}),
            client: dockerClient,
            timeoutMs: BUILD_TIMEOUT_MS,
            onOutput: (chunk) => log(this.redactSecrets(chunk)),
          });
        } else {
          const buildArgs = publicBuildArgs(app.env || {});
          const build = await run('docker', ['build', ...buildArgs, '-t', buildImageTag, '-t', versionedTag, '.'], {
            cwd: buildsDir,
            timeoutMs: BUILD_TIMEOUT_MS,
            onOutput: (chunk) => log(this.redactSecrets(chunk)),
          });
          if (build.exitCode !== 0) {
            throw new Error(
              `Erro ao compilar imagem Docker (código ${build.exitCode}). Verifique os logs de build acima.`
            );
          }
        }
        await this.startRelease({
          app,
          deployment,
          containerName,
          buildImageTag,
          envList,
          ports,
          isRemote,
          dockerClient,
          log,
        });
      } else {
        const image = app.imageName || 'nginx:alpine';
        log(`[${new Date().toISOString()}] 🐳 [Step 4/5] Preparando contêiner a partir da imagem ${image}...\n`, {
          step: 4,
          stepName: 'Baixando Imagem',
          percentage: 60,
        });

        await this.startRelease({
          app,
          deployment,
          containerName,
          buildImageTag: image,
          envList,
          ports,
          isRemote,
          dockerClient,
          log,
        });
      }

      /**
       * The container exists; that is not the same as the application working.
       *
       * A deploy that reports success while the process crash-loops is worse
       * than one that fails, because nobody goes looking: the panel says green,
       * the site is down, and the previous working image was already replaced.
       * So the pipeline waits for the app to answer before claiming success and
       * puts the previous image back when it never does.
       */
      logs += await this.awaitReadinessOrRollback(app, (line) =>
        log(line, { step: 5, stepName: 'Verificando saúde', percentage: 92 })
      );

      const duration = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      logs += `[${new Date().toISOString()}] ✅ [Step 5/5] Deploy concluído! Servidor ativo na porta :${app.port}\n`;
      logs += `[${new Date().toISOString()}] 🎉 Aplicação online em ${duration}s.\n`;

      deployment.status = 'success';
      deployment.commitHash = commitHash;
      deployment.commitMessage = commitMsg;
      deployment.authorName = author;
      deployment.buildLogs = this.redactSecrets(logs);
      deployment.durationSeconds = duration;
      deployment.finishedAt = new Date().toISOString();
      dbStorage.saveDeployment(deployment);

      app.status = 'running';
      app.lastDeployAt = deployment.finishedAt;
      app.lastCommitHash = commitHash;
      app.lastCommitMessage = commitMsg;
      app.lastCommitAuthor = author;
      app.lastCommitAt = commitDate;
      app.updatedAt = new Date().toISOString();
      dbStorage.saveApp(app);

      try {
        await CaddyService.syncCaddyfile();
      } catch (err: any) {
        console.warn('Caddy sync notice após deploy:', err.message);
      }

      // Right after a deploy, because that is when the tree just grew and when
      // this app's own working copy is the one we must not touch. Never fatal:
      // the deploy already succeeded, and failing it over housekeeping would
      // report a working release as broken.
      try {
        BuildsCleanupService.enforceCap(app.id);
      } catch (err: any) {
        console.warn('Limpeza de builds falhou:', err?.message);
      }

      dbStorage.addActivity({
        type: 'deploy',
        title: `Deploy Sucesso: ${app.name}`,
        description: `Commit #${commitHash} "${commitMsg}" por ${author} (Porta :${app.port})`,
        status: 'success',
        metadata: { appId: app.id, commitHash, durationSeconds: duration },
      });

      AlertService.broadcastNotification(
        `✅ Deploy Concluído: ${app.name}`,
        `🚀 *Aplicação:* ${app.name}\n🌿 *Branch:* ${branch}\n🏷️ *Commit:* #${commitHash} - "${commitMsg}"\n👤 *Autor:* ${author}\n🌐 *Porta:* :${app.port}${app.domain ? `\n🔒 *Domínio:* https://${app.domain}` : ''}\n⏱️ *Tempo de Build:* ${duration}s`,
        'deploy',
        false,
        { appId: app.id }
      );

      this.emitProgress(app.id, {
        step: 5,
        stepName: 'Deploy Concluído!',
        line: 'Deploy finalizado com sucesso!',
        status: 'success',
        percentage: 100,
      });

      return deployment;
    } catch (err: any) {
      const safeMessage = this.redactAppSecrets(err.message || String(err), app);
      logs += `[${new Date().toISOString()}] ❌ ERRO NO DEPLOY: ${safeMessage}\n`;

      deployment.status = 'failed';
      deployment.buildLogs = this.redactSecrets(logs);
      deployment.durationSeconds = Math.round((Date.now() - startTime) / 1000);
      deployment.finishedAt = new Date().toISOString();
      dbStorage.saveDeployment(deployment);

      app.status = 'error';
      dbStorage.saveApp(app);

      dbStorage.addActivity({
        type: 'deploy',
        title: `Deploy Falhou: ${app.name}`,
        description: `Erro: ${safeMessage}`,
        status: 'error',
        metadata: { appId: app.id, error: safeMessage },
      });

      AlertService.broadcastNotification(
        `❌ Falha no Deploy: ${app.name}`,
        `🚨 *Erro no Deploy da Aplicação:* ${app.name}\n🌿 *Branch:* ${branch}\n⚠️ *Detalhe:* ${safeMessage}`,
        'deploy',
        true,
        { appId: app.id }
      );

      this.emitProgress(app.id, {
        step: 5,
        stepName: 'Erro no Deploy',
        line: safeMessage,
        status: 'failed',
        percentage: 100,
      });

      throw new Error(safeMessage);
    }
  }

  /** Restores a previous deployment by re-running its tagged image. */
  /**
   * Builds on the target node from a Git URL the node's daemon fetches itself.
   *
   * Returns `built: false` whenever the panel has to do the clone instead, so
   * the caller falls through to the existing path. That happens for a local
   * deploy, a private repository, and — the case only discovered by trying —
   * a repository that ships no Dockerfile, since framework detection reads the
   * files and can only run against a working copy.
   */
  private static async tryDaemonGitBuild(
    app: AppRecord,
    ctx: {
      isRemote: boolean;
      branch: string;
      requestedCommitHash?: string;
      dockerClient: Docker;
      buildImageTag: string;
      versionedTag: string;
      log: (line: string, progress?: { step: number; stepName: string; percentage: number }) => void;
    }
  ): Promise<{ built: boolean; logs: string; commitHash?: string }> {
    let logs = '';
    const emitLine = (line: string, progress?: { step: number; stepName: string; percentage: number }) => {
      logs += line;
      ctx.log(line, progress);
    };

    const token = AppService.getGithubToken(app);
    const plan = planBuildContext({
      isRemote: ctx.isRemote,
      sourceType: app.sourceType,
      gitUrl: app.gitUrl,
      hasToken: Boolean(token),
      remoteCloneDisabled: app.remoteClone === false,
    });

    if (plan.mode !== 'daemon-git') {
      // Only worth saying when the node could have done it and did not.
      if (ctx.isRemote) emitLine(`[${new Date().toISOString()}] ℹ️ ${plan.reason}\n`);
      return { built: false, logs };
    }

    const safeGitTarget = await assertSafeGitUrl(app.gitUrl!);

    // Resolves the branch to an exact commit without cloning, so the build is
    // pinned and the deploy history records a real hash instead of a branch
    // name that moves.
    let ref = ctx.requestedCommitHash || ctx.branch;
    let resolvedHash = ctx.requestedCommitHash;
    if (!resolvedHash) {
      const lsRemote = await run(
        'git',
        [...this.gitNetworkArgs(safeGitTarget), 'ls-remote', app.gitUrl!, ctx.branch],
        { timeoutMs: 60_000 }
      );
      const sha = lsRemote.stdout.trim().split(/\s+/)[0];
      if (lsRemote.exitCode === 0 && /^[a-f0-9]{40}$/i.test(sha)) {
        ref = sha;
        resolvedHash = sha.substring(0, 7);
      }
    }

    let gitContext: string;
    try {
      gitContext = gitBuildContext(app.gitUrl!, ref);
    } catch (err: any) {
      emitLine(`[${new Date().toISOString()}] ℹ️ Contexto remoto indisponível: ${err.message}\n`);
      return { built: false, logs };
    }

    emitLine(
      `[${new Date().toISOString()}] 🛰️ [Step 2/5] O nó vai buscar o repositório sozinho (${ref.substring(0, 12)}); ` +
        'o painel não clona nem envia contexto.\n',
      { step: 2, stepName: 'Clone no nó', percentage: 35 }
    );

    try {
      await dockerService.buildImageFromGitContext({
        gitContext,
        tags: [ctx.buildImageTag, ctx.versionedTag],
        buildArgs: publicBuildArgMap(app.env || {}),
        client: ctx.dockerClient,
        timeoutMs: BUILD_TIMEOUT_MS,
        onOutput: (chunk) => emitLine(this.redactSecrets(chunk)),
      });
    } catch (err: any) {
      const message = this.redactSecrets(err?.message || String(err));
      if (!shouldFallBackToPanelClone(message)) {
        // A broken Dockerfile fails identically after a local clone; retrying
        // would double the duration of every failed deploy and print the same
        // error twice.
        throw err;
      }
      emitLine(
        `[${new Date().toISOString()}] ↩️ O nó não conseguiu usar o repositório como contexto (${message}). ` +
          'Voltando ao clone no painel.\n'
      );
      return { built: false, logs };
    }

    emitLine(`[${new Date().toISOString()}] ✅ Imagem compilada no próprio nó.\n`, {
      step: 4,
      stepName: 'Compilado no nó',
      percentage: 80,
    });
    return { built: true, logs, commitHash: resolvedHash };
  }

  /** Deploy is only successful once the app answers. */
  private static readonly READINESS_TIMEOUT_MS = 120_000;

  /**
   * Blocks until the new container answers, and restores the previous image
   * when it never does.
   *
   * Throws on failure so the caller's existing error path owns the rest: it
   * already marks the deployment failed, records the activity, alerts and
   * streams the outcome. Duplicating that here would let the two paths drift.
   */
  private static async awaitReadinessOrRollback(
    app: AppRecord,
    log: (line: string) => void
  ): Promise<string> {
    let logs = '';
    const emitLine = (line: string) => {
      logs += line;
      log(line);
    };

    emitLine(
      `[${new Date().toISOString()}] 🩺 Verificando se a aplicação responde ` +
        `(até ${Math.round(this.READINESS_TIMEOUT_MS / 1000)}s)...\n`
    );

    const readiness = await HealthService.waitUntilReady(app, {
      timeoutMs: this.READINESS_TIMEOUT_MS,
      onAttempt: (attempt, result) => {
        if (result.reachable) {
          emitLine(
            `[${new Date().toISOString()}] ✅ Respondeu na tentativa ${attempt} ` +
              `(HTTP ${result.statusCode}, ${result.durationMs}ms).\n`
          );
        } else if (attempt % 5 === 0) {
          // Every attempt would drown the build log; the outcome is what matters.
          emitLine(`[${new Date().toISOString()}] ⏳ Tentativa ${attempt}: ${result.error}\n`);
        }
      },
    });

    if (readiness.ready) {
      app.health = {
        status: 'healthy',
        checkedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
      dbStorage.saveApp(app);
      return logs;
    }

    app.health = {
      status: 'unhealthy',
      checkedAt: new Date().toISOString(),
      consecutiveFailures: readiness.attempts,
      lastError: readiness.lastError,
    };
    dbStorage.saveApp(app);

    emitLine(
      `[${new Date().toISOString()}] ❌ A aplicação não respondeu em ` +
        `${Math.round(this.READINESS_TIMEOUT_MS / 1000)}s (${readiness.lastError}).\n`
    );

    const restored = await this.rollbackToLastHealthy(app, emitLine);
    throw new Error(
      restored
        ? `A aplicação não respondeu após o deploy e foi restaurada para a versão anterior (${restored}). ` +
          'Veja os logs do contêiner para descobrir por que a nova versão não subiu.'
        : 'A aplicação não respondeu após o deploy e não há versão anterior para restaurar. ' +
          'O contêiner continua de pé para inspeção; veja os logs da aplicação.'
    );
  }

  /**
   * Restarts the most recent previously successful deployment.
   *
   * Skips the deployment being rolled back and anything already failed: rolling
   * back onto another broken release would just move the outage.
   */
  private static async rollbackToLastHealthy(
    app: AppRecord,
    log: (line: string) => void
  ): Promise<string | null> {
    const candidates = dbStorage
      .getDeployments(app.id)
      .filter((d) => d.status === 'success')
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    for (const candidate of candidates) {
      log(`[${new Date().toISOString()}] ↩️ Restaurando o deploy anterior #${candidate.commitHash || candidate.id}...\n`);
      try {
        const result = await this.rollback(app.id, candidate.id);
        if (result.success) {
          log(`[${new Date().toISOString()}] ✅ Versão anterior restaurada.\n`);
          return candidate.commitHash || candidate.id;
        }
        log(`[${new Date().toISOString()}] ⚠️ Rollback recusado: ${result.message}\n`);
      } catch (err: any) {
        log(`[${new Date().toISOString()}] ⚠️ Rollback falhou: ${this.redactSecrets(err?.message || String(err))}\n`);
      }
      // Only the newest successful deployment is attempted. Walking further
      // back would silently put a much older release into production without
      // the operator asking for it.
      break;
    }

    return null;
  }

  static async rollback(appId: string, deploymentId: string): Promise<{ success: boolean; message: string }> {
    const app = dbStorage.getAppById(appId);
    if (!app) throw new Error('Aplicação não encontrada');

    const targetDeployment = dbStorage.getDeployments(appId).find((d) => d.id === deploymentId);
    if (!targetDeployment) throw new Error('Histórico de deploy alvo não encontrado');

    const target = await NodeService.assertDeployTarget(app);
    const dockerClient = await NodeService.getClient(target.nodeId);
    const isRemote = target.isRemote;

    const containerName = containerNameForApp(app.name);
    const versionedTag = `${containerName}:${deploymentId}`;
    const envList = Object.entries(app.env || {}).map(([k, v]) => `${k}=${v}`);
    const ports: { [intPort: string]: number } = { [`${app.internalPort || 3000}/tcp`]: app.port };

    // Exact tag comparison. A substring match could select an image belonging
    // to a different application whose tag happens to contain this id.
    const images = await dockerService.listImages(isRemote ? dockerClient : undefined);
    const hasImage = images.some(
      (img: any) => Array.isArray(img.repoTags) && img.repoTags.includes(versionedTag)
    );

    if (!hasImage) {
      if (app.sourceType !== 'git') {
        throw new Error('A imagem versionada do rollback não existe mais e esta aplicação não possui um repositório Git para recompilação.');
      }
      await this.executeDeploy(app, {
        commitHash: targetDeployment.commitHash,
        commitMessage: `[Rollback] Revertendo para ${targetDeployment.commitHash}`,
        authorName: targetDeployment.authorName,
        branch: targetDeployment.branch,
        triggeredBy: 'manual',
      });
      return {
        success: true,
        message: `Imagem versionada não existe mais localmente; o commit #${targetDeployment.commitHash} foi recompilado.`,
      };
    }

    const rollbackPlacement = remoteWorkloadPlacement(isRemote);
    app.containerId = await dockerService.createAndStartContainer({
      name: containerName,
      image: versionedTag,
      env: envList,
      ports,
      bindIp: rollbackPlacement.publishOnAllInterfaces ? '0.0.0.0' : CONFIG.APP_BIND_IP,
      client: rollbackPlacement.useRemoteDocker ? dockerClient : undefined,
      limits: AppService.resolveLimits(app),
      healthcheck: AppService.dockerHealthcheck(app),
      joinPanelNetwork: rollbackPlacement.joinPanelNetwork,
      labels: { 'aegis.type': 'app', 'aegis.app.name': app.name },
    });

    app.status = 'running';
    app.lastCommitHash = targetDeployment.commitHash;
    app.lastCommitMessage = `[Rollback] ${targetDeployment.commitMessage || ''}`;
    app.lastCommitAuthor = targetDeployment.authorName;
    app.lastDeployAt = new Date().toISOString();
    dbStorage.saveApp(app);

    dbStorage.addActivity({
      type: 'rollback',
      title: `Rollback: ${app.name}`,
      description: `Revertido para a versão #${targetDeployment.commitHash}`,
      status: 'info',
      metadata: { appId: app.id, deploymentId },
    });

    AlertService.broadcastNotification(
      `⏪ Rollback Executado: ${app.name}`,
      `A aplicação *${app.name}* foi revertida para o commit *#${targetDeployment.commitHash}*.`,
      'deploy',
      false,
      { appId: app.id }
    );

    return { success: true, message: `Aplicação revertida para a versão #${targetDeployment.commitHash}.` };
  }

  private static prepareGitAuth(
    app: AppRecord,
    token?: string
  ): { cloneUrl: string; env?: NodeJS.ProcessEnv; ssh: boolean } {
    const privateKey = AppService.getDeployKeyPrivate(app);
    if (privateKey && app.gitUrl) {
      const dir = path.join(CONFIG.DATA_DIR, 'tmp', `gitkey-${app.id}`);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const keyPath = path.join(dir, 'id_ed25519');
      const knownHostsPath = path.join(dir, 'known_hosts');
      fs.writeFileSync(keyPath, privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`, { mode: 0o600 });
      fs.writeFileSync(knownHostsPath, PROVIDER_KNOWN_HOSTS, { mode: 0o600 });
      const sshUrl = httpsToSshUrl(app.gitUrl);
      return {
        cloneUrl: sshUrl || this.buildCloneUrl(app.gitUrl),
        env: this.gitAuthEnv(app.gitUrl, undefined, { keyPath, knownHostsPath }),
        ssh: Boolean(sshUrl),
      };
    }
    return { cloneUrl: this.buildCloneUrl(app.gitUrl || ''), env: this.gitAuthEnv(app.gitUrl || '', token), ssh: false };
  }

  private static async buildAppImage(opts: {
    app: AppRecord;
    contextDir: string;
    buildImageTag: string;
    versionedTag: string;
    isRemote: boolean;
    dockerClient: Docker;
    noCache: boolean;
    log: (line: string, progress?: { step: number; stepName: string; percentage: number }) => void;
  }): Promise<boolean> {
    const cacheTag = cacheImageName(opts.app.name);
    const useCache = opts.app.deploy?.cache !== false && !opts.noCache;
    const buildArgs = publicBuildArgs(opts.app.env || {});
    const cacheArgs = useCache ? ['--cache-from', cacheTag, '--build-arg', 'BUILDKIT_INLINE_CACHE=1'] : [];

    const attempt = async (noCache: boolean): Promise<boolean> => {
      if (opts.isRemote) {
        await dockerService.buildImage({
          contextDir: opts.contextDir,
          tags: [opts.buildImageTag, opts.versionedTag],
          buildArgs: publicBuildArgMap(opts.app.env || {}),
          cacheFrom: !noCache && useCache ? [cacheTag] : undefined,
          nocache: noCache,
          client: opts.dockerClient,
          timeoutMs: BUILD_TIMEOUT_MS,
          onOutput: (chunk) => opts.log(this.redactSecrets(chunk)),
        });
        return true;
      }
      const args = [
        'build',
        ...(noCache ? ['--no-cache'] : cacheArgs),
        ...buildArgs,
        '-t',
        opts.buildImageTag,
        '-t',
        opts.versionedTag,
        '.',
      ];
      const build = await run('docker', args, {
        cwd: opts.contextDir,
        timeoutMs: BUILD_TIMEOUT_MS,
        onOutput: (chunk) => opts.log(this.redactSecrets(chunk)),
      });
      if (build.exitCode !== 0) return false;
      return true;
    };

    let ok = await attempt(!useCache);
    let cacheHit = useCache;
    if (!ok && useCache) {
      opts.log(`[${new Date().toISOString()}] ⚠️ Cache de build falhou; repetindo sem cache.\n`);
      ok = await attempt(true);
      cacheHit = false;
    }
    if (!ok) {
      throw new Error('Erro ao compilar imagem Docker. Verifique os logs de build acima.');
    }
    try {
      if (opts.isRemote) await dockerService.tagImage(opts.buildImageTag, cacheTag, opts.dockerClient);
      else await run('docker', ['tag', opts.buildImageTag, cacheTag]);
    } catch {
      cacheHit = false;
    }
    return cacheHit;
  }

  private static async startRelease(opts: {
    app: AppRecord;
    deployment: DeploymentRecord;
    containerName: string;
    buildImageTag: string;
    envList: string[];
    ports: { [k: string]: number };
    isRemote: boolean;
    dockerClient: Docker;
    log: (line: string, progress?: { step: number; stepName: string; percentage: number }) => void;
  }): Promise<void> {
    const { app, deployment, containerName, buildImageTag, envList, ports, isRemote, dockerClient, log } = opts;
    const placement = remoteWorkloadPlacement(isRemote);
    const client = placement.useRemoteDocker ? dockerClient : undefined;
    const limits = AppService.resolveLimits(app);

    const release = (app.processes || []).find((p) => p.type === 'release');
    const hookPre = app.deploy?.hooks?.preDeploy;
    const hookPost = app.deploy?.hooks?.postDeploy;

    const runHook = async (name: string, command: string) => {
      log(`[${new Date().toISOString()}] 🧪 ${name}: ${command}\n`, {
        step: 5,
        stepName: name,
        percentage: 80,
      });
      const result = await dockerService.runOnce({
        name: `${containerName}-${name}-${deployment.id}`.slice(0, 60),
        image: buildImageTag,
        cmd: ['sh', '-c', command],
        env: envList,
        client,
        joinPanelNetwork: placement.joinPanelNetwork,
        limits,
        onOutput: (chunk) => log(this.redactSecrets(chunk)),
      });
      if (result.exitCode !== 0) {
        throw new Error(`${name} falhou (código ${result.exitCode}). O tráfego não foi trocado.`);
      }
    };

    if (hookPre) await runHook('pre_deploy', hookPre);
    if (release) await runHook('release', release.command);

    const plan = planDeployStrategy({
      requested: app.deploy?.strategy,
      hasHealthcheck: Boolean(app.healthcheck),
      hasDomain: Boolean(app.domain),
      remoteExplicitPort: isRemote && app.autoPort === false,
    });
    for (const warning of plan.warnings) log(`[${new Date().toISOString()}] ⚠️ ${warning}\n`);

    const preview = (deployment as DeploymentRecord).previewOf;
    const webName = preview
      ? containerNameForAppSlot(app.name, `pr${preview}`)
      : plan.strategy === 'blue-green'
        ? containerNameForAppSlot(app.name, deployment.id)
        : containerName;

    log(`[${new Date().toISOString()}] 🚀 [Step 5/5] Iniciando ${plan.strategy} em ${webName}...\n`, {
      step: 5,
      stepName: plan.strategy === 'blue-green' ? 'Slot verde' : 'Iniciando Contêiner',
      percentage: 85,
    });

    const started = await dockerService.createAndStartContainer({
      name: webName,
      image: buildImageTag,
      env: envList,
      ports,
      bindIp: placement.publishOnAllInterfaces ? '0.0.0.0' : CONFIG.APP_BIND_IP,
      client,
      limits,
      healthcheck: AppService.dockerHealthcheck(app),
      joinPanelNetwork: placement.joinPanelNetwork,
      replaceExisting: plan.strategy !== 'blue-green',
      labels: { 'aegis.type': 'app', 'aegis.app.name': app.name, 'aegis.slot': plan.strategy === 'blue-green' ? 'green' : 'web' },
    });

    if (plan.strategy === 'blue-green') {
      const previousName = app.activeContainerName || containerName;
      app.activeContainerName = webName;
      app.containerId = started;
      dbStorage.saveApp(app);
      try {
        await CaddyService.syncCaddyfile();
      } catch (err: any) {
        log(`[${new Date().toISOString()}] ⚠️ Caddy swap: ${err.message}\n`);
      }
      if (previousName && previousName !== webName) {
        try {
          await dockerService.removeContainerByName(previousName, true, client);
        } catch {
          // drain best-effort
        }
      }
      deployment.slot = 'green';
      deployment.downtimeMs = 0;
    } else {
      app.activeContainerName = undefined;
      app.containerId = started;
      deployment.slot = 'blue';
    }

    const workers = (app.processes || []).filter((p) => p.type === 'worker');
    const processIds: Array<{ name: string; containerId?: string }> = [{ name: 'web', containerId: started }];
    for (const worker of workers) {
      const replicas = worker.replicas || 1;
      for (let i = 1; i <= replicas; i++) {
        const name = containerNameForAppProcess(app.name, replicas > 1 ? `${worker.name}-${i}` : worker.name);
        const id = await dockerService.createAndStartContainer({
          name,
          image: buildImageTag,
          cmd: ['sh', '-c', worker.command],
          env: envList,
          client,
          limits: worker.limits || limits,
          joinPanelNetwork: placement.joinPanelNetwork,
          labels: { 'aegis.type': 'app', 'aegis.app.name': app.name, 'aegis.process': worker.name },
        });
        processIds.push({ name: worker.name, containerId: id });
      }
    }
    deployment.processes = processIds;
    if (hookPost) await runHook('post_deploy', hookPost);
    log(`[${new Date().toISOString()}] 🚀 Container online com ID: ${started.substring(0, 12)}\n`);
  }

  private static async deployCompose(
    app: AppRecord,
    log: (line: string) => void
  ): Promise<void> {
    if (!app.composeYaml) throw new Error('Esta aplicação não tem um arquivo compose.');
    const root = path.join(CONFIG.DATA_DIR, 'apps', app.id);
    const volumes = path.join(root, 'volumes');
    fs.mkdirSync(volumes, { recursive: true, mode: 0o700 });
    const plan = validateCompose(app.composeYaml, volumes);
    if (!plan.ok) {
      throw new Error(plan.blocked.map((b) => b.message).join(' '));
    }
    const composePath = path.join(root, 'docker-compose.yml');
    fs.writeFileSync(composePath, app.composeYaml, 'utf8');
    const project = containerNameForApp(app.name);
    log(`[${new Date().toISOString()}] 🐳 docker compose up (${project})\n`);
    const up = await run('docker', ['compose', '-p', project, '-f', composePath, 'up', '-d', '--remove-orphans'], {
      cwd: root,
      timeoutMs: BUILD_TIMEOUT_MS,
      onOutput: (chunk) => log(this.redactSecrets(chunk)),
    });
    if (up.exitCode !== 0) throw new Error('docker compose up falhou. Veja os logs.');
  }

  static async recipeForApp(app: AppRecord): Promise<{
    dockerfile: string;
    dockerignore: string;
    sourceByField?: Record<string, string>;
    warnings: string[];
    usedNativeDockerfile: boolean;
  }> {
    const buildsDir = path.join(CONFIG.DATA_DIR, 'builds', app.id);
    if (fs.existsSync(buildsDir)) {
      const { toml } = readAegisTomlFile(buildsDir);
      const workDir = resolveWorkDir(buildsDir, app.buildConfig?.rootDir || toml?.build?.rootDir);
      const inspection = ProjectDetector.inspect(workDir, app.internalPort);
      const { resolved } = mergeResolvedConfig(app.buildConfig, toml, inspection.proposedBuildConfig);
      if (inspection.hasDockerfile && resolved.runtime === 'docker') {
        return {
          dockerfile: inspection.dockerfile,
          dockerignore: inspection.dockerignore,
          sourceByField: resolved.sourceByField,
          warnings: [],
          usedNativeDockerfile: true,
        };
      }
      const recipe = recipeFromResolved(inspection.type, resolved, app.internalPort || inspection.recommendedInternalPort);
      return {
        dockerfile: recipe.dockerfile,
        dockerignore: recipe.dockerignore,
        sourceByField: resolved.sourceByField,
        warnings: recipe.warnings,
        usedNativeDockerfile: false,
      };
    }
    if (app.buildConfig) {
      const type = (app.lastInspection?.type || 'generic-node') as Parameters<typeof recipeFromResolved>[0];
      const { resolved } = mergeResolvedConfig(app.buildConfig, undefined, app.buildConfig);
      const recipe = recipeFromResolved(type, resolved, app.internalPort || 3000);
      return {
        dockerfile: recipe.dockerfile,
        dockerignore: recipe.dockerignore,
        sourceByField: resolved.sourceByField,
        warnings: recipe.warnings,
        usedNativeDockerfile: false,
      };
    }
    throw new Error('Ainda não há receita. Faça um inspect ou o primeiro deploy.');
  }

  static async runOneOff(app: AppRecord, command: string): Promise<{ exitCode: number; logs: string }> {
    if (!app.imageName && !app.lastDeployAt) {
      throw new Error('Faça um deploy antes de executar um comando.');
    }
    const image = `aegis-app-${app.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}:latest`;
    const envList = Object.entries(app.env || {}).map(([k, v]) => `${k}=${v}`);
    return dockerService.runOnce({
      name: `${containerNameForApp(app.name)}-run-${Date.now().toString(36)}`.slice(0, 60),
      image,
      cmd: ['sh', '-c', command],
      env: envList,
      limits: AppService.resolveLimits(app),
    });
  }

  static generateGitHubWorkflow(app: AppRecord, hostUrl: string): string {
    const webhookUrl = `${hostUrl}/api/webhooks/deploy/${app.id}`;

    return `# 🚀 AegisPanel - GitHub Actions Automated CI/CD Workflow
# Salve este arquivo no seu repositório em: .github/workflows/deploy.yml
#
# Antes de usar, crie o secret AEGIS_WEBHOOK_SECRET no repositório
# (Settings > Secrets and variables > Actions) com o valor exibido no painel,
# em Aplicações > ${app.name} > Webhook.

name: AegisPanel Auto-Deploy

on:
  push:
    branches:
      - ${app.branch || 'main'}
  workflow_dispatch:

jobs:
  deploy:
    name: Trigger Deploy to VPS / Local Server
    runs-on: ubuntu-latest

    steps:
      - name: Notify AegisPanel Webhook
        env:
          AEGIS_WEBHOOK_SECRET: \${{ secrets.AEGIS_WEBHOOK_SECRET }}
        run: |
          echo "🚀 Disparando deploy no AegisPanel para o commit \${{ github.sha }}"
          curl --fail-with-body -X POST "${webhookUrl}" \\
            -H "Content-Type: application/json" \\
            -H "X-Aegis-Secret: $AEGIS_WEBHOOK_SECRET" \\
            -d '{
              "commit": "\${{ github.sha }}",
              "message": \${{ toJSON(github.event.head_commit.message) }},
              "author": "\${{ github.actor }}",
              "branch": "\${{ github.ref_name }}"
            }'
`;
  }
}

/**
 * Wired here rather than imported by the queue: CicdService already imports the
 * queue to enqueue, so the queue importing it back would be a module cycle.
 */
DeployQueueService.setRunner((app, request, deploymentId) =>
  CicdService.runQueuedDeploy(app, request, deploymentId)
);

function httpsToSshUrl(httpsUrl: string): string | null {
  try {
    const url = new URL(httpsUrl.trim());
    const host = url.hostname.toLowerCase();
    if (!['github.com', 'gitlab.com', 'bitbucket.org'].includes(host)) return null;
    const repo = url.pathname.replace(/^\//, '');
    return `git@${host}:${repo}`;
  } catch {
    return null;
  }
}
