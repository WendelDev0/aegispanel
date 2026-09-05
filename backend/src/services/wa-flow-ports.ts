import type { EvolutionCredentials } from '../utils/evolution.client.js';

export type EvolutionSender = {
  sendText: (creds: EvolutionCredentials, number: string, text: string) => Promise<unknown>;
  sendButtons: (
    creds: EvolutionCredentials,
    number: string,
    text: string,
    buttons: Array<{ id: string; label: string }>
  ) => Promise<unknown>;
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

export interface AiCompletionRequest {
  provider: 'openai' | 'openrouter';
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
}

export interface AiCompletionResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiProvider {
  complete: (req: AiCompletionRequest) => Promise<AiCompletionResponse>;
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

export interface FlowPorts {
  sender: EvolutionSender;
  sessions: FlowSessionStore;
  logs: FlowLogStore;
  ai?: AiProvider;
  http?: HttpGateway;
  sql?: SqlGateway;
}
