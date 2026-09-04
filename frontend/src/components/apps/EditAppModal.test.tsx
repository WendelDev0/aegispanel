import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { ToastProvider } from '../Toast';
import { EditAppModal } from './EditAppModal';
import type { AppRecord } from '../../types';

vi.mock('../../services/api.js', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

import { api } from '../../services/api.js';

const app: AppRecord = {
  id: 'app-1',
  name: 'demo',
  sourceType: 'git',
  port: 4100,
  internalPort: 3000,
  env: {},
  status: 'running',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** These modals report through toasts, which require the provider. */
const renderWithToast = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<ToastProvider>{ui}</ToastProvider>);

describe('EditAppModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ id: 'node-local', name: 'Este Servidor', isLocal: true, status: 'online' }],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows destination node select', async () => {
    renderWithToast(<EditAppModal app={app} onClose={() => {}} onSaved={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/nodes');
    });

    expect(screen.getByText(/Configurações: demo/)).toBeTruthy();
    expect(screen.getByText(/Nó de destino/i)).toBeTruthy();
  });

  it('shows a single Porta field and hides the app listen port', async () => {
    renderWithToast(<EditAppModal app={app} onClose={() => {}} onSaved={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/nodes');
    });

    expect(screen.getByLabelText(/^Porta$/i)).toBeTruthy();
    expect(screen.queryByText(/Porta Interna/i)).toBeNull();
    expect(screen.queryByLabelText(/Porta que o app escuta/i)).toBeNull();
  });

  it('warns when host and listen ports were copied as the same value', async () => {
    renderWithToast(<EditAppModal
        app={{ ...app, port: 4104, internalPort: 4104 }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/nodes');
    });

    expect(screen.getByText(/porta interna estava igual à do host/i)).toBeTruthy();
    expect(screen.getByLabelText(/Porta que o app escuta/i)).toBeTruthy();
  });

  it('reveals the listen port behind the advanced toggle', async () => {
    renderWithToast(<EditAppModal app={app} onClose={() => {}} onSaved={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/nodes');
    });

    fireEvent.click(screen.getByRole('button', { name: /O app escuta numa porta diferente/i }));
    expect(screen.getByLabelText(/Porta que o app escuta/i)).toBeTruthy();
  });
});
