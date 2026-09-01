import Docker from 'dockerode';
import { dbStorage, ServerNode } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { EncryptionService } from '../utils/crypto.js';

export interface NodeHealth {
  reachable: boolean;
  message: string;
  dockerVersion?: string;
  containerCount?: number;
  checkedAt: string;
}

/** Node id used for the machine this process runs on. */
export const LOCAL_NODE_ID = 'node-local';

const CONNECT_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60_000;

/**
 * Reaches remote nodes over SSH.
 *
 * dockerode's SSH transport runs `docker system dial-stdio` through an ordinary
 * SSH session, so no Docker port is ever exposed on the node and the whole
 * authentication and audit story stays with sshd. This is the same mechanism
 * behind `DOCKER_HOST=ssh://…`.
 *
 * The trade-off accepted here: the stored key grants membership of the remote
 * `docker` group, which is equivalent to root on that machine. It is encrypted
 * at rest, never leaves the server, and node management is admin-only.
 */
export class NodeService {
  /** One client per node, created on first use and reused afterwards. */
  private static clients = new Map<string, { client: Docker; createdAt: number }>();

  static getAll(): ServerNode[] {
    return dbStorage.getServerNodes();
  }

  static getById(id: string): ServerNode | undefined {
    return dbStorage.getServerNodes().find((n) => n.id === id);
  }

  /**
   * Strips the credentials before a node leaves the API.
   * The key is write-only: it is set through the create/update endpoints and
   * never echoed back, only reported as present.
   */
  static toPublic(node: ServerNode) {
    const { sshPrivateKey, sshPassphrase, ...rest } = node;
    return {
      ...rest,
      hasSshKey: Boolean(sshPrivateKey),
      hasPassphrase: Boolean(sshPassphrase),
      hasSshHostFingerprint: Boolean(node.sshHostFingerprint),
    };
  }

  /** Drops a cached client, so the next call reconnects with fresh settings. */
  static invalidate(nodeId: string): void {
    this.clients.delete(nodeId);
  }

  /**
   * Docker client for a node.
   *
   * The local node reuses the existing singleton rather than opening a second
   * connection to the same daemon.
   */
  static async getClient(nodeId: string): Promise<Docker> {
    if (!nodeId || nodeId === LOCAL_NODE_ID) {
      return dockerService.getDockerClient();
    }

    const node = this.getById(nodeId);
    if (!node) throw new Error('Nó não encontrado');
    if (node.isLocal) return dockerService.getDockerClient();

    const cached = this.clients.get(nodeId);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      return cached.client;
    }

