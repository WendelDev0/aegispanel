import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EditAppModal } from './EditAppModal';
import type { AppRecord } from '../../types';

vi.mock('../../services/api.js', () => ({
  api: { get: vi.fn(), put: vi.fn() },
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

describe('EditAppModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ id: 'node-local', name: 'Este Servidor', isLocal: true, status: 'online' }],
    });
  });

  it('shows destination node select', async () => {
    render(<EditAppModal app={app} onClose={() => {}} onSaved={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/nodes');
    });

    expect(screen.getByText(/Configurações: demo/)).toBeTruthy();
    expect(screen.getByText(/Nó de destino/i)).toBeTruthy();
  });
});
