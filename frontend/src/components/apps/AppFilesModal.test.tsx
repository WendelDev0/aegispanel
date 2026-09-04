import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '../Toast';
import { AppFilesModal } from './AppFilesModal';
import type { AppRecord } from '../../types';

vi.mock('../../services/api.js', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

import { api } from '../../services/api.js';

const app: AppRecord = {
  id: 'app-1',
  name: 'demo',
  sourceType: 'git',
  branch: 'main',
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

describe('AppFilesModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: { items: [{ name: 'package.json', path: 'package.json', isDirectory: false, sizeBytes: 12, modifiedAt: new Date().toISOString() }] },
    });
  });

  it('lists application files', async () => {
    renderWithToast(<AppFilesModal app={app} onClose={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/apps/app-1/files', { params: { subPath: '' } });
    });

    expect(screen.getByText(/Arquivos da Aplicação: demo/)).toBeTruthy();
    expect(screen.getByText('package.json')).toBeTruthy();
  });
});
