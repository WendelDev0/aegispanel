import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { dbStorage, DeploymentRecord, AppRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { CaddyService } from './caddy.service.js';
import { ProjectDetector } from './project-detector.service.js';
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

  /**
   * Executes a Real CI/CD Build and Deployment pipeline:
   * 1. Clones repository (with PAT support if private)
   * 2. Extracts real Git commit hash, message, author & timestamp
   * 3. Detects Dockerfile or auto-generates Node/Python Dockerfile
   * 4. Builds real Docker image
   * 5. Spawns and maps container on the requested host port
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

    let logs = deployment.buildLogs;
    const isDockerOnline = await dockerService.testConnection();

    if (!isDockerOnline) {
      logs += `[${new Date().toISOString()}] ❌ Erro: Docker Engine não está disponível no servidor.\n`;
      deployment.status = 'failed';
      deployment.buildLogs = logs;
      dbStorage.saveDeployment(deployment);
      throw new Error('Docker Engine offline no servidor.');
    }

    const containerName = `aegis-app-${app.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
    const buildImageTag = `aegis-app-${app.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}:latest`;
    const envList = Object.entries(app.env || {}).map(([k, v]) => `${k}=${v}`);
    const ports: { [intPort: string]: number } = {};
    ports[`${app.internalPort || 3000}/tcp`] = app.port;

    try {
      if (app.sourceType === 'git' && app.gitUrl) {
        const buildsDir = path.join(CONFIG.DATA_DIR, 'builds', app.id);
        if (!fs.existsSync(buildsDir)) {
          fs.mkdirSync(buildsDir, { recursive: true });
        }

        // Format authenticated Git URL if token is provided
        let cloneUrl = app.gitUrl.trim();
        if (app.githubToken && cloneUrl.startsWith('https://github.com/')) {
          const repoPath = cloneUrl.replace('https://github.com/', '');
          cloneUrl = `https://${app.githubToken}@github.com/${repoPath}`;
          logs += `[${new Date().toISOString()}] 🔑 [Step 1/5] Autenticando com GitHub Personal Access Token (PAT)...\n`;
        } else {
          logs += `[${new Date().toISOString()}] 📦 [Step 1/5] Conectando ao repositório: ${app.gitUrl}\n`;
        }

        // Clone or Pull
        const gitDir = path.join(buildsDir, '.git');
        if (fs.existsSync(gitDir)) {
          logs += `[${new Date().toISOString()}] 🌿 [Step 2/5] Atualizando código existente (git pull origin ${branch})...\n`;
          try {
            const { stdout: pullOut } = await execAsync(`git pull origin ${branch}`, { cwd: buildsDir });
            logs += pullOut ? `[Git] ${pullOut}\n` : '';
          } catch (gitErr: any) {
            logs += `[Git Warning] Pull falhou, re-clonando: ${gitErr.message}\n`;
            fs.rmSync(buildsDir, { recursive: true, force: true });
            await execAsync(`git clone -b ${branch} --single-branch "${cloneUrl}" "${buildsDir}"`);
          }
        } else {
          logs += `[${new Date().toISOString()}] 🌿 [Step 2/5] Clonando branch [${branch}]...\n`;
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
            logs += `[${new Date().toISOString()}] 🏷️ [Git Commit] ${commitHash} - "${commitMsg}" por ${author}\n`;
          }
        } catch {
          // ignore
        }

        // Check for Dockerfile or auto-detect project type and generate optimized Dockerfile
        const dockerfilePath = path.join(buildsDir, 'Dockerfile');
        const internalPort = app.internalPort || 3000;

        if (!fs.existsSync(dockerfilePath)) {
          const detection = ProjectDetector.detect(buildsDir, internalPort);
          logs += `[${new Date().toISOString()}] ${detection.log}\n`;
          logs += `[${new Date().toISOString()}] 📦 [Step 3/5] Tipo detectado: ${detection.type.toUpperCase()} | Runtime: ${detection.runtimeCmd}\n`;

          if (detection.type === 'static-html') {
            // Static HTML uses nginx on port 80 internally
            ports[`80/tcp`] = app.port;
            delete ports[`${internalPort}/tcp`];
          }

          fs.writeFileSync(dockerfilePath, detection.dockerfile, 'utf-8');
        } else {
          logs += `[${new Date().toISOString()}] 🔍 [Step 3/5] Dockerfile nativo do projeto encontrado. Iniciando compilação...\n`;
        }

        // Build Docker Image
        logs += `[${new Date().toISOString()}] 🐳 [Step 4/5] Executando docker build -t ${buildImageTag}...\n`;
        try {
          const { stdout: buildOut } = await execAsync(`docker build -t "${buildImageTag}" .`, { cwd: buildsDir });
          if (buildOut) logs += `[Docker Build]\n${buildOut.slice(-1000)}\n`;
        } catch (dockerBuildErr: any) {
          throw new Error(`Erro ao compilar imagem Docker: ${dockerBuildErr.message}`);
        }

        // Create/Restart Container with the newly built image
        const newContainerId = await dockerService.createAndStartContainer({
          name: containerName,
          image: buildImageTag,
          env: envList,
          ports,
        });

        app.containerId = newContainerId;
        logs += `[${new Date().toISOString()}] 🚀 Container criado e iniciado na porta Host :${app.port} (ID: ${newContainerId.substring(0, 12)})\n`;
      } else {
        // Image based deploy
        let image = app.imageName || 'nginx:alpine';
        logs += `[${new Date().toISOString()}] 🐳 [Step 4/5] Baixando imagem Docker Hub (${image}) e preparando contêiner...\n`;
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
      throw err;
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
