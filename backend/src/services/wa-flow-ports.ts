import type { EvolutionCredentials, InboundMedia } from '../utils/evolution.client.js';

export type { InboundMedia };

export interface SendMediaOptions {
  kind: 'image' | 'video' | 'document' | 'audio';
  /** A public URL or a base64 payload; Evolution accepts either in `media`. */
  media: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
}

export type EvolutionSender = {
  sendText: (creds: EvolutionCredentials, number: string, text: string) => Promise<unknown>;
  sendButtons: (
    creds: EvolutionCredentials,
    number: string,
    text: string,
    buttons: Array<{ id: string; label: string }>
  ) => Promise<unknown>;
  /**
   * Optional: a sender written before media existed (and every test mock from
   * that era) still satisfies this port. `deliverMedia` reports the gap to the
   * operator rather than letting the block fail silently.
   */
  sendMedia?: (creds: EvolutionCredentials, number: string, options: SendMediaOptions) => Promise<unknown>;
  sendPresence?: (creds: EvolutionCredentials, number: string, presence: 'composing' | 'available') => Promise<unknown>;
};

export interface WaSession {
  flowId: string;
  nodeId: string;
  waiting: boolean;
  lastText: string;
  vars: Record<string, string>;
  updatedAt: string;
  expiresAt?: string;
  attempts?: number;
}

export interface FlowSessionStore {
  read: (instance: string, phone: string) => Promise<WaSession | null> | WaSession | null;
  write: (instance: string, phone: string, session: WaSession, ttlMinutes?: number) => Promise<void> | void;
  clear: (instance: string, phone: string) => Promise<void> | void;
  clearFlow: (flowId: string) => Promise<void> | void;
}

export interface WaTurnLog {
  id?: string | number;
  at: string;
  instance: string;
  flowId: string;
  phoneHash: string;
  phoneTail: string;
  direction: 'in' | 'out';
  nodeId?: string;
  nodeType?: string;
  textExcerpt: string;
  aiModel?: string;
  aiTokensIn?: number;
  aiTokensOut?: number;
  error?: string;
}

export interface FlowLogStore {
  appendTurn: (turn: WaTurnLog) => Promise<void> | void;
  listTurns: (
    flowId: string,
    options?: { limit?: number; cursor?: string }
  ) => Promise<{ turns: WaTurnLog[]; nextCursor?: string }> | { turns: WaTurnLog[]; nextCursor?: string };
}

/** A tool the model may call, resolved from an `http` or `sql` node in the flow. */
export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, string>;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Set on a tool result so the provider can pair it with its call. */
  toolCallId?: string;
  toolCalls?: AiToolCall[];
}

export interface AiCompletionRequest {
  provider: 'openai' | 'openrouter';
  model: string;
  messages: AiMessage[];
  maxTokens?: number;
  tools?: AiToolDefinition[];
}

export interface AiCompletionResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** Present when the model asked for a tool instead of answering. */
  toolCalls?: AiToolCall[];
}

export interface AiProvider {
  complete: (req: AiCompletionRequest) => Promise<AiCompletionResponse>;
  /** Speech to text, so a voice note can drive the same flow a typed one does. */
  transcribe?: (audio: { base64: string; mimetype?: string; model?: string }) => Promise<string>;
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  data: any;
  text: string;
}

export interface HttpGateway {
  request: (options: HttpRequestOptions) => Promise<HttpResponse>;
}

export interface SqlQueryOptions {
  text: string;
  params: any[];
  mode: 'read' | 'write';
  databaseId?: string;
  timeoutMs?: number;
}

export interface SqlGateway {
  query: (options: SqlQueryOptions) => Promise<any[]>;
}

/** Pulls the bytes of an inbound attachment out of Evolution, on demand. */
export interface MediaGateway {
  fetchBase64: (
    creds: EvolutionCredentials,
    message: { messageId?: string; raw?: unknown }
  ) => Promise<{ base64: string; mimetype?: string }>;
}

export interface FlowContactRecord {
  phoneHash: string;
  phoneTail: string;
  pushName: string;
  attrs: Record<string, string>;
  tags: string[];
  inboundCount: number;
  optedOut: boolean;
}

/**
 * The contact behind the conversation. A port rather than a direct store call
 * so the simulator can run a flow that writes attributes without leaving a
 * fake customer in the real roster.
 */
export interface FlowContactStore {
  load: (instance: string, phone: string, pushName?: string) => FlowContactRecord | null;
  saveAttrs: (instance: string, phoneHash: string, patch: Record<string, string>) => void;
  setTags: (instance: string, phoneHash: string, tags: string[]) => void;
  appendMessage: (
    instance: string,
    phoneHash: string,
    role: 'user' | 'assistant',
    content: string,
    flowId?: string
  ) => void;
  history: (instance: string, phoneHash: string, limit: number) => Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface FlowPorts {
  sender: EvolutionSender;
  sessions: FlowSessionStore;
  logs: FlowLogStore;
  contacts: FlowContactStore;
  ai?: AiProvider;
  http?: HttpGateway;
  sql?: SqlGateway;
  media?: MediaGateway;
}

/** Everything a handler may read or mutate while walking one turn. */
export interface FlowContext {
  instance: string;
  phone: string;
  phoneHash: string;
  phoneTail: string;
  text: string;
  vars: Record<string, string>;
  stepsCount: number;
  sendError?: string;
  /** Attachment on the inbound message, when there was one. */
  media?: InboundMedia;
  /** Raw webhook payload, kept so the media gateway can ask Evolution for bytes. */
  rawInbound?: unknown;
  contact?: FlowContactRecord;
  /** Attribute writes to flush to the contact at the end of the turn. */
  contactPatch?: Record<string, string>;
}
