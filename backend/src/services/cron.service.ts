import { dbStorage, CronJobRecord } from '../db/storage.js';
import { BackupService } from './backup.service.js';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export class CronService {
  static getAll(): CronJobRecord[] {
    return dbStorage.getCronJobs();
  }

  static create(job: Omit<CronJobRecord, 'id' | 'createdAt'>): CronJobRecord {
    const id = `cron-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const record: CronJobRecord = {
      ...job,
      id,
      createdAt: new Date().toISOString(),
    };
    return dbStorage.saveCronJob(record);
  }

  static async runNow(id: string): Promise<CronJobRecord> {
    const job = dbStorage.getCronJobs().find(j => j.id === id);
    if (!job) throw new Error('Tarefa cron não encontrada');

    job.lastRunAt = new Date().toISOString();
    let output = '';

    try {
      if (job.type === 'backup') {
        const dbs = dbStorage.getDatabases();
        for (const db of dbs) {
          await BackupService.createDatabaseBackup(db.id);
        }
        output = `Backup de rotina concluído com sucesso para ${dbs.length} banco(s) de dados.`;
      } else if (job.type === 'shell' && job.command) {
        const { stdout, stderr } = await execPromise(job.command);
        output = stdout || stderr || 'Comando executado com código 0.';
      } else if (job.type === 'webhook' && job.webhookUrl) {
        const res = await fetch(job.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            triggeredBy: 'AegisPanel Cron',
            timestamp: new Date().toISOString(),
          }),
        });
        output = `Webhook disparado com HTTP status ${res.status}`;
      }

      job.lastStatus = 'success';
      job.lastOutput = output;
    } catch (err: any) {
      job.lastStatus = 'failed';
      job.lastOutput = `Erro: ${err.message}`;
    }

    dbStorage.saveCronJob(job);
    return job;
  }

  static toggle(id: string): CronJobRecord {
    const job = dbStorage.getCronJobs().find(j => j.id === id);
    if (!job) throw new Error('Tarefa cron não encontrada');

    job.enabled = !job.enabled;
    return dbStorage.saveCronJob(job);
  }

  static delete(id: string): boolean {
    return dbStorage.removeCronJob(id);
  }
}
