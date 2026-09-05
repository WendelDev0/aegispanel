import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { EncryptionService } from '../utils/crypto.js';
import { assertSafeFlowHttpUrl } from '../utils/flow-http-guard.js';
import { containerNameForDatabase } from '../utils/naming.js';
import type {
  AiCompletionRequest,
  AiCompletionResponse,
  AiProvider,
  HttpGateway,
  HttpRequestOptions,
  HttpResponse,
  SqlGateway,
  SqlQueryOptions,
} from './wa-flow-ports.js';

/**
 * The live ports for the agent, http and sql blocks.
 *
 * These three existed only as mocks inside the simulator. In production
 * `defaultPorts` carried sender, sessions and logs and nothing else, so
 * `ports.ai` was undefined and the engine took the node's error branch in
 * silence. An operator built a flow with an AI block, watched it answer in the
 * simulator, published it, and the bot never said a word — with no error
 * anywhere, because not being wired is not a failure the code could see.
 *
 * Every gateway here throws with a message the operator can act on. The engine
 * still follows the error edge, but the reason now reaches the turn log.
 */

const AI_BASE_URL: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

function outboundBlocked(): boolean {
  return CONFIG.LOCAL_MODE && !CONFIG.ALLOW_OUTBOUND_ALERTS;
}

export function createAiProvider(): AiProvider {
  return {
    async complete(req: AiCompletionRequest): Promise<AiCompletionResponse> {
      if (outboundBlocked()) {
        throw new Error('Modo local: chamada de IA bloqueada. Defina AEGIS_ALLOW_OUTBOUND_ALERTS=true para permitir.');
      }

      const providers = dbStorage.getSettings().aiProviders;
      const stored = req.provider === 'openai' ? providers?.openaiKey : providers?.openrouterKey;
      if (!stored) {
        throw new Error(`Chave da API ${req.provider} não configurada em Configurações.`);
      }

      // An allowlist that is empty means "no restriction"; the operator only
      // fills it to stop a flow from reaching for an expensive model.
      const allowed = providers?.allowedModels || [];
      if (allowed.length && !allowed.includes(req.model)) {
        throw new Error(`Modelo "${req.model}" não está na lista de modelos permitidos.`);
      }

      const apiKey = EncryptionService.tryDecrypt(stored) ?? stored;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);

      try {
        const res = await fetch(`${AI_BASE_URL[req.provider]}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: req.model,
            messages: req.messages,
            max_tokens: Math.max(16, Math.min(2000, req.maxTokens || 512)),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const detail = (await res.text()).slice(0, 200);
          throw new Error(`Provedor de IA respondeu HTTP ${res.status}: ${detail}`);
        }

        const data: any = await res.json();
        const text = String(data?.choices?.[0]?.message?.content || '').trim();
        if (!text) throw new Error('O provedor de IA respondeu sem conteúdo.');

        return {
          text,
          tokensIn: Number(data?.usage?.prompt_tokens) || 0,
          tokensOut: Number(data?.usage?.completion_tokens) || 0,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createHttpGateway(): HttpGateway {
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      const allowlist = dbStorage.getSettings().flowHttpAllowlist || [];
      const { url } = await assertSafeFlowHttpUrl(options.url, allowlist);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(15_000, options.timeoutMs || 8000)));

      try {
        const res = await fetch(url, {
          method: options.method,
          headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
          body: options.method === 'GET' ? undefined : options.body,
          signal: controller.signal,
          // A 302 to a private address would walk straight past the guard.
          redirect: 'manual',
        });

        const text = (await res.text()).slice(0, 20_000);
        let data: any = text;
        try {
          data = JSON.parse(text);
        } catch {
          /* a plain-text body is still a valid answer */
        }

        return { status: res.status, data, text };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Postgres only, and always with bind parameters.
 *
 * `sqlParams` map to conversation variables, which hold whatever a stranger
 * typed on WhatsApp. Building the statement as a string would put that text
 * straight into the operator's database, so the query travels as text and the
 * values travel separately — which is also why this needs a real driver
 * rather than `psql -c`, that has no way to bind.
 *
 * Writes are refused unless the block asks for them explicitly, so a typo in
 * `sqlMode` cannot turn a lookup into a DELETE.
 */
export function createSqlGateway(): SqlGateway {
  return {
    async query(options: SqlQueryOptions): Promise<any[]> {
      const id = options.databaseId;
      if (!id) throw new Error('Nenhum banco selecionado no bloco SQL.');

      const db = dbStorage.getDatabases().find((entry) => entry.id === id);
      if (!db) throw new Error('O banco escolhido no bloco SQL não existe mais.');
      if (db.type !== 'postgres') {
        throw new Error(`O bloco SQL só atende PostgreSQL. "${db.name}" é ${db.type}.`);
      }
      if (db.status !== 'running') {
        throw new Error(`O banco "${db.name}" não está em execução.`);
      }

      const statement = options.text.trim();
      const isWrite = /^\s*(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke)\b/i.test(statement);
      if (isWrite && options.mode !== 'write') {
        throw new Error('Este bloco SQL está em modo leitura; marque como escrita para alterar dados.');
      }

      const { Client } = await import('pg');
      const client = new Client({
        // Container name on the shared network: the published port is bound to
        // the host's loopback, which this container does not share.
        host: containerNameForDatabase(db.name),
        port: db.internalPort || 5432,
        user: db.dbUser,
        password: EncryptionService.tryDecrypt(db.dbPassword) ?? db.dbPassword,
        database: db.dbName,
        connectionTimeoutMillis: 5000,
        statement_timeout: Math.max(1000, Math.min(10_000, options.timeoutMs || 5000)),
      });

      try {
        await client.connect();
        const result = await client.query(statement, options.params);
        return Array.isArray(result.rows) ? result.rows.slice(0, 50) : [];
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}

/** Built once: each gateway reads settings per call, so nothing goes stale. */
export const liveFlowGateways = {
  ai: createAiProvider(),
  http: createHttpGateway(),
  sql: createSqlGateway(),
};
