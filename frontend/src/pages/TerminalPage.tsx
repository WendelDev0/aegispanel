import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Terminal as TerminalIcon, RefreshCw, Trash2, Boxes } from 'lucide-react';
import { socket, connectSocket } from '../services/socket.js';
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

    // Surfaces a rejected shell (insufficient role, invalid container) in the
    // terminal itself instead of leaving a silent blank screen.
    const onReady = (payload: { success: boolean; error?: string }) => {
      if (!payload.success && payload.error) {
        term.write(`

[31m${payload.error}[0m

`);
      }
    };

    socket.off('terminal:data');
    socket.on('terminal:data', onData);
    socket.off('terminal:ready');
    socket.on('terminal:ready', onReady);

    // The socket is authenticated at the handshake and stays closed until a
    // session exists, so make sure it is open before requesting a shell.
    connectSocket();

    const requestShell = () => socket.emit('terminal:init', { containerId });
    if (socket.connected) {
      requestShell();
    } else {
      socket.once('connect', requestShell);
    }

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.off('terminal:data', onData);
      socket.off('terminal:ready', onReady);
      socket.off('connect', requestShell);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-container p-4 rounded-lg border border-outline-variant shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded bg-primary/10 text-primary">
            <TerminalIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-white text-base">Terminal Web Interativo (SSH / Shell)</h2>
            <p className="text-xs text-on-surface-variant">
              Acesso root direto ao sistema operacional da VPS ou dentro dos containers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Target shell selector */}
          <div className="flex items-center gap-1.5 bg-surface-container-low px-3 py-1.5 rounded border border-outline-variant text-xs">
            <span className="text-on-surface-variant/70 font-semibold uppercase text-[10px]">Ambiente:</span>
            <select
              value={selectedContainer}
              onChange={(e) => setSelectedContainer(e.target.value)}
              className="bg-transparent text-on-surface font-medium focus:outline-none cursor-pointer"
            >
              <option value="" className="bg-surface-container-low text-white">Shell do Servidor Host</option>
              {containers.map((c) => (
                <option key={c.id} value={c.id} className="bg-surface-container-low text-white">
                  Docker: {c.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleClear}
            title="Limpar tela"
            className="p-2 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            onClick={handleRestart}
            title="Reiniciar sessão"
            className="p-2 rounded bg-primary-container/20 hover:bg-primary-container/30 text-primary border border-primary/30 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Screen Container */}
      <div className="flex-1 bg-surface-container-lowest rounded-lg border border-outline-variant p-3 overflow-hidden relative">
        <div ref={terminalRef} className="w-full h-full" />
      </div>
    </div>
  );
};
