import { execFile } from 'child_process';
import util from 'util';
import { dbStorage, FirewallRule } from '../db/storage.js';
import { CONFIG } from '../config.js';

const execFilePromise = util.promisify(execFile);

export interface FirewallApplyResult {
  rule: FirewallRule;
  applied: boolean;
  message: string;
}

/**
 * Firewall rules are applied with ufw on the host.
 *
 * The panel normally runs inside a container that has neither ufw nor the
 * host's network namespace, so the command silently failed while the API
 * still answered "success" and the UI showed the rule as active. Availability
 * is now probed once and reported honestly to the caller.
 */
export class FirewallService {
  private static availability: { checked: boolean; available: boolean; reason: string } = {
    checked: false,
    available: false,
    reason: '',
  };

  static async checkAvailability(): Promise<{ available: boolean; reason: string }> {
    if (this.availability.checked) {
      return { available: this.availability.available, reason: this.availability.reason };
    }

    let available = false;
    let reason = '';

    if (CONFIG.IS_WINDOWS) {
      reason = 'O gerenciamento de firewall via ufw só está disponível em servidores Linux.';
    } else {
      try {
        await execFilePromise('ufw', ['status'], { timeout: 5000 });
        available = true;
        reason = 'ufw disponível.';
      } catch (err: any) {
        available = false;
        reason =
          err.code === 'ENOENT'
            ? 'O comando ufw não existe neste ambiente. O painel provavelmente está em um contêiner: aplique as regras no host ou execute o backend com acesso à rede do host.'
            : `Não foi possível executar o ufw: ${err.message}`;
      }
    }

    this.availability = { checked: true, available, reason };
    return { available, reason };
  }

  static getRules(): FirewallRule[] {
    return dbStorage.getFirewallRules();
  }

  private static portSpec(rule: { port: number; protocol: 'tcp' | 'udp' | 'both' }): string {
    return `${rule.port}/${rule.protocol === 'both' ? 'tcp' : rule.protocol}`;
  }

  static async addRule(input: {
    port: number;
    protocol: 'tcp' | 'udp' | 'both';
    action: 'allow' | 'deny';
    comment: string;
  }): Promise<FirewallApplyResult> {
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw new Error('Porta inválida. Informe um número entre 1 e 65535.');
    }
    if (!['tcp', 'udp', 'both'].includes(input.protocol)) {
      throw new Error('Protocolo inválido.');
    }
    if (!['allow', 'deny'].includes(input.action)) {
      throw new Error('Ação inválida.');
    }

    const rule: FirewallRule = {
      id: `fw-${input.port}-${Date.now().toString(36)}`,
      port: input.port,
      protocol: input.protocol,
      action: input.action,
      comment: input.comment,
      createdAt: new Date().toISOString(),
    };

    const { available, reason } = await this.checkAvailability();
    if (!available) {
      dbStorage.saveFirewallRule(rule);
      return {
        rule,
        applied: false,
        message: `Regra registrada no painel, mas NÃO aplicada no sistema. ${reason}`,
      };
    }

    try {
      // execFile with an argument array: nothing here reaches a shell.
      await execFilePromise('ufw', [input.action, this.portSpec(input)], { timeout: 15000 });
      dbStorage.saveFirewallRule(rule);
      return { rule, applied: true, message: `Regra ${input.action} ${this.portSpec(input)} aplicada com sucesso.` };
    } catch (err: any) {
      throw new Error(`Falha ao aplicar a regra no ufw: ${err.stderr || err.message}`);
    }
  }

  static async deleteRule(id: string): Promise<FirewallApplyResult | null> {
    const rule = dbStorage.getFirewallRules().find((r) => r.id === id);
    if (!rule) return null;

    const { available, reason } = await this.checkAvailability();
    if (!available) {
      dbStorage.removeFirewallRule(id);
      return {
        rule,
        applied: false,
        message: `Regra removida do painel, mas NÃO removida do sistema. ${reason}`,
      };
    }

    try {
      await execFilePromise('ufw', ['delete', rule.action, this.portSpec(rule)], { timeout: 15000 });
      dbStorage.removeFirewallRule(id);
      return { rule, applied: true, message: 'Regra removida com sucesso.' };
    } catch (err: any) {
      throw new Error(`Falha ao remover a regra no ufw: ${err.stderr || err.message}`);
    }
  }
}
