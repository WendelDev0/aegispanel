import fs from 'fs';
import { dbStorage, DatabaseRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { EncryptionService } from '../utils/crypto.js';
import { CONFIG } from '../config.js';
import { containerNameForDatabase } from '../utils/naming.js';
import { PortService } from './port.service.js';
import { clampDbLimits, toDockerResources } from '../utils/resource-limits.js';

export interface CreateDbDTO {
  name: string;
  type: 'postgres' | 'mysql' | 'mariadb' | 'redis' | 'mongodb';
  /** Omit to have a free host port assigned automatically. */
  port?: number;
  dbUser?: string;
  dbPassword?: string;
  dbName?: string;
  withGui?: boolean;
}

export class DatabaseService {
  private static dbResources() {
    return toDockerResources(clampDbLimits(undefined, dbStorage.getSettings().defaultDbLimits));
  }
  /**
   * Lists databases without their credentials.
   *
   * The previous implementation decrypted every password and returned it in
   * the list response, so the plaintext of every database reached the browser
   * on each page load. Credentials are now fetched explicitly, one record at a
   * time, through getCredentials().
   */
  static getAll(): DatabaseRecord[] {
    return dbStorage.getDatabases().map((db) => ({
      ...db,
      dbPassword: '',
      connectionString: db.connectionString.replace(/:\/\/([^:]+):([^@]*)@/, '://$1:***@'),
    }));
  }

  /**
   * Builds a connection URI for a given host and port.
   * Single definition so the host-facing and container-facing strings cannot
   * drift apart in format.
   */
  private static buildUri(
    db: Pick<DatabaseRecord, 'type' | 'dbUser' | 'dbName'>,
    host: string,
    port: number,
    password: string
  ): string {
    const user = encodeURIComponent(db.dbUser);
    const pass = encodeURIComponent(password);

    switch (db.type) {
      case 'postgres':
        return `postgresql://${user}:${pass}@${host}:${port}/${db.dbName}`;
      case 'mysql':
      case 'mariadb':
        return `mysql://${user}:${pass}@${host}:${port}/${db.dbName}`;
      case 'redis':
        return `redis://:${pass}@${host}:${port}`;
      case 'mongodb':
        return `mongodb://${user}:${pass}@${host}:${port}/${db.dbName}?authSource=admin`;
      default:
        return `${db.type}://${user}:${pass}@${host}:${port}/${db.dbName}`;
    }
  }

  /** Conventional environment variable name for each engine. */
  private static envVarName(type: DatabaseRecord['type']): string {
    switch (type) {
      case 'redis':
        return 'REDIS_URL';
      case 'mongodb':
        return 'MONGODB_URI';
      default:
        return 'DATABASE_URL';
    }
  }

  /** Returns the decrypted credentials for a single database. */
  static getCredentials(id: string): {
    dbUser: string;
    dbPassword: string;
    dbName: string;
    containerName: string;
    internalPort: number;
    hostPort: number;
    connectionString: string;
    internalConnectionString: string;
    envVarName: string;
    envLine: string;
  } {
    const db = dbStorage.getDatabaseById(id);
    if (!db) throw new Error('Banco de dados não encontrado');

    const password = EncryptionService.tryDecrypt(db.dbPassword);
    if (password === null) {
      throw new Error(
        'Não foi possível descriptografar a senha deste banco. A ENCRYPTION_KEY do servidor mudou desde que o registro foi criado.'
      );
    }

    const containerName = containerNameForDatabase(db.name);
    const envVarName = this.envVarName(db.type);

    // Container-to-container URI. Applications deployed by the panel share the
    // aegis network with their databases, so addressing the container by name
    // on its internal port keeps the traffic off the host and stays correct if
    // the published host port is ever changed.
    const internalConnectionString = this.buildUri(db, containerName, db.internalPort, password);

    // Host-facing URI, for connecting from outside Docker (a local client, a
    // migration run from a laptop). HOST_IP is substituted by the frontend.
    const connectionString = db.connectionString.includes('***ENCRYPTED***')
      ? db.connectionString.replace('***ENCRYPTED***', password)
      : this.buildUri(db, 'HOST_IP', db.port, password);

    return {
      dbUser: db.dbUser,
      dbPassword: password,
      dbName: db.dbName,
      containerName,
      internalPort: db.internalPort,
      hostPort: db.port,
      connectionString,
      internalConnectionString,
      envVarName,
      envLine: `${envVarName}=${internalConnectionString}`,
    };
  }

  static getCredentialsSuggestion(type: string = 'postgres') {
    const prefix = type === 'postgres' ? 'pg' : type === 'mysql' ? 'my' : type === 'redis' ? 'red' : 'mg';
    return {
      suggestedUsername: EncryptionService.generateSecureUsername(`usr_${prefix}`),
      suggestedPassword: EncryptionService.generateStrongPassword(24, true),
      suggestedDbName: EncryptionService.generateDbName(`app_${prefix}`),
    };
  }

  /**
   * Image, env and volume path for one engine. Shared by create, disaster
   * recovery recreate, and restore drills so a DR restore cannot start a
   * different image than the panel originally used.
   *
   * `dbPassword` must already be plaintext.
   */
  static engineLaunch(db: Pick<DatabaseRecord, 'type' | 'dbUser' | 'dbPassword' | 'dbName'>): {
    image: string;
    env: string[];
    cmd?: string[];
    internalPort: number;
    volumeTarget: string;
  } {
    const mysqlUser = db.dbUser !== 'root' ? db.dbUser : 'app_user';
    switch (db.type) {
      case 'postgres':
        return {
          image: 'postgres:16-alpine',
          env: [
            `POSTGRES_USER=${db.dbUser}`,
            `POSTGRES_PASSWORD=${db.dbPassword}`,
            `POSTGRES_DB=${db.dbName}`,
          ],
          internalPort: 5432,
          volumeTarget: '/var/lib/postgresql/data',
        };
      case 'mysql':
        return {
          image: 'mysql:8.4',
          env: [
            `MYSQL_ROOT_PASSWORD=${db.dbPassword}`,
            `MYSQL_DATABASE=${db.dbName}`,
            `MYSQL_USER=${mysqlUser}`,
            `MYSQL_PASSWORD=${db.dbPassword}`,
          ],
          internalPort: 3306,
          volumeTarget: '/var/lib/mysql',
        };
      case 'mariadb':
        return {
          image: 'mariadb:11',
          env: [
            `MARIADB_ROOT_PASSWORD=${db.dbPassword}`,
            `MARIADB_DATABASE=${db.dbName}`,
            `MARIADB_USER=${mysqlUser}`,
            `MARIADB_PASSWORD=${db.dbPassword}`,
          ],
          internalPort: 3306,
          volumeTarget: '/var/lib/mysql',
        };
      case 'redis':
        return {
          image: 'redis:7-alpine',
          env: [],
          cmd: ['redis-server', '--requirepass', db.dbPassword],
          internalPort: 6379,
          volumeTarget: '/data',
        };
      case 'mongodb':
        return {
          image: 'mongo:7.0',
          env: [
            `MONGO_INITDB_ROOT_USERNAME=${db.dbUser}`,
            `MONGO_INITDB_ROOT_PASSWORD=${db.dbPassword}`,
            `MONGO_INITDB_DATABASE=${db.dbName}`,
          ],
          internalPort: 27017,
          volumeTarget: '/data/db',
        };
      default:
        throw new Error(`Tipo de banco não suportado: ${db.type}`);
    }
  }

  static hostConnectionString(
    db: Pick<DatabaseRecord, 'type' | 'dbUser' | 'dbName'>,
    password: string,
    hostPort: number
  ): string {
    switch (db.type) {
      case 'postgres':
        return `postgresql://${db.dbUser}:${password}@HOST_IP:${hostPort}/${db.dbName}`;
      case 'mysql':
      case 'mariadb':
        return `mysql://${db.dbUser}:${password}@HOST_IP:${hostPort}/${db.dbName}`;
      case 'redis':
        return `redis://:${password}@HOST_IP:${hostPort}`;
      case 'mongodb':
        return `mongodb://${db.dbUser}:${password}@HOST_IP:${hostPort}/${db.dbName}?authSource=admin`;
      default:
        throw new Error(`Tipo de banco não suportado: ${db.type}`);
    }
  }

  /**
   * Recreates an existing panel database container from its record (same
   * image/env as create). Used by disaster recovery after importState.
   */
  static async recreateContainer(db: DatabaseRecord): Promise<string> {
    const password = EncryptionService.decrypt(db.dbPassword);
    const launch = this.engineLaunch({ ...db, dbPassword: password });
    const containerName = containerNameForDatabase(db.name);
    const containerId = await dockerService.createAndStartContainer({
      name: containerName,
      image: launch.image,
      env: launch.env,
      ...(launch.cmd ? { cmd: launch.cmd } : {}),
      ports: { [`${launch.internalPort}/tcp`]: db.port },
      bindIp: CONFIG.DB_BIND_IP,
      volumes: { [`aegis-db-${db.id}`]: launch.volumeTarget },
      resources: this.dbResources(),
      labels: {
        'aegis.type': 'database',
        'aegis.db.type': db.type,
        'aegis.db.name': db.name,
      },
    });
    db.containerId = containerId;
    db.status = 'running';
    db.internalPort = launch.internalPort;
    dbStorage.saveDatabase(db);
    return containerId;
  }

  /**
   * Starts a throwaway engine with no published ports. Restore drills must
   * never bind the live database's host port.
   */
  static async startEphemeral(
    db: Pick<DatabaseRecord, 'type' | 'dbUser' | 'dbPassword' | 'dbName'>,
    name: string
  ): Promise<string> {
    const password = EncryptionService.isEncrypted(db.dbPassword)
      ? EncryptionService.decrypt(db.dbPassword)
      : db.dbPassword;
    const launch = this.engineLaunch({ ...db, dbPassword: password });
    return dockerService.createAndStartContainer({
      name,
      image: launch.image,
      env: launch.env,
      ...(launch.cmd ? { cmd: launch.cmd } : {}),
      restartPolicy: 'no',
      joinPanelNetwork: false,
      resources: this.dbResources(),
      labels: { 'aegis.type': 'restore-drill' },
    });
  }

  static async pingInContainer(
    containerId: string,
    db: Pick<DatabaseRecord, 'type' | 'dbUser' | 'dbPassword'>
  ): Promise<void> {
    const password = EncryptionService.isEncrypted(db.dbPassword)
      ? EncryptionService.decrypt(db.dbPassword)
      : db.dbPassword;
    let cmd: string[];
    switch (db.type) {
      case 'postgres':
        cmd = ['pg_isready', '-U', db.dbUser];
        break;
      case 'mysql':
        cmd = ['mysqladmin', 'ping', '-h', '127.0.0.1'];
        break;
      case 'mariadb':
        cmd = ['healthcheck.sh', '--connect'];
        break;
      case 'mongodb':
        cmd = ['mongosh', '--quiet', '--eval', 'db.adminCommand("ping")'];
        break;
      case 'redis':
        cmd = ['redis-cli', '-a', password, 'ping'];
        break;
      default:
        throw new Error(`Ping não suportado para ${db.type}`);
    }
    const result = await dockerService.execInContainer(containerId, cmd, { timeoutMs: 10_000 });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Ping falhou com código ${result.exitCode}`);
    }
  }

  static async waitUntilReady(
    containerId: string,
    db: Pick<DatabaseRecord, 'type' | 'dbUser' | 'dbPassword'>,
    timeoutMs = 90_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = 'ainda não respondeu';
    while (Date.now() < deadline) {
      try {
        await this.pingInContainer(containerId, db);
        return;
      } catch (err: any) {
        last = err.message || String(err);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    throw new Error(`O engine não ficou pronto a tempo: ${last}`);
  }

  static async createDatabase(dto: CreateDbDTO): Promise<DatabaseRecord> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(dto.name)) {
      throw new Error('Nome do banco inválido. Use apenas letras, números, ponto, hífen ou sublinhado.');
    }
    const id = `db-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const containerName = containerNameForDatabase(dto.name);
    // Applications reach the database by container name on the internal port,
    // so the published host port is only needed for external clients and does
    // not have to be chosen by hand.
    const hostPort = await PortService.allocate(dto.port);
    // The Docker daemon resolves bind paths on the host, not inside the
    // backend container. A named volume avoids mounting a path such as
    // /app/data/... on the wrong filesystem and keeps persistence portable.
    const dataVolume = `aegis-db-${id}`;

    const dbUser = dto.dbUser || EncryptionService.generateSecureUsername('usr_db');
    const rawPassword = dto.dbPassword || EncryptionService.generateStrongPassword(24, true);
    const dbName = dto.dbName || dto.name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const launch = this.engineLaunch({
      type: dto.type,
      dbUser,
      dbPassword: rawPassword,
      dbName,
    });
    const image = launch.image;
    const internalPort = launch.internalPort;
    const env = launch.env;
    const cmd = launch.cmd;
    const volumeTarget = launch.volumeTarget;
    const connString = this.hostConnectionString(
      { type: dto.type, dbUser, dbName },
      rawPassword,
      hostPort
    );

    const volumes: { [hostPath: string]: string } = {};
    volumes[dataVolume] = volumeTarget;

    const ports: { [intPort: string]: number } = {};
    ports[`${internalPort}/tcp`] = hostPort;

    let containerId: string | undefined;
    let status: DatabaseRecord['status'] = 'stopped';

    try {
      containerId = await dockerService.createAndStartContainer({
        name: containerName,
        image,
        env,
        ...(cmd ? { cmd } : {}),
        ports,
        // Databases bind to loopback only. Docker's iptables rules are
        // evaluated before ufw, so a port published on 0.0.0.0 is reachable
        // from the internet no matter what the firewall says - and a database
        // on the public internet is scanned within minutes. Applications reach
        // it by container name on the shared network, which does not need a
        // published port at all; this one exists for local tools and for an
        // SSH tunnel.
        bindIp: CONFIG.DB_BIND_IP,
        volumes,
        resources: this.dbResources(),
        labels: {
          'aegis.type': 'database',
          'aegis.db.type': dto.type,
          'aegis.db.name': dto.name,
        },
      });
      status = 'running';
    } catch (err) {
      console.error('Could not create Docker container directly (saved as registered):', err);
      status = 'stopped';
    }

    // Encrypt password with AES-256-GCM before saving to disk!
    const encryptedPassword = EncryptionService.encrypt(rawPassword);

    const record: DatabaseRecord = {
      id,
      name: dto.name,
      type: dto.type,
      containerId,
      port: hostPort,
      internalPort,
      dbUser,
      dbPassword: encryptedPassword, // Stored encrypted in JSON file
      dbName,
      status,
      // The password is replaced by a placeholder before the record is written.
      // Storing the connection string verbatim would keep a cleartext copy of
      // the very secret the field above is encrypted to protect, in the same
      // file, defeating the encryption entirely. getCredentials() substitutes
      // the decrypted value back in on read.
      connectionString: connString.replace(rawPassword, '***ENCRYPTED***'),
      withGui: dto.withGui,
      createdAt: new Date().toISOString(),
    };

    dbStorage.saveDatabase(record);

    // The full credentials are returned once, to the session that created the
    // database, so the user can copy them.
    return {
      ...record,
      dbPassword: rawPassword,
      connectionString: connString,
    };
  }

  static async deleteDatabase(id: string): Promise<boolean> {
    const db = dbStorage.getDatabaseById(id);
    if (!db) return false;

    if (db.containerId) {
      try {
        await dockerService.removeContainer(db.containerId, true, true);
      } catch (err) {
        console.error('Error removing container:', err);
      }
    }

    return dbStorage.removeDatabase(id);
  }

  static async startDatabase(id: string): Promise<DatabaseRecord> {
    const db = dbStorage.getDatabaseById(id);
    if (!db) throw new Error('Database not found');

    if (db.containerId) {
      await dockerService.startContainer(db.containerId);
      db.status = 'running';
      const saved = dbStorage.saveDatabase(db);
      return { ...saved, dbPassword: '' };
    }
    throw new Error('No container associated');
  }

  static async stopDatabase(id: string): Promise<DatabaseRecord> {
    const db = dbStorage.getDatabaseById(id);
    if (!db) throw new Error('Database not found');

    if (db.containerId) {
      await dockerService.stopContainer(db.containerId);
      db.status = 'stopped';
      const saved = dbStorage.saveDatabase(db);
      return { ...saved, dbPassword: '' };
    }
    throw new Error('No container associated');
  }

  static async restartDatabase(id: string): Promise<DatabaseRecord> {
    const db = dbStorage.getDatabaseById(id);
    if (!db) throw new Error('Database not found');

    if (db.containerId) {
      await dockerService.restartContainer(db.containerId);
      db.status = 'running';
      const saved = dbStorage.saveDatabase(db);
      return { ...saved, dbPassword: '' };
    }
    throw new Error('No container associated');
  }

  static async getSupabaseHub(host = ''): Promise<any> {
    const envPath = '/opt/supabase/docker/.env';
    let content = '';

    if (fs.existsSync(envPath)) {
      try {
        content = fs.readFileSync(envPath, 'utf8');
      } catch (e) {
        // ignore
      }
    }

    // Default or parsed values
    const getVal = (k: string, fallback: string = '') => {
      const m = content.match(new RegExp(`^${k}=(.*)$`, 'm'));
      return m ? m[1].trim() : fallback;
    };

    let isRunning = false;
    let services: { name: string; status: string; healthy: boolean }[] = [];

    try {
      const allContainers = await dockerService.listContainers(true);
      const supabaseContainers = allContainers.filter(
        c => c.name.toLowerCase().includes('supabase') || c.name.toLowerCase().includes('realtime')
      );
      if (supabaseContainers.length > 0) {
        isRunning = supabaseContainers.some(c => c.state === 'running');
        services = supabaseContainers.map(c => ({
          name: c.name.replace(/^\//, ''),
          status: c.status,
          healthy: c.state === 'running',
        }));
      }
    } catch {
      // ignore
    }

    const isInstalled = fs.existsSync(envPath) || fs.existsSync('/opt/supabase') || services.length > 0;
    const publicHost = CONFIG.SUPABASE_PUBLIC_HOST || host.trim();
    if (!publicHost || !content) {
      return {
        installed: false,
        configured: false,
        running: isRunning,
        services,
      };
    }

    const anonKey = getVal('ANON_KEY');
    const serviceRoleKey = getVal('SERVICE_ROLE_KEY');
    const postgresPassword = getVal('POSTGRES_PASSWORD');
    const dashboardPassword = getVal('DASHBOARD_PASSWORD');
    const dashboardUser = getVal('DASHBOARD_USERNAME');
    const organization = getVal('STUDIO_DEFAULT_ORGANIZATION');
    const project = getVal('STUDIO_DEFAULT_PROJECT');

    if (!anonKey || !serviceRoleKey || !postgresPassword || !dashboardPassword) {
      return {
        installed: false,
        configured: false,
        running: isRunning,
        services,
      };
    }

    const cleanHost = publicHost.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    const targetHost = cleanHost;
    const scheme = CONFIG.LOCAL_MODE ? 'http' : 'https';
    const studioUrl = `${scheme}://${targetHost}${CONFIG.LOCAL_MODE ? ':8000' : ''}/`;
    const apiUrl = `${scheme}://${targetHost}${CONFIG.LOCAL_MODE ? ':8000' : ''}`;
    const connectionString = `postgresql://postgres:${postgresPassword}@${targetHost}:5432/postgres`;

    return {
      installed: isInstalled,
      configured: true,
      running: isRunning,
      studioUrl,
      apiUrl,
      dashboardUser,
      dashboardPassword,
      anonKey,
      serviceRoleKey,
      postgresPort: 5432,
      postgresUser: 'postgres',
      postgresPassword,
      postgresDb: 'postgres',
      connectionString,
      organization,
      project,
      services,
    };
  }
}
