import { Router, Request, Response } from 'express';
import { dbStorage, ServerNode } from '../db/storage.js';
import { NodeService, LOCAL_NODE_ID } from '../services/node.service.js';
import { EncryptionService } from '../utils/crypto.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';

export const nodeRouter = Router();

nodeRouter.use(authMiddleware);

/**
 * A stored SSH key is equivalent to root on the node it opens, so every route
 * that reads or writes one is admin-only — the same bar as the host terminal
 * and shell cron jobs.
 */

function normalizeHost(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^ssh:\/\//i, '')
    .replace(/\/.*$/, '');
}

/**
 * Validates the SSH login name.
 *
 * Worth checking rather than trusting: a server name pasted into this field
 * ("VPS SELVA") is accepted by the form, fails authentication on the node, and
 * surfaces as a generic "authentication refused" that says nothing about the
 * real mistake.
 */
function validateSshUser(user: string): string | null {
  const trimmed = user.trim();
  if (!trimmed) return 'Usuário SSH é obrigatório.';
  if (/\s/.test(trimmed)) {
    return `"${trimmed}" não é um usuário SSH válido: nomes de usuário não têm espaços. Informe a conta de login no servidor, por exemplo "aegis" ou "root".`;
  }
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(trimmed)) {
    return `"${trimmed}" não é um usuário SSH válido. Use apenas letras, números, hífen e sublinhado.`;
  }
  return null;
}

/** Rejects a key that is not in a format ssh2 can parse, before it is stored. */
function validatePrivateKey(key: string): string | null {
  const trimmed = key.trim();
  if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(trimmed)) {
    return 'A chave deve começar com "-----BEGIN ... PRIVATE KEY-----". Cole o arquivo inteiro da chave privada, não a pública (.pub).';
  }
  if (!/-----END [A-Z ]*PRIVATE KEY-----$/.test(trimmed)) {
    return 'A chave parece incompleta: falta a linha "-----END ... PRIVATE KEY-----".';
  }
  if (/^ssh-(rsa|ed25519|dss)|^ecdsa-sha2-/.test(trimmed)) {
    return 'Isso é uma chave pública. Informe a chave privada correspondente.';
  }
  return null;
}

nodeRouter.get('/', (req: Request, res: Response) => {
  res.json(NodeService.getAll().map(NodeService.toPublic));
});

