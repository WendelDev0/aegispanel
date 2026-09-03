import fs from 'fs';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { CONFIG } from '../config.js';
import { dbStorage, BackupTarget } from '../db/storage.js';
import { EncryptionService } from '../utils/crypto.js';
import { groupByPrefix, keysToDelete, type DatedObject } from '../utils/backup-retention.js';

const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;
const TEST_OBJECT_KEY = '.aegis-offsite-probe';

export interface RemoteObject {
  key: string;
  sizeBytes: number;
  lastModified: string;
  sha256?: string;
}

export interface OffsiteBackend {
  put(key: string, filePath: string, sha256: string): Promise<void>;
  get(key: string, destPath: string): Promise<void>;
  head(key: string): Promise<{ sizeBytes: number; sha256?: string }>;
  list(prefix: string): Promise<DatedObject[]>;
  delete(key: string): Promise<void>;
}

const MASK = '••••••••';

export class MemoryOffsiteBackend implements OffsiteBackend {
  readonly objects = new Map<string, { body: Buffer; sha256: string; lastModified: Date }>();

  async put(key: string, filePath: string, sha256: string): Promise<void> {
    this.objects.set(key, {
      body: fs.readFileSync(filePath),
      sha256,
      lastModified: new Date(),
    });
  }

  async get(key: string, destPath: string): Promise<void> {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`Objeto não encontrado: ${key}`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, obj.body, { mode: 0o600 });
  }

  async head(key: string): Promise<{ sizeBytes: number; sha256?: string }> {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`Objeto não encontrado: ${key}`);
    return { sizeBytes: obj.body.length, sha256: obj.sha256 };
  }

  async list(prefix: string): Promise<DatedObject[]> {
    const out: DatedObject[] = [];
    for (const [key, obj] of this.objects) {
      if (key.startsWith(prefix)) {
        out.push({ key, lastModified: obj.lastModified, sizeBytes: obj.body.length });
      }
    }
    return out;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

class S3OffsiteBackend implements OffsiteBackend {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string
  ) {}

  async put(key: string, filePath: string, sha256: string): Promise<void> {
    const size = fs.statSync(filePath).size;
    if (size > MULTIPART_THRESHOLD) {
      await this.putMultipart(key, filePath, sha256, size);
      return;
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentLength: size,
        Metadata: { sha256 },
      })
    );
  }

  private async putMultipart(key: string, filePath: string, sha256: string, size: number): Promise<void> {
    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        Metadata: { sha256 },
      })
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw new Error('S3 recusou o upload multipart.');
    const parts: CompletedPart[] = [];
    const fd = fs.openSync(filePath, 'r');
    try {
      let partNumber = 1;
      let offset = 0;
      while (offset < size) {
        const len = Math.min(PART_SIZE, size - offset);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, offset);
        const uploaded = await this.client.send(
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: buf,
          })
        );
        parts.push({ ETag: uploaded.ETag, PartNumber: partNumber });
        offset += len;
        partNumber++;
      }
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        })
      );
    } catch (err) {
      await this.client
        .send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }))
        .catch(() => undefined);
      throw err;
    } finally {
      fs.closeSync(fd);
    }
  }

  async get(key: string, destPath: string): Promise<void> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error('Objeto S3 sem corpo.');
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const out = fs.createWriteStream(destPath, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const body = res.Body as NodeJS.ReadableStream;
      body.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      body.pipe(out);
    });
  }

  async head(key: string): Promise<{ sizeBytes: number; sha256?: string }> {
    const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      sizeBytes: res.ContentLength ?? 0,
      sha256: res.Metadata?.sha256,
    };
  }

  async list(prefix: string): Promise<DatedObject[]> {
    const out: DatedObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        })
      );
      for (const obj of res.Contents || []) {
        if (!obj.Key || !obj.LastModified) continue;
        out.push({
          key: obj.Key,
          lastModified: obj.LastModified,
          sizeBytes: obj.Size ?? 0,
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export class OffsiteService {
  private static testBackend: OffsiteBackend | null = null;

  static useBackendForTests(backend: OffsiteBackend | null): void {
    this.testBackend = backend;
  }

  static offsiteAllowed(): boolean {
    if (!CONFIG.LOCAL_MODE) return true;
    return CONFIG.ALLOW_OFFSITE_BACKUP;
  }

  static rawTarget(): BackupTarget | undefined {
    return dbStorage.getSettings().backupTarget;
  }

  static resolvedTarget(): BackupTarget | null {
    const target = this.rawTarget();
    if (!target?.bucket || !target.accessKeyId || !target.secretAccessKey) return null;
    const secret = EncryptionService.tryDecrypt(target.secretAccessKey);
    if (!secret) return null;
    return { ...target, secretAccessKey: secret };
  }

  static toPublic(target: BackupTarget | undefined) {
    if (!target) return null;
    return {
      provider: target.provider,
      endpoint: target.endpoint || '',
      region: target.region || '',
      bucket: target.bucket || '',
      prefix: target.prefix || '',
      accessKeyId: target.accessKeyId || '',
      hasSecret: Boolean(target.secretAccessKey),
      secretAccessKey: target.secretAccessKey ? MASK : '',
      lastUploadAt: target.lastUploadAt,
      lastError: target.lastError,
    };
  }

  static parseS3Uri(uri: string): { bucket: string; prefix: string } {
    const trimmed = uri.trim();
    const match = /^s3:\/\/([^/]+)(?:\/(.*))?$/i.exec(trimmed);
    if (!match) {
      throw new Error('URI inválida. Use s3://bucket/prefix');
    }
    return {
      bucket: match[1],
      prefix: (match[2] || '').replace(/^\/+|\/+$/g, ''),
    };
  }

  static parseRemoteKey(key: string): { kind: 'panel' | 'db'; dbId?: string; filename: string } {
    const parts = key.split('/').filter(Boolean);
    const base = parts[parts.length - 1] || '';
    if (base.includes('..') || parts.some((p) => p === '..')) {
      throw new Error('Chave remota inválida.');
    }
    const filename = base.endsWith('.enc') ? base.slice(0, -4) : base;
    const panelIdx = parts.indexOf('panel');
    const dbIdx = parts.indexOf('db');
    if (panelIdx >= 0) return { kind: 'panel', filename };
    if (dbIdx >= 0 && parts[dbIdx + 1]) return { kind: 'db', dbId: parts[dbIdx + 1], filename };
    throw new Error('Chave remota não reconhecida (esperado .../panel/... ou .../db/<id>/...).');
  }

  static s3BackendFromEnv(bucket: string): OffsiteBackend {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Defina AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY no ambiente para o restore offsite.');
    }
    const client = new S3Client({
      region: process.env.AWS_REGION || 'auto',
      endpoint: process.env.AWS_ENDPOINT_URL || undefined,
      forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL),
      credentials: { accessKeyId, secretAccessKey },
    });
    return new S3OffsiteBackend(client, bucket);
  }

  static saveTarget(input: Partial<BackupTarget>): BackupTarget {
    const current = this.rawTarget() || {
      provider: 's3' as const,
      region: '',
      bucket: '',
      accessKeyId: '',
    };
    const incomingSecret = input.secretAccessKey;
    const secret =
      !incomingSecret || incomingSecret === MASK
        ? current.secretAccessKey
        : EncryptionService.isEncrypted(incomingSecret)
          ? incomingSecret
          : EncryptionService.encrypt(incomingSecret);
    const next: BackupTarget = {
      provider: 's3',
      endpoint: input.endpoint !== undefined ? input.endpoint : current.endpoint,
      region: input.region !== undefined ? input.region : current.region,
      bucket: input.bucket !== undefined ? input.bucket : current.bucket,
      prefix: input.prefix !== undefined ? input.prefix : current.prefix,
      accessKeyId: input.accessKeyId !== undefined ? input.accessKeyId : current.accessKeyId,
      secretAccessKey: secret,
      lastUploadAt: current.lastUploadAt,
      lastError: current.lastError,
    };
    dbStorage.updateSettings({ backupTarget: next });
    return next;
  }

  static objectKey(kind: 'panel' | 'db', filename: string, dbId?: string): string {
    const target = this.rawTarget();
    const prefix = (target?.prefix || 'aegis').replace(/^\/+|\/+$/g, '');
    const base = path.basename(filename);
    if (kind === 'panel') return `${prefix}/panel/${base}.enc`;
    return `${prefix}/db/${dbId || 'unknown'}/${base}.enc`;
  }

  static prefixRoot(): string {
    const target = this.rawTarget();
    return (target?.prefix || 'aegis').replace(/^\/+|\/+$/g, '');
  }

  private static backend(): OffsiteBackend {
    if (this.testBackend) return this.testBackend;
    const target = this.resolvedTarget();
    if (!target) throw new Error('Destino offsite não configurado.');
    const client = new S3Client({
      region: target.region || 'auto',
      endpoint: target.endpoint || undefined,
      forcePathStyle: Boolean(target.endpoint),
      credentials: {
        accessKeyId: target.accessKeyId,
        secretAccessKey: target.secretAccessKey || '',
      },
    });
    return new S3OffsiteBackend(client, target.bucket);
  }

  static async uploadFile(localPath: string, key: string): Promise<{ sha256: string }> {
    if (!this.offsiteAllowed()) {
      throw new Error('Upload offsite bloqueado no modo local. Defina AEGIS_ALLOW_OFFSITE_BACKUP=true para permitir.');
    }
    const encPath = `${localPath}.enc`;
    try {
      await EncryptionService.encryptFile(localPath, encPath);
      const sha256 = await EncryptionService.sha256File(encPath);
      const backend = this.backend();
      await backend.put(key, encPath, sha256);
      const head = await backend.head(key);
      if (head.sha256 && head.sha256 !== sha256) {
        throw new Error('Checksum SHA-256 do objeto no bucket não confere com o arquivo enviado.');
      }
      return { sha256 };
    } finally {
      try {
        if (fs.existsSync(encPath)) fs.unlinkSync(encPath);
      } catch {
        /* best effort */
      }
    }
  }

  static async downloadTo(key: string, destPlainPath: string, backend?: OffsiteBackend): Promise<void> {
    const tmp = `${destPlainPath}.enc.download`;
    try {
      const store = backend || this.backend();
      const head = await store.head(key);
      await store.get(key, tmp);
      const sha256 = await EncryptionService.sha256File(tmp);
      if (head.sha256 && head.sha256 !== sha256) {
        throw new Error('Checksum SHA-256 do download não confere.');
      }
      await EncryptionService.decryptFile(tmp, destPlainPath);
    } finally {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* best effort */
      }
    }
  }

  static async listRemote(backend?: OffsiteBackend, prefix?: string): Promise<RemoteObject[]> {
    const store = backend || this.backend();
    const root = prefix !== undefined ? prefix.replace(/^\/+|\/+$/g, '') : this.prefixRoot();
    const listed = await store.list(root ? `${root}/` : '');
    return listed
      .filter((obj) => !obj.key.endsWith(`/${TEST_OBJECT_KEY}`) && !obj.key.endsWith(TEST_OBJECT_KEY))
      .map((obj) => ({
        key: obj.key,
        sizeBytes: obj.sizeBytes ?? 0,
        lastModified: obj.lastModified.toISOString(),
      }))
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  }

  static async applyRetention(): Promise<number> {
    const backend = this.backend();
    const prefix = this.prefixRoot();
    const listed = await backend.list(prefix ? `${prefix}/` : '');
    let removed = 0;
    for (const [, group] of groupByPrefix(listed)) {
      for (const key of keysToDelete(group)) {
        await backend.delete(key);
        removed++;
      }
    }
    return removed;
  }

  static async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    if (!this.offsiteAllowed()) {
      throw new Error('Teste offsite bloqueado no modo local. Defina AEGIS_ALLOW_OFFSITE_BACKUP=true para permitir.');
    }
    const backend = this.backend();
    const prefix = this.prefixRoot();
    const key = `${prefix}/${TEST_OBJECT_KEY}`;
    const tmp = path.join(CONFIG.DATA_DIR, 'backups', `.probe-${Date.now()}`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, Buffer.alloc(1024, 1), { mode: 0o600 });
    const started = Date.now();
    try {
      const sha256 = await EncryptionService.sha256File(tmp);
      await backend.put(key, tmp, sha256);
      const down = `${tmp}.down`;
      await backend.get(key, down);
      const back = await EncryptionService.sha256File(down);
      fs.unlinkSync(down);
      if (back !== sha256) throw new Error('O objeto lido do bucket não bate com o enviado.');
      await backend.delete(key);
      return { ok: true, latencyMs: Date.now() - started };
    } finally {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* best effort */
      }
    }
  }

  static markUpload(ok: boolean, error?: string): void {
    const current = dbStorage.getSettings();
    if (!current.backupTarget) return;
    current.backupTarget.lastUploadAt = ok ? new Date().toISOString() : current.backupTarget.lastUploadAt;
    current.backupTarget.lastError = ok ? undefined : error;
    dbStorage.updateSettings({ backupTarget: current.backupTarget });
  }
}
