import type { DeployStrategy } from './app-build.js';

export type DeployPlanStep = 'release' | 'green' | 'swap' | 'drain' | 'recreate';

export interface DeployPlanInput {
  requested?: DeployStrategy;
  hasHealthcheck: boolean;
  hasDomain: boolean;
  /** Explicit host port cannot be held by two containers on a remote node. */
  remoteExplicitPort?: boolean;
  /** Blue/green doubles RAM while both slots are up. */
  memoryFitsTwice?: boolean;
}

export interface DeployPlan {
  strategy: DeployStrategy;
  warnings: string[];
  steps: DeployPlanStep[];
}

/**
 * Chooses recreate whenever a zero-downtime swap would lie.
 *
 * Without a domain Caddy has no hostname to retarget, so flipping the host
 * port still drops in-flight clients. Without a healthcheck the green slot
 * cannot be proven ready, and swapping blindly is how a broken release used
 * to take the site down while the panel said success.
 */
export function planDeployStrategy(input: DeployPlanInput): DeployPlan {
  const warnings: string[] = [];
  if (input.requested === 'recreate') {
    return { strategy: 'recreate', warnings, steps: ['release', 'recreate'] };
  }

  if (!input.hasDomain) {
    warnings.push('Sem domínio o painel não troca o upstream no Caddy; o deploy recria o contêiner.');
    return { strategy: 'recreate', warnings, steps: ['release', 'recreate'] };
  }
  if (!input.hasHealthcheck) {
    warnings.push('Sem healthcheck o slot verde não pode ser validado; o deploy recria o contêiner.');
    return { strategy: 'recreate', warnings, steps: ['release', 'recreate'] };
  }
  if (input.remoteExplicitPort) {
    warnings.push('Porta de host fixa em nó remoto não cabe em dois slots; o deploy recria o contêiner.');
    return { strategy: 'recreate', warnings, steps: ['release', 'recreate'] };
  }
  if (input.memoryFitsTwice === false) {
    warnings.push('RAM livre não cabe os dois slots; o deploy recria o contêiner para não causar OOM.');
    return { strategy: 'recreate', warnings, steps: ['release', 'recreate'] };
  }

  return {
    strategy: 'blue-green',
    warnings,
    steps: ['release', 'green', 'swap', 'drain'],
  };
}
