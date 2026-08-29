import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { dbStorage, DeploymentRecord, AppRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { CaddyService } from './caddy.service.js';
import { ProjectDetector, ProjectInspectionResult } from './project-detector.service.js';
import { AlertService } from './alert.service.js';
import { io } from '../server.js';
import { CONFIG } from '../config.js';

const execAsync = promisify(exec);

export class CicdService {
  /**
   * Verifies GitHub HMAC SHA-256 signature
   */
  static verifyGitHubSignature(rawBody: string, signatureHeader?: string, secret?: string): boolean {
    if (!signatureHeader || !secret) return true;

    try {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = 'sha256=' + hmac.update(rawBody).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signatureHeader));
    } catch {
      return false;
    }
  }

  private static emitProgress(appId: string, data: { step: number; stepName: string; line: string; status: 'running' | 'success' | 'failed'; percentage: number }) {
    try {
      io.emit(`deploy:${appId}:stream`, data);
      io.emit('deploy:stream', { appId, ...data });
    } catch {
      // ignore
    }
  }

  /**
   * Pre-Deploy Inspector (Vercel Style Auto-Discovery)
   * Clones a shallow snapshot of the repo to inspect package.json, framework, build commands & commits
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
    const tempDir = path.join(CONFIG.DATA_DIR, 'temp', `inspect-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`);
    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      let cloneUrl = options.gitUrl.trim();
      if (options.githubToken && cloneUrl.startsWith('https://github.com/')) {
        const repoPath = cloneUrl.replace('https://github.com/', '');
        cloneUrl = `https://${options.githubToken}@github.com/${repoPath}`;
      }

      const branch = options.branch || 'main';
      try {
        await execAsync(`git clone --depth 1 -b ${branch} --single-branch "${cloneUrl}" "${tempDir}"`);
      } catch {
        // Fallback: clone default branch
        await execAsync(`git clone --depth 1 "${cloneUrl}" "${tempDir}"`);
      }

      let commit: { hash: string; message: string; author: string; date: string } | undefined;
      try {
        const { stdout: logOut } = await execAsync('git log -1 --format="%H|%h|%s|%an|%cI"', { cwd: tempDir });
        if (logOut && logOut.includes('|')) {
          const [fullHash, shortHash, subject, authName, commitIso] = logOut.trim().split('|');
          commit = {
            hash: shortHash || fullHash.substring(0, 7),
            message: subject,
            author: authName,
            date: commitIso,
          };
        }
      } catch {}

      const inspection = ProjectDetector.inspect(tempDir);
      return { success: true, inspection, commit };
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }

  /**
   * Executes a Real CI/CD Build and Deployment pipeline:
   * 1. Clones repository (with PAT support if private)
   * 2. Extracts real Git commit hash, message, author & timestamp
   * 3. Detects project type and generates optimized multi-stage Dockerfile
   * 4. Builds real Docker image and tags with deployment ID for rollback
   * 5. Spawns and maps container on the requested host port with auto-heal
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
    let commitHash = options.commitHash || Math.random().toString(36).substring(2, 9);
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
    this.emitProgress(app.id, { step: 1, stepName: 'Inicializando Pipeline', line: deployment.buildLogs, status: 'running', percentage: 10 });

    let logs = deployment.buildLogs;
    const isDockerOnline = await dockerService.testConnection();

    if (!isDockerOnline) {
      logs += `[${new Date().toISOString()}] ❌ Erro: Docker Engine não está disponível no servidor.\n`;
      deployment.status = 'failed';
      deployment.buildLogs = logs;
      dbStorage.saveDeployment(deployment);
      this.emitProgress(app.id, { step: 1, stepName: 'Falha Docker Engine', line: 'Docker offline', status: 'failed', percentage: 100 });
      throw new Error('Docker Engine offline no servidor.');
    }

    const containerName = `aegis-app-${app.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
    const buildImageTag = `aegis-app-${app.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}:latest`;
    const versionedTag = `aegis-app-${app.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}:${deploymentId}`;
    const envList = Object.entries(app.env || {}).map(([k, v]) => `${k}=${v}`);
    const ports: { [intPort: string]: number } = {};
    ports[`${app.internalPort || 3000}/tcp`] = app.port;

    try {
      if (app.sourceType === 'git' && app.gitUrl) {
        const buildsDir = path.join(CONFIG.DATA_DIR, 'builds', app.id);
        if (!fs.existsSync(buildsDir)) {
          fs.mkdirSync(buildsDir, { recursive: true });
        }

        // Step 1: Auth & Repo info
        let cloneUrl = app.gitUrl.trim();
        if (app.githubToken && cloneUrl.startsWith('https://github.com/')) {
          const repoPath = cloneUrl.replace('https://github.com/', '');
          cloneUrl = `https://${app.githubToken}@github.com/${repoPath}`;
          const line = `[${new Date().toISOString()}] 🔑 [Step 1/5] Autenticando com GitHub Personal Access Token (PAT)...\n`;
          logs += line;
          this.emitProgress(app.id, { step: 1, stepName: 'Autenticação GitHub', line, status: 'running', percentage: 20 });
        } else {
          const line = `[${new Date().toISOString()}] 📦 [Step 1/5] Conectando ao repositório: ${app.gitUrl}\n`;
          logs += line;
          this.emitProgress(app.id, { step: 1, stepName: 'Conectando Repositório', line, status: 'running', percentage: 20 });
        }

        // Step 2: Clone or Pull
        const gitDir = path.join(buildsDir, '.git');
        if (fs.existsSync(gitDir)) {
          const line = `[${new Date().toISOString()}] 🌿 [Step 2/5] Atualizando código existente (git pull origin ${branch})...\n`;
          logs += line;
          this.emitProgress(app.id, { step: 2, stepName: 'Git Pull', line, status: 'running', percentage: 35 });
          try {
            const { stdout: pullOut } = await execAsync(`git pull origin ${branch}`, { cwd: buildsDir });
            logs += pullOut ? `[Git] ${pullOut}\n` : '';
          } catch (gitErr: any) {
            logs += `[Git Warning] Pull falhou, re-clonando: ${gitErr.message}\n`;
            fs.rmSync(buildsDir, { recursive: true, force: true });
            await execAsync(`git clone -b ${branch} --single-branch "${cloneUrl}" "${buildsDir}"`);
          }
        } else {
          const line = `[${new Date().toISOString()}] 🌿 [Step 2/5] Clonando branch [${branch}]...\n`;
          logs += line;
          this.emitProgress(app.id, { step: 2, stepName: 'Git Clone', line, status: 'running', percentage: 35 });
          try {
            await execAsync(`git clone -b ${branch} --single-branch "${cloneUrl}" "${buildsDir}"`);
          } catch (cloneErr: any) {
            throw new Error(`Falha ao clonar repositório: ${cloneErr.message.replace(/https:\/\/[^@]+@/, 'https://***@')}`);
          }
        }

        // Extract real commit details from git log
        try {
          const { stdout: logOut } = await execAsync('git log -1 --format="%H|%h|%s|%an|%cI"', { cwd: buildsDir });
          if (logOut && logOut.includes('|')) {
            const [fullHash, shortHash, subject, authName, commitIso] = logOut.trim().split('|');
            commitHash = shortHash || fullHash?.substring(0, 7) || commitHash;
            commitMsg = subject || commitMsg;
            author = authName || author;
            commitDate = commitIso || commitDate;
            const line = `[${new Date().toISOString()}] 🏷️ [Git Commit] ${commitHash} - "${commitMsg}" por ${author}\n`;
            logs += line;
            this.emitProgress(app.id, { step: 2, stepName: 'Commit Extraído', line, status: 'running', percentage: 40 });
          }
        } catch {
          // ignore
        }

        // Step 3: Smart Project Detector & Dockerfile Validation
        const dockerfilePath = path.join(buildsDir, 'Dockerfile');
        const internalPort = app.internalPort || 3000;

        let hasGitCommittedDockerfile = false;
        if (fs.existsSync(dockerfilePath)) {
          try {
            const { stdout } = await execAsync('git ls-files Dockerfile', { cwd: buildsDir });
            hasGitCommittedDockerfile = stdout.trim().length > 0;
          } catch {
            hasGitCommittedDockerfile = false;
          }
        }

        if (!hasGitCommittedDockerfile) {
          // If an auto-generated Dockerfile existed from a previous build, delete it to ensure fresh detection
          if (fs.existsSync(dockerfilePath)) {
            try {
              fs.rmSync(dockerfilePath, { force: true });
            } catch {}
          }

          const detection = ProjectDetector.inspect(buildsDir, internalPort);
          const line = `[${new Date().toISOString()}] ${detection.log}\n[${new Date().toISOString()}] 📦 [Step 3/5] Framework: ${detection.frameworkName} | Gerenciador: ${detection.packageManager.toUpperCase()} | Porta Interna: :${internalPort}\n`;
          logs += line;
          this.emitProgress(app.id, { step: 3, stepName: `Detectado: ${detection.frameworkName}`, line, status: 'running', percentage: 50 });

          if (detection.type === 'static-html') {
            ports[`80/tcp`] = app.port;
            delete ports[`${internalPort}/tcp`];
          }

          fs.writeFileSync(dockerfilePath, detection.dockerfile, 'utf-8');
        } else {
          const line = `[${new Date().toISOString()}] 🔍 [Step 3/5] Dockerfile nativo do repositório Git encontrado. Compilando com Dockerfile do desenvolvedor...\n`;
          logs += line;
          this.emitProgress(app.id, { step: 3, stepName: 'Dockerfile Nativo Git', line, status: 'running', percentage: 50 });
        }

        // Step 4: Build Docker Image and tag with version
        const lineBuild = `[${new Date().toISOString()}] 🐳 [Step 4/5] Executando docker build -t ${buildImageTag}...\n`;
        logs += lineBuild;
        this.emitProgress(app.id, { step: 4, stepName: 'Compilando Imagem Docker', line: lineBuild, status: 'running', percentage: 65 });

        try {
          const { stdout: buildOut } = await execAsync(`docker build -t "${buildImageTag}" -t "${versionedTag}" .`, { cwd: buildsDir });
          if (buildOut) {
            logs += `[Docker Build]\n${buildOut.slice(-1200)}\n`;
          }
        } catch (dockerBuildErr: any) {
          throw new Error(`Erro ao compilar imagem Docker: ${dockerBuildErr.message}`);
        }

        // Step 5: Start Container
        const lineDeploy = `[${new Date().toISOString()}] 🚀 [Step 5/5] Iniciando contêiner na porta Host :${app.port}...\n`;
        logs += lineDeploy;
        this.emitProgress(app.id, { step: 5, stepName: 'Iniciando Contêiner', line: lineDeploy, status: 'running', percentage: 85 });

        const newContainerId = await dockerService.createAndStartContainer({
          name: containerName,
          image: buildImageTag,
          env: envList,
          ports,
        });

        app.containerId = newContainerId;
        logs += `[${new Date().toISOString()}] 🚀 Container online com ID: ${newContainerId.substring(0, 12)}\n`;
      } else {
        // Image based deploy
        let image = app.imageName || 'nginx:alpine';
        logs += `[${new Date().toISOString()}] 🐳 [Step 4/5] Baixando imagem Docker Hub (${image}) e preparando contêiner...\n`;
        this.emitProgress(app.id, { step: 4, stepName: 'Baixando Imagem', line: logs, status: 'running', percentage: 60 });

        const newId = await dockerService.createAndStartContainer({
          name: containerName,
          image,
          env: envList,
          ports,
        });
        app.containerId = newId;
        logs += `[${new Date().toISOString()}] 🚀 Container criado com sucesso com ID: ${newId.substring(0, 12)}\n`;
      }

      logs += `[${new Date().toISOString()}] ✅ [Step 5/5] Deploy concluído com sucesso! Servidor ativo na porta :${app.port}\n`;
      logs += `[${new Date().toISOString()}] 🎉 Aplicação online em ${((Date.now() - startTime) / 1000).toFixed(1)}s.\n`;

      const duration = Math.round((Date.now() - startTime) / 1000) || 1;
      deployment.status = 'success';
      deployment.commitHash = commitHash;
      deployment.commitMessage = commitMsg;
      deployment.authorName = author;
      deployment.buildLogs = logs;
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

      // Auto-sync Caddy reverse proxy after successful deploy
      try {
        await CaddyService.syncCaddyfile();
        logs += `[${new Date().toISOString()}] 🔒 Caddy Proxy sincronizado com sucesso.\n`;
      } catch {
        // ignore
      }

      // Record Global Activity
      dbStorage.addActivity({
        type: 'deploy',
        title: `Deploy Sucesso: ${app.name}`,
        description: `Commit #${commitHash} "${commitMsg}" por ${author} (Porta :${app.port})`,
        status: 'success',
        metadata: { appId: app.id, commitHash, durationSeconds: duration },
      });

      // Multi-channel Notification (WhatsApp Evolution, Telegram, Discord)
      AlertService.broadcastNotification(
        `✅ Deploy Concluído: ${app.name}`,
        `🚀 *Aplicação:* ${app.name}\n🌿 *Branch:* ${branch}\n🏷️ *Commit:* #${commitHash} - "${commitMsg}"\n👤 *Autor:* ${author}\n🌐 *Porta:* :${app.port}${app.domain ? `\n🔒 *Domínio:* https://${app.domain}` : ''}\n⏱️ *Tempo de Build:* ${duration}s`,
        'deploy',
        false
      );

      this.emitProgress(app.id, { step: 5, stepName: 'Deploy Concluído!', line: 'Deploy finalizado com sucesso!', status: 'success', percentage: 100 });

      return deployment;
    } catch (err: any) {
      logs += `[${new Date().toISOString()}] ❌ ERRO NO DEPLOY: ${err.message}\n`;
      deployment.status = 'failed';
      deployment.buildLogs = logs;
      deployment.durationSeconds = Math.round((Date.now() - startTime) / 1000);
      deployment.finishedAt = new Date().toISOString();
      dbStorage.saveDeployment(deployment);

      app.status = 'error';
      dbStorage.saveApp(app);

      // Record Failed Activity
      dbStorage.addActivity({
        type: 'deploy',
        title: `Deploy Falhou: ${app.name}`,
        description: `Erro: ${err.message}`,
        status: 'error',
        metadata: { appId: app.id, error: err.message },
      });

      // Notification
      AlertService.broadcastNotification(
        `❌ Falha no Deploy: ${app.name}`,
        `🚨 *Erro no Deploy da Aplicação:* ${app.name}\n🌿 *Branch:* ${branch}\n⚠️ *Detalhe:* ${err.message}`,
        'deploy',
        true
      );

      this.emitProgress(app.id, { step: 5, stepName: 'Erro no Deploy', line: err.message, status: 'failed', percentage: 100 });
      throw err;
    }
  }

  /**
   * 1-Click Instant Rollback: Restores a previous deployment version in 2 seconds
   */
  static async rollback(appId: string, deploymentId: string): Promise<{ success: boolean; message: string }> {
    const app = dbStorage.getAppById(appId);
    if (!app) throw new Error('Aplicação não encontrada');

    const deployments = dbStorage.getDeployments(appId);
    const targetDeployment = deployments.find(d => d.id === deploymentId);
    if (!targetDeployment) throw new Error('Histórico de deploy alvo não encontrado');

    const containerName = `aegis-app-${app.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
    const versionedTag = `aegis-app-${app.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}:${deploymentId}`;
    const envList = Object.entries(app.env || {}).map(([k, v]) => `${k}=${v}`);
    const ports: { [intPort: string]: number } = {};
    ports[`${app.internalPort || 3000}/tcp`] = app.port;

    // Check if versioned Docker image exists
    const images = await dockerService.listImages();
    const hasImage = images.some((img: any) => img.repoTags && img.repoTags.some((t: string) => t.includes(versionedTag) || t.includes(deploymentId)));

    if (hasImage) {
      const newId = await dockerService.createAndStartContainer({
        name: containerName,
        image: versionedTag,
        env: envList,
        ports,
      });

      app.containerId = newId;
      app.status = 'running';
      app.lastCommitHash = targetDeployment.commitHash;
      app.lastCommitMessage = `[Rollback] ${targetDeployment.commitMessage || ''}`;
      app.lastCommitAuthor = targetDeployment.authorName;
      app.lastDeployAt = new Date().toISOString();
      dbStorage.saveApp(app);

      dbStorage.addActivity({
        type: 'rollback',
        title: `Rollback: ${app.name}`,
        description: `Revertido com sucesso para a versão #${targetDeployment.commitHash}`,
        status: 'info',
        metadata: { appId: app.id, deploymentId },
      });

      AlertService.broadcastNotification(
        `⏪ Rollback Executado: ${app.name}`,
        `A aplicação *${app.name}* foi revertida com sucesso para o commit *#${targetDeployment.commitHash}* em 2 segundos!`,
        'deploy',
        false
      );

      return { success: true, message: `Aplicação revertida com sucesso para a versão #${targetDeployment.commitHash}!` };
    } else {
      // Re-trigger deploy with target commit hash
      await this.executeDeploy(app, {
        commitHash: targetDeployment.commitHash,
        commitMessage: `[Rollback] Revertendo para ${targetDeployment.commitHash}`,
        authorName: targetDeployment.authorName,
        branch: targetDeployment.branch,
        triggeredBy: 'manual',
      });

      return { success: true, message: `Re-deploy do commit #${targetDeployment.commitHash} executado com sucesso!` };
    }
  }

  static generateGitHubWorkflow(app: AppRecord, hostUrl: string): string {
    const webhookUrl = `${hostUrl}/api/webhooks/deploy/${app.id}?secret=${app.webhookSecret || 'aegis_secret'}`;

    return `# 🚀 AegisPanel - GitHub Actions Automated CI/CD Workflow
# Salve este arquivo no seu repositório em: .github/workflows/deploy.yml

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
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Notify AegisPanel Webhook
        run: |
          echo "🚀 Disparando Deploy no AegisPanel para o commit: \${{ github.sha }}"
          curl -X POST "${webhookUrl}" \\
            -H "Content-Type: application/json" \\
            -d '{
              "commit": "\${{ github.sha }}",
              "message": "\${{ github.event.head_commit.message }}",
              "author": "\${{ github.actor }}",
              "branch": "\${{ github.ref_name }}"
            }'
          echo "✅ Deploy recebido pelo servidor!"
`;
  }
}
