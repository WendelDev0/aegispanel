import path from 'path';
import fs from 'fs';
import { dbStorage, DatabaseRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { EncryptionService } from '../utils/crypto.js';
import { CONFIG } from '../config.js';
import { containerNameForDatabase } from '../utils/naming.js';
import { PortService } from './port.service.js';

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

  static async createDatabase(dto: CreateDbDTO): Promise<DatabaseRecord> {
    const id = `db-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const containerName = containerNameForDatabase(dto.name);
    // Applications reach the database by container name on the internal port,
    // so the published host port is only needed for external clients and does
    // not have to be chosen by hand.
    const hostPort = await PortService.allocate(dto.port);
    const dataPath = path.join(CONFIG.DATA_DIR, 'databases', dto.name);

    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }

    let image = '';
    let internalPort = 5432;
    let env: string[] = [];
    let connString = '';
    let volumeTarget = '';

    // Generate strong credentials if empty
    const dbUser = dto.dbUser || EncryptionService.generateSecureUsername('usr_db');
    const rawPassword = dto.dbPassword || EncryptionService.generateStrongPassword(24, true);
    const dbName = dto.dbName || dto.name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    switch (dto.type) {
      case 'postgres':
        image = 'postgres:16-alpine';
        internalPort = 5432;
        volumeTarget = '/var/lib/postgresql/data';
        env = [
          `POSTGRES_USER=${dbUser}`,
          `POSTGRES_PASSWORD=${rawPassword}`,
          `POSTGRES_DB=${dbName}`,
        ];
        connString = `postgresql://${dbUser}:${rawPassword}@HOST_IP:${hostPort}/${dbName}`;
        break;

      case 'mysql':
        image = 'mysql:8.4';
        internalPort = 3306;
        volumeTarget = '/var/lib/mysql';
        env = [
          `MYSQL_ROOT_PASSWORD=${rawPassword}`,
          `MYSQL_DATABASE=${dbName}`,
          `MYSQL_USER=${dbUser !== 'root' ? dbUser : 'app_user'}`,
          `MYSQL_PASSWORD=${rawPassword}`,
        ];
        connString = `mysql://${dbUser}:${rawPassword}@HOST_IP:${hostPort}/${dbName}`;
        break;

      case 'mariadb':
        image = 'mariadb:11';
        internalPort = 3306;
        volumeTarget = '/var/lib/mysql';
        env = [
          `MARIADB_ROOT_PASSWORD=${rawPassword}`,
          `MARIADB_DATABASE=${dbName}`,
          `MARIADB_USER=${dbUser !== 'root' ? dbUser : 'app_user'}`,
          `MARIADB_PASSWORD=${rawPassword}`,
        ];
        connString = `mysql://${dbUser}:${rawPassword}@HOST_IP:${hostPort}/${dbName}`;
        break;

      case 'redis':
        image = 'redis:7-alpine';
        internalPort = 6379;
        volumeTarget = '/data';
        env = [];
        connString = `redis://:${rawPassword}@HOST_IP:${hostPort}`;
        break;

      case 'mongodb':
        image = 'mongo:7.0';
        internalPort = 27017;
        volumeTarget = '/data/db';
        env = [
          `MONGO_INITDB_ROOT_USERNAME=${dbUser}`,
          `MONGO_INITDB_ROOT_PASSWORD=${rawPassword}`,
          `MONGO_INITDB_DATABASE=${dbName}`,
        ];
        connString = `mongodb://${dbUser}:${rawPassword}@HOST_IP:${hostPort}/${dbName}?authSource=admin`;
        break;
    }

    const volumes: { [hostPath: string]: string } = {};
    volumes[dataPath] = volumeTarget;

    const ports: { [intPort: string]: number } = {};
    ports[`${internalPort}/tcp`] = hostPort;

    let containerId: string | undefined;
    let status: DatabaseRecord['status'] = 'stopped';

    try {
      containerId = await dockerService.createAndStartContainer({
        name: containerName,
        image,
        env,
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
        await dockerService.removeContainer(db.containerId, true);
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
}
