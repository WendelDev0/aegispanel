import { createHash, generateKeyPairSync } from 'node:crypto';

export interface GeneratedDeployKey {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

function u32(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n);
  return buf;
}

function sshBlob(raw32: Buffer): Buffer {
  const type = Buffer.from('ssh-ed25519');
  return Buffer.concat([u32(type.length), type, u32(raw32.length), raw32]);
}

function fingerprintOf(blob: Buffer): string {
  const digest = createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

/**
 * ED25519 in OpenSSH form so the public half can be pasted into GitHub as a
 * deploy key. The private half is PKCS8 PEM — OpenSSH 7.8+ accepts it with
 * IdentitiesOnly, and it encrypts with the same aegis.v1: prefix as other
 * secrets instead of inventing another envelope.
 */
export function generateDeployKey(comment = 'aegis-deploy'): GeneratedDeployKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const raw32 = spki.subarray(spki.length - 32);
  const blob = sshBlob(raw32);
  return {
    publicKey: `ssh-ed25519 ${blob.toString('base64')} ${comment}`,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerprint: fingerprintOf(blob),
  };
}

export function fingerprintPublicKey(publicKey: string): string {
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length < 2) throw new Error('Chave pública SSH inválida.');
  const blob = Buffer.from(parts[1], 'base64');
  return fingerprintOf(blob);
}

/** Published host keys. Rotating them is a code change on purpose. */
export const PROVIDER_KNOWN_HOSTS = `# github.com
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
# gitlab.com
gitlab.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAfuCHKVTjquu62bu8ssTvsJgJKzWc0El0CUBWsz3eB+
# bitbucket.org
bitbucket.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIizTQAFb/l3BgOnyIUEC7HL5+/G3ynSwbZ6K+pBb5pG
`;
