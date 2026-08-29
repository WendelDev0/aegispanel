import { AppService } from './app.service.js';
import { dbStorage, AppRecord } from '../db/storage.js';
import { EncryptionService } from '../utils/crypto.js';

export interface AppTemplate {
  id: string;
  name: string;
  category: 'whatsapp' | 'automation' | 'database' | 'cms' | 'monitoring' | 'tools';
  description: string;
  iconUrl: string;
  defaultPort: number;
  image: string;
  version: string;
  author: string;
  env: Record<string, string>;
  features: string[];
  tags: string[];
  docsUrl?: string;
  requiresDb?: boolean;
}

export const TEMPLATES_CATALOG: AppTemplate[] = [
  {
    id: 'evolution-api-v2',
    name: 'Evolution API v2.1 (WhatsApp Master)',
    category: 'whatsapp',
    description: 'A mais poderosa API open-source de WhatsApp para envio de mensagens, áudios, botões, mídias, webhooks e QR Code multi-instâncias.',
    iconUrl: 'https://evolution-api.com/favicon.ico',
    defaultPort: 8080,
    image: 'atendai/evolution-api:v2.1.2',
    version: 'v2.1.2',
    author: 'Evolution Community',
    env: {
      SERVER_PORT: '8080',
      AUTHENTICATION_API_KEY: 'evo_key_placeholder',
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
    id: 'chatwoot',
    name: 'Chatwoot (Atendimento Omnichannel)',
    category: 'whatsapp',
    description: 'Central completa de atendimento ao cliente multicanal (estilo Zendesk / Intercom) integrada com WhatsApp Evolution API.',
    iconUrl: 'https://www.chatwoot.com/favicon.ico',
    defaultPort: 3005,
    image: 'chatwoot/chatwoot:latest',
    version: 'v3.8.0',
    author: 'Chatwoot Inc.',
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
    id: 'n8n',
    name: 'n8n Workflow Automation',
    category: 'automation',
    description: 'Plataforma visual de automação para conectar a Evolution API do WhatsApp com OpenAI, bancos de dados, planilhas e mais de 400 serviços.',
    iconUrl: 'https://n8n.io/favicon.ico',
    defaultPort: 5678,
    image: 'n8nio/n8n:latest',
    version: 'v1.45.0',
    author: 'n8n GmbH',
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
    id: 'typebot',
    name: 'Typebot (Viewer & Builder)',
    category: 'whatsapp',
    description: 'Construtor visual de conversas e chatbots de alta conversão integrado diretamente à Evolution API para responder clientes no WhatsApp.',
    iconUrl: 'https://typebot.io/favicon.ico',
    defaultPort: 3001,
    image: 'baptistearno/typebot-viewer:latest',
    version: 'v2.24.0',
    author: 'Baptiste Arnaud',
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
    image: 'flowiseai/flowise:latest',
    version: 'v1.8.0',
    author: 'FlowiseAI',
    env: {
      PORT: '3004',
      FLOWISE_USERNAME: 'admin',
      FLOWISE_PASSWORD: 'admin_flowise_password_123',
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
    image: 'louislam/uptime-kuma:1',
    version: 'v1.23.0',
    author: 'Louis Lam',
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
    name: 'WordPress 6.5 CMS',
    category: 'cms',
    description: 'Crie sites institucionais, blogs e lojas virtuais completas com WooCommerce com alta performance.',
    iconUrl: 'https://s.w.org/favicon.ico',
    defaultPort: 8000,
    image: 'wordpress:latest',
    version: 'v6.5',
    author: 'WordPress Foundation',
    env: {
      WORDPRESS_DB_HOST: 'localhost:3306',
      WORDPRESS_DB_USER: 'app_user',
      WORDPRESS_DB_PASSWORD: 'change_me_secure',
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
    image: 'minio/minio:latest',
    version: 'v2024.05',
    author: 'MinIO Inc.',
    env: {
      MINIO_ROOT_USER: 'minioadmin',
      MINIO_ROOT_PASSWORD: 'miniopassword123',
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
    image: 'ghcr.io/muchobien/pocketbase:latest',
    version: 'v0.22.0',
    author: 'Gani',
    env: {},
    features: [
      'Banco de dados SQLite embutido de alta velocidade',
      'API REST e realtime subscriptions automáticas',
      'Painel administrativo elegante integrado',
    ],
    tags: ['Backend', 'Auth', 'SQLite', 'Supabase Alternative'],
    docsUrl: 'https://pocketbase.io/docs',
  },
];

export class TemplateService {
  static getCatalog(): AppTemplate[] {
    return TEMPLATES_CATALOG;
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
          const rawPass = EncryptionService.decrypt(db.dbPassword);
          env['DATABASE_ENABLED'] = 'true';
          env['DATABASE_PROVIDER'] = 'postgresql';
          env['DATABASE_CONNECTION_URI'] = `postgresql://${db.dbUser}:${rawPass}@localhost:${db.port}/${db.dbName}`;
        }
      }

      // Link to Redis if provided
      if (options.redisDbId) {
        const redisDb = dbStorage.getDatabaseById(options.redisDbId);
        if (redisDb) {
          const redisPass = EncryptionService.decrypt(redisDb.dbPassword);
          env['CACHE_REDIS_ENABLED'] = 'true';
          env['CACHE_REDIS_URI'] = `redis://:${redisPass}@localhost:${redisDb.port}`;
        }
      }
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
