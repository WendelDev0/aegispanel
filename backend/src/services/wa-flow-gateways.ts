import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { EncryptionService } from '../utils/crypto.js';
import { assertSafeFlowHttpUrl } from '../utils/flow-http-guard.js';
import { containerNameForDatabase } from '../utils/naming.js';
import { evolutionFetchMediaBase64 } from '../utils/evolution.client.js';
import { WaContactStore } from '../utils/wa-contact.store.js';
import { phoneHash } from '../utils/phone.js';
import type {
  AiCompletionRequest,
  AiCompletionResponse,
  AiMessage,
  AiToolCall,
  AiToolDefinition,
  AiProvider,
  FlowContactStore,
  HttpGateway,
  HttpRequestOptions,
  HttpResponse,
  MediaGateway,
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

function aiCredentials(provider: 'openai' | 'openrouter', model?: string): string {
  const providers = dbStorage.getSettings().aiProviders;
  const stored = provider === 'openai' ? providers?.openaiKey : providers?.openrouterKey;
  if (!stored) {
    throw new Error(`Chave da API ${provider} não configurada em Configurações.`);
  }

  // An allowlist that is empty means "no restriction"; the operator only
  // fills it to stop a flow from reaching for an expensive model.
  const allowed = providers?.allowedModels || [];
  if (model && allowed.length && !allowed.includes(model)) {
    throw new Error(`Modelo "${model}" não está na lista de modelos permitidos.`);
  }

  return EncryptionService.tryDecrypt(stored) ?? stored;
}

/** Chat-completions function-calling shape, which OpenRouter mirrors. */
function toolsPayload(tools: AiToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          tool.parameters.map((p) => [p.name, { type: 'string', description: p.description || p.name }])
        ),
        required: tool.parameters.filter((p) => p.required !== false).map((p) => p.name),
      },
    },
  }));
}

function messagesPayload(messages: AiMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function parseToolCalls(raw: unknown): AiToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const calls: AiToolCall[] = [];
  for (const item of raw) {
    const name = String((item as any)?.function?.name || '').trim();
    if (!name) continue;
    let args: Record<string, string> = {};
    try {
      const parsed = JSON.parse(String((item as any)?.function?.arguments || '{}'));
      if (parsed && typeof parsed === 'object') {
        // Coerced to strings: arguments are interpolated into a URL or bound
        // as SQL parameters, and both want text.
        args = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? '')]));
      }
    } catch {
      /* a model that emits malformed arguments still gets its tool run empty */
    }
    calls.push({ id: String((item as any)?.id || name), name, arguments: args });
  }
  return calls.length ? calls : undefined;
}

export function createAiProvider(): AiProvider {
  return {
    async complete(req: AiCompletionRequest): Promise<AiCompletionResponse> {
      if (outboundBlocked()) {
        throw new Error('Modo local: chamada de IA bloqueada. Defina AEGIS_ALLOW_OUTBOUND_ALERTS=true para permitir.');
      }

      const apiKey = aiCredentials(req.provider, req.model);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);

      try {
        const res = await fetch(`${AI_BASE_URL[req.provider]}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: req.model,
            messages: messagesPayload(req.messages),
            max_tokens: Math.max(16, Math.min(2000, req.maxTokens || 512)),
            ...(req.tools?.length ? { tools: toolsPayload(req.tools), tool_choice: 'auto' } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const detail = (await res.text()).slice(0, 200);
          throw new Error(`Provedor de IA respondeu HTTP ${res.status}: ${detail}`);
        }

        const data: any = await res.json();
        const message = data?.choices?.[0]?.message;
        const text = String(message?.content || '').trim();
        const toolCalls = parseToolCalls(message?.tool_calls);

        // A tool round legitimately answers with no prose, so emptiness is
        // only a failure when the model also asked for nothing.
        if (!text && !toolCalls) throw new Error('O provedor de IA respondeu sem conteúdo.');

        return {
          text,
          toolCalls,
          tokensIn: Number(data?.usage?.prompt_tokens) || 0,
          tokensOut: Number(data?.usage?.completion_tokens) || 0,
        };
      } finally {
        clearTimeout(timer);
      }
    },

    /**
     * Voice notes are how most of this market writes.
     *
     * Without this an audio message reached `no_text` and the flow answered
     * nothing at all — the customer saw two ticks and silence. Transcribing
     * turns the voice note into the same string a typed message produces, so
     * every existing block downstream works unchanged.
     */
    async transcribe(audio): Promise<string> {
      if (outboundBlocked()) {
        throw new Error('Modo local: transcrição bloqueada. Defina AEGIS_ALLOW_OUTBOUND_ALERTS=true para permitir.');
      }

      // Whisper is an OpenAI endpoint; OpenRouter does not proxy it, so the
      // OpenAI key is required even for a flow whose agent runs elsewhere.
      const apiKey = aiCredentials('openai');
      const model = audio.model || 'whisper-1';
      const bytes = Buffer.from(audio.base64, 'base64');
      if (!bytes.length) throw new Error('O áudio recebido estava vazio.');

      const form = new FormData();
      form.append('file', new Blob([bytes], { type: audio.mimetype || 'audio/ogg' }), 'audio.ogg');
      form.append('model', model);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(`${AI_BASE_URL.openai}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: controller.signal,
        });
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 200);
          throw new Error(`A transcrição respondeu HTTP ${res.status}: ${detail}`);
        }
        const data: any = await res.json();
        const text = String(data?.text || '').trim();
        if (!text) throw new Error('A transcrição voltou vazia.');
        return text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createMediaGateway(): MediaGateway {
  return {
    fetchBase64: (creds, message) => evolutionFetchMediaBase64(creds, message),
  };
}

/** The live contact roster, behind the port the simulator replaces. */
export function createContactStore(): FlowContactStore {
  return {
    load(instance, phone, pushName) {
      const contact = WaContactStore.touch(instance, phone, { pushName });
      return {
        phoneHash: contact.phoneHash,
        phoneTail: contact.phoneTail,
        pushName: contact.pushName,
        attrs: contact.attrs,
        tags: contact.tags,
        inboundCount: contact.inboundCount,
        optedOut: contact.optedOut,
      };
    },
    saveAttrs: (instance, pHash, patch) => {
      WaContactStore.setAttrs(instance, pHash, patch);
    },
    setTags: (instance, pHash, tags) => {
      WaContactStore.setTags(instance, pHash, tags);
    },
    appendMessage: (instance, pHash, role, content, flowId) => {
      WaContactStore.appendMessage(instance, pHash, role, content, flowId);
    },
    history: (instance, pHash, limit) =>
      WaContactStore.history(instance, pHash, limit).map((h) => ({ role: h.role, content: h.content })),
  };
}

/** Test seam: the panel-event path has no inbound phone to hash. */
export function contactHashFor(phone: string): string {
  return phoneHash(phone);
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
  media: createMediaGateway(),
  contacts: createContactStore(),
};
