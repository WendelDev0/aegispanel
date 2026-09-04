/**
 * Strips credentials from strings that may be logged or stored in audit meta.
 *
 * Kept as a leaf module so AuditStore can share the same rules as deploy logs
 * without importing CicdService (and its Docker/git graph).
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/https:\/\/[^@\s/]+@/g, 'https://***@')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, '***')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '***')
    .replace(/aegis\.v1:[^"\s]+/g, 'aegis.v1:***')
    .replace(
      /("?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key(?:_id)?|secret[_-]?access[_-]?key|authorization)"?\s*[:=]\s*")[^"]+/gi,
      '$1***'
    );
}
