import Docker from 'dockerode';
import { PassThrough, Readable } from 'stream';
import { CONFIG } from '../config.js';
import { collectBuildContextFiles } from '../utils/build-context.js';
import { toHostConfigLimits, type ResourceLimits } from '../utils/resource-limits.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  ports: Array<{ ip?: string; privatePort: number; publicPort?: number; type: string }>;
  isPanelManaged?: boolean;
}

class DockerManager {
  private docker: Docker;
  private isAvailable: boolean = false;
  private connectionType: string = 'unknown';

  constructor() {
    this.docker = this.createDefaultClient();
    this.detectAndConnect();
  }

  private createDefaultClient(): Docker {
    return new Docker({ socketPath: CONFIG.DOCKER_SOCKET });
  }

  async detectAndConnect(): Promise<boolean> {
    const candidates: Array<{ name: string; options: Docker.DockerOptions }> = [];

    if (CONFIG.DOCKER_SOCKET) {
      candidates.push({ name: `Configured socket (${CONFIG.DOCKER_SOCKET})`, options: { socketPath: CONFIG.DOCKER_SOCKET } });
    }

    if (CONFIG.IS_WINDOWS) {
      candidates.push(
        { name: 'Windows Named Pipe (docker_engine)', options: { socketPath: '//./pipe/docker_engine' } },
        { name: 'Windows Docker Desktop Linux Pipe', options: { socketPath: '//./pipe/dockerDesktopLinuxEngine' } }
      );
    } else {
      candidates.push(
        { name: 'Linux Socket (/var/run/docker.sock)', options: { socketPath: '/var/run/docker.sock' } },
        ...(process.env.XDG_RUNTIME_DIR
          ? [{ name: 'Rootless Socket', options: { socketPath: `${process.env.XDG_RUNTIME_DIR}/docker.sock` } }]
          : [])
      );
    }

    for (const cand of candidates) {
      try {
        const client = new Docker(cand.options);
        await client.ping();
        this.docker = client;
        this.isAvailable = true;
        this.connectionType = cand.name;
        console.log(`🐳 [Docker Engine] Conectado com sucesso via: ${cand.name}`);
        return true;
      } catch {
        // try next
      }
    }

    this.isAvailable = false;
    this.connectionType = 'offline';
    return false;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.docker.ping();
      this.isAvailable = true;
      return true;
    } catch {
      return this.detectAndConnect();
    }
  }

  getDockerClient(): Docker {
    return this.docker;
  }

  getIsAvailable(): boolean {
    return this.isAvailable;
  }

  getConnectionType(): string {
    return this.connectionType;
  }

  /**
   * Runs a command inside a container through the Docker API.
   *
   * Deliberately not `child_process.exec("docker exec ...")`: that path builds
   * a shell string, so any interpolated value (a SQL statement, a database
   * name) is evaluated by /bin/sh. Here the command is an argv array that the
   * daemon execs directly, and secrets travel in `env` over the socket instead
   * of appearing in the host process list.
   */
  async execInContainer(
    containerId: string,
    cmd: string[],
    options: { env?: string[]; stdin?: string | Buffer; timeoutMs?: number } = {}
  ): Promise<ExecResult> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      Env: options.env,
      AttachStdin: options.stdin !== undefined,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: options.stdin !== undefined });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    stdoutStream.on('data', (c: Buffer) => stdoutChunks.push(c));
    stderrStream.on('data', (c: Buffer) => stderrChunks.push(c));
    this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);

    if (options.stdin !== undefined) {
      Readable.from([Buffer.isBuffer(options.stdin) ? options.stdin : Buffer.from(options.stdin, 'utf-8')]).pipe(stream);
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            stream.destroy();
            reject(new Error(`Comando excedeu o tempo limite de ${options.timeoutMs}ms`));
          }, options.timeoutMs)
        : null;

      stream.on('end', () => {
        if (timeout) clearTimeout(timeout);
        resolve();
      });
      stream.on('error', (err: Error) => {
        if (timeout) clearTimeout(timeout);
        reject(err);
      });
    });

    const inspect = await exec.inspect();

    return {
      stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
      stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      exitCode: inspect.ExitCode ?? 0,
    };
  }

  /**
   * Like execInContainer, but streams stdout straight to a writable stream.
   * Used for database dumps, which can be far larger than a sane in-memory
   * buffer and previously went through a shell redirect.
   */
  async execToStream(
    containerId: string,
    cmd: string[],
    destination: NodeJS.WritableStream,
    options: { env?: string[]; timeoutMs?: number } = {}
  ): Promise<{ stderr: string; exitCode: number }> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      Env: options.env,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    const stderrChunks: Buffer[] = [];
    const stderrStream = new PassThrough();
    stderrStream.on('data', (c: Buffer) => stderrChunks.push(c));
    this.docker.modem.demuxStream(stream, destination, stderrStream);

    await new Promise<void>((resolve, reject) => {
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            stream.destroy();
            reject(new Error(`Comando excedeu o tempo limite de ${options.timeoutMs}ms`));
          }, options.timeoutMs)
        : null;

      stream.on('end', () => {
        if (timeout) clearTimeout(timeout);
        resolve();
      });
      stream.on('error', (err: Error) => {
        if (timeout) clearTimeout(timeout);
        reject(err);
      });
    });

    const inspect = await exec.inspect();
    return {
      stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      exitCode: inspect.ExitCode ?? 0,
    };
  }

  async listImages(client?: Docker): Promise<any[]> {
    try {
      const docker = client || this.docker;
      if (!client) {
        const connected = await this.testConnection();
        if (!connected) return [];
      }
      const images = await docker.listImages();
      return images.map(img => ({
        id: img.Id,
        repoTags: img.RepoTags || [],
        size: img.Size,
        created: img.Created,
      }));
    } catch {
      return [];
    }
  }

  async listContainers(all: boolean = true): Promise<ContainerInfo[]> {
    return this.listContainersFiltered(all, false);
  }

  async listContainersFiltered(all: boolean = true, managedOnly = false): Promise<ContainerInfo[]> {
    try {
      const connected = await this.testConnection();
      if (!connected) return [];

      const containers = await this.docker.listContainers({ all });
      return containers.filter((c) => !managedOnly || c.Labels?.['aegis.managed'] === 'true').map(c => {
        const name = (c.Names[0] || '').replace(/^\//, '');
        const ports = (c.Ports || []).map(p => ({
          ip: p.IP,
          privatePort: p.PrivatePort,
          publicPort: p.PublicPort,
          type: p.Type,
        }));

        return {
          id: c.Id.substring(0, 12),
          name,
          image: c.Image,
          state: c.State,
          status: c.Status,
          created: c.Created,
          ports,
          isPanelManaged: c.Labels ? !!c.Labels['aegis.managed'] : false,
        };
      });
    } catch (err) {
      console.warn('Docker list warning (daemon offline or starting):', (err as Error).message);
      return [];
    }
  }

  /** Returns the allowed workload type, never arbitrary container metadata. */
  async getManagedContainerType(containerId: string): Promise<'app' | 'database' | null> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(containerId)) return null;
    try {
      if (!(await this.testConnection())) return null;
      const info = await this.docker.getContainer(containerId).inspect();
      if (info.Config?.Labels?.['aegis.managed'] !== 'true') return null;
      const type = info.Config?.Labels?.['aegis.type'];
      return type === 'app' || type === 'database' ? type : null;
    } catch {
      return null;
    }
  }

  async isManagedWorkload(containerId: string): Promise<boolean> {
    return (await this.getManagedContainerType(containerId)) !== null;
  }

  /**
   * Runtime state the panel acts on, from a single inspect call.
   *
   * `restartCount` is what makes an OOM event countable: `oomKilled` stays true
   * on the record of the last exit, so it alone cannot tell one kill from the
   * same kill observed ten times. Health is read here too so the watchdog in
   * phase 3.2 needs no second call.
   */
  async inspectRuntime(
    containerId: string,
    client?: Docker
  ): Promise<{
    running: boolean;
    oomKilled: boolean;
    exitCode: number;
    restartCount: number;
    health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
    memoryLimitBytes: number;
  } | null> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(containerId)) return null;
    try {
      const docker = client || this.docker;
      const info = await docker.getContainer(containerId).inspect();
      if (info.Config?.Labels?.['aegis.managed'] !== 'true') return null;
      const state = info.State as typeof info.State & { Health?: { Status?: string } };
      return {
        running: Boolean(state?.Running),
        oomKilled: Boolean(state?.OOMKilled),
        exitCode: Number(state?.ExitCode ?? 0),
        restartCount: Number((info as { RestartCount?: number }).RestartCount ?? 0),
        health: (state?.Health?.Status as 'healthy' | 'unhealthy' | 'starting') || 'none',
        memoryLimitBytes: Number(info.HostConfig?.Memory ?? 0),
      };
    } catch {
      return null;
    }
  }

  async getContainerStats(containerId: string, client?: Docker) {
    const empty = { cpuPercent: 0, memoryUsedBytes: 0, memoryLimitBytes: 0, memoryPercent: 0 };
    try {
      const docker = client || this.docker;
      if (!(await this.isManagedOn(docker, containerId))) {
        throw new Error('Contêiner não gerenciado pelo AegisPanel.');
      }
      const container = docker.getContainer(containerId);
      const statsStream = await container.stats({ stream: false });
      return this.parseContainerStats(statsStream);
    } catch {
      return empty;
    }
  }

  private parseContainerStats(statsStream: {
    cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number; online_cpus?: number };
    precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
    memory_stats: { usage?: number; limit?: number; stats?: { cache?: number } };
  }) {
    const cpuDelta = statsStream.cpu_stats.cpu_usage.total_usage - (statsStream.precpu_stats.cpu_usage.total_usage || 0);
    const systemDelta = statsStream.cpu_stats.system_cpu_usage - (statsStream.precpu_stats.system_cpu_usage || 0);
    const numCores = statsStream.cpu_stats.online_cpus || 1;

    let cpuPercent = 0;
    if (systemDelta > 0 && cpuDelta > 0) {
      cpuPercent = (cpuDelta / systemDelta) * numCores * 100;
    }

    const memUsed = (statsStream.memory_stats.usage || 0) - (statsStream.memory_stats.stats?.cache || 0);
    const memLimit = statsStream.memory_stats.limit || 1;
    const memPercent = (memUsed / memLimit) * 100;

    return {
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryUsedBytes: memUsed,
      memoryLimitBytes: memLimit,
      memoryPercent: Math.round(memPercent * 10) / 10,
    };
  }

  private async isManagedOn(docker: Docker, containerId: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(containerId)) return false;
    try {
      const info = await docker.getContainer(containerId).inspect();
      return info.Config?.Labels?.['aegis.managed'] === 'true';
    } catch {
      return false;
    }
  }

  async startContainer(containerId: string, client?: Docker): Promise<boolean> {
    try {
      const docker = client || this.docker;
      if (!client && !(await this.isManagedWorkload(containerId))) {
        throw new Error('Contêiner não gerenciado pelo AegisPanel.');
      }
      const container = docker.getContainer(containerId);
      await container.start();
      return true;
    } catch (err) {
      console.error(`Failed to start container ${containerId}:`, err);
      throw err;
    }
  }

  async stopContainer(containerId: string, client?: Docker): Promise<boolean> {
    try {
      const docker = client || this.docker;
      if (!client && !(await this.isManagedWorkload(containerId))) {
        throw new Error('Contêiner não gerenciado pelo AegisPanel.');
      }
      const container = docker.getContainer(containerId);
      await container.stop();
      return true;
    } catch (err) {
      console.error(`Failed to stop container ${containerId}:`, err);
      throw err;
    }
  }

  async restartContainer(containerId: string, client?: Docker): Promise<boolean> {
    try {
      const docker = client || this.docker;
      if (!client && !(await this.isManagedWorkload(containerId))) {
        throw new Error('Contêiner não gerenciado pelo AegisPanel.');
      }
      const container = docker.getContainer(containerId);
      await container.restart();
      return true;
    } catch (err) {
      console.error(`Failed to restart container ${containerId}:`, err);
      throw err;
    }
  }

  async removeContainer(containerId: string, force: boolean = true, removeVolumes = false, client?: Docker): Promise<boolean> {
    try {
      const docker = client || this.docker;
      if (!client && !(await this.isManagedWorkload(containerId))) {
        throw new Error('Contêiner não gerenciado pelo AegisPanel.');
      }
      const container = docker.getContainer(containerId);
      await container.remove({ force, ...(removeVolumes ? { v: true } : {}) });
      return true;
    } catch (err) {
      console.error(`Failed to remove container ${containerId}:`, err);
      throw err;
    }
  }

  async getLogs(containerId: string, tail: number = 100, client?: Docker): Promise<string> {
    try {
      const docker = client || this.docker;
      if (!client && !(await this.isManagedWorkload(containerId))) {
        throw new Error('Contêiner não gerenciado pelo AegisPanel.');
      }
      const container = docker.getContainer(containerId);
      const logBuffer = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        timestamps: true,
      });
      return logBuffer.toString('utf-8');
    } catch (err) {
      console.error(`Failed to get logs for ${containerId}:`, err);
      return `Logs unavailable: ${(err as Error).message}`;
    }
  }

  async pullImage(imageName: string, client?: Docker): Promise<void> {
    const docker = client || this.docker;
    return new Promise((resolve, reject) => {
      docker.pull(imageName, (err: any, stream: any) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  async removeContainerByName(name: string, force: boolean = true, client?: Docker): Promise<boolean> {
    try {
      const docker = client || this.docker;
      const container = docker.getContainer(name);
      const info = await container.inspect();
      if (info.Config?.Labels?.['aegis.managed'] !== 'true') return false;
      await container.remove({ force });
      return true;
    } catch (err: any) {
      if (err.statusCode === 404) return false;
      throw err;
    }
  }

  private buildCreateOptions(options: {
    name: string;
    image: string;
    env?: string[];
    ports?: { [internalPort: string]: number };
    volumes?: { [hostPath: string]: string };
    restartPolicy?: string;
    labels?: { [key: string]: string };
    cmd?: string[];
    networkName?: string;
    /**
     * Interface the published ports bind to. Defaults to loopback.
     *
     * Passing '127.0.0.1' is the only way to keep a published port off the
     * internet: Docker writes its rules into the iptables DOCKER chain, which
     * is evaluated before ufw, so `ufw deny` does not block a published port.
     * A firewall that looks correct is not enough.
     */
    bindIp?: string;
    /**
     * Resource ceiling. Absent means the container is created without limits,
     * which is only correct for short-lived helpers (restore drills); every
     * long-running workload passes one.
     */
    limits?: ResourceLimits;
  }): Docker.ContainerCreateOptions {
    const PortBindings: { [key: string]: Array<{ HostIp?: string; HostPort: string }> } = {};
    const ExposedPorts: { [key: string]: object } = {};

    for (const [intPort, hostPort] of Object.entries(options.ports || {})) {
      const portKey = intPort.includes('/') ? intPort : `${intPort}/tcp`;
      ExposedPorts[portKey] = {};
      PortBindings[portKey] = [
        { HostIp: options.bindIp || CONFIG.APP_BIND_IP, HostPort: hostPort.toString() },
      ];
    }

    const Binds: string[] = Object.entries(options.volumes || {}).map(
      ([host, container]) => `${host}:${container}`
    );

    return {
      name: options.name,
      Image: options.image,
      Env: options.env || [],
      ...(options.cmd ? { Cmd: options.cmd } : {}),
      ExposedPorts,
      Labels: {
        'aegis.managed': 'true',
        ...(options.labels || {}),
      },
      HostConfig: {
        PortBindings,
        Binds,
        RestartPolicy: { Name: options.restartPolicy || 'unless-stopped' },
        // Applied here rather than at each call site so a remote node gets the
        // identical HostConfig: this is the only place a managed container is
        // described, and an unlimited container on a node is just as capable of
        // taking that machine down as one on the panel's own host.
        ...(options.limits ? toHostConfigLimits(options.limits) : {}),
        // Joining the panel network at creation lets Caddy reach the container
        // by name immediately, instead of after a second connect call that may
        // land while the first request is already being proxied.
        ...(options.networkName ? { NetworkMode: options.networkName } : {}),
      },
    };
  }

  private async findAegisNetworkName(): Promise<string | undefined> {
    try {
      const nets = await this.docker.listNetworks();
      if (CONFIG.DOCKER_NETWORK) {
        return nets.find((n) => n.Name === CONFIG.DOCKER_NETWORK)?.Name;
      }

      // When production and local stacks coexist, choose the network attached
      // to this instance's Caddy instead of whichever aegis-net happens to be
      // first in Docker's response.
      try {
        const caddyInfo = await this.docker.getContainer(CONFIG.CADDY_CONTAINER).inspect();
        const attached = Object.keys(caddyInfo.NetworkSettings?.Networks || {});
        const caddyNetwork = attached.find((name) => nets.some((network) => network.Name === name && name.includes('aegis-net')));
        if (caddyNetwork) return caddyNetwork;
      } catch {
        // Caddy may not be running yet; use the legacy name fallback below.
      }
      return nets.find((n) => n.Name.includes('aegis-net'))?.Name;
    } catch {
      return undefined;
    }
  }

  /**
   * Removes containers named "<name>-prev-*", left over from a swap that was
   * interrupted before its cleanup ran.
   */
  private async removeStaleBackups(name: string, client?: Docker): Promise<void> {
    const docker = client || this.docker;
    try {
      const containers = await docker.listContainers({ all: true });
      for (const info of containers) {
        const containerName = (info.Names[0] || '').replace(/^\//, '');
        if (containerName.startsWith(`${name}-prev-`) && info.Labels?.['aegis.managed'] === 'true') {
          try {
            await docker.getContainer(info.Id).remove({ force: true });
            console.warn(`Contêiner órfão removido: ${containerName}`);
          } catch (err: any) {
            console.warn(`Não foi possível remover o órfão ${containerName}:`, err.message);
          }
        }
      }
    } catch (err: any) {
      console.warn('Não foi possível varrer contêineres órfãos:', err.message);
    }
  }

  /** Finds which container is publishing one of the given host ports. */
  private async findPortHolder(
    hostPorts: number[],
    client?: Docker
  ): Promise<{ port: number; container: string } | null> {
    const docker = client || this.docker;
    try {
      const containers = await docker.listContainers({ all: false });
      for (const info of containers) {
        for (const p of info.Ports || []) {
          if (p.PublicPort && hostPorts.includes(p.PublicPort)) {
            return { port: p.PublicPort, container: (info.Names[0] || '').replace(/^\//, '') };
          }
        }
      }
    } catch {
      // diagnostics only
    }
    return null;
  }

  /**
   * Builds an image on the given daemon (local socket or remote SSH client).
   *
   * The context is packed on the panel and uploaded to that daemon, so a git
   * deploy targeting a worker never `docker build`s against the panel socket
   * and never starts the resulting container there.
   */
  async buildImage(options: {
    contextDir: string;
    tags: string[];
    buildArgs?: Record<string, string>;
    client?: Docker;
    onOutput?: (chunk: string) => void;
    timeoutMs?: number;
  }): Promise<void> {
    const docker = options.client || this.docker;
    const src = collectBuildContextFiles(options.contextDir);
    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    const primaryTag = options.tags[0];
    if (!primaryTag) throw new Error('Informe ao menos uma tag de imagem.');

    const stream = await docker.buildImage(
      { context: options.contextDir, src },
      {
        t: primaryTag,
        dockerfile: 'Dockerfile',
        buildargs: options.buildArgs && Object.keys(options.buildArgs).length ? options.buildArgs : undefined,
      }
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`docker build excedeu ${Math.round(timeoutMs / 60000)} minutos.`));
      }, timeoutMs);

      docker.modem.followProgress(
        stream as NodeJS.ReadableStream,
        (err: Error | null) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        },
        (event: { stream?: string; status?: string; error?: string; errorDetail?: { message?: string } }) => {
          const line = event.stream || event.status || event.error || event.errorDetail?.message;
          if (line) options.onOutput?.(line);
        }
      );
    });

    for (const extra of options.tags.slice(1)) {
      if (typeof docker.getImage !== 'function') break;
      const lastColon = extra.lastIndexOf(':');
      const repo = lastColon > 0 ? extra.slice(0, lastColon) : extra;
      const tag = lastColon > 0 ? extra.slice(lastColon + 1) : 'latest';
      await docker.getImage(primaryTag).tag({ repo, tag });
    }
  }

  /**
   * Creates and starts a container, replacing any previous one with the same
   * name.
   *
   * The previous container is renamed aside rather than deleted up front: if
   * the new one fails to start (a port taken by another service, a bad image)
   * the old container is restored under its original name. Deleting first
   * meant a failed deploy left the application simply gone.
   */
  async createAndStartContainer(options: {
    name: string;
    image: string;
    env?: string[];
    cmd?: string[];
    ports?: { [internalPort: string]: number };
    volumes?: { [hostPath: string]: string };
    restartPolicy?: string;
    labels?: { [key: string]: string };
    /** '127.0.0.1' keeps the published port off the internet. See buildCreateOptions. */
    bindIp?: string;
    /** Memory / CPU / pid ceiling. See buildCreateOptions. */
    limits?: ResourceLimits;
    /** Remote Docker daemon (SSH). Defaults to the local panel daemon. */
    client?: Docker;
    /**
     * Join the panel's aegis-net so Caddy can reach the container by name.
     * Must stay false on remote nodes — that network does not exist there.
     */
    joinPanelNetwork?: boolean;
  }): Promise<string> {
    const docker = options.client || this.docker;
    // Remote daemons have no panel aegis-net; attaching would fail the create.
    const joinNetwork = options.joinPanelNetwork !== false && !options.client;

    if (!options.client) {
      await this.testConnection();
      if (!this.isAvailable) {
        throw new Error(
          'Docker Engine não está ativo. No Windows, inicie o Docker Desktop. Na VPS Ubuntu, o Docker inicia automaticamente.'
        );
      }
    } else {
      await docker.ping();
    }

    // Ensure the image exists on the target daemon before touching the running container.
    try {
      await docker.getImage(options.image).inspect();
    } catch {
      console.log(`Pulling image ${options.image}...`);
      await this.pullImage(options.image, docker);
    }

    const networkName = joinNetwork ? await this.findAegisNetworkName() : undefined;
    const createOptions = this.buildCreateOptions({ ...options, networkName });

    // Sweep containers left behind by an earlier interrupted swap. Each one
    // still holds the host port binding, so without this a single failed
    // deploy makes the port permanently unavailable.
    await this.removeStaleBackups(options.name, docker);

    const backupName = `${options.name}-prev-${Date.now().toString(36)}`;
    let renamedOld = false;
    let created: Docker.Container | null = null;

    try {
      const existing = docker.getContainer(options.name);
      const existingInfo = await existing.inspect();
      if (existingInfo.Config?.Labels?.['aegis.managed'] !== 'true') {
        throw new Error(`Já existe um contêiner não gerenciado com o nome "${options.name}".`);
      }
      await existing.rename({ name: backupName });
      renamedOld = true;
      try {
        await existing.stop({ t: 10 });
      } catch {
        // already stopped, or stopping while restarting
      }
    } catch (err: any) {
      if (err?.statusCode !== 404) throw err;
      // nothing to replace
    }

    try {
      created = await docker.createContainer(createOptions);
      await created.start();

      if (renamedOld) {
        try {
          await docker.getContainer(backupName).remove({ force: true });
        } catch (err: any) {
          console.warn('Não foi possível remover o contêiner anterior:', err.message);
        }
      }

      return created.id;
    } catch (err: any) {
      // Remove the half-created container first. It holds the target name even
      // when it never started, which would make restoring the previous
      // container fail with a name conflict and leave it stranded under its
      // backup name, still binding the host port.
      if (created) {
        try {
          await created.remove({ force: true });
        } catch (removeErr: any) {
          console.warn('Não foi possível remover o contêiner que falhou:', removeErr.message);
        }
      }

      if (renamedOld) {
        try {
          const old = docker.getContainer(backupName);
          await old.rename({ name: options.name });
          await old.start().catch(() => {});
          console.warn(`Deploy falhou; contêiner anterior "${options.name}" foi restaurado.`);
        } catch (restoreErr: any) {
          console.error('Falha ao restaurar o contêiner anterior:', restoreErr.message);
        }
      }

      if (
        err.message &&
        (err.message.includes('port is already allocated') ||
          err.message.includes('address already in use') ||
          err.message.includes('Ports are not available'))
      ) {
        const hostPorts = Object.values(options.ports || {});
        const holder = await this.findPortHolder(hostPorts, docker);
        throw new Error(
          holder
            ? `A porta do host :${holder.port} já está em uso pelo contêiner "${holder.container}". ` +
              `Pare esse contêiner ou escolha outra porta para esta aplicação.`
            : `A porta do host :${hostPorts.join(', ')} já está em uso por outro serviço nesta máquina. ` +
              `Escolha outra porta (ex: 5000, 5050, 8080) ou libere a atual.`
        );
      }

      console.error('Failed to create and start container:', err);
      throw err;
    }
  }
}

export const dockerService = new DockerManager();
