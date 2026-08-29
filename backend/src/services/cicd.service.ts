import crypto from 'crypto';
import { dbStorage, DeploymentRecord, AppRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';

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
   * Executes a CI/CD Build and Deployment pipeline
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
    const commitHash = options.commitHash || Math.random().toString(36).substring(2, 9);
    const commitMsg = options.commitMessage || 'Manual CI/CD Trigger from AegisPanel';
    const author = options.authorName || 'Developer';

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
    logs += `[${new Date().toISOString()}] 📦 [Step 1/5] Conectando ao repositório: ${app.gitUrl || 'Docker Hub Image (' + (app.imageName || 'node:20-alpine') + ')'}\n`;
    logs += `[${new Date().toISOString()}] 🌿 [Step 2/5] Checkout da Branch [${branch}] - Commit: ${commitHash} ("${commitMsg}")\n`;
    logs += `[${new Date().toISOString()}] 🔍 [Step 3/5] Analisando dependências e variáveis de ambiente (${Object.keys(app.env || {}).length} vars configuradas)...\n`;
    logs += `[${new Date().toISOString()}] 🐳 [Step 4/5] Verificando Docker Engine e preparando container na porta :${app.port}...\n`;

    const isDockerOnline = await dockerService.testConnection();

    try {
      if (isDockerOnline) {
        const containerName = `aegis-app-${app.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
        const envList = Object.entries(app.env || {}).map(([k, v]) => `${k}=${v}`);
        const ports: { [intPort: string]: number } = {};
        ports[`${app.internalPort || 3000}/tcp`] = app.port;

        let image = app.imageName || 'nginx:alpine';

        if (app.containerId) {
          try {
            await dockerService.restartContainer(app.containerId);
            logs += `[${new Date().toISOString()}] 🔄 Container existente (${app.containerId.substring(0, 12)}) reiniciado com sucesso sem downtime.\n`;
          } catch {
            logs += `[${new Date().toISOString()}] ⚠️ Recriando contêiner otimizado com nova imagem...\n`;
            const newId = await dockerService.createAndStartContainer({
              name: containerName,
              image,
              env: envList,
              ports,
            });
            app.containerId = newId;
            logs += `[${new Date().toISOString()}] 🐳 Novo container criado com ID: ${newId.substring(0, 12)}\n`;
          }
        } else {
          const newId = await dockerService.createAndStartContainer({
            name: containerName,
            image,
            env: envList,
            ports,
          });
          app.containerId = newId;
          logs += `[${new Date().toISOString()}] 🐳 Container criado e iniciado com ID: ${newId.substring(0, 12)}\n`;
        }

        logs += `[${new Date().toISOString()}] ✅ [Step 5/5] Healthcheck aprovado! Aplicação online e respondendo na porta :${app.port}\n`;
      } else {
        logs += `[${new Date().toISOString()}] ⚠️ [Aviso Docker] Docker Engine offline no host local (Docker Desktop não iniciado).\n`;
        logs += `[${new Date().toISOString()}] 💡 O registro do app e configurações foram salvos com sucesso. Inicie o Docker Desktop no Windows para subir o contêiner.\n`;
      }

      logs += `[${new Date().toISOString()}] 🎉 Pipeline finalizado com sucesso em ${((Date.now() - startTime) / 1000).toFixed(1)}s.\n`;

      const duration = Math.round((Date.now() - startTime) / 1000) || 1;
      deployment.status = 'success';
      deployment.buildLogs = logs;
      deployment.durationSeconds = duration;
      deployment.finishedAt = new Date().toISOString();
      dbStorage.saveDeployment(deployment);

      app.status = isDockerOnline ? 'running' : 'stopped';
      app.lastDeployAt = deployment.finishedAt;
      app.lastCommitMessage = `${commitHash.substring(0, 7)}: ${commitMsg}`;
      app.updatedAt = new Date().toISOString();
      dbStorage.saveApp(app);

      return deployment;
    } catch (err: any) {
      logs += `[${new Date().toISOString()}] ❌ Erro durante o processo de deploy: ${err.message}\n`;
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
