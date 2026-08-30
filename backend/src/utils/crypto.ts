import crypto from 'crypto';
import { CONFIG } from '../config.js';

// Derived from a key dedicated to data-at-rest, never from the session signing key.
const MASTER_KEY = crypto.scryptSync(CONFIG.ENCRYPTION_KEY, 'aegis_crypto_salt_secure_2026', 32);
const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'aegis.v1';

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

export class EncryptionService {
  /**
   * Encrypts plaintext with AES-256-GCM.
   * Format: aegis.v1:<iv>:<authTag>:<ciphertext>
   */
  static encrypt(plaintext: string): string {
    if (!plaintext) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${PREFIX}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  static isEncrypted(value: string): boolean {
    return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
  }

  /**
   * Decrypts a value produced by encrypt().
   *
   * Throws on tampering or on a wrong key. It never returns a placeholder
   * string: a caller that persisted that placeholder would silently overwrite
   * the real secret with unusable text.
   */
  static decrypt(ciphertext: string): string {
    if (!ciphertext) return '';

    if (!this.isEncrypted(ciphertext)) {
      // Records written by the pre-v1 format: <iv>:<authTag>:<ciphertext>, no
      // prefix, 16-byte IV.
      if (this.looksLikeLegacy(ciphertext)) {
        const legacy = this.tryDecryptLegacy(ciphertext);
        if (legacy !== null) return legacy;

        // The shape says encrypted but the key cannot open it. Returning the
        // raw string here would hand the caller a hex blob as if it were the
        // password, and the next save would write that blob over the record.
        throw new DecryptionError(
          'Este valor foi criptografado com outra chave. Defina ENCRYPTION_KEY com o valor do antigo ' +
            'JWT_SECRET para migrar os dados existentes, ou recrie o registro.'
        );
      }

      // Anything else predates encryption entirely and is stored in the clear.
      return ciphertext;
    }

    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
      throw new DecryptionError('Formato de valor criptografado inválido.');
    }

    try {
      const [, ivHex, authTagHex, encryptedHex] = parts;
      const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch (err: any) {
      throw new DecryptionError(
        'Falha ao descriptografar: a ENCRYPTION_KEY mudou ou o dado foi adulterado. ' +
          'O valor original NÃO foi alterado em disco.'
      );
    }
  }

  /** True when a value has the shape of the pre-v1 format: iv:authTag:payload. */
  private static looksLikeLegacy(value: string): boolean {
    const parts = value.split(':');
    if (parts.length !== 3) return false;
    if (!parts.every((p) => /^[0-9a-f]+$/i.test(p) && p.length > 0)) return false;
    return parts[0].length === 32 && parts[1].length === 32;
  }

  /** Reads the pre-v1 on-disk format, or null when this key cannot open it. */
  private static tryDecryptLegacy(value: string): string | null {
    const parts = value.split(':');
    if (!this.looksLikeLegacy(value)) return null;

    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, Buffer.from(parts[0], 'hex'));
      decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[2], 'hex')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }

  /**
   * Decrypts without throwing, for read paths that must degrade gracefully.
   * Returns null when the value cannot be recovered so callers can surface the
   * failure instead of persisting a corrupted placeholder.
   */
  static tryDecrypt(ciphertext: string): string | null {
    try {
      return this.decrypt(ciphertext);
    } catch {
      return null;
    }
  }

  /** Cryptographically strong random password. */
  static generateStrongPassword(length: number = 24, includeSymbols: boolean = true): string {
    const charset = {
      upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
      lower: 'abcdefghijkmnpqrstuvwxyz',
      numbers: '23456789',
      symbols: '!@#$%&*_+=-',
    };

    let allChars = charset.upper + charset.lower + charset.numbers;
    if (includeSymbols) allChars += charset.symbols;

    const chars: string[] = [
      charset.upper[crypto.randomInt(charset.upper.length)],
      charset.lower[crypto.randomInt(charset.lower.length)],
      charset.numbers[crypto.randomInt(charset.numbers.length)],
    ];
    if (includeSymbols) {
      chars.push(charset.symbols[crypto.randomInt(charset.symbols.length)]);
    }

    while (chars.length < length) {
      chars.push(allChars[crypto.randomInt(allChars.length)]);
    }

    // Fisher-Yates: a sort() with a random comparator is not a valid ordering
    // and produces a biased permutation.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
  }

  /** Secure random database username. */
  static generateSecureUsername(prefix: string = 'usr'): string {
    return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /** Clean random database name. */
  static generateDbName(prefix: string = 'db'): string {
    return `${prefix}_${crypto.randomBytes(3).toString('hex')}`;
  }

  /** URL-safe high-entropy token, used for webhook secrets. */
  static generateToken(bytes: number = 32): string {
    return crypto.randomBytes(bytes).toString('base64url');
  }
}
