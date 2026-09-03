import { AppService } from './app.service.js';
import { dbStorage, AppRecord } from '../db/storage.js';
import { EncryptionService } from '../utils/crypto.js';
import { DatabaseService } from './database.service.js';
import { dockerService } from './docker.service.js';
import {
  clampAppLimits,
  clampHealthcheck,
  toDockerHealthcheck,
  toDockerResources,
} from '../utils/resource-limits.js';

export interface AppTemplate {
  id: string;
  name: string;
  category: 'whatsapp' | 'automation' | 'database' | 'cms' | 'monitoring' | 'tools';
  description: string;
  iconUrl: string;
  defaultPort: number;
  image: string;
  version: string;
  latestVersion: string;
  releaseDate?: string;
  author: string;
  websiteUrl?: string;
  changelogUrl?: string;
  env: Record<string, string>;
  features: string[];
  tags: string[];
  docsUrl?: string;
  requiresDb?: boolean;
}

export const TEMPLATES_CATALOG: AppTemplate[] = [
  {
    id: 'supabase',
    name: 'Supabase Self-Hosted Stack',
    category: 'database',
    description: 'A mais poderosa alternativa open-source ao Firebase: PostgreSQL 17, GoTrue Auth, PostgREST API, Realtime WebSockets, Storage e painel web Supabase Studio.',
    iconUrl: 'https://supabase.com/favicon/favicon.ico',
    defaultPort: 8000,
    image: 'supabase/studio:2026.08.03-sha-022b374',
    version: 'v2026.08',
    latestVersion: 'v2026.08',
    releaseDate: '2026-08',
    author: 'Supabase Inc.',
    websiteUrl: 'https://supabase.com',
    changelogUrl: 'https://github.com/supabase/supabase/releases',
    env: {
      API_GW_HTTP_PORT: '8000',
      POSTGRES_PORT: '5432',
      STUDIO_DEFAULT_ORGANIZATION: 'AegisPanel',
      STUDIO_DEFAULT_PROJECT: 'aegis-project',
    },
    features: [
      'PostgreSQL 17 com pgvector e extensões',
      'GoTrue Auth com JWT e recuperação de senha',
      'PostgREST com API REST automática em milissegundos',
      'Supabase Studio completo para gerenciar tabelas e SQL',
      'Storage e Realtime WebSockets para dados ao vivo',
    ],
    tags: ['Supabase', 'PostgreSQL', 'Auth', 'BaaS'],
    docsUrl: 'https://supabase.com/docs',
  },
  {
    id: 'evolution-api-v2',
    name: 'Evolution API v2.2 (WhatsApp Master)',
    category: 'whatsapp',
    description: 'A mais poderosa API open-source de WhatsApp para envio de mensagens, áudios gravados, botões, mídias, webhooks e QR Code multi-instâncias com alta estabilidade.',
    iconUrl: 'https://evolution-api.com/favicon.ico',
    defaultPort: 8080,
    image: 'evoapicloud/evolution-api:latest',
    version: 'v2.3.7',
    latestVersion: 'v2.2.3',
    releaseDate: '2026-08',
    author: 'Evolution Community',
    websiteUrl: 'https://evolution-api.com',
    changelogUrl: 'https://github.com/EvolutionAPI/evolution-api/releases',
    env: {
      SERVER_PORT: '8080',
      AUTHENTICATION_API_KEY: '',
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: 'true',
      DATABASE_ENABLED: 'false',
      CACHE_REDIS_ENABLED: 'false',
      WEBHOOK_GLOBAL_ENABLED: 'false',
      LOG_LEVEL: 'ERROR,WARN,DEBUG,INFO,LOG,VERBOSE,DARK,WEBHOOKS',
    },
    features: [
      'Multi-instâncias simultâneas de WhatsApp',
      'Envio de texto, áudio gravado na hora (PTT), PDFs, imagens e botões',
      'Webhooks em tempo real para n8n, Typebot e Chatwoot',
      'Swagger / Documentação interativa embutida (/docs)',
    ],
    tags: ['WhatsApp', 'Evolution API', 'Chatbot', 'Automação', 'Atendimento'],
    docsUrl: 'https://doc.evolution-api.com',
  },
  {
    id: 'n8n',
    name: 'n8n Workflow Automation',
    category: 'automation',
    description: 'Plataforma visual de automação para conectar a Evolution API do WhatsApp com OpenAI, bancos de dados, planilhas e mais de 400 serviços.',
    iconUrl: 'https://n8n.io/favicon.ico',
    defaultPort: 5678,
    image: 'n8nio/n8n:1.82.0',
    version: 'v1.82.0',
    latestVersion: 'v1.82.0',
    releaseDate: '2026-08',
    author: 'n8n GmbH',
    websiteUrl: 'https://n8n.io',
    changelogUrl: 'https://github.com/n8n-io/n8n/releases',
    env: {
      N8N_PORT: '5678',
      N8N_PROTOCOL: 'http',
      NODE_ENV: 'production',
      GENERIC_TIMEZONE: 'America/Sao_Paulo',
      EXECUTIONS_DATA_PRUNE: 'true',
      EXECUTIONS_DATA_MAX_AGE: '168',
    },
    features: [
      'Mais de 400 nós de integração nativos',
      'Suporte completo a agentes de IA (LangChain / OpenAI)',
      'Disparador automático de Webhooks para WhatsApp',
    ],
    tags: ['Automação', 'IA', 'Webhooks', 'Zapier Alternative', 'Fluxos'],
    docsUrl: 'https://docs.n8n.io',
  },
  {
    id: 'chatwoot',
    name: 'Chatwoot (Atendimento Omnichannel)',
    category: 'whatsapp',
    description: 'Central completa de atendimento ao cliente multicanal (estilo Zendesk / Intercom) integrada com WhatsApp Evolution API.',
    iconUrl: 'https://www.chatwoot.com/favicon.ico',
    defaultPort: 3005,
    image: 'chatwoot/chatwoot:v3.12.0',
    version: 'v3.12.0',
    latestVersion: 'v3.12.0',
    releaseDate: '2026-07',
    author: 'Chatwoot Inc.',
    websiteUrl: 'https://chatwoot.com',
    changelogUrl: 'https://github.com/chatwoot/chatwoot/releases',
    env: {
      PORT: '3005',
      NODE_ENV: 'production',
      FRONTEND_URL: 'http://localhost:3005',
      ENABLE_ACCOUNT_SIGNUP: 'true',
    },
    features: [
      'Inbox unificado para vários atendentes e múltiplos números',
      'Distribuição automática de conversas para a equipe',
      'Respostas rápidas, notas privadas e tags de clientes',
    ],
    tags: ['Atendimento', 'WhatsApp', 'Helpdesk', 'Chatwoot'],
    docsUrl: 'https://www.chatwoot.com/docs',
  },
  {
    id: 'typebot',
    name: 'Typebot (Viewer & Builder)',
    category: 'whatsapp',
    description: 'Construtor visual de conversas e chatbots de alta conversão integrado diretamente à Evolution API para responder clientes no WhatsApp.',
    iconUrl: 'https://typebot.io/favicon.ico',
    defaultPort: 3001,
    image: 'baptistearno/typebot-viewer:v3.1.4',
    version: 'v3.1.4',
    latestVersion: 'v3.1.4',
    releaseDate: '2026-08',
    author: 'Baptiste Arnaud',
    websiteUrl: 'https://typebot.io',
    changelogUrl: 'https://github.com/baptisteArno/typebot.io/releases',
    env: {
      PORT: '3001',
      NEXTAUTH_URL: 'http://localhost:3001',
    },
    features: [
      'Fluxos conversacionais visuais com lógica condicional',
      'Integração direta com WhatsApp Evolution API',
      'Captura e salvamento de leads em tempo real',
    ],
    tags: ['Chatbot', 'WhatsApp', 'Leads', 'Typebot'],
    docsUrl: 'https://docs.typebot.io',
  },
  {
    id: 'flowise-ai',
    name: 'Flowise AI (LLM / LangChain)',
    category: 'automation',
    description: 'Construa aplicações de inteligência artificial personalizadas e agentes de suporte com ChatGPT conectados ao WhatsApp.',
    iconUrl: 'https://flowiseai.com/favicon.ico',
    defaultPort: 3004,
    image: 'flowiseai/flowise:2.1.4',
    version: 'v2.1.4',
    latestVersion: 'v2.1.4',
    releaseDate: '2026-08',
    author: 'FlowiseAI',
    websiteUrl: 'https://flowiseai.com',
    changelogUrl: 'https://github.com/FlowiseAI/Flowise/releases',
    env: {
      PORT: '3004',
      FLOWISE_USERNAME: 'admin',
      FLOWISE_PASSWORD: '',
    },
    features: [
      'Chatbots com RAG (treinados com PDFs e documentos da sua empresa)',
      'Conexão com OpenAI, Anthropic e Llama 3',
      'API pronta para ser chamada pela Evolution API no WhatsApp',
    ],
    tags: ['IA', 'ChatGPT', 'LangChain', 'RAG', 'WhatsApp'],
    docsUrl: 'https://docs.flowiseai.com',
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    category: 'monitoring',
    description: 'Monitore se seus servidores, sites, APIs e a Evolution API do WhatsApp estão online com alertas instantâneos no Discord e Telegram.',
    iconUrl: 'https://uptime.kuma.pet/img/icon.svg',
    defaultPort: 3002,
    image: 'louislam/uptime-kuma:1.23.16',
    version: 'v1.23.16',
    latestVersion: 'v1.23.16',
    releaseDate: '2026-07',
    author: 'Louis Lam',
    websiteUrl: 'https://uptime.kuma.pet',
    changelogUrl: 'https://github.com/louislam/uptime-kuma/releases',
    env: {
      PORT: '3002',
    },
    features: [
      'Monitoramento HTTP, TCP, Ping, DNS e certificados SSL',
      'Página de status pública para seus clientes',
      'Notificações no Telegram, Discord e WhatsApp',
    ],
    tags: ['Monitoramento', 'Status Page', 'Uptime', 'Alertas'],
    docsUrl: 'https://uptime.kuma.pet',
  },
  {
    id: 'wordpress',
    name: 'WordPress 6.6 CMS',
    category: 'cms',
    description: 'Crie sites institucionais, blogs e lojas virtuais completas com WooCommerce com alta performance.',
    iconUrl: 'https://s.w.org/favicon.ico',
    defaultPort: 8000,
    image: 'wordpress:6.6-apache',
    version: 'v6.6',
    latestVersion: 'v6.6',
    releaseDate: '2026-07',
    author: 'WordPress Foundation',
    websiteUrl: 'https://wordpress.org',
    changelogUrl: 'https://wordpress.org/news/category/releases/',
    env: {
      WORDPRESS_DB_HOST: 'localhost:3306',
      WORDPRESS_DB_USER: 'app_user',
      WORDPRESS_DB_PASSWORD: '',
      WORDPRESS_DB_NAME: 'wordpress_db',
    },
    features: [
      'Painel de controle visual intuitivo',
      'Milhares de plugins e temas profissionais',
      'Loja virtual completa com WooCommerce',
    ],
    tags: ['CMS', 'E-commerce', 'Sites', 'WooCommerce'],
    docsUrl: 'https://wordpress.org/documentation',
  },
  {
    id: 'minio',
    name: 'MinIO S3 Object Storage',
    category: 'tools',
    description: 'Servidor de armazenamento de arquivos em nuvem de alta velocidade 100% compatível com a API do Amazon S3.',
    iconUrl: 'https://min.io/resources/img/favicon/favicon.ico',
    defaultPort: 9000,
    image: 'minio/minio:RELEASE.2026-08-15T00-00-00Z',
    version: 'RELEASE.2026-08',
    latestVersion: 'RELEASE.2026-08',
    releaseDate: '2026-08',
    author: 'MinIO Inc.',
    websiteUrl: 'https://min.io',
    changelogUrl: 'https://github.com/minio/minio/releases',
    env: {
      MINIO_ROOT_USER: '',
      MINIO_ROOT_PASSWORD: '',
    },
    features: [
      'Armazene imagens, mídias e gravações de áudio do WhatsApp',
      'Compatível com clientes AWS S3 (Node, Python, PHP)',
      'Painel visual web integrado para gerenciar buckets',
    ],
    tags: ['S3 Storage', 'Arquivos', 'AWS Alternative', 'Mídia'],
    docsUrl: 'https://min.io/docs',
  },
  {
    id: 'pocketbase',
    name: 'PocketBase',
    category: 'database',
    description: 'Backend em 1 arquivo executável com banco SQLite embutido, autenticação e realtime subscriptions.',
    iconUrl: 'https://pocketbase.io/images/logo.svg',
    defaultPort: 8090,
    image: 'ghcr.io/muchobien/pocketbase:0.23.0',
    version: 'v0.23.0',
    latestVersion: 'v0.23.0',
    releaseDate: '2026-08',
    author: 'Gani',
    websiteUrl: 'https://pocketbase.io',
    changelogUrl: 'https://github.com/pocketbase/pocketbase/releases',
    env: {},
    features: [
      'Banco de dados SQLite embutido de alta velocidade',
      'API REST e realtime subscriptions automáticas',
      'Painel administrativo elegante integrado',
    ],
    tags: ['Backend', 'Auth', 'SQLite', 'Supabase Alternative'],
    docsUrl: 'https://pocketbase.io/docs',
  },
  {
    id: 'ollama',
    name: 'Ollama (LLMs Locais / IA Offline)',
    category: 'automation',
    description: 'Execute modelos de Inteligência Artificial como Llama 3, DeepSeek e Mistral diretamente no servidor VPS sem custo por token.',
    iconUrl: 'https://ollama.com/public/ollama.png',
    defaultPort: 11434,
    image: 'ollama/ollama:latest',
    version: 'v0.3.10',
    latestVersion: 'v0.3.10',
    releaseDate: '2026-08',
    author: 'Ollama Team',
    websiteUrl: 'https://ollama.com',
    changelogUrl: 'https://github.com/ollama/ollama/releases',
    env: {
      OLLAMA_ORIGINS: '*',
    },
    features: [
      'Roda Llama 3, DeepSeek, Gemma e Mistral localmente',
      'API compatível com OpenAI para integração com n8n e Evolution API',
      'Zero custo de API externa e privacidade total dos dados',
    ],
    tags: ['IA', 'Ollama', 'Llama 3', 'DeepSeek', 'Local LLM'],
    docsUrl: 'https://github.com/ollama/ollama',
  },
  {
    id: 'portainer',
    name: 'Portainer CE (Gerenciador Docker)',
    category: 'tools',
    description: 'Interface web gráfica intuitiva e profissional para visualizar e gerenciar todos os contêineres, redes e volumes Docker.',
    iconUrl: 'https://www.portainer.io/hubfs/Portainer_2021/Images/favicon.png',
    defaultPort: 9443,
    image: 'portainer/portainer-ce:2.21.0',
    version: 'v2.21.0',
    latestVersion: 'v2.21.0',
    releaseDate: '2026-08',
    author: 'Portainer.io',
    websiteUrl: 'https://portainer.io',
    changelogUrl: 'https://github.com/portainer/portainer/releases',
    env: {},
    features: [
      'Dashboard visual completo de contêineres e imagens',
      'Monitoramento de CPU, memória e logs de containers',
      'Controle de acesso seguro e webhooks de deploy',
    ],
    tags: ['Docker', 'Containers', 'Painel', 'DevOps'],
    docsUrl: 'https://docs.portainer.io',
  },
];

