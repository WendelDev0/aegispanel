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
    vi.mocked(api.get).mockResolvedValue({
      data: {
        id: 'waflow-1',
        name: 'Boas-vindas',
        published: false,
        nodes: [],
        edges: [],
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      },
    });
  });

  it('renders the block palette', async () => {
    render(<FlowEditor flowId="waflow-1" onBack={() => {}} />);
    expect(await screen.findByText('Blocos')).toBeTruthy();
    expect(screen.getByText('Mensagem recebida')).toBeTruthy();
    expect(screen.getByText('Evento do painel')).toBeTruthy();
    expect(screen.getByText('Enviar texto')).toBeTruthy();
    expect(screen.getByText('Menu')).toBeTruthy();
    expect(screen.getByText('Aguardar resposta')).toBeTruthy();
    expect(screen.getByText('Condição')).toBeTruthy();
    expect(screen.getByText('Encerrar')).toBeTruthy();
  });
});
