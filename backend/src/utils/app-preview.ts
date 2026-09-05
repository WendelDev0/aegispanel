import type { AppPreviewRecord } from './app-build.js';

export interface PreviewConfig {
  enabled: boolean;
  maxConcurrent: number;
  ttlHours: number;
  domainPattern: string;
}

export interface PreviewDecision {
  action: 'create' | 'update' | 'remove' | 'ignore';
  reason: string;
}

export function defaultPreviewConfig(): PreviewConfig {
  return {
    enabled: false,
    maxConcurrent: 3,
    ttlHours: 72,
    domainPattern: 'pr-{n}.{base}',
  };
}

export function previewDomain(
  prNumber: number,
  pattern: string,
  vars: { app?: string; base?: string }
): string {
  return pattern
    .replaceAll('{n}', String(prNumber))
    .replaceAll('{app}', vars.app || 'app')
    .replaceAll('{base}', vars.base || 'preview.localhost')
    .toLowerCase();
}

export function previewExpiresAt(ttlHours: number, now = new Date()): string {
  const hours = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 72;
  return new Date(now.getTime() + hours * 3600 * 1000).toISOString();
}

export function canCreatePreview(existing: AppPreviewRecord[], maxConcurrent: number): boolean {
  const active = existing.filter((p) => p.status === 'running' || p.status === 'building');
  return active.length < Math.max(1, maxConcurrent);
}

export function decidePreviewAction(
  event: { action: 'opened' | 'synchronize' | 'closed' | 'reopened'; number: number },
  existing: AppPreviewRecord | undefined,
  config: PreviewConfig,
  allForApp: AppPreviewRecord[]
): PreviewDecision {
  if (!config.enabled) {
    return { action: 'ignore', reason: 'Previews desativados para esta aplicação.' };
  }
  if (event.action === 'closed') {
    return existing
      ? { action: 'remove', reason: 'Pull request fechado.' }
      : { action: 'ignore', reason: 'Nenhum preview deste PR.' };
  }
  if (existing && (event.action === 'synchronize' || event.action === 'reopened' || event.action === 'opened')) {
    return { action: 'update', reason: 'Novo commit no pull request.' };
  }
  if (event.action === 'opened' || event.action === 'reopened') {
    if (!canCreatePreview(allForApp.filter((p) => p.prNumber !== event.number), config.maxConcurrent)) {
      return {
        action: 'ignore',
        reason: `Cota de previews atingida (${config.maxConcurrent}).`,
      };
    }
    return { action: 'create', reason: 'Pull request aberto.' };
  }
  return { action: 'ignore', reason: 'Evento de pull request ignorado.' };
}

export function expiredPreviews(records: AppPreviewRecord[], now = new Date()): AppPreviewRecord[] {
  const ts = now.toISOString();
  return records.filter((p) => p.status !== 'expired' && p.expiresAt <= ts);
}
