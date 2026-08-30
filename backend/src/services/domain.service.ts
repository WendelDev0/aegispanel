import dns from 'dns';
import tls from 'tls';
import { dbStorage } from '../db/storage.js';
import { CaddyService } from './caddy.service.js';
import { SystemService } from './system.service.js';
import { normalizeDomain } from '../utils/naming.js';

const resolver = dns.promises;

/** Certificate DN attributes can repeat, so Node types them as string | string[]. */
function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export interface DnsCheckResult {
  domain: string;
  isConfigured: boolean;
  resolvedIps: string[];
  serverIp: string;
  status: 'propagated' | 'pending' | 'mismatch';
  message: string;
}

export interface SslDetails {
  domain: string;
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  protocol: string;
  autoRenew: boolean;
  status: 'valid' | 'expiring' | 'expired' | 'unreachable';
  message: string;
}

export class DomainService {
  /**
   * Checks whether the domain's A record points at this server.
   *
   * The server address is fetched rather than hardcoded: it was previously
   * pinned to 127.0.0.1, so the comparison could never report a mismatch and
   * the 'mismatch' branch was unreachable — the most common real failure
   * (the record points at the old host) was reported as success.
   */
  static async checkDnsPropagation(domainName: string): Promise<DnsCheckResult> {
    const cleanDomain = normalizeDomain(domainName) || '';
    const serverIp = await SystemService.getPublicIp();

    let resolvedIps: string[] = [];
    try {
      resolvedIps = await resolver.resolve4(cleanDomain);
    } catch {
      // Not resolving yet; treated as pending below.
    }

    if (resolvedIps.length === 0) {
      return {
        domain: cleanDomain,
        isConfigured: false,
        resolvedIps,
        serverIp,
        status: 'pending',
        message:
          'Aguardando propagação do registro Tipo A. Após criar o registro no seu provedor de DNS, a propagação leva de 5 a 30 minutos.',
      };
    }

    if (!serverIp) {
      return {
        domain: cleanDomain,
        isConfigured: true,
        resolvedIps,
        serverIp: '',
        status: 'propagated',
        message: `DNS resolvido para ${resolvedIps.join(', ')}. Não foi possível descobrir o IP público deste servidor para comparar.`,
      };
    }

    if (resolvedIps.includes(serverIp)) {
      return {
        domain: cleanDomain,
        isConfigured: true,
        resolvedIps,
        serverIp,
        status: 'propagated',
        message: `DNS apontando corretamente para este servidor (${serverIp}).`,
      };
    }

    return {
      domain: cleanDomain,
      isConfigured: true,
      resolvedIps,
      serverIp,
      status: 'mismatch',
      message: `O domínio aponta para ${resolvedIps.join(', ')}, mas este servidor é ${serverIp}. Corrija o registro Tipo A para que o SSL possa ser emitido.`,
    };
  }

  /**
   * Reads the certificate actually served for the domain.
   *
   * The previous implementation returned a fixed issuer and "89 days
   * remaining" without opening a connection, so an expired or missing
   * certificate was displayed as valid.
   */
  static async getSslDetails(domainName: string): Promise<SslDetails> {
    const cleanDomain = normalizeDomain(domainName) || '';

    const unreachable = (message: string): SslDetails => ({
      domain: cleanDomain,
      issuer: '—',
      subject: cleanDomain,
      validFrom: '',
      validTo: '',
      daysRemaining: 0,
      protocol: '—',
      autoRenew: true,
      status: 'unreachable',
      message,
    });

    return new Promise<SslDetails>((resolve) => {
      const socket = tls.connect(
        {
          host: cleanDomain,
          port: 443,
          servername: cleanDomain,
          timeout: 8000,
          // The certificate is inspected and reported, including when it is
          // not trusted; rejecting here would hide the reason from the user.
          rejectUnauthorized: false,
        },
        () => {
          const cert = socket.getPeerCertificate();
          const protocol = socket.getProtocol() || 'desconhecido';
          socket.end();

          if (!cert || !cert.valid_to) {
            resolve(unreachable('O servidor respondeu, mas não apresentou um certificado.'));
            return;
          }

          const validTo = new Date(cert.valid_to);
          const validFrom = new Date(cert.valid_from);
          const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);

          let status: SslDetails['status'] = 'valid';
          let message = `Certificado válido por mais ${daysRemaining} dia(s).`;
          if (daysRemaining < 0) {
            status = 'expired';
            message = `Certificado expirado há ${Math.abs(daysRemaining)} dia(s).`;
          } else if (daysRemaining <= 14) {
            status = 'expiring';
            message = `Certificado expira em ${daysRemaining} dia(s). O Caddy renova automaticamente a partir de 30 dias antes.`;
          }

          resolve({
            domain: cleanDomain,
            // Node types these DN fields as string | string[]: a certificate
            // may carry the same attribute more than once.
            issuer: first(cert.issuer?.O) || first(cert.issuer?.CN) || 'desconhecido',
            subject: first(cert.subject?.CN) || cleanDomain,
            validFrom: validFrom.toISOString(),
            validTo: validTo.toISOString(),
            daysRemaining,
            protocol,
            autoRenew: true,
            status,
            message,
          });
        }
      );

      socket.on('timeout', () => {
        socket.destroy();
        resolve(unreachable('Tempo esgotado ao conectar na porta 443. Verifique DNS e firewall.'));
      });

      socket.on('error', (err: Error) => {
        resolve(unreachable(`Não foi possível conectar via HTTPS: ${err.message}`));
      });
    });
  }

  /**
   * Regenerates the Caddy configuration so it re-attempts issuance.
   * Reports whether the reload actually succeeded rather than assuming it did.
   */
  static async renewSsl(domainId: string): Promise<{ success: boolean; message: string }> {
    const domain = dbStorage.getDomains().find((d) => d.id === domainId);
    if (!domain) throw new Error('Domínio não encontrado');

    domain.sslEnabled = true;
    dbStorage.saveDomain(domain);

    await CaddyService.syncCaddyfile();
    const reload = await CaddyService.reload();

    domain.status = reload.success ? 'active' : 'error';
    dbStorage.saveDomain(domain);

    return {
      success: reload.success,
      message: reload.success
        ? 'Configuração recarregada. O Caddy solicitará ou renovará o certificado em segundos.'
        : `Falha ao recarregar o Caddy: ${reload.message}`,
    };
  }
}