export interface ProviderUpdateInfo {
  templateId: string;
  templateName: string;
  currentCatalogVersion: string;
  latestVersion: string;
  releaseDate?: string;
  changelogUrl?: string;
  installedAppId?: string;
  installedAppName?: string;
  installedImage?: string;
  isInstalled: boolean;
  hasUpdate: boolean;
}

export class TemplateService {
  static getCatalog(): AppTemplate[] {
    return TEMPLATES_CATALOG;
  }

  static getUpdatesSummary(): {
    checkedAt: string;
    totalProviders: number;
    totalInstalled: number;
    updatesAvailable: number;
    providers: ProviderUpdateInfo[];
  } {
    const apps = dbStorage.getApps();
    const providers: ProviderUpdateInfo[] = [];

    for (const template of TEMPLATES_CATALOG) {
      // Find if an app was installed from this template
      const templateBaseImage = template.image.split(':')[0];
      const installedApp = apps.find(
        (a) =>
          (a.imageName && a.imageName.includes(templateBaseImage)) ||
          a.name.toLowerCase().includes(template.id.toLowerCase())
      );

      let hasUpdate = false;
      let installedImage: string | undefined;

      if (installedApp) {
        installedImage = installedApp.imageName;
        // If the installed image tag is different from template latest image tag
        if (installedApp.imageName !== template.image) {
          hasUpdate = true;
        }
      }

      providers.push({
        templateId: template.id,
        templateName: template.name,
        currentCatalogVersion: template.version,
        latestVersion: template.latestVersion,
        releaseDate: template.releaseDate,
        changelogUrl: template.changelogUrl,
        installedAppId: installedApp?.id,
        installedAppName: installedApp?.name,
        installedImage,
        isInstalled: Boolean(installedApp),
        hasUpdate,
      });
    }

    const totalInstalled = providers.filter((p) => p.isInstalled).length;
    const updatesAvailable = providers.filter((p) => p.isInstalled && p.hasUpdate).length;

    return {
      checkedAt: new Date().toISOString(),
      totalProviders: TEMPLATES_CATALOG.length,
      totalInstalled,
      updatesAvailable,
      providers,
    };
  }

