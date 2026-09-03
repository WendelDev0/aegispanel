import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EnvModal } from './EnvModal';
import type { AppRecord } from '../../types';

vi.mock('../../services/api.js', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

vi.mock('../EnvEditor.js', () => ({
  EnvEditor: ({ title }: { title?: string }) => <div>{title}</div>,
}));

import { api } from '../../services/api.js';

const app: AppRecord = {
  id: 'app-1',
  name: 'demo',
  sourceType: 'image',
  port: 4100,
  internalPort: 3000,
  env: {},
  status: 'running',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('EnvModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: { env: { PORT: '3000' } } });
  });

  it('loads env and shows save control', async () => {
    render(<EnvModal app={app} onClose={() => {}} onSaved={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/apps/app-1/env');
    });

    expect(screen.getByText(/Variáveis de Ambiente/)).toBeTruthy();
    expect(screen.getByText(/Aplicação: demo/)).toBeTruthy();
    expect(screen.getByText(/Reiniciar contêiner/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Salvar Variáveis/ })).toBeTruthy();
  });
});
