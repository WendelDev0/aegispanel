import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowEditor } from './FlowEditor';

vi.mock('../../services/api.js', () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children?: import('react').ReactNode }) => <div data-testid="canvas">{children}</div>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  addEdge: () => [],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  useNodesState: () => [[], vi.fn(), vi.fn()],
}));

import { api } from '../../services/api.js';

describe('FlowEditor', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (String(url).includes('/inbound')) return { data: { events: [] } };
      if (String(url).includes('/instances')) {
        return {
          data: {
            ok: true,
            managerUrl: 'https://evo.example.com/manager',
            instances: [
              { name: 'clinica', connectionStatus: 'open', number: '5511999990000', profileName: 'Clínica' },
            ],
          },
        };
      }
      return {
        data: {
          id: 'waflow-1',
          name: 'Boas-vindas',
          published: false,
          nodes: [],
          edges: [],
          createdAt: '2026-09-05T00:00:00.000Z',
          updatedAt: '2026-09-05T00:00:00.000Z',
        },
      };
    });
  });

  it('renders the block palette', async () => {
    render(<FlowEditor flowId="waflow-1" onBack={() => {}} />);
    expect(await screen.findByText('Blocos')).toBeTruthy();
    expect(screen.getByText('Ouvir cliente')).toBeTruthy();
    expect(screen.getByText('Ouvir painel')).toBeTruthy();
    expect(screen.getByText('Enviar mensagem')).toBeTruthy();
    expect(screen.getByText('Menu interativo')).toBeTruthy();
    expect(screen.getByText('Agente IA')).toBeTruthy();
    expect(screen.getByText('Transbordo humano')).toBeTruthy();
    expect(screen.getByText('Finalizar fluxo')).toBeTruthy();
    expect(screen.getByText(/Rascunho: vincule uma linha conectada/)).toBeTruthy();
    expect(await screen.findByText('Linhas WhatsApp')).toBeTruthy();
    expect(screen.getByText('Nova instância')).toBeTruthy();
    expect(screen.getByText('clinica')).toBeTruthy();
  });
});
