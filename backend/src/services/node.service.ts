import Docker from 'dockerode';
import { dbStorage, ServerNode } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { EncryptionService } from '../utils/crypto.js';
import { AlertService } from './alert.service.js';
import { CaddyService } from './caddy.service.js';
import { AuditStore } from '../utils/audit.store.js';

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
   * Failed probes tolerated before a node is declared `error`.
   *
   * One failure is a dropped SSH connection or a moment of packet loss, which
   * happens on any link. Flipping a node to `error` on that would pull every
   * app it hosts out of Caddy, so the outage would be the panel's, not the
   * node's.
   */
  static readonly FAILURES_BEFORE_ERROR = 3;
  private static probeTimer: NodeJS.Timeout | null = null;

  /**
   * Reads what the Docker API actually reports about a node.
   *
   * Free RAM and free disk of the host are not in that list. Getting them means
   * running a container on the node to read /proc — a read-only health probe
   * that schedules a workload is not a health probe. The numbers Docker does
   * give are reported; nothing is invented to fill the gap.
   */
  static async probe(nodeId: string): Promise<ServerNode['health'] | null> {
    const node = this.getById(nodeId);
    if (!node || node.isLocal || nodeId === LOCAL_NODE_ID) return null;

    const startedAt = Date.now();
    const at = new Date().toISOString();
    const previousFailures = node.health?.consecutiveFailures ?? 0;
    const wasReachable = node.status === 'online';

    try {
      this.invalidate(nodeId);
      const client = await this.getClient(nodeId);

      const info: any = await this.withTimeout(client.info(), CONNECT_TIMEOUT_MS, 'docker info');
      const sshMs = Date.now() - startedAt;

      const containers = await this.withTimeout(
        client.listContainers({ all: false }),
        CONNECT_TIMEOUT_MS,
        'listagem de contêineres'
      );
      const aegisRunning = containers.filter(
        (c: any) => c.Labels?.['aegis.managed'] === 'true'
      ).length;

      let dockerDiskBytes: number | undefined;
      try {
        const df: any = await this.withTimeout(client.df(), CONNECT_TIMEOUT_MS, 'docker df');
        dockerDiskBytes =
          (df?.LayersSize || 0) +
          (df?.Volumes || []).reduce((sum: number, v: any) => sum + (v?.UsageData?.Size || 0), 0);
      } catch {
        // Older daemons do not implement /system/df; the rest of the probe is
        // still valid and must not be discarded over one optional number.
      }

      node.health = {
        at,
        sshMs,
        dockerOk: true,
        containersRunning: containers.length,
        aegisRunning,
        memTotalBytes: info?.MemTotal,
        cpuCount: info?.NCPU,
        dockerDiskBytes,
        consecutiveFailures: 0,
      };
      node.status = 'online';
      node.lastCheckedAt = at;
      node.lastError = undefined;
      node.dockerVersion = info?.ServerVersion || node.dockerVersion;
      node.containerCount = containers.length;
      dbStorage.saveServerNode(node);

      if (!wasReachable && previousFailures >= this.FAILURES_BEFORE_ERROR) {
        await AlertService.broadcastNotification(
          `✅ Nó "${node.name}" voltou`,
          `O nó "${node.name}" (${node.hostIp}) respondeu novamente. Latência SSH: ${sshMs}ms.`,
          'alert',
          false
        ).catch(() => {});
        AuditStore.append({
          action: 'node.recovered',
          outcome: 'success',
          target: { type: 'node', id: node.id, name: node.name },
        });
        // Its apps go back into the proxy.
        await CaddyService.syncCaddyfile().catch(() => {});
      }

      return node.health;
    } catch (err: any) {
      const message = this.explain(err);
      const consecutiveFailures = previousFailures + 1;

      node.health = {
        at,
        sshMs: Date.now() - startedAt,
        dockerOk: false,
        containersRunning: 0,
        aegisRunning: 0,
        consecutiveFailures,
        lastError: message,
      };
      node.lastCheckedAt = at;
      node.lastError = message;
      this.invalidate(nodeId);

      // Only after the third: a single dropped SSH connection must not take a
      // node's applications offline.
      if (consecutiveFailures >= this.FAILURES_BEFORE_ERROR) {
        const justFailed = node.status !== 'error';
        node.status = 'error';
        dbStorage.saveServerNode(node);

        if (justFailed) {
          await AlertService.broadcastNotification(
            `🚨 Nó "${node.name}" inacessível`,
            `O nó "${node.name}" (${node.hostIp}) falhou ${consecutiveFailures} sondagens seguidas: ${message}. ` +
              'As aplicações hospedadas nele saíram do proxy e mostram a página de manutenção.',
            'alert',
            true
          ).catch(() => {});
          AuditStore.append({
            action: 'node.unreachable',
            outcome: 'failure',
            target: { type: 'node', id: node.id, name: node.name },
            meta: { consecutiveFailures, error: message },
          });
          await CaddyService.syncCaddyfile().catch(() => {});
        }
      } else {
        dbStorage.saveServerNode(node);
      }

      return node.health;
    }
  }

  /** Probes every registered remote node. */
  static async probeAll(): Promise<void> {
    for (const node of this.getAll()) {
      if (node.isLocal || node.id === LOCAL_NODE_ID) continue;
      await this.probe(node.id).catch((err: any) =>
        console.warn(`Sondagem do nó "${node.name}" falhou:`, err?.message)
      );
    }
  }

  static startProbing(intervalMs = 60_000): void {
    if (this.probeTimer) return;
    this.probeTimer = setInterval(() => {
      this.probeAll().catch(() => {});
    }, intervalMs);
    this.probeTimer.unref();
  }

  static stopProbing(): void {
    if (!this.probeTimer) return;
    clearInterval(this.probeTimer);
    this.probeTimer = null;
  }

  /** True when a node's applications should still receive traffic. */
  static isRoutable(nodeId: string | undefined): boolean {
    if (!nodeId || nodeId === LOCAL_NODE_ID) return true;
    const node = this.getById(nodeId);
    if (!node || node.isLocal) return true;
    // `unknown` routes: it is the state before the first probe, and taking
    // every remote app offline on a panel restart would be self-inflicted.
    return node.status !== 'error';
  }

  /**
   * Ensures an app may be deployed to its configured node.
   *
   * Git/dockerfile clones happen on the panel; docker build and start use this
   * node's daemon over SSH. Image-only apps skip the clone and pull there.
   */
  static async assertDeployTarget(app: {
    nodeId?: string;
    sourceType: string;
    name: string;
  }): Promise<{ nodeId: string; isRemote: boolean }> {
    const nodeId = app.nodeId || LOCAL_NODE_ID;
    const isRemote = Boolean(nodeId && nodeId !== LOCAL_NODE_ID);

    if (!isRemote) {
      return { nodeId: LOCAL_NODE_ID, isRemote: false };
    }

    const node = this.getById(nodeId);
    if (!node) {
      throw new Error(
        `O nó "${nodeId}" configurado na aplicação "${app.name}" não existe mais. Atualize o destino do deploy.`
      );
    }

    const health = await this.checkHealth(nodeId);
    if (!health.reachable || (node.status !== 'online' && node.status !== 'unknown')) {
      // checkHealth already persisted status; refuse when unreachable.
      if (!health.reachable) {
        throw new Error(
          `Nó "${node.name}" indisponível para deploy: ${health.message}`
        );
      }
    }
    if (node.status === 'offline' || node.status === 'error') {
      throw new Error(
        `Nó "${node.name}" está ${node.status}. Só é possível implantar em nós online.`
      );
    }

    return { nodeId, isRemote: true };
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
