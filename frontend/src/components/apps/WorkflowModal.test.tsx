import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '../Toast';
import { WorkflowModal } from './WorkflowModal';
import type { AppRecord } from '../../types';

vi.mock('../../services/api.js', () => ({
  api: { get: vi.fn() },
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

describe('WorkflowModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: { yaml: 'name: aegis-deploy\non: [push]' },
    });
  });

  it('renders generated GitHub Actions yaml', async () => {
    renderWithToast(<WorkflowModal app={app} onClose={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/apps/app-1/workflow');
    });

    expect(screen.getByText(/GitHub Actions CI\/CD Workflow/)).toBeTruthy();
    expect(screen.getByText(/name: aegis-deploy/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copiar YAML/ })).toBeTruthy();
  });
});
