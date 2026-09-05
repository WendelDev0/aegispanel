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
  webhookUrl: string
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

export function parseEvolutionUpsert(body: unknown): InboundWaMessage | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, any>;
  const data = root.data || root;
  const key = data.key || {};
  if (key.fromMe) return null;

  const remoteJid = String(key.remoteJid || '');
  if (!remoteJid || remoteJid.endsWith('@g.us')) return null;
  const phone = remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
  if (!phone) return null;

  const message = data.message || {};
  const text =
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.title ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    '';
  const trimmed = String(text).trim();
  if (!trimmed) return null;

  return {
    instance: String(root.instance || data.instance || ''),
    phone,
    text: trimmed.slice(0, 2000),
    pushName: String(data.pushName || key.pushName || ''),
    fromMe: false,
  };
}
