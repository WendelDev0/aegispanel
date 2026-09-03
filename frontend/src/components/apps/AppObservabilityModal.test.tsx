import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppObservabilityModal } from './AppObservabilityModal';
import type { AppRecord } from '../../types';

vi.mock('../../services/api.js', () => ({
  api: { get: vi.fn() },
}));

import { api } from '../../services/api.js';

const app: AppRecord = {
  id: 'app-1',
  name: 'bomdebolao',
  sourceType: 'git',
  port: 4104,
  internalPort: 3000,
  env: {},
  status: 'running',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('AppObservabilityModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/metrics')) {
        return {
          data: {
            appId: 'app-1',
            appName: 'bomdebolao',
            status: 'running',
            available: true,
            cpuPercent: 12.5,
            memoryUsedBytes: 64 * 1024 * 1024,
            memoryLimitBytes: 256 * 1024 * 1024,
            memoryPercent: 25,
            retainedLogBytes: 2048,
          },
        };
      }
      return {
        data: [
          {
            id: 'alrt-1',
            title: 'Falha no Deploy: bomdebolao',
            message: 'porta ocupada',
            type: 'deploy',
            isError: true,
            appId: 'app-1',
            createdAt: '2026-09-03T12:00:00.000Z',
          },
        ],
      };
    });
  });

  it('shows per-app CPU, memory and alert history', async () => {
    render(<AppObservabilityModal app={app} onClose={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/apps/app-1/metrics');
      expect(api.get).toHaveBeenCalledWith('/apps/app-1/alerts');
    });

    expect(screen.getByText(/Observabilidade: bomdebolao/)).toBeTruthy();
    expect(screen.getByText('12.5%')).toBeTruthy();
    expect(screen.getByText(/Falha no Deploy: bomdebolao/)).toBeTruthy();
    expect(screen.getByText(/porta ocupada/)).toBeTruthy();
  });
});
