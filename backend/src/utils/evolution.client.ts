import http from 'http';
import https from 'https';
import { CONFIG } from '../config.js';
import { EncryptionService } from './crypto.js';

export interface EvolutionCredentials {
  apiUrl: string;
  apiKey: string;
  instance: string;
}

export interface EvolutionSendResult {
  ok: boolean;
  skipped?: 'local_mode' | 'missing';
  error?: string;
}

/** Mocks and LOCAL_MODE skips are not failures. A real `{ ok: false }` is. */
export function evolutionSendFailed(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const parsed = result as EvolutionSendResult;
  if (parsed.ok !== false) return null;
  if (parsed.skipped === 'local_mode') return null;
  if (parsed.skipped === 'missing') return 'Envio sem URL, chave, instância ou número.';
  return parsed.error || 'Falha ao enviar no WhatsApp.';
}

export function evolutionManagerUrl(apiUrl: string): string {
  try {
    const url = new URL(apiUrl);
    return `${url.origin}/manager`;
  } catch {
    return apiUrl.replace(/\/+$/, '') + '/manager';
  }
}

/**
 * Blocks a laptop copy restored from production from paging real numbers.
 */
export function evolutionOutboundBlocked(): boolean {
  if (!CONFIG.LOCAL_MODE || CONFIG.ALLOW_OUTBOUND_ALERTS) return false;
  console.warn(
    '🧪 Modo local: Evolution API NÃO chamada. ' +
      'Defina AEGIS_ALLOW_OUTBOUND_ALERTS=true para permitir envios reais daqui.'
  );
  return true;
}

export function revealEvolutionKey(value: string | undefined): string {
  if (!value) return '';
  return EncryptionService.tryDecrypt(value) ?? value;
}

