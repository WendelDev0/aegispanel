import crypto from 'crypto';
import { CONFIG } from '../config.js';

// Derive a 32-byte key from the secret
const MASTER_KEY = crypto.scryptSync(CONFIG.JWT_SECRET, 'aegis_crypto_salt_secure_2026', 32);
const ALGORITHM = 'aes-256-gcm';

export class EncryptionService {
  /**
   * Encrypts plaintext string with AES-256-GCM
   */
  static encrypt(plaintext: string): string {
    if (!plaintext) return '';
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag().toString('hex');
      // Format: iv:authTag:encrypted
      return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err) {
      console.error('Encryption error:', err);
      return plaintext;
    }
  }

  /**
   * Decrypts AES-256-GCM ciphertext
   */
  static decrypt(ciphertext: string): string {
    if (!ciphertext) return '';
    // If not in encrypted format (e.g. legacy data), return as is
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      return ciphertext;
    }

    try {
      const [ivHex, authTagHex, encryptedHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('Decryption failed or invalid key:', err);
      return '***ENCRYPTED***';
    }
  }

  /**
   * Generates a cryptographically strong random password
   */
  static generateStrongPassword(length: number = 24, includeSymbols: boolean = true): string {
    const charset = {
      upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
      lower: 'abcdefghijkmnpqrstuvwxyz',
      numbers: '23456789',
      symbols: '!@#$%&*_+=-',
    };

    let allChars = charset.upper + charset.lower + charset.numbers;
    if (includeSymbols) allChars += charset.symbols;

    const randomBytes = crypto.randomBytes(length);
    let result = '';

    // Guarantee at least one from each category
    result += charset.upper[crypto.randomInt(charset.upper.length)];
    result += charset.lower[crypto.randomInt(charset.lower.length)];
    result += charset.numbers[crypto.randomInt(charset.numbers.length)];
    if (includeSymbols) {
      result += charset.symbols[crypto.randomInt(charset.symbols.length)];
    }

    for (let i = result.length; i < length; i++) {
      const randomIndex = randomBytes[i] % allChars.length;
      result += allChars[randomIndex];
    }

    // Shuffle characters
    return result.split('').sort(() => crypto.randomInt(3) - 1).join('');
  }

  /**
   * Generates a secure random database username
   */
  static generateSecureUsername(prefix: string = 'usr'): string {
    const rand = crypto.randomBytes(4).toString('hex');
    return `${prefix}_${rand}`;
  }

  /**
   * Generates a clean database name
   */
  static generateDbName(prefix: string = 'db'): string {
    const rand = crypto.randomBytes(3).toString('hex');
    return `${prefix}_${rand}`;
  }
}
