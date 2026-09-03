import { exec } from 'child_process';
import util from 'util';
import { CONFIG } from '../config.js';
import { dbStorage, CronJobRecord } from '../db/storage.js';
import { BackupService } from './backup.service.js';

const execPromise = util.promisify(exec);

const SHELL_TIMEOUT_MS = 10 * 60 * 1000;
const SHELL_MAX_BUFFER = 10 * 1024 * 1024;

type CronField = { min: number; max: number };

const FIELDS: CronField[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week
];

/**
 * Expands one cron field into the set of values it matches.
 * Supports `*`, `a-b`, `*\/n`, `a-b/n` and comma-separated lists.
 */
function expandField(expr: string, field: CronField): Set<number> | null {
  const values = new Set<number>();

  for (const part of expr.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? parseInt(stepPart, 10) : 1;
    if (!Number.isInteger(step) || step < 1) return null;

    let start: number;
    let end: number;

    if (rangePart === '*') {
      start = field.min;
      end = field.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-').map((v) => parseInt(v, 10));
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
      start = a;
      end = b;
    } else {
      const v = parseInt(rangePart, 10);
      if (!Number.isInteger(v)) return null;
      start = v;
      end = v;
    }

    if (start < field.min || end > field.max || start > end) return null;

    for (let v = start; v <= end; v += step) values.add(v);
  }

  return values.size > 0 ? values : null;
}

function parseSchedule(schedule: string): Set<number>[] | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const expanded: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const set = expandField(parts[i], FIELDS[i]);
    if (!set) return null;
    expanded.push(set);
  }
  return expanded;
}

function matchesNow(schedule: string, date: Date): boolean {
  const parsed = parseSchedule(schedule);
  if (!parsed) return false;

  const [minutes, hours, daysOfMonth, months, daysOfWeek] = parsed;
  const parts = schedule.trim().split(/\s+/);
  const domMatch = daysOfMonth.has(date.getDate());
  const dowMatch = daysOfWeek.has(date.getDay());
  const domRestricted = parts[2] !== '*';
  const dowRestricted = parts[4] !== '*';
  const dayMatch = domRestricted && dowRestricted ? domMatch || dowMatch : domMatch && dowMatch;

  return minutes.has(date.getMinutes()) && hours.has(date.getHours()) && dayMatch && months.has(date.getMonth() + 1);
}

export class CronService {
  private static timer: NodeJS.Timeout | null = null;
  private static startupTimer: NodeJS.Timeout | null = null;
  private static running = new Set<string>();

  static isValidSchedule(schedule: string): boolean {
    return parseSchedule(schedule) !== null;
  }

  static getAll(): CronJobRecord[] {
    return dbStorage.getCronJobs();
  }

