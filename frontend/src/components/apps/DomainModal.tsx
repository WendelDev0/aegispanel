import React, { useState } from 'react';
import { Globe, X } from 'lucide-react';
import { api } from '../../services/api.js';
import type { AppRecord } from '../../types/index.js';

interface DomainModalProps {
  app: AppRecord;
  onClose: () => void;
  onSaved: () => void;
}

export const DomainModal: React.FC<DomainModalProps> = ({ app, onClose, onSaved }) => {
  const [domainInput, setDomainInput] = useState(app.domain || '');
  const [savingDomain, setSavingDomain] = useState(false);

  const handleSaveDomain = async () => {
    try {
      setSavingDomain(true);
      await api.put(`/apps/${app.id}/domain`, { domain: domainInput });
      onSaved();
      alert('✅ Domínio e certificado SSL configurados com sucesso!');
    } catch (err: any) {
      alert('Erro ao salvar domínio: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingDomain(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-md overflow-hidden p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-white text-base">Domínio / Subdomínio (Hostinger)</h3>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-on-surface-variant">
          Digite o domínio ou subdomínio que deseja apontar para este app (ex:{' '}
          <code className="text-primary">api.meusite.com.br</code> ou <code className="text-primary">meusite.com</code>):
        </p>

        <div>
          <label className="block text-xs font-semibold text-on-surface-variant uppercase mb-1.5">
            Nome do Domínio *
          </label>
          <input
            type="text"
            required
            placeholder="ex: app.meusite.com.br"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-primary"
          />
          <p className="text-[10px] text-on-surface-variant mt-1">
            🔒 O Caddy emitirá o certificado SSL (HTTPS com cadeado) automaticamente.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-on-surface-variant hover:text-white text-xs font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveDomain}
            disabled={savingDomain}
            className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
          >
            {savingDomain ? 'Configurando SSL...' : 'Salvar Domínio'}
          </button>
        </div>
      </div>
    </div>
  );
};
