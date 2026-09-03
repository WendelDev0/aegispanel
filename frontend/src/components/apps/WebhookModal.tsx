import React, { useEffect, useState } from 'react';
import { Check, Copy, Webhook, X } from 'lucide-react';
import { api } from '../../services/api.js';
import type { AppRecord } from '../../types/index.js';

interface WebhookModalProps {
  app: AppRecord;
  onClose: () => void;
}

export const WebhookModal: React.FC<WebhookModalProps> = ({ app, onClose }) => {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLoading, setWebhookLoading] = useState(true);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWebhookLoading(true);
      try {
        const res = await api.get(`/apps/${app.id}/webhook`);
        if (!cancelled) setWebhookUrl(res.data.url);
      } catch (err: any) {
        if (!cancelled) {
          setWebhookUrl('');
          alert('Não foi possível obter a URL do webhook: ' + (err.response?.data?.error || err.message));
        }
      } finally {
        if (!cancelled) setWebhookLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.id]);

  const rotateWebhookSecret = async () => {
    if (!confirm('Gerar um novo segredo invalida a URL atual. Você precisará atualizá-la no GitHub. Continuar?')) {
      return;
    }
    setWebhookLoading(true);
    try {
      await api.post(`/apps/${app.id}/webhook-secret`);
      const res = await api.get(`/apps/${app.id}/webhook`);
      setWebhookUrl(res.data.url);
    } catch (err: any) {
      alert('Falha ao gerar novo segredo: ' + (err.response?.data?.error || err.message));
    } finally {
      setWebhookLoading(false);
    }
  };

  const copyWebhookUrl = () => {
    if (!webhookUrl) return;
    void navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-lg overflow-hidden p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Webhook className="w-5 h-5 text-primary" />
            Webhook de Auto-Deploy do GitHub
          </h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-on-surface-variant mb-4">
          No seu repositório GitHub, vá em <strong>Settings &rarr; Webhooks &rarr; Add Webhook</strong> e cole a Payload URL abaixo:
        </p>

        <div className="space-y-2 mb-4">
          <label className="text-[11px] font-semibold text-on-surface-variant uppercase">Payload URL</label>
          <div className="flex items-center gap-2 bg-surface-container-lowest p-3 rounded border border-outline-variant font-mono text-xs text-primary">
            <span className="truncate flex-1 select-all">
              {webhookLoading ? 'Carregando...' : webhookUrl || 'Indisponível'}
            </span>
            <button
              onClick={copyWebhookUrl}
              title="Copiar URL do Webhook"
              className="p-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface"
            >
              {copiedWebhook ? <Check className="w-4 h-4 text-ok" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <p className="text-[11px] text-on-surface-variant mb-4">
          Trate esta URL como uma senha: quem a possui pode disparar deploys desta aplicação.
          Se ela vazar, gere um novo segredo e atualize o webhook no GitHub.
        </p>

        <div className="flex justify-between items-center gap-2">
          <button
            onClick={rotateWebhookSecret}
            disabled={webhookLoading}
            className="px-4 py-2.5 bg-surface-container-high hover:bg-surface-container-highest disabled:opacity-50 text-on-surface rounded text-xs font-semibold"
          >
            Gerar novo segredo
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded text-xs font-semibold"
          >
            Concluído
          </button>
        </div>
      </div>
    </div>
  );
};
