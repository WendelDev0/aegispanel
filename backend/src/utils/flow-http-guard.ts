import dns from 'node:dns/promises';
import net from 'node:net';
import { CONFIG } from '../config.js';
import { isPrivateAddress } from './url-security.js';

/**
 * Where a flow's HTTP block is allowed to reach.
 *
 * The URL is written by the panel operator, but it carries `{{vars}}` filled
 * with text a stranger typed on WhatsApp. The process resolving it holds the
 * Docker socket, so a request that lands on the bridge is a request made as
 * root on the host: the panel's own API, any application container, the
 * databases, or the cloud metadata endpoint that hands out instance
 * credentials.
 *
 * So the default is the public internet only. Reaching a neighbour on the
 * Docker network is legitimate — a flow calling the operator's own API is the
 * obvious use — but it has to be named in settings.flowHttpAllowlist first.
 * That field already existed in the schema and was never read by anything.
 *
 * Three destinations are refused even when allowlisted, because no flow has a
 * reason to reach them and each one is an escalation:
 *   - link-local (169.254.0.0/16), which carries cloud instance credentials
 *   - loopback, which is this process
 *   - the panel's own container, which would let a conversation drive the API
 */
const ALWAYS_BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata', 'instance-data']);

export interface FlowHttpTarget {
  url: URL;
  /** Resolved address the request will actually reach. */
  address: string;
}

function isLinkLocal(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized.startsWith('169.254.') || normalized.startsWith('fe80:');
}

function isLoopback(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized.startsWith('127.') || normalized === '::1' || normalized === '0.0.0.0' || normalized === '::';
}

function normalizeAllowEntry(entry: string): string {
  return String(entry || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

/** Host is allowlisted when it matches an entry exactly, or a `.suffix` of it. */
export function hostIsAllowlisted(hostname: string, allowlist: string[] = []): boolean {
  const host = hostname.trim().toLowerCase();
  return allowlist.map(normalizeAllowEntry).filter(Boolean).some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export async function assertSafeFlowHttpUrl(
  rawUrl: string,
  allowlist: string[] = []
): Promise<FlowHttpTarget> {
  let url: URL;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw new Error('URL inválida no bloco HTTP.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('O bloco HTTP só aceita http:// ou https://.');
  }
  if (url.username || url.password) {
    throw new Error('Não coloque credenciais na URL do bloco HTTP.');
  }

  const hostname = url.hostname.toLowerCase();
  if (ALWAYS_BLOCKED_HOSTS.has(hostname)) {
    throw new Error(`O bloco HTTP não pode acessar "${hostname}".`);
  }
  // The panel would answer its own API as whoever the flow is talking to.
  if (hostname === CONFIG.BACKEND_CONTAINER.toLowerCase() || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('O bloco HTTP não pode chamar o próprio painel.');
  }

  const allowed = hostIsAllowlisted(hostname, allowlist);

  let addresses: Array<{ address: string }>;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch {
      // A Docker container name resolves only on the bridge. Refusing here
      // would make an allowlisted neighbour unreachable, so the allowlist
      // itself is what authorises it.
      if (allowed) return { url, address: hostname };
      throw new Error(`Não foi possível resolver "${hostname}".`);
    }
  }
  if (!addresses.length) throw new Error(`Não foi possível resolver "${hostname}".`);

  for (const { address } of addresses) {
    if (isLoopback(address)) throw new Error('O bloco HTTP não pode chamar endereços de loopback.');
    if (isLinkLocal(address)) {
      throw new Error('O bloco HTTP não pode acessar o endereço de metadados da instância.');
    }
    if (isPrivateAddress(address) && !allowed) {
      throw new Error(
        `"${hostname}" está numa rede privada. Adicione o host na allowlist de blocos HTTP em Configurações para liberar.`
      );
    }
  }

  return { url, address: addresses[0].address };
}