function requestJson(
  apiUrl: string,
  apiKey: string,
  method: string,
  pathname: string,
  body?: unknown
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const formattedUrl = apiUrl.replace(/\/+$/, '');
    const url = new URL(`${formattedUrl}${pathname}`);
    const payload = body === undefined ? '' : JSON.stringify(body);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function digits(number: string): string {
  return number.replace(/\D/g, '');
}

export async function evolutionSendText(
  creds: EvolutionCredentials,
  number: string,
  text: string
): Promise<EvolutionSendResult> {
  if (evolutionOutboundBlocked()) return { ok: false, skipped: 'local_mode' };
  const apiKey = revealEvolutionKey(creds.apiKey);
  const instance = creds.instance?.trim();
  const phone = digits(number);
  if (!creds.apiUrl || !apiKey || !instance || !phone || !text) {
    return { ok: false, skipped: 'missing' };
  }

  try {
    const res = await requestJson(creds.apiUrl, apiKey, 'POST', `/message/sendText/${encodeURIComponent(instance)}`, {
      number: phone,
      text,
      options: { delay: 800, presence: 'composing' },
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: res.text.slice(0, 400) || `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function evolutionSendButtons(
  creds: EvolutionCredentials,
  number: string,
  text: string,
  buttons: Array<{ id: string; label: string }>
): Promise<EvolutionSendResult> {
  const limited = buttons.slice(0, 3).filter((b) => b.label?.trim());
  const numbered = [text, ...limited.map((b, i) => `${i + 1}. ${b.label}`)].join('\n');

  if (evolutionOutboundBlocked()) return { ok: false, skipped: 'local_mode' };
  const apiKey = revealEvolutionKey(creds.apiKey);
  const instance = creds.instance?.trim();
  const phone = digits(number);
  if (!creds.apiUrl || !apiKey || !instance || !phone) {
    return { ok: false, skipped: 'missing' };
  }

  try {
    const res = await requestJson(
      creds.apiUrl,
      apiKey,
      'POST',
      `/message/sendButtons/${encodeURIComponent(instance)}`,
      {
        number: phone,
        title: text.slice(0, 60) || 'Menu',
        description: text,
        buttons: limited.map((b) => ({
          type: 'reply',
          displayText: b.label.slice(0, 20),
          id: b.id,
        })),
      }
    );
    if (res.status >= 200 && res.status < 300) return { ok: true };
  } catch {
    /* WhatsApp dropped native buttons on many accounts; fall through. */
  }

  return evolutionSendText(creds, number, numbered);
}

export async function evolutionSetWebhook(
  creds: EvolutionCredentials,
  webhookUrl: string,
  headers?: Record<string, string>
): Promise<EvolutionSendResult> {
  if (evolutionOutboundBlocked()) return { ok: false, skipped: 'local_mode' };
  const apiKey = revealEvolutionKey(creds.apiKey);
  const instance = creds.instance?.trim();
  if (!creds.apiUrl || !apiKey || !instance || !webhookUrl) {
    return { ok: false, skipped: 'missing' };
  }

  try {
    const res = await requestJson(creds.apiUrl, apiKey, 'POST', `/webhook/set/${encodeURIComponent(instance)}`, {
      webhook: {
        enabled: true,
        url: webhookUrl,
        events: ['MESSAGES_UPSERT'],
        webhookByEvents: false,
        webhookBase64: false,
        // Dedicated header so auth still works if a proxy strips `?token=`.
        ...(headers && Object.keys(headers).length ? { headers } : {}),
      },
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: res.text.slice(0, 400) || `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function evolutionClearWebhook(creds: EvolutionCredentials): Promise<EvolutionSendResult> {
  if (evolutionOutboundBlocked()) return { ok: false, skipped: 'local_mode' };
  const apiKey = revealEvolutionKey(creds.apiKey);
  const instance = creds.instance?.trim();
  if (!creds.apiUrl || !apiKey || !instance) return { ok: false, skipped: 'missing' };

  try {
    const res = await requestJson(creds.apiUrl, apiKey, 'POST', `/webhook/set/${encodeURIComponent(instance)}`, {
      webhook: { enabled: false, url: '', events: [] },
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: res.text.slice(0, 400) || `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export interface InboundWaMessage {
  instance: string;
  phone: string;
  text: string;
  pushName: string;
  fromMe: boolean;
}

function firstMessageRecord(root: Record<string, any>): Record<string, any> {
  const data = root.data ?? root;
  if (Array.isArray(data)) return data[0] && typeof data[0] === 'object' ? data[0] : {};
  if (Array.isArray(data?.messages)) {
    return data.messages[0] && typeof data.messages[0] === 'object' ? data.messages[0] : {};
  }
  return data && typeof data === 'object' ? data : {};
}

function unwrapWaMessage(message: Record<string, any> | undefined): Record<string, any> {
  if (!message || typeof message !== 'object') return {};
  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message.documentWithCaptionMessage?.message ||
    message.editedMessage?.message ||
    message
  );
}

function textFromInteractive(message: Record<string, any>): string {
  const params = message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (typeof params === 'string' && params.trim()) {
    try {
      const parsed = JSON.parse(params);
      const picked = parsed.id || parsed.selectedId || parsed.title || parsed.displayText;
      if (picked) return String(picked);
    } catch {
      /* WhatsApp sometimes sends non-JSON here; ignore rather than echo the blob. */
    }
  }
  return String(message.interactiveResponseMessage?.body?.text || '');
}

function extractWaText(message: Record<string, any>): string {
  const m = unwrapWaMessage(message);
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.templateButtonReplyMessage?.selectedId ||
    m.listResponseMessage?.title ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    textFromInteractive(m) ||
    ''
  );
}

export type WaJidKind = 'group' | 'broadcast' | 'newsletter' | 'direct' | 'unknown';

/**
 * A published instance is usually the operator's own line, so it also
 * receives every group it belongs to. Those are not flow traffic and never
 * were — `phoneFromKey` has always dropped them. The cost was that the
 * inbound strip logged each one as "parse_failed", and eighty group pings
 * pushed the one real conversation out of the ring before anyone looked.
 * Naming the reason is what lets the store count noise and list signal.
 */
export function jidKind(remoteJid: string): WaJidKind {
  const jid = String(remoteJid || '');
  if (!jid) return 'unknown';
  if (jid.endsWith('@g.us')) return 'group';
  if (jid.endsWith('@newsletter')) return 'newsletter';
  if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) return 'broadcast';
  return 'direct';
}

function phoneFromKey(key: Record<string, any>): string {
  const remoteJid = String(key.remoteJid || '');
  if (jidKind(remoteJid) !== 'direct') return '';

  const candidates = [key.remoteJid, key.remoteJidAlt, key.participant, key.participantAlt];
  for (const jid of candidates) {
    const value = String(jid || '');
    if (value.endsWith('@s.whatsapp.net') || value.endsWith('@c.us')) {
      const phone = value.replace(/@.*$/, '').replace(/\D/g, '');
      if (phone) return phone;
    }
  }

  return remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
}

/** Why an inbound payload produced no flow turn. */
export type InboundSkipReason =
  | 'not_object'
  | 'from_me'
  | 'group'
  | 'broadcast'
  | 'newsletter'
  | 'no_phone'
  | 'no_text';

export type EvolutionInbound =
  | { kind: 'message'; message: InboundWaMessage }
  | { kind: 'skipped'; reason: InboundSkipReason; instance?: string; phone?: string };

export function classifyEvolutionInbound(body: unknown): EvolutionInbound {
  if (!body || typeof body !== 'object') return { kind: 'skipped', reason: 'not_object' };
  const root = body as Record<string, any>;
  const data = firstMessageRecord(root);
  const key = data.key || {};
  const instance = String(root.instance || data.instance || '').trim() || undefined;

  if (key.fromMe) return { kind: 'skipped', reason: 'from_me', instance };

  const kind = jidKind(String(key.remoteJid || ''));
  if (kind === 'group') return { kind: 'skipped', reason: 'group', instance };
  if (kind === 'newsletter') return { kind: 'skipped', reason: 'newsletter', instance };
  if (kind === 'broadcast') return { kind: 'skipped', reason: 'broadcast', instance };

  const phone = phoneFromKey(key);
  if (!phone) return { kind: 'skipped', reason: 'no_phone', instance };

  // A sticker or a caption-less image in a 1:1 chat reaches a real person's
  // conversation and still moves no flow. That one belongs on the strip.
  const trimmed = String(extractWaText(data.message || {})).trim();
  if (!trimmed) return { kind: 'skipped', reason: 'no_text', instance, phone };

  return {
    kind: 'message',
    message: {
      instance: instance || '',
      phone,
      text: trimmed.slice(0, 2000),
      pushName: String(data.pushName || key.pushName || ''),
      fromMe: false,
    },
  };
}

export function parseEvolutionUpsert(body: unknown): InboundWaMessage | null {
  const result = classifyEvolutionInbound(body);
  return result.kind === 'message' ? result.message : null;
}

export interface EvolutionInstanceInfo {
  name: string;
  connectionStatus: 'open' | 'close' | 'connecting' | 'unknown';
  profileName?: string;
  profilePicUrl?: string;
  number?: string;
  competitors?: string[];
}

function ownerNumberFromInstance(item: Record<string, any>): string | undefined {
  const raw =
    item.ownerJid ||
    item.owner ||
    item.wuid ||
    item.number ||
    item.instance?.ownerJid ||
    item.instance?.owner ||
    item.instance?.wuid ||
    item.instance?.number;
  if (!raw) return undefined;
  const digits = String(raw).replace(/@.*$/, '').replace(/\D/g, '');
  return digits || undefined;
}

function integrationEnabled(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.some((row) => row && (row.enabled === true || row.enable === true || row.status === 'enabled'));
  } catch {
    return false;
  }
}

const COMPETITOR_PATHS: Array<{ path: string; label: string }> = [
  { path: 'typebot/find', label: 'Typebot' },
  { path: 'openai/find', label: 'OpenAI' },
  { path: 'evolutionBot/find', label: 'Evolution Bot' },
  { path: 'dify/find', label: 'Dify' },
  { path: 'n8n/find', label: 'n8n' },
];

export async function evolutionInspectCompetitors(
  creds: EvolutionCredentials
): Promise<string[]> {
  if (evolutionOutboundBlocked()) return [];
  const apiKey = revealEvolutionKey(creds.apiKey);
  const instance = creds.instance?.trim();
  if (!creds.apiUrl || !apiKey || !instance) return [];

  const found: string[] = [];
  for (const item of COMPETITOR_PATHS) {
    try {
      const res = await requestJson(
        creds.apiUrl,
        apiKey,
        'GET',
        `/${item.path}/${encodeURIComponent(instance)}`
      );
      if (res.status >= 200 && res.status < 300 && integrationEnabled(res.text)) {
        found.push(item.label);
      }
    } catch {
      /* Evolution versions omit these routes; a 404 is not a competitor. */
    }
  }
  return found;
}

export async function evolutionFetchInstances(creds: {
  apiUrl: string;
  apiKey: string;
}): Promise<{ ok: boolean; instances: EvolutionInstanceInfo[]; error?: string }> {
  if (evolutionOutboundBlocked()) {
    return {
      ok: true,
      instances: [
        { name: 'local-mock', connectionStatus: 'open', profileName: 'Mock Local' },
      ],
    };
  }

  const apiKey = revealEvolutionKey(creds.apiKey);
  if (!creds.apiUrl || !apiKey) {
    return { ok: false, instances: [], error: 'URL ou chave da Evolution não configurada.' };
  }

  try {
    const res = await requestJson(creds.apiUrl, apiKey, 'GET', '/instance/fetchInstances');
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, instances: [], error: `Evolution HTTP ${res.status}: ${res.text.slice(0, 200)}` };
    }

    const parsed = JSON.parse(res.text);
    const rawList: any[] = Array.isArray(parsed) ? parsed : parsed?.instances || [];

    const instances: EvolutionInstanceInfo[] = rawList
      .map((item) => {
        const name = String(item.name || item.instanceName || item.instance?.instanceName || '').trim();
        const statusRaw = String(item.connectionStatus || item.status || item.instance?.status || '').toLowerCase();
        let connectionStatus: EvolutionInstanceInfo['connectionStatus'] = 'unknown';
        if (statusRaw.includes('open') || statusRaw.includes('connected')) connectionStatus = 'open';
        else if (statusRaw.includes('close') || statusRaw.includes('disconnected')) connectionStatus = 'close';
        else if (statusRaw.includes('connect')) connectionStatus = 'connecting';

        return {
          name,
          connectionStatus,
          profileName: item.profileName || item.instance?.profileName,
          profilePicUrl: item.profilePicUrl || item.instance?.profilePicUrl,
          number: ownerNumberFromInstance(item),
        };
      })
      .filter((i) => Boolean(i.name));

    return { ok: true, instances };
  } catch (err: any) {
    return { ok: false, instances: [], error: err.message || String(err) };
  }
}

export async function evolutionTestConnection(creds: {
  apiUrl: string;
  apiKey: string;
}): Promise<{ ok: boolean; count: number; error?: string }> {
  const result = await evolutionFetchInstances(creds);
  if (!result.ok) {
    return { ok: false, count: 0, error: result.error };
  }
  return { ok: true, count: result.instances.length };
}