    const client = this.buildClient(node);
    this.clients.set(nodeId, { client, createdAt: Date.now() });
    return client;
  }

  private static buildClient(node: ServerNode): Docker {
    if (!node.sshHost || !node.sshUser) {
      throw new Error(`O nó "${node.name}" não tem host ou usuário SSH configurado.`);
    }
    if (!node.sshPrivateKey) {
      throw new Error(`O nó "${node.name}" não tem chave SSH cadastrada.`);
    }
    if (!node.sshHostFingerprint) {
      throw new Error(
        `O nó "${node.name}" não possui fingerprint da chave do host SSH. ` +
          'Informe o SHA256 exibido por ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256.'
      );
    }

    const privateKey = EncryptionService.tryDecrypt(node.sshPrivateKey);
    if (privateKey === null) {
      throw new Error(
        `Não foi possível descriptografar a chave SSH do nó "${node.name}". ` +
          'A ENCRYPTION_KEY do servidor mudou desde que ela foi cadastrada; cadastre a chave novamente.'
      );
    }

    const passphrase = node.sshPassphrase ? EncryptionService.tryDecrypt(node.sshPassphrase) : undefined;
    const expectedFingerprint = node.sshHostFingerprint.replace(/^SHA256:/i, '').trim();

    // Note: dockerode logs a DeprecationWarning about a malformed URL for the
    // ssh protocol (docker-modem builds it with url.format and no scheme). It
    // is cosmetic - the address is re-resolved before the request and the
    // connection works - so it is left alone rather than worked around with a
    // fragile patch to the library's internals.
    return new Docker({
      protocol: 'ssh',
      host: node.sshHost,
      port: node.sshPort || 22,
      username: node.sshUser,
      sshOptions: {
        privateKey,
        ...(passphrase ? { passphrase } : {}),
        readyTimeout: CONNECT_TIMEOUT_MS,
        hostVerifier: (fingerprint: string) =>
          fingerprint === expectedFingerprint || fingerprint === `SHA256:${expectedFingerprint}`,
      },
    } as Docker.DockerOptions);
  }

  /**
   * Checks whether a node is actually reachable, and records the result.
   *
   * Reports the real outcome rather than assuming success: the point of this
   * endpoint is to tell the operator what is wrong before they rely on the node.
   */
  static async checkHealth(nodeId: string): Promise<NodeHealth> {
    const node = this.getById(nodeId);
    if (!node) throw new Error('Nó não encontrado');

    const checkedAt = new Date().toISOString();

    try {
      // A stale client would report a connection that no longer works, which is
      // exactly what this check exists to catch.
      this.invalidate(nodeId);

      const client = await this.getClient(nodeId);

      const version = await this.withTimeout(client.version(), CONNECT_TIMEOUT_MS, 'conexão');
      const containers = await this.withTimeout(
        client.listContainers({ all: true }),
        CONNECT_TIMEOUT_MS,
        'listagem de contêineres'
      );

      node.status = 'online';
      node.lastCheckedAt = checkedAt;
      node.lastError = undefined;
      node.dockerVersion = version.Version;
      node.containerCount = containers.length;
      dbStorage.saveServerNode(node);

      return {
        reachable: true,
        message: `Conectado. Docker ${version.Version} com ${containers.length} contêiner(es).`,
        dockerVersion: version.Version,
        containerCount: containers.length,
        checkedAt,
      };
    } catch (err: any) {
      const message = this.explain(err);

      node.status = 'error';
      node.lastCheckedAt = checkedAt;
      node.lastError = message;
      dbStorage.saveServerNode(node);
      this.invalidate(nodeId);

      return { reachable: false, message, checkedAt };
    }
  }

  /**
   * Turns a transport error into something the operator can act on.
   * The raw errors from ssh2 and dockerode name a symptom, not a fix.
   */
  private static explain(err: any): string {
    const raw = String(err?.message || err);

    if (/All configured authentication methods failed/i.test(raw)) {
      return 'Autenticação SSH recusada. Verifique se a chave pública correspondente está em ~/.ssh/authorized_keys do usuário no nó remoto.';
    }
    if (/ECONNREFUSED/i.test(raw)) {
      return 'Conexão recusada na porta SSH. Verifique se o sshd está ativo e se a porta está correta.';
    }
    if (/ETIMEDOUT|timed out|Timed out while waiting/i.test(raw)) {
      return 'Tempo esgotado ao conectar. Verifique o endereço, o firewall do nó e se a porta SSH está liberada.';
    }
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
      return 'Endereço não resolvido. Confira o host ou o IP informado.';
    }
    if (/Cannot parse privateKey|OpenSSH.*unsupported|Encrypted private OpenSSH key/i.test(raw)) {
      return 'Chave privada inválida ou protegida por passphrase não informada. Cole a chave inteira, incluindo as linhas BEGIN e END.';
    }
    if (/dial-stdio|not a docker command|executable file not found/i.test(raw)) {
      return 'A conexão SSH funcionou, mas o comando docker não foi encontrado no nó. Instale o Docker no servidor remoto.';
    }
    if (/permission denied while trying to connect to the Docker daemon/i.test(raw)) {
      return 'O usuário SSH não tem permissão no Docker do nó. Adicione-o ao grupo docker: sudo usermod -aG docker <usuario>.';
    }

    return `Falha ao conectar: ${raw}`;
  }

  private static withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Tempo esgotado durante ${what}.`)), ms)
      ),
    ]);
  }
}
