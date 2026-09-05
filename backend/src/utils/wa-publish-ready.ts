import type { EvolutionInstanceInfo } from './evolution.client.js';

export interface PublishReadyResult {
  ok: boolean;
  error?: string;
  warnings: string[];
}

/**
 * Publish used to succeed with a bound name that was offline or missing.
 * The operator clicked Publicar, the card said Ativo, and WhatsApp stayed mute.
 */
export function assessBoundInstances(
  boundNames: string[],
  live: EvolutionInstanceInfo[],
  opts?: { skipLiveCheck?: boolean }
): PublishReadyResult {
  const bound = boundNames.map((n) => n.trim()).filter(Boolean);
  if (!bound.length) {
    return { ok: false, error: 'Vincule pelo menos uma instância da Evolution antes de publicar.', warnings: [] };
  }

  if (opts?.skipLiveCheck) {
    return { ok: true, warnings: [] };
  }

  if (!live.length) {
    return {
      ok: true,
      warnings: ['Não foi possível listar as instâncias da Evolution. Confirme o QR no manager antes de testar.'],
    };
  }

  const warnings: string[] = [];
  for (const name of bound) {
    const inst = live.find((item) => item.name.trim().toLowerCase() === name.toLowerCase());
    if (!inst) {
      return {
        ok: false,
        error: `Instância "${name}" não existe na Evolution. Abra o manager e crie a linha, ou escolha outra na lista.`,
        warnings,
      };
    }
    if (inst.connectionStatus === 'close') {
      return {
        ok: false,
        error: `Instância "${name}" está desconectada. Abra o manager da Evolution e leia o QR.`,
        warnings,
      };
    }
    if (inst.connectionStatus === 'connecting') {
      warnings.push(`Instância "${name}" ainda está conectando. Espere o QR fechar antes de testar no celular.`);
    }
    if (inst.competitors?.length) {
      warnings.push(
        `A linha "${name}" ainda tem ${inst.competitors.join(', ')} ligado. Isso ecoa a mensagem e o fluxo parece morto.`
      );
    }
  }

  return { ok: true, warnings };
}
