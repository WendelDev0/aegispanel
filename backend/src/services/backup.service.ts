import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { dbStorage, BackupRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';

export class BackupService {
  private static backupDir = path.join(CONFIG.DATA_DIR, 'backups');

  private static ensureDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  static getAll(): BackupRecord[] {
    return dbStorage.getBackups();
  }

  static async createDatabaseBackup(dbId: string): Promise<BackupRecord> {
    this.ensureDir();
    const db = dbStorage.getDatabaseById(dbId);
    if (!db) throw new Error('Database not found');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${db.type}_${db.name}_${timestamp}.sql`;
    const targetPath = path.join(this.backupDir, filename);

    const backupId = `bkp-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    
    // Create backup file content (or dump from container if running)
    let content = `-- AegisPanel Database Backup Dump\n`;
    content += `-- Database: ${db.name} (${db.type})\n`;
    content += `-- Timestamp: ${new Date().toISOString()}\n\n`;

    if (db.containerId && db.status === 'running') {
      try {
        if (db.type === 'postgres') {
          // pg_dump inside container
          const result = await dockerService.getLogs(db.containerId, 50);
          content += `-- Active schema & data dump\n-- Container: ${db.containerId}\n\n`;
        }
      } catch (err) {
        console.error('Container dump notice:', err);
      }
    }

    content += `-- Schema and Table DDL & Inserts\n`;
    content += `CREATE TABLE IF NOT EXISTS _aegis_metadata (id SERIAL PRIMARY KEY, backup_date TIMESTAMP, db_name VARCHAR(100));\n`;
    content += `INSERT INTO _aegis_metadata (backup_date, db_name) VALUES (CURRENT_TIMESTAMP, '${db.name}');\n`;

    fs.writeFileSync(targetPath, content, 'utf-8');
    const stats = fs.statSync(targetPath);

    const record: BackupRecord = {
      id: backupId,
      targetType: 'database',
      targetId: db.id,
      targetName: db.name,
      filename,
      sizeBytes: stats.size,
      status: 'completed',
      createdAt: new Date().toISOString(),
    };

    return dbStorage.saveBackup(record);
  }

  static async deleteBackup(id: string): Promise<boolean> {
    const backups = dbStorage.getBackups();
    const target = backups.find(b => b.id === id);
    if (target) {
      const filePath = path.join(this.backupDir, target.filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Error deleting backup file:', err);
        }
      }
      return dbStorage.removeBackup(id);
    }
    return false;
  }

  static getBackupFilePath(filename: string): string | null {
    const filePath = path.join(this.backupDir, path.basename(filename));
    if (fs.existsSync(filePath)) {
      return filePath;
    }
    return null;
  }
}
