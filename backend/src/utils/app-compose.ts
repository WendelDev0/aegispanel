export interface ComposeBlock {
  code: string;
  message: string;
  suggestion?: string;
}

export interface ComposeServicePlan {
  name: string;
  image?: string;
  hasBuild: boolean;
  ports: string[];
  volumes: string[];
}

export interface ComposePlan {
  ok: boolean;
  services: ComposeServicePlan[];
  blocked: ComposeBlock[];
  rewrittenPorts: string[];
}

const FORBIDDEN: Array<{ pattern: RegExp; code: string; message: string; suggestion?: string }> = [
  {
    pattern: /^\s*privileged\s*:\s*(true|yes|1)/im,
    code: 'privileged',
    message: 'privileged: true daria root no host.',
    suggestion: 'Remova privileged. Se precisar de um dispositivo, use um volume nomeado.',
  },
  {
    pattern: /^\s*cap_add\s*:/im,
    code: 'cap_add',
    message: 'cap_add amplia as capabilities do container.',
    suggestion: 'Remova cap_add. Capacidades extras não são necessárias para um app web.',
  },
  {
    pattern: /^\s*network_mode\s*:\s*["']?host["']?/im,
    code: 'network_host',
    message: 'network_mode: host ignora o isolamento de rede do painel.',
    suggestion: 'Use a rede padrão. O Caddy alcança o serviço pelo nome.',
  },
  {
    pattern: /^\s*pid\s*:\s*["']?host["']?/im,
    code: 'pid_host',
    message: 'pid: host expõe os processos do servidor.',
  },
  {
    pattern: /^\s*devices\s*:/im,
    code: 'devices',
    message: 'devices monta hardware do host no container.',
  },
  {
    pattern: /\/var\/run\/docker\.sock/i,
    code: 'docker_socket',
    message: 'O socket do Docker no compose seria root no host.',
    suggestion: 'Remova o volume /var/run/docker.sock.',
  },
];

/**
 * Allowlist over a compose file the customer already has.
 *
 * A real YAML parser would accept anchors and merge keys that hide the same
 * forbidden fields; scanning the text as the operator pasted it is what
 * catches `privileged: true` even when it sits under an alias.
 */
export function validateCompose(yaml: string, allowedHostRoot: string): ComposePlan {
  const blocked: ComposeBlock[] = [];
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(yaml)) {
      blocked.push({ code: rule.code, message: rule.message, suggestion: rule.suggestion });
    }
  }

  const bindBlocks = findForbiddenBinds(yaml, allowedHostRoot);
  blocked.push(...bindBlocks);

  const services = extractServices(yaml);
  const rewrittenPorts: string[] = [];
  for (const svc of services) {
    for (const port of svc.ports) {
      if (!/^\s*127\.0\.0\.1:/.test(port) && !/^\s*localhost:/.test(port) && /:\d+/.test(port)) {
        rewrittenPorts.push(`${svc.name}: ${port} → 127.0.0.1:${port.replace(/^[^:]+:/, '')}`);
      }
    }
  }

  return {
    ok: blocked.length === 0,
    services,
    blocked,
    rewrittenPorts,
  };
}

function findForbiddenBinds(yaml: string, allowedHostRoot: string): ComposeBlock[] {
  const blocked: ComposeBlock[] = [];
  const root = allowedHostRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const bindLines = yaml.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return (
      /^-\s*["']?\/[^:]+:/.test(trimmed) ||
      /^\s*source:\s*["']?\//.test(trimmed) ||
      /^\s*-\s*type:\s*bind/i.test(trimmed)
    );
  });

  for (const line of bindLines) {
    const match = line.match(/(\/[A-Za-z0-9._\-/]+)/);
    if (!match) continue;
    const host = match[1].replace(/\\/g, '/');
    if (host === '/var/run/docker.sock') continue;
    if (root && (host === root || host.startsWith(`${root}/`))) continue;
    blocked.push({
      code: 'host_bind',
      message: `Bind de host fora da pasta do app: ${host}.`,
      suggestion: `Use um volume nomeado ou um caminho dentro de ${root || 'DATA_DIR/apps/<id>'}.`,
    });
  }
  return blocked;
}

function extractServices(yaml: string): ComposeServicePlan[] {
  const lines = yaml.split(/\r?\n/);
  let inServices = false;
  let current: ComposeServicePlan | null = null;
  const services: ComposeServicePlan[] = [];
  let section: 'none' | 'ports' | 'volumes' = 'none';

  const flush = () => {
    if (current) services.push(current);
    current = null;
    section = 'none';
  };

  for (const line of lines) {
    if (/^services\s*:/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^[a-zA-Z]/.test(line) && !line.startsWith(' ') && !line.startsWith('\t')) {
      if (!/^services\s*:/.test(line)) break;
    }
    if (!inServices) continue;

    const svc = line.match(/^  ([A-Za-z0-9._-]+)\s*:/);
    if (svc) {
      flush();
      current = { name: svc[1], hasBuild: false, ports: [], volumes: [] };
      continue;
    }
    if (!current) continue;

    if (/^\s{4}image\s*:/.test(line)) {
      current.image = line.split(':').slice(1).join(':').trim().replace(/^["']|["']$/g, '');
    }
    if (/^\s{4}build\s*:/.test(line)) current.hasBuild = true;
    if (/^\s{4}ports\s*:/.test(line)) {
      section = 'ports';
      continue;
    }
    if (/^\s{4}volumes\s*:/.test(line)) {
      section = 'volumes';
      continue;
    }
    if (/^\s{4}[a-zA-Z]/.test(line)) section = 'none';

    if (section === 'ports' && /^\s+-\s+/.test(line)) {
      current.ports.push(line.replace(/^\s+-\s+/, '').replace(/["']/g, '').trim());
    }
    if (section === 'volumes' && /^\s+-\s+/.test(line)) {
      current.volumes.push(line.replace(/^\s+-\s+/, '').replace(/["']/g, '').trim());
    }
  }
  flush();
  return services;
}

export function composeOverrideYaml(opts: {
  projectName: string;
  panelNetwork?: string;
  bindIp?: string;
}): string {
  const bind = opts.bindIp || '127.0.0.1';
  const lines = [
    '# Gerado pelo AegisPanel. Nomes, labels e bind de porta.',
    'x-aegis:',
    `  project: ${opts.projectName}`,
    `  bind: ${bind}`,
  ];
  if (opts.panelNetwork) {
    lines.push('networks:', `  default:`, `    name: ${opts.panelNetwork}`, `    external: true`);
  }
  return `${lines.join('\n')}\n`;
}
