import React from 'react';
import { Terminal, X } from 'lucide-react';
import type { DeploymentRecord } from '../../types/index.js';

interface BuildLogsModalProps {
  deployment: DeploymentRecord;
  onClose: () => void;
}

export const BuildLogsModal: React.FC<BuildLogsModalProps> = ({ deployment, onClose }) => (
  <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-[#0a0f1c] rounded-lg border border-outline-variant w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
      <div className="p-4 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-ok" />
          <span className="font-bold text-white text-sm">Build Output: {deployment.appName}</span>
        </div>
        <button onClick={onClose} className="text-on-surface-variant hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-5 flex-1 overflow-auto font-mono text-xs text-ok bg-black/90 whitespace-pre-wrap leading-relaxed">
        {deployment.buildLogs || 'Nenhum log gravado para este build.'}
      </div>
    </div>
  </div>
);
