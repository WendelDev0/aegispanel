import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WebhookModal } from './WebhookModal';
import type { AppRecord } from '../../types';

vi.mock('../../services/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn() },
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

describe('WebhookModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: { url: 'https://painel.example/api/hooks/abc' },
    });
  });

  it('shows the payload URL from the dedicated endpoint', async () => {
    render(<WebhookModal app={app} onClose={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/apps/app-1/webhook');
    });

    expect(screen.getByText(/Webhook de Auto-Deploy/)).toBeTruthy();
    expect(screen.getByText('https://painel.example/api/hooks/abc')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Gerar novo segredo/ })).toBeTruthy();
  });
});