nodeRouter.post('/', requireAdmin, (req: Request, res: Response): void => {
  try {
    const { name, type, hostIp, location, sshHost, sshPort, sshUser, sshPrivateKey, sshPassphrase } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Nome do servidor é obrigatório' });
      return;
    }

    const host = normalizeHost(sshHost || hostIp);
    if (!host) {
      res.status(400).json({ error: 'Endereço (host ou IP) do servidor é obrigatório' });
      return;
    }

    const userProblem = validateSshUser(String(sshUser || ''));
    if (userProblem) {
      res.status(400).json({ error: userProblem });
      return;
    }

    if (!sshPrivateKey) {
      res.status(400).json({
        error: 'Chave privada SSH é obrigatória. O painel se conecta ao Docker do nó por SSH, sem expor nenhuma porta.',
      });
      return;
    }

    const keyProblem = validatePrivateKey(sshPrivateKey);
    if (keyProblem) {
      res.status(400).json({ error: keyProblem });
      return;
    }

    const port = sshPort ? parseInt(String(sshPort), 10) : 22;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      res.status(400).json({ error: 'Porta SSH inválida.' });
      return;
    }

    const newNode: ServerNode = {
      id: `node-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      type: type === 'local' || type === 'cloud' ? type : 'vps',
      hostIp: host,
      isLocal: false,
      isCurrent: false,
      // Unknown until the first health check actually connects; claiming
      // "online" before testing is how the old cadastro lied about state.
      status: 'unknown',
      location: location || undefined,
      sshHost: host,
      sshPort: port,
      sshUser: String(sshUser).trim(),
      sshPrivateKey: EncryptionService.encrypt(String(sshPrivateKey).trim()),
      sshPassphrase: sshPassphrase ? EncryptionService.encrypt(String(sshPassphrase)) : undefined,
    };

    const saved = dbStorage.saveServerNode(newNode);

    dbStorage.addActivity({
      type: 'system',
      title: `Nó registrado: ${saved.name}`,
      description: `${saved.sshUser}@${saved.sshHost}:${saved.sshPort} — aguardando teste de conexão`,
      status: 'info',
      metadata: { nodeId: saved.id },
    });

    res.status(201).json(NodeService.toPublic(saved));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

nodeRouter.put('/:id', requireAdmin, (req: Request, res: Response): void => {
  try {
    const node = NodeService.getById(req.params.id);
    if (!node) {
      res.status(404).json({ error: 'Nó não encontrado' });
      return;
    }
    if (node.isLocal) {
      res.status(400).json({ error: 'O nó local não possui configuração de conexão editável.' });
      return;
    }

    const { name, location, sshHost, sshPort, sshUser, sshPrivateKey, sshPassphrase } = req.body;

    if (name) node.name = name;
    if (location !== undefined) node.location = location || undefined;
    if (sshUser) {
      const userProblem = validateSshUser(String(sshUser));
      if (userProblem) {
        res.status(400).json({ error: userProblem });
        return;
      }
      node.sshUser = String(sshUser).trim();
    }

    if (sshHost) {
      const host = normalizeHost(sshHost);
      if (!host) {
        res.status(400).json({ error: 'Endereço inválido.' });
        return;
      }
      node.sshHost = host;
      node.hostIp = host;
    }

    if (sshPort) {
      const port = parseInt(String(sshPort), 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        res.status(400).json({ error: 'Porta SSH inválida.' });
        return;
      }
      node.sshPort = port;
    }

    // Blank means "keep the stored key": the API never sends it back, so an
    // empty field cannot be read as an instruction to erase it.
    if (sshPrivateKey) {
      const keyProblem = validatePrivateKey(sshPrivateKey);
      if (keyProblem) {
        res.status(400).json({ error: keyProblem });
        return;
      }
      node.sshPrivateKey = EncryptionService.encrypt(String(sshPrivateKey).trim());
    }

    if (sshPassphrase !== undefined) {
      node.sshPassphrase = sshPassphrase ? EncryptionService.encrypt(String(sshPassphrase)) : undefined;
    }

    // Settings changed, so any open connection is stale.
    NodeService.invalidate(node.id);
    node.status = 'unknown';

    res.json(NodeService.toPublic(dbStorage.saveServerNode(node)));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Connects to the node and reports what actually happened. */
nodeRouter.post('/:id/check', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await NodeService.checkHealth(req.params.id));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

nodeRouter.post('/select/:id', requireAdmin, (req: Request, res: Response): void => {
  const nodes = dbStorage.getServerNodes();
  const target = nodes.find((n) => n.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: 'Servidor não encontrado' });
    return;
  }

  for (const n of nodes) {
    n.isCurrent = n.id === target.id;
    dbStorage.saveServerNode(n);
  }

  res.json({ success: true, activeNode: NodeService.toPublic(target) });
});

nodeRouter.delete('/:id', requireAdmin, (req: Request, res: Response): void => {
  const node = NodeService.getById(req.params.id);
  if (!node) {
    res.status(404).json({ error: 'Nó não encontrado' });
    return;
  }

  // Removing the local node would leave the panel unable to describe the
  // machine it is running on.
  if (node.isLocal || node.id === LOCAL_NODE_ID) {
    res.status(400).json({ error: 'O nó local não pode ser removido.' });
    return;
  }

  NodeService.invalidate(node.id);
  const success = dbStorage.removeServerNode(node.id);

  dbStorage.addActivity({
    type: 'system',
    title: `Nó removido: ${node.name}`,
    description: `${node.sshUser}@${node.sshHost}`,
    status: 'info',
    metadata: { nodeId: node.id },
  });

  res.json({ success });
});