  static async upgradeInstalledApp(appId: string): Promise<AppRecord> {
    const app = dbStorage.getAppById(appId);
    if (!app) throw new Error('Aplicação não encontrada');

    // Find corresponding template
    const template = TEMPLATES_CATALOG.find(
      (t) =>
        (app.imageName && app.imageName.includes(t.image.split(':')[0])) ||
        app.name.toLowerCase().includes(t.id.toLowerCase())
    );

    if (!template) {
      throw new Error('Esta aplicação não está vinculada a nenhum template do catálogo');
    }

    // Pull new image and recreate container
    const targetImage = template.image;
    app.imageName = targetImage;
    app.updatedAt = new Date().toISOString();
    app.lastCommitMessage = `Upgrade para versão ${template.latestVersion}`;

    if (app.containerId) {
      try {
        await dockerService.removeContainer(app.containerId, true);
      } catch (err: any) {
        console.warn('Erro ao remover container anterior durante upgrade:', err.message);
      }
    }

    const envList = Object.entries(app.env || {}).map(([k, v]) => `${k}=${v}`);
    const internalPort = app.internalPort || template.defaultPort;
    const ports: { [intPort: string]: number } = { [`${internalPort}/tcp`]: app.port };
    const limits = clampAppLimits(app.limits, dbStorage.getSettings().defaultAppLimits);
    const healthcheck = clampHealthcheck(app.healthcheck);

    try {
      const newContainerId = await dockerService.createAndStartContainer({
        name: `aegis-app-${app.name}`,
        image: targetImage,
        env: envList,
        ports,
        resources: toDockerResources(limits),
        healthcheck: toDockerHealthcheck(healthcheck, internalPort),
        waitHealthy: true,
        labels: {
          'aegis.type': 'app',
          'aegis.app.name': app.name,
          'aegis.app.domain': app.domain || '',
        },
      });
      app.containerId = newContainerId;
      app.status = 'running';
    } catch (err: any) {
      console.error('Falha ao recriar contêiner com nova imagem:', err);
      app.status = 'stopped';
    }

    return dbStorage.saveApp(app);
  }

