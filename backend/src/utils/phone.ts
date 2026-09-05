import crypto from 'crypto';
import { CONFIG } from '../config.js';

const PHONE_SALT = crypto
  .createHash('sha256')
  .update(`${CONFIG.ENCRYPTION_KEY}:wa-phone-salt`)
  .digest('hex');

export function digits(phone: string): string {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Deterministic pseudonym for a phone number.
 *
 * Full phone numbers must never appear in logs or AI prompts.
 * Using a salt derived from ENCRYPTION_KEY ensures rainbow tables
 * cannot reverse the hashes if log files are exported.
 */
export function phoneHash(phone: string): string {
  const d = digits(phone);
  return crypto.createHash('sha256').update(PHONE_SALT + d).digest('hex').slice(0, 16);
}

/**
 * Returns only the last 4 digits of a phone number so operators can recognize the contact.
 */
export function phoneTail(phone: string): string {
  const d = digits(phone);
  return d.slice(-4);
}
