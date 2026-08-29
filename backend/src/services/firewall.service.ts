import { dbStorage, FirewallRule } from '../db/storage.js';
import { CONFIG } from '../config.js';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export class FirewallService {
  static getRules(): FirewallRule[] {
    return dbStorage.getFirewallRules();
  }

  static async addRule(rule: { port: number; protocol: 'tcp' | 'udp' | 'both'; action: 'allow' | 'deny'; comment: string }): Promise<FirewallRule> {
    const id = `fw-${rule.port}-${Date.now().toString(36)}`;
    const newRule: FirewallRule = {
      id,
      port: rule.port,
      protocol: rule.protocol,
      action: rule.action,
      comment: rule.comment,
      createdAt: new Date().toISOString(),
    };

    if (!CONFIG.IS_WINDOWS) {
      try {
        const cmd = `sudo ufw ${rule.action} ${rule.port}/${rule.protocol === 'both' ? 'tcp' : rule.protocol}`;
        await execPromise(cmd);
      } catch (err) {
        console.error('UFW execution note:', err);
      }
    }

    return dbStorage.saveFirewallRule(newRule);
  }

  static async deleteRule(id: string): Promise<boolean> {
    const rules = dbStorage.getFirewallRules();
    const rule = rules.find(r => r.id === id);
    if (rule && !CONFIG.IS_WINDOWS) {
      try {
        const cmd = `sudo ufw delete ${rule.action} ${rule.port}/${rule.protocol === 'both' ? 'tcp' : rule.protocol}`;
        await execPromise(cmd);
      } catch (err) {
        console.error('UFW delete note:', err);
      }
    }
    return dbStorage.removeFirewallRule(id);
  }
}