  static async installTemplate(
    templateId: string,
    options: {
      customPort?: number;
      customName?: string;
      apiKey?: string;
      postgresDbId?: string;
      redisDbId?: string;
      customEnv?: Record<string, string>;
    } = {}
  ): Promise<AppRecord> {
    const template = TEMPLATES_CATALOG.find(t => t.id === templateId);
    if (!template) throw new Error('Template não encontrado no catálogo');

    const appName = options.customName || `${template.id}-app`;
    const port = options.customPort || template.defaultPort;

    const env = { ...template.env, ...(options.customEnv || {}) };

    // Evolution API Specific configuration
    if (template.id === 'evolution-api-v2') {
      const generatedApiKey = options.apiKey || `evo_${EncryptionService.generateStrongPassword(24, false)}`;
      env['AUTHENTICATION_API_KEY'] = generatedApiKey;

      // Link to selected PostgreSQL database if provided
      if (options.postgresDbId) {
        const db = dbStorage.getDatabaseById(options.postgresDbId);
        if (db) {
          const credentials = DatabaseService.getCredentials(db.id);
          env['DATABASE_ENABLED'] = 'true';
          env['DATABASE_PROVIDER'] = 'postgresql';
          env['DATABASE_CONNECTION_URI'] = credentials.internalConnectionString;
        }
      }

      // Link to Redis if provided
      if (options.redisDbId) {
        const redisDb = dbStorage.getDatabaseById(options.redisDbId);
        if (redisDb) {
          const credentials = DatabaseService.getCredentials(redisDb.id);
          env['CACHE_REDIS_ENABLED'] = 'true';
          env['CACHE_REDIS_URI'] = credentials.internalConnectionString;
        }
      }
    }

    if (template.id === 'flowise-ai' && !options.customEnv?.FLOWISE_PASSWORD) {
      env.FLOWISE_PASSWORD = EncryptionService.generateStrongPassword(24, true);
    }
    if (template.id === 'wordpress' && !options.customEnv?.WORDPRESS_DB_PASSWORD) {
      env.WORDPRESS_DB_PASSWORD = EncryptionService.generateStrongPassword(24, true);
    }
    if (template.id === 'minio') {
      if (!options.customEnv?.MINIO_ROOT_USER) env.MINIO_ROOT_USER = EncryptionService.generateSecureUsername('minio');
      if (!options.customEnv?.MINIO_ROOT_PASSWORD) env.MINIO_ROOT_PASSWORD = EncryptionService.generateStrongPassword(24, true);
    }

    return AppService.createApp({
      name: appName,
      sourceType: 'image',
      imageName: template.image,
      port,
      internalPort: template.defaultPort,
      env,
    });
  }
}
