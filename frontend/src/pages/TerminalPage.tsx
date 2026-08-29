import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Terminal as TerminalIcon, RefreshCw, Trash2, Boxes } from 'lucide-react';
import { socket } from '../services/socket.js';
import { api } from '../services/api.js';
import { ContainerInfo } from '../types/index.js';

export const TerminalPage: React.FC = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>('');

  useEffect(() => {
    // Fetch containers for container shell selector
    api.get('/docker/containers').then((res) => {
      setContainers(res.data.filter((c: ContainerInfo) => c.state === 'running'));
    }).catch(() => {});
  }, []);

  const initTerminal = (containerId?: string) => {
    if (!terminalRef.current) return;

    if (xtermInstance.current) {
      xtermInstance.current.dispose();
    }

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#090d16',
        foreground: '#e2e8f0',
        cursor: '#6366f1',
        selectionBackground: 'rgba(99, 102, 241, 0.3)',
        black: '#1e293b',
        red: '#f43f5e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#d946ef',
        cyan: '#06b6d4',
        white: '#f8fafc',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    // Send input from user typing
    term.onData((data) => {
      socket.emit('terminal:input', data);
    });

    // Receive data from backend
    const onData = (data: string) => {
      term.write(data);
    };

    socket.off('terminal:data');
    socket.on('terminal:data', onData);

    // Initialize backend PTY process
    socket.emit('terminal:init', { containerId });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.off('terminal:data', onData);
      term.dispose();
    };
  };

  useEffect(() => {
    initTerminal(selectedContainer || undefined);
  }, [selectedContainer]);

  const handleClear = () => {
    xtermInstance.current?.clear();
  };

  const handleRestart = () => {
    initTerminal(selectedContainer || undefined);
  };

  return (
    <div className="space-y-4 flex flex-col h-[calc(100vh-8rem)]">
      {/* Header toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0f172a]/90 p-4 rounded-2xl border border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
            <TerminalIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-white text-base">Terminal Web Interativo (SSH / Shell)</h2>
            <p className="text-xs text-slate-400">
              Acesso root direto ao sistema operacional da VPS ou dentro dos containers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Target shell selector */}
          <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
            <span className="text-slate-500 font-semibold uppercase text-[10px]">Ambiente:</span>
            <select
              value={selectedContainer}
              onChange={(e) => setSelectedContainer(e.target.value)}
              className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
            >
              <option value="" className="bg-slate-900 text-white">Shell do Servidor Host</option>
              {containers.map((c) => (
                <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                  Docker: {c.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleClear}
            title="Limpar tela"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            onClick={handleRestart}
            title="Reiniciar sessão"
            className="p-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Screen Container */}
      <div className="flex-1 bg-[#090d16] rounded-2xl border border-slate-800 p-3 shadow-2xl overflow-hidden relative">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  );
};
