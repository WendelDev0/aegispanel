import { AppService } from './app.service.js';
import { DatabaseService } from './database.service.js';
import { AppRecord } from '../db/storage.js';

export interface AppTemplate {
  id: string;
  name: string;
  category: 'automation' | 'database' | 'cms' | 'monitoring' | 'tools';
  description: string;
  iconUrl: string;
  defaultPort: number;
  image: string;
  env: Record<string, string>;
  tags: string[];
}

export const TEMPLATES_CATALOG: AppTemplate[] = [
  {
    id: 'n8n',
    name: 'n8n Workflow Automation',
    category: 'automation',
    description: 'Automatize processos, integrações de IA, webhooks e fluxos entre qualquer API sem escrever código.',
    iconUrl: 'https://n8n.io/favicon.ico',
    defaultPort: 5678,
    image: 'n8nio/n8n:latest',
    env: {
      N8N_PORT: '5678',
      N8N_PROTOCOL: 'http',
      NODE_ENV: 'production',
      GENERIC_TIMEZONE: 'America/Sao_Paulo',
    },
    tags: ['Automação', 'IA', 'Webhooks', 'Zapier Alternative'],
  },
  {
    id: 'evolution-api',
    name: 'Evolution API (WhatsApp)',
    category: 'automation',
    description: 'API profissional e open-source para automação e envio de mensagens no WhatsApp via QR Code.',
    iconUrl: 'https://evolution-api.com/favicon.ico',
    defaultPort: 8080,
    image: 'atendai/evolution-api:latest',
    env: {
      SERVER_PORT: '8080',
      AUTHENTICATION_API_KEY: 'aegis_evolution_master_key_2026',
      DATABASE_ENABLED: 'false',
    },
    tags: ['WhatsApp', 'Chatbots', 'Automação', 'Atendimento'],
  },
  {
    id: 'typebot',
    name: 'Typebot Viewer & Builder',
    category: 'automation',
    description: 'Construtor visual de conversas e chatbots interativos de alta conversão para Web e WhatsApp.',
    iconUrl: 'https://typebot.io/favicon.ico',
    defaultPort: 3001,
    image: 'baptistearno/typebot-viewer:latest',
    env: {
      PORT: '3001',
      NEXTAUTH_URL: 'http://localhost:3001',
    },
    tags: ['Chatbot', 'Lead Capture', 'Marketing'],
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    category: 'monitoring',
    description: 'Monitor de integridade (uptime) e páginas de status públicas com alertas no Discord e Telegram.',
    iconUrl: 'https://uptime.kuma.pet/img/icon.svg',
    defaultPort: 3002,
    image: 'louislam/uptime-kuma:1',
    env: {
      PORT: '3002',
    },
    tags: ['Monitoramento', 'Status Page', 'Healthcheck'],
  },
  {
    id: 'wordpress',
    name: 'WordPress CMS',
    category: 'cms',
    description: 'O CMS mais popular do mundo para criação de sites, landing pages e e-commerces WooCommerce.',
    iconUrl: 'https://s.w.org/favicon.ico',
    defaultPort: 8000,
    image: 'wordpress:latest',
    env: {
      WORDPRESS_DB_HOST: 'localhost:3306',
      WORDPRESS_DB_USER: 'app_user',
      WORDPRESS_DB_PASSWORD: 'change_me_secure',
      WORDPRESS_DB_NAME: 'wordpress_db',
    },
    tags: ['CMS', 'E-commerce', 'Sites', 'WooCommerce'],
  },
  {
    id: 'minio',
    name: 'MinIO S3 Storage',
    category: 'tools',
    description: 'Armazenamento de objetos de alta performance 100% compatível com a API do Amazon S3.',
    iconUrl: 'https://min.io/resources/img/favicon/favicon.ico',
    defaultPort: 9000,
    image: 'minio/minio:latest',
    env: {
      MINIO_ROOT_USER: 'minioadmin',
      MINIO_ROOT_PASSWORD: 'miniopassword123',
    },
    tags: ['S3 Storage', 'Arquivos', 'AWS Alternative'],
  },
  {
    id: 'pocketbase',
    name: 'PocketBase',
    category: 'database',
    description: 'Backend em 1 arquivo executável com banco SQLite embutido, autenticação e realtime subscriptions.',
    iconUrl: 'https://pocketbase.io/images/logo.svg',
    defaultPort: 8090,
    image: 'ghcr.io/muchobien/pocketbase:latest',
    env: {},
    tags: ['Backend', 'Auth', 'SQLite', 'Supabase Alternative'],
  },
];

export class TemplateService {
  static getCatalog(): AppTemplate[] {
    return TEMPLATES_CATALOG;
  }

  static async installTemplate(templateId: string, customPort?: number, customName?: string): Promise<AppRecord> {
    const template = TEMPLATES_CATALOG.find(t => t.id === templateId);
    if (!template) throw new Error('Template não encontrado');

    const appName = customName || `${template.id}-app`;
    const port = customPort || template.defaultPort;

    return AppService.createApp({
      name: appName,
      sourceType: 'image',
      imageName: template.image,
      port,
      internalPort: template.defaultPort,
      env: template.env,
    });
  }
}
