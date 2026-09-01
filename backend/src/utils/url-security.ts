import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '0.0.0.0' || normalized.startsWith('127.') || normalized.startsWith('169.254.')) {
    return true;
  }
  if (normalized.startsWith('10.') || normalized.startsWith('192.168.')) return true;
  if (normalized.startsWith('172.')) {
    const second = Number(normalized.split('.')[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (normalized.startsWith('100.64.') || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
    return true;
  }
  return normalized.startsWith('::ffff:') && isPrivateAddress(normalized.slice(7));
}

/** Allows only public HTTPS Git remotes and rejects SSRF-prone destinations. */
export async function assertSafeGitUrl(value: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('URL do repositório Git inválida.');
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('O repositório Git deve usar HTTPS público, sem credenciais embutidas na URL.');
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || net.isIP(hostname) && isPrivateAddress(hostname)) {
    throw new Error('O repositório Git não pode apontar para um endereço local ou privado.');
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error('Não foi possível resolver o host do repositório Git.');
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('O repositório Git resolve para uma rede privada ou reservada.');
  }
}
