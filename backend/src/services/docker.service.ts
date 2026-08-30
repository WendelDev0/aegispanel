import Docker from 'dockerode';
import { PassThrough, Readable } from 'stream';
import { CONFIG } from '../config.js';

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
    if (CONFIG.IS_WINDOWS) {
      return new Docker({ socketPath: '//./pipe/docker_engine' });
    }
    return new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async detectAndConnect(): Promise<boolean> {
    const candidates: Array<{ name: string; options: Docker.DockerOptions }> = [];

    if (CONFIG.IS_WINDOWS) {
      candidates.push(
        { name: 'Windows Named Pipe (docker_engine)', options: { socketPath: '//./pipe/docker_engine' } },
        { name: 'Windows Docker Desktop Linux Pipe', options: { socketPath: '//./pipe/dockerDesktopLinuxEngine' } },
        { name: 'Windows TCP (localhost:2375)', options: { host: 'localhost', port: 2375 } },
        { name: 'Windows TCP (127.0.0.1:2375)', options: { host: '127.0.0.1', port: 2375 } }
      );
    } else {
      candidates.push(
        { name: 'Linux Socket (/var/run/docker.sock)', options: { socketPath: '/var/run/docker.sock' } },
        { name: 'Rootless Socket', options: { socketPath: `${process.env.XDG_RUNTIME_DIR || ''}/docker.sock` } }
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
    options: { env?: string[]; stdin?: string; timeoutMs?: number } = {}
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
      Readable.from([Buffer.from(options.stdin, 'utf-8')]).pipe(stream);
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

  async listImages(): Promise<any[]> {
    try {
      const connected = await this.testConnection();
      if (!connected) return [];
      const images = await this.docker.listImages();
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
    try {
      const connected = await this.testConnection();
      if (!connected) return [];

      const containers = await this.docker.listContainers({ all });
      return containers.map(c => {
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

  async getContainerStats(containerId: string) {
    try {
      const container = this.docker.getContainer(containerId);
      const statsStream = await container.stats({ stream: false });

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
    } catch {
      return { cpuPercent: 0, memoryUsedBytes: 0, memoryLimitBytes: 0, memoryPercent: 0 };
    }
  }

  async startContainer(containerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.start();
      return true;
    } catch (err) {
      console.error(`Failed to start container ${containerId}:`, err);
      throw err;
    }
  }

  async stopContainer(containerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop();
      return true;
    } catch (err) {
      console.error(`Failed to stop container ${containerId}:`, err);
      throw err;
    }
  }

  async restartContainer(containerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.restart();
      return true;
    } catch (err) {
      console.error(`Failed to restart container ${containerId}:`, err);
      throw err;
    }
  }

  async removeContainer(containerId: string, force: boolean = true): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force });
      return true;
    } catch (err) {
      console.error(`Failed to remove container ${containerId}:`, err);
      throw err;
    }
  }

  async getLogs(containerId: string, tail: number = 100): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);
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

  async pullImage(imageName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(imageName, (err: any, stream: any) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, (err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  async removeContainerByName(name: string, force: boolean = true): Promise<boolean> {
    try {
      await this.docker.getContainer(name).remove({ force });
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
    networkName?: string;
  }): Docker.ContainerCreateOptions {
    const PortBindings: { [key: string]: Array<{ HostPort: string }> } = {};
    const ExposedPorts: { [key: string]: object } = {};

    for (const [intPort, hostPort] of Object.entries(options.ports || {})) {
      const portKey = intPort.includes('/') ? intPort : `${intPort}/tcp`;
      ExposedPorts[portKey] = {};
      PortBindings[portKey] = [{ HostPort: hostPort.toString() }];
    }

    const Binds: string[] = Object.entries(options.volumes || {}).map(
      ([host, container]) => `${host}:${container}`
    );

    return {
      name: options.name,
      Image: options.image,
      Env: options.env || [],
      ExposedPorts,
      Labels: {
        'aegis.managed': 'true',
        ...(options.labels || {}),
      },
      HostConfig: {
        PortBindings,
        Binds,
        RestartPolicy: { Name: options.restartPolicy || 'unless-stopped' },
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
      return nets.find((n) => n.Name.includes('aegis-net'))?.Name;
    } catch {
      return undefined;
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
    ports?: { [internalPort: string]: number };
    volumes?: { [hostPath: string]: string };
    restartPolicy?: string;
    labels?: { [key: string]: string };
  }): Promise<string> {
    await this.testConnection();
    if (!this.isAvailable) {
      throw new Error(
        'Docker Engine não está ativo. No Windows, inicie o Docker Desktop. Na VPS Ubuntu, o Docker inicia automaticamente.'
      );
    }

    // Ensure the image exists locally before touching the running container.
    try {
      await this.docker.getImage(options.image).inspect();
    } catch {
      console.log(`Pulling image ${options.image}...`);
      await this.pullImage(options.image);
    }

    const networkName = await this.findAegisNetworkName();
    const createOptions = this.buildCreateOptions({ ...options, networkName });

    const backupName = `${options.name}-prev-${Date.now().toString(36)}`;
    let renamedOld = false;

    try {
      const existing = this.docker.getContainer(options.name);
      await existing.inspect();
      await existing.rename({ name: backupName });
      renamedOld = true;
      try {
        await existing.stop({ t: 10 });
      } catch {
        // already stopped
      }
    } catch {
      // nothing to replace
    }

    try {
      const container = await this.docker.createContainer(createOptions);
      await container.start();

      if (renamedOld) {
        try {
          await this.docker.getContainer(backupName).remove({ force: true });
        } catch (err: any) {
          console.warn('Não foi possível remover o contêiner anterior:', err.message);
        }
      }

      return container.id;
    } catch (err: any) {
      // Roll back to the previous container so a failed deploy does not take
      // the application offline.
      if (renamedOld) {
        try {
          const old = this.docker.getContainer(backupName);
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
        throw new Error(
          'A porta do host já está em uso por outro serviço na sua máquina (ex: painel ou outro contêiner). Altere a porta da aplicação para 5000, 5050 ou 8080.'
        );
      }

      console.error('Failed to create and start container:', err);
      throw err;
    }
  }
}

export const dockerService = new DockerManager();
