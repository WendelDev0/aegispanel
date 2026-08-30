import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { dbStorage, DeploymentRecord, AppRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { CaddyService } from './caddy.service.js';
import { ProjectDetector, ProjectInspectionResult } from './project-detector.service.js';
import { AlertService } from './alert.service.js';
import { AppService } from './app.service.js';
import { containerNameForApp } from '../utils/naming.js';
import { emit } from '../realtime.js';
import { CONFIG } from '../config.js';

const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
const BUILD_TIMEOUT_MS = 30 * 60 * 1000;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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
  options: { cwd?: string; timeoutMs?: number; onOutput?: (chunk: string) => void } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
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
      stdout += text;
      options.onOutput?.(text);
    });

    child.stderr.on('data', (buf: Buffer) => {
      const text = buf.toString('utf-8');
      stderr += text;
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
    return text
      .replace(/https:\/\/[^@\s/]+@/g, 'https://***@')
      .replace(/\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, '***')
      .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '***');
  }

  private static emitProgress(
    appId: string,
    data: { step: number; stepName: string; line: string; status: 'running' | 'success' | 'failed'; percentage: number }
  ) {
    const safe = { ...data, line: this.redactSecrets(data.line) };
    emit(`deploy:${appId}:stream`, safe);
    emit('deploy:stream', { appId, ...safe });
  }

  /** Builds an authenticated clone URL without letting the token reach a log. */
  private static buildCloneUrl(gitUrl: string, token?: string): string {
    const clean = gitUrl.trim();
    if (token && clean.startsWith('https://github.com/')) {
      return `https://${token}@github.com/${clean.replace('https://github.com/', '')}`;
    }
    return clean;
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
  }> {
    const tempDir = path.join(
      CONFIG.DATA_DIR,
      'temp',
      `inspect-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`
    );

    try {
      fs.mkdirSync(tempDir, { recursive: true });

      const cloneUrl = this.buildCloneUrl(options.gitUrl, options.githubToken);
      const branch = options.branch || 'main';

      const cloned = await run(
        'git',
        ['clone', '--depth', '1', '-b', branch, '--single-branch', cloneUrl, tempDir],
        { timeoutMs: CLONE_TIMEOUT_MS }
      );

      if (cloned.exitCode !== 0) {
        // Fall back to the repository's default branch.
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        const fallback = await run('git', ['clone', '--depth', '1', cloneUrl, tempDir], {
          timeoutMs: CLONE_TIMEOUT_MS,
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

      return { success: true, inspection: ProjectDetector.inspect(tempDir), commit };
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
    }
  ): Promise<DeploymentRecord> {
    const deploymentId = `dep-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const startTime = Date.now();
    const branch = options.branch || app.branch || 'main';

    let commitHash = options.commitHash || 'unknown';
    let commitMsg = options.commitMessage || 'Manual CI/CD Trigger from AegisPanel';
    let author = options.authorName || 'Developer';
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
      logs += line;
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

    if (!(await dockerService.testConnection())) {
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
    const ports: { [intPort: string]: number } = { [`${app.internalPort || 3000}/tcp`]: app.port };

    try {
      if (app.sourceType === 'git' && app.gitUrl) {
        const buildsDir = path.join(CONFIG.DATA_DIR, 'builds', app.id);
        fs.mkdirSync(buildsDir, { recursive: true });

        const token = AppService.getGithubToken(app);
        const cloneUrl = this.buildCloneUrl(app.gitUrl, token);

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
          const fetched = await run('git', ['fetch', '--prune', 'origin', branch], {
            cwd: buildsDir,
            timeoutMs: CLONE_TIMEOUT_MS,
            onOutput: (c) => log(this.redactSecrets(c)),
          });

          if (fetched.exitCode !== 0) {
            log(`[Git] Fetch falhou, re-clonando repositório...\n`);
            fs.rmSync(buildsDir, { recursive: true, force: true });
            const cloned = await run('git', ['clone', '-b', branch, '--single-branch', cloneUrl, buildsDir], {
              timeoutMs: CLONE_TIMEOUT_MS,
            });
            if (cloned.exitCode !== 0) {
              throw new Error(`Falha ao clonar repositório: ${this.redactSecrets(cloned.stderr.trim())}`);
            }
          } else {
            await run('git', ['reset', '--hard', `origin/${branch}`], { cwd: buildsDir });
            await run('git', ['clean', '-fd'], { cwd: buildsDir });
          }
        } else {
          log(`[${new Date().toISOString()}] 🌿 [Step 2/5] Clonando branch [${branch}]...\n`, {
            step: 2,
            stepName: 'Git Clone',
            percentage: 35,
          });
          const cloned = await run('git', ['clone', '-b', branch, '--single-branch', cloneUrl, buildsDir], {
            timeoutMs: CLONE_TIMEOUT_MS,
          });
          if (cloned.exitCode !== 0) {
            throw new Error(`Falha ao clonar repositório: ${this.redactSecrets(cloned.stderr.trim())}`);
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
        const dockerfilePath = path.join(buildsDir, 'Dockerfile');
        const internalPort = app.internalPort || 3000;

        let hasGitCommittedDockerfile = false;
        if (fs.existsSync(dockerfilePath)) {
          const tracked = await run('git', ['ls-files', '--error-unmatch', 'Dockerfile'], { cwd: buildsDir });
          hasGitCommittedDockerfile = tracked.exitCode === 0;
        }

        if (!hasGitCommittedDockerfile) {
          if (fs.existsSync(dockerfilePath)) {
            fs.rmSync(dockerfilePath, { force: true });
          }

          const detection = ProjectDetector.inspect(buildsDir, internalPort);
          log(
            `[${new Date().toISOString()}] ${detection.log}\n` +
              `[${new Date().toISOString()}] 📦 [Step 3/5] Framework: ${detection.frameworkName} | Gerenciador: ${detection.packageManager.toUpperCase()} | Porta Interna: :${internalPort}\n`,
            { step: 3, stepName: `Detectado: ${detection.frameworkName}`, percentage: 50 }
          );

          if (detection.type === 'static-html') {
            delete ports[`${internalPort}/tcp`];
            ports['80/tcp'] = app.port;
          }

          fs.writeFileSync(dockerfilePath, detection.dockerfile, 'utf-8');
        } else {
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

        const build = await run('docker', ['build', '-t', buildImageTag, '-t', versionedTag, '.'], {
          cwd: buildsDir,
          timeoutMs: BUILD_TIMEOUT_MS,
          onOutput: (chunk) => log(this.redactSecrets(chunk)),
        });

        if (build.exitCode !== 0) {
          throw new Error(
            `Erro ao compilar imagem Docker (código ${build.exitCode}). Verifique os logs de build acima.`
          );
        }

        // Step 5: start the container
        log(`[${new Date().toISOString()}] 🚀 [Step 5/5] Iniciando contêiner na porta host :${app.port}...\n`, {
          step: 5,
          stepName: 'Iniciando Contêiner',
          percentage: 85,
        });

        app.containerId = await dockerService.createAndStartContainer({
          name: containerName,
          image: buildImageTag,
          env: envList,
          ports,
        });
        logs += `[${new Date().toISOString()}] 🚀 Container online com ID: ${app.containerId.substring(0, 12)}\n`;
      } else {
        const image = app.imageName || 'nginx:alpine';
        log(`[${new Date().toISOString()}] 🐳 [Step 4/5] Preparando contêiner a partir da imagem ${image}...\n`, {
          step: 4,
          stepName: 'Baixando Imagem',
          percentage: 60,
        });

        app.containerId = await dockerService.createAndStartContainer({
          name: containerName,
          image,
          env: envList,
          ports,
        });
        logs += `[${new Date().toISOString()}] 🚀 Container criado com ID: ${app.containerId.substring(0, 12)}\n`;
      }

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
        false
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
      const safeMessage = this.redactSecrets(err.message || String(err));
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
        true
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
  static async rollback(appId: string, deploymentId: string): Promise<{ success: boolean; message: string }> {
    const app = dbStorage.getAppById(appId);
    if (!app) throw new Error('Aplicação não encontrada');

    const targetDeployment = dbStorage.getDeployments(appId).find((d) => d.id === deploymentId);
    if (!targetDeployment) throw new Error('Histórico de deploy alvo não encontrado');

    const containerName = containerNameForApp(app.name);
    const versionedTag = `${containerName}:${deploymentId}`;
    const envList = Object.entries(app.env || {}).map(([k, v]) => `${k}=${v}`);
    const ports: { [intPort: string]: number } = { [`${app.internalPort || 3000}/tcp`]: app.port };

    // Exact tag comparison. A substring match could select an image belonging
    // to a different application whose tag happens to contain this id.
    const images = await dockerService.listImages();
    const hasImage = images.some(
      (img: any) => Array.isArray(img.repoTags) && img.repoTags.includes(versionedTag)
    );

    if (!hasImage) {
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

    app.containerId = await dockerService.createAndStartContainer({
      name: containerName,
      image: versionedTag,
      env: envList,
      ports,
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
      false
    );

    return { success: true, message: `Aplicação revertida para a versão #${targetDeployment.commitHash}.` };
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
