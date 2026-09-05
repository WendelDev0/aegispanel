import crypto from 'node:crypto';

export type WebhookKind = 'push' | 'tag' | 'pr';

export type WebhookEvent =
  | { kind: 'push'; branch: string; headSha: string; message?: string; author?: string }
  | { kind: 'tag'; tag: string; headSha: string; message?: string; author?: string }
  | {
      kind: 'pr';
      number: number;
      action: 'opened' | 'synchronize' | 'closed' | 'reopened';
      branch: string;
      headSha: string;
    };

export type ParsedWebhook =
  | { ok: true; event: WebhookEvent; provider: string }
  | { ok: false; error: string; status: number };

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function hmacSha256Hex(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function verifyGitHubSignature(rawBody: string, signature: string | undefined, secret?: string): boolean {
  if (!secret || !signature) return false;
  const expected = `sha256=${hmacSha256Hex(secret, rawBody)}`;
  return safeEqual(signature, expected);
}

export function verifyGiteaSignature(rawBody: string, signature: string | undefined, secret?: string): boolean {
  if (!secret || !signature) return false;
  const hex = hmacSha256Hex(secret, rawBody);
  return safeEqual(signature, hex) || safeEqual(signature, `sha256=${hex}`);
}

export function verifySharedSecret(provided: string | undefined, secret?: string): boolean {
  if (!secret || !provided) return false;
  return safeEqual(provided, secret);
}

export interface WebhookHeaders {
  'x-hub-signature-256'?: string;
  'x-gitea-signature'?: string;
  'x-gitlab-token'?: string;
  'x-event-key'?: string;
  'x-aegis-secret'?: string;
  'x-github-event'?: string;
  'x-gitlab-event'?: string;
  'x-gitea-event'?: string;
  [key: string]: string | undefined;
}

/**
 * Authentication is checked before the body is trusted.
 *
 * A payload without a signature used to pass because the old GitHub-only
 * branch treated a missing header as "must be our own Actions secret" and
 * then compared against an empty string. Every provider now has to present
 * something that matches the app secret.
 */
export function authorizeWebhook(
  headers: WebhookHeaders,
  rawBody: string,
  secret?: string
): { ok: true; provider: string } | { ok: false; error: string } {
  if (!secret) return { ok: false, error: 'Esta aplicação não possui segredo de webhook.' };

  if (headers['x-hub-signature-256']) {
    return verifyGitHubSignature(rawBody, headers['x-hub-signature-256'], secret)
      ? { ok: true, provider: 'github' }
      : { ok: false, error: 'Assinatura GitHub inválida.' };
  }
  if (headers['x-gitea-signature']) {
    return verifyGiteaSignature(rawBody, headers['x-gitea-signature'], secret)
      ? { ok: true, provider: 'gitea' }
      : { ok: false, error: 'Assinatura Gitea inválida.' };
  }
  if (headers['x-gitlab-token']) {
    return verifySharedSecret(headers['x-gitlab-token'], secret)
      ? { ok: true, provider: 'gitlab' }
      : { ok: false, error: 'Token GitLab inválido.' };
  }
  if (headers['x-event-key'] && headers['x-aegis-secret']) {
    return verifySharedSecret(headers['x-aegis-secret'], secret)
      ? { ok: true, provider: 'bitbucket' }
      : { ok: false, error: 'Segredo Bitbucket inválido.' };
  }
  if (headers['x-aegis-secret']) {
    return verifySharedSecret(headers['x-aegis-secret'], secret)
      ? { ok: true, provider: 'aegis' }
      : { ok: false, error: 'Segredo Aegis inválido.' };
  }
  return { ok: false, error: 'Credencial de webhook ausente.' };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function prAction(raw: string | undefined): 'opened' | 'synchronize' | 'closed' | 'reopened' | null {
  const value = String(raw || '').toLowerCase();
  if (value === 'opened' || value === 'synchronize' || value === 'synchronized') {
    return value === 'synchronized' ? 'synchronize' : value;
  }
  if (value === 'closed' || value === 'merged' || value === 'declined') return 'closed';
  if (value === 'reopened') return 'reopened';
  return null;
}

export function parseWebhookEvent(headers: WebhookHeaders, body: unknown): ParsedWebhook {
  const payload = asRecord(body);
  const githubEvent = headers['x-github-event'] || headers['x-gitea-event'];
  const gitlabEvent = headers['x-gitlab-event'];
  const bitbucketEvent = headers['x-event-key'];

  if (githubEvent === 'pull_request' || gitlabEvent === 'Merge Request Hook') {
    return parsePullRequest(payload, gitlabEvent ? 'gitlab' : 'github');
  }
  if (bitbucketEvent?.startsWith('pullrequest:')) {
    return parseBitbucketPr(payload, bitbucketEvent);
  }

  const ref = String(payload.ref || payload.checkout_sha || '');
  if (ref.startsWith('refs/tags/') || payload.object_kind === 'tag_push') {
    const tag = ref.replace(/^refs\/tags\//, '') || String(payload.tag || '');
    const headSha = shortSha(payload.after || payload.checkout_sha || payload.head_commit?.id);
    if (!tag || !headSha) return { ok: false, error: 'Push de tag sem nome ou commit.', status: 400 };
    return {
      ok: true,
      provider: gitlabEvent ? 'gitlab' : 'git',
      event: {
        kind: 'tag',
        tag,
        headSha,
        message: payload.head_commit?.message || payload.message,
        author: payload.head_commit?.author?.name || payload.user_name,
      },
    };
  }

  const branch =
    String(payload.ref || '')
      .replace(/^refs\/heads\//, '')
      .replace(/^refs\/tags\//, '') ||
    payload.branch ||
    payload.object_attributes?.target_branch ||
    '';
  const headSha = shortSha(
    payload.head_commit?.id || payload.after || payload.checkout_sha || payload.push?.changes?.[0]?.new?.target?.hash
  );
  if (!branch) {
    return { ok: false, error: 'Push sem branch.', status: 400 };
  }
  return {
    ok: true,
    provider: gitlabEvent ? 'gitlab' : bitbucketEvent ? 'bitbucket' : 'git',
    event: {
      kind: 'push',
      branch,
      headSha: headSha || 'HEAD',
      message: payload.head_commit?.message || payload.message || 'Push',
      author: payload.head_commit?.author?.name || payload.user_name || payload.actor?.display_name || 'git',
    },
  };
}

function parsePullRequest(payload: Record<string, any>, provider: string): ParsedWebhook {
  const pr = payload.pull_request || payload.object_attributes || {};
  const action = prAction(payload.action || pr.action || pr.state);
  const number = Number(pr.number || pr.iid || payload.number);
  const branch = String(pr.head?.ref || pr.source_branch || '');
  const headSha = shortSha(pr.head?.sha || pr.last_commit?.id || '');
  if (!action || !number || !branch) {
    return { ok: false, error: 'Pull request sem número, ação ou branch.', status: 400 };
  }
  return {
    ok: true,
    provider,
    event: { kind: 'pr', number, action, branch, headSha: headSha || 'HEAD' },
  };
}

function parseBitbucketPr(payload: Record<string, any>, eventKey: string): ParsedWebhook {
  const mapped =
    eventKey.includes('fulfilled') || eventKey.includes('rejected')
      ? 'closed'
      : eventKey.includes('updated')
        ? 'synchronize'
        : 'opened';
  const pr = payload.pullrequest || {};
  const number = Number(pr.id);
  const branch = String(pr.source?.branch?.name || '');
  const headSha = shortSha(pr.source?.commit?.hash || '');
  if (!number || !branch) return { ok: false, error: 'Pull request Bitbucket incompleto.', status: 400 };
  return {
    ok: true,
    provider: 'bitbucket',
    event: { kind: 'pr', number, action: mapped, branch, headSha: headSha || 'HEAD' },
  };
}

function shortSha(value: unknown): string {
  const sha = String(value || '').trim();
  return sha ? sha.slice(0, 12) : '';
}
