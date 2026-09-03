import React, { useEffect, useState } from 'react';
import { Check, Copy, FileCode2, X } from 'lucide-react';
import { api } from '../../services/api.js';
import type { AppRecord } from '../../types/index.js';

interface WorkflowModalProps {
  app: AppRecord;
  onClose: () => void;
}

export const WorkflowModal: React.FC<WorkflowModalProps> = ({ app, onClose }) => {
  const [workflowYaml, setWorkflowYaml] = useState('');
  const [copiedWorkflow, setCopiedWorkflow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/apps/${app.id}/workflow`);
        if (!cancelled) setWorkflowYaml(res.data.yaml);
      } catch (err: any) {
        alert('Erro ao gerar workflow: ' + err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.id]);

  const copyWorkflowYaml = () => {
    void navigator.clipboard.writeText(workflowYaml);
    setCopiedWorkflow(true);
    setTimeout(() => setCopiedWorkflow(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-5 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-primary" />
            <span className="font-bold text-white text-sm">GitHub Actions CI/CD Workflow</span>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-on-surface-variant">
            Salve este código no seu repositório GitHub dentro de{' '}
            <code className="text-primary bg-surface-container-low px-1.5 py-0.5 rounded font-mono">
              .github/workflows/deploy.yml
            </code>
            :
          </p>

          <div className="relative bg-surface-container-lowest p-4 rounded-lg border border-outline-variant font-mono text-xs text-ok overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72">
            {workflowYaml}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={copyWorkflowYaml}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-container hover:bg-primary text-white rounded text-xs font-semibold shadow transition-all active:scale-95"
            >
              {copiedWorkflow ? <Check className="w-4 h-4 text-ok" /> : <Copy className="w-4 h-4" />}
              <span>{copiedWorkflow ? 'Código Copiado!' : 'Copiar YAML'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