  static create(job: Omit<CronJobRecord, 'id' | 'createdAt'>): CronJobRecord {
    const record: CronJobRecord = {
      ...job,
      id: `cron-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    return dbStorage.saveCronJob(record);
  }

  /**
   * Starts the scheduler.
   *
   * Jobs were previously only executed when someone pressed "run now", so the
   * default nightly backup entry never actually ran. The tick fires once a
   * minute, aligned to the start of the minute, and skips a job that is still
   * running from a previous tick.
   */
  static start(): void {
    if (this.timer) return;

    // Scheduled jobs stay off in a development copy: the backup routine and any
    // shell task would otherwise run against the developer's own machine on the
    // schedule configured for the server. Running one by hand still works.
    if (CONFIG.LOCAL_MODE) {
      console.warn('🧪 Modo local: agendador de cron desativado. Execute tarefas manualmente pelo painel.');
      return;
    }

    const tick = async () => {
      const now = new Date();
      for (const job of dbStorage.getCronJobs()) {
        if (!job.enabled) continue;
        if (this.running.has(job.id)) continue;
        if (!matchesNow(job.schedule, now)) continue;

        this.runNow(job.id)
          .catch((err) => console.error(`Cron "${job.name}" falhou:`, err.message))
      }
    };

    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      tick();
      this.timer = setInterval(tick, 60_000);
    }, msToNextMinute).unref();

    console.log('⏰ Agendador de tarefas cron ativo.');
  }

  static stop(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running.clear();
  }

  static async runNow(id: string): Promise<CronJobRecord> {
    if (this.running.has(id)) throw new Error('Esta tarefa já está em execução.');
    this.running.add(id);
    try {
      return await this.runNowUnlocked(id);
    } finally {
      this.running.delete(id);
    }
  }

  private static async runNowUnlocked(id: string): Promise<CronJobRecord> {
    const job = dbStorage.getCronJobs().find((j) => j.id === id);
    if (!job) throw new Error('Tarefa cron não encontrada');

    job.lastRunAt = new Date().toISOString();
    let output = '';

    try {
      if (job.type === 'backup') {
        const dbs = dbStorage.getDatabases();
        const results: string[] = [];
        let failures = 0;
        const totalSteps = dbs.length + 1; // databases + panel state

        for (const db of dbs) {
          try {
            const backup = await BackupService.createDatabaseBackup(db.id);
            results.push(`✅ ${db.name}: ${backup.filename} (${(backup.sizeBytes / 1024).toFixed(1)} KB)`);
          } catch (err: any) {
            failures++;
            results.push(`❌ ${db.name}: ${err.message}`);
          }
        }

        // Panel state was previously omitted from cron backups: recovering DB
        // dumps alone left apps/domains/users unrecovered after a disk loss.
        try {
          const panelBackup = await BackupService.createPanelStateBackup();
          results.push(
            `✅ Estado do painel: ${panelBackup.filename} (${(panelBackup.sizeBytes / 1024).toFixed(1)} KB)`
          );
        } catch (err: any) {
          failures++;
          results.push(`❌ Estado do painel: ${err.message}`);
        }

        output = results.join('\n') || 'Nenhum item para backup.';
        // A partial failure must not be reported as a successful backup run.
        if (failures > 0) {
          throw new Error(`${failures} de ${totalSteps} backup(s) falharam.\n${output}`);
        }
      } else if (job.type === 'restore-drill') {
        const result = await BackupService.runRestoreDrill();
        output = result.summary;
        if (!result.ok) throw new Error(output);
      } else if (job.type === 'shell' && job.command) {
        // Shell jobs are admin-gated at the route; a shell is intentional here.
        const { stdout, stderr } = await execPromise(job.command, {
          timeout: SHELL_TIMEOUT_MS,
          maxBuffer: SHELL_MAX_BUFFER,
        });
        output = stdout || stderr || 'Comando executado com código 0.';
      } else if (job.type === 'webhook' && job.webhookUrl) {
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), 30_000);
        try {
          const res = await fetch(job.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ triggeredBy: 'AegisPanel Cron', timestamp: new Date().toISOString() }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`Webhook respondeu HTTP ${res.status}`);
          output = `Webhook disparado com HTTP status ${res.status}`;
        } finally {
          clearTimeout(abortTimer);
        }
      } else {
        throw new Error(`Tarefa "${job.name}" está incompleta para o tipo ${job.type}.`);
      }

      job.lastStatus = 'success';
      job.lastOutput = output.slice(-4000);
    } catch (err: any) {
      job.lastStatus = 'failed';
      job.lastOutput = `Erro: ${err.message}`.slice(-4000);
      dbStorage.saveCronJob(job);

      dbStorage.addActivity({
        type: 'system',
        title: `Tarefa agendada falhou: ${job.name}`,
        description: err.message,
        status: 'error',
        metadata: { cronJobId: job.id },
      });
      throw err;
    }

    dbStorage.saveCronJob(job);
    return job;
  }

  static toggle(id: string): CronJobRecord {
    const job = dbStorage.getCronJobs().find((j) => j.id === id);
    if (!job) throw new Error('Tarefa cron não encontrada');
    job.enabled = !job.enabled;
    return dbStorage.saveCronJob(job);
  }

  static delete(id: string): boolean {
    return dbStorage.removeCronJob(id);
  }
}
