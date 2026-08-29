import Docker from 'dockerode';
import { CONFIG } from '../config.js';

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

    try {
      // Ensure image exists
      try {
        await this.docker.getImage(options.image).inspect();
      } catch {
        console.log(`Pulling image ${options.image}...`);
        await this.pullImage(options.image);
      }

      const PortBindings: { [key: string]: Array<{ HostPort: string }> } = {};
      const ExposedPorts: { [key: string]: object } = {};

      if (options.ports) {
        for (const [intPort, hostPort] of Object.entries(options.ports)) {
          const portKey = intPort.includes('/') ? intPort : `${intPort}/tcp`;
          ExposedPorts[portKey] = {};
          PortBindings[portKey] = [{ HostPort: hostPort.toString() }];
        }
      }

      const Binds: string[] = [];
      if (options.volumes) {
        for (const [host, container] of Object.entries(options.volumes)) {
          Binds.push(`${host}:${container}`);
        }
      }

      const container = await this.docker.createContainer({
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
          RestartPolicy: {
            Name: options.restartPolicy || 'unless-stopped',
          },
        },
      });

      await container.start();
      return container.id;
    } catch (err) {
      console.error('Failed to create and start container:', err);
      throw err;
    }
  }
}

export const dockerService = new DockerManager();
