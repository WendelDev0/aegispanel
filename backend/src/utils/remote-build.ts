/**
 * Where the repository is cloned for a deploy.
 *
 * Until now the panel always cloned into `DATA_DIR/builds/<appId>`, tarred the
 * result and streamed it to the target daemon — even when that daemon was on
 * another machine perfectly capable of fetching the repository itself. The panel
 * paid the disk and the bandwidth for every remote deploy, twice: once to pull
 * from GitHub, once to push the context over SSH.
 *
 * Docker's builder accepts a Git remote as the build context, so the node's own
 * daemon can do the clone. A leaf module because the decision — which mode, and
 * why — is the part worth testing, and it must not depend on a service.
 */

export type BuildContextMode = 'daemon-git' | 'panel-clone';

export interface BuildContextPlan {
  mode: BuildContextMode;
  /** Shown in the build log so the operator knows which path ran, and why. */
  reason: string;
}

export interface BuildContextInput {
  isRemote: boolean;
  sourceType: 'git' | 'dockerfile' | 'image';
  gitUrl?: string;
  /** True when the app carries a GitHub PAT for a private repository. */
  hasToken: boolean;
  /** Explicit opt-out stored on the app. */
  remoteCloneDisabled?: boolean;
}

/**
 * Chooses the build context mode.
 *
 * The private-repository case deliberately stays on the panel. Docker's remote
 * context is fetched by the daemon *before* the build starts, so there is no
 * secret mechanism for it — the only way to authenticate is to embed the token
 * in the URL, which then travels as a query parameter the remote daemon logs.
 * The panel already clones private repositories with the token in a git config
 * header, never in argv and never on disk, so falling back keeps that property
 * instead of trading it for disk space.
 */
export function planBuildContext(input: BuildContextInput): BuildContextPlan {
  if (!input.isRemote) {
    return {
      mode: 'panel-clone',
      reason: 'Deploy local: o clone e o build acontecem na mesma máquina.',
    };
  }
  if (input.sourceType !== 'git' || !input.gitUrl) {
    return { mode: 'panel-clone', reason: 'A origem desta aplicação não é um repositório Git.' };
  }
  if (input.remoteCloneDisabled) {
    return { mode: 'panel-clone', reason: 'Clone no nó desativado nas configurações desta aplicação.' };
  }
  if (input.hasToken) {
    return {
      mode: 'panel-clone',
      reason:
        'Repositório privado: o contexto remoto do Docker não aceita credencial sem colocá-la na URL, ' +
        'que o daemon do nó registraria em log. O painel clona e envia o contexto, mantendo o token fora do nó.',
    };
  }

  return {
    mode: 'daemon-git',
    reason: 'O daemon do nó clona o repositório; o painel não gasta disco nem banda com o contexto.',
  };
}

/**
 * Builds the context reference Docker's builder understands.
 *
 * `<url>#<ref>` — the fragment takes a branch, a tag or a full commit hash, so a
 * commit-pinned deploy and a rollback both work without a local clone.
 *
 * The URL is re-validated here rather than trusted from the record: it goes to
 * the remote daemon as a query parameter, and a value carrying credentials
 * would be logged by that daemon.
 */
export function gitBuildContext(gitUrl: string, ref: string): string {
  const url = new URL(gitUrl.trim());
  if (url.protocol !== 'https:') {
    throw new Error('O contexto remoto do Docker exige uma URL HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('A URL do repositório não pode carregar credenciais para o contexto remoto.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(ref) || ref.includes('..')) {
    throw new Error('Referência Git inválida para o contexto remoto.');
  }

  return `${url.toString()}#${ref}`;
}

/**
 * Whether a failed remote-context build should be retried by cloning locally.
 *
 * Only for failures that mean "this daemon cannot fetch that repository" — a
 * build that failed because the Dockerfile is wrong will fail identically after
 * a local clone, and retrying it would double every broken deploy's duration
 * and print the same error twice.
 */
export function shouldFallBackToPanelClone(message: string): boolean {
  const text = (message || '').toLowerCase();
  const contextFailures = [
    'unable to prepare context',
    'failed to fetch remote',
    'repository not found',
    'could not read from remote repository',
    'unsupported protocol',
    'remote context',
    'git',
  ];
  const buildFailures = ['dockerfile', 'returned a non-zero code', 'executor failed', 'build step'];

  if (buildFailures.some((needle) => text.includes(needle))) return false;
  return contextFailures.some((needle) => text.includes(needle));
}
