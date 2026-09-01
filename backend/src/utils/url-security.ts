import dns from 'node:dns/promises';
import net from 'node:net';

export interface SafeGitTarget {
  hostname: string;
  port: string;
  address: string;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized === '0.0.0.0' || normalized.startsWith('127.') || normalized.startsWith('169.254.')) {
    return true;
  }
  if (normalized.startsWith('10.') || normalized.startsWith('192.168.') || normalized.startsWith('192.0.0.') || normalized.startsWith('192.0.2.')) return true;
  if (normalized.startsWith('198.18.') || normalized.startsWith('198.19.') || normalized.startsWith('198.51.100.') || normalized.startsWith('203.0.113.')) return true;
  if (normalized.startsWith('224.') || normalized.startsWith('225.') || normalized.startsWith('226.') || normalized.startsWith('227.') || normalized.startsWith('228.') || normalized.startsWith('229.') || normalized.startsWith('230.') || normalized.startsWith('231.') || normalized.startsWith('232.') || normalized.startsWith('233.') || normalized.startsWith('234.') || normalized.startsWith('235.') || normalized.startsWith('236.') || normalized.startsWith('237.') || normalized.startsWith('238.') || normalized.startsWith('239.')) return true;
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
export async function assertSafeGitUrl(value: string): Promise<SafeGitTarget> {
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

  // Pin the address used by Git so a DNS answer cannot change between this
  // validation and clone/fetch. Prefer IPv4 because it is available in more
  // container networks; IPv6 remains supported when it is the only answer.
  const address = addresses.find((entry) => net.isIPv4(entry.address))?.address || addresses[0].address;
  return { hostname, port: url.port || '443', address };
}
