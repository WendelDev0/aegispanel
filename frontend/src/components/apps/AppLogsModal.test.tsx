import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppLogsModal } from './AppLogsModal';
import type { AppRecord } from '../../types';

vi.mock('../../services/api.js', () => ({
  api: { get: vi.fn() },
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

describe('AppLogsModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: { logs: 'listening on :3000' } });
  });

  it('loads and displays container logs', async () => {
    render(<AppLogsModal app={app} onClose={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/apps/app-1/logs');
    });

    expect(screen.getByText(/Logs da Aplicação: demo/)).toBeTruthy();
    expect(screen.getByText('listening on :3000')).toBeTruthy();
  });
});
