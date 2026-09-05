import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ToastProvider } from '../Toast';
import { AppBuildPanel } from './AppBuildPanel';
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
  buildConfig: { runtime: 'python', version: '3.12', source: 'detected' },
};

describe('AppBuildPanel', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        dockerfile: 'FROM python:3.12-slim\nUSER app\nHEALTHCHECK CMD true',
        sourceByField: { runtime: 'detected', version: 'toml' },
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the origin badge for a field from aegis.toml', async () => {
    render(
      <ToastProvider>
        <AppBuildPanel app={app} onSaved={() => {}} />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/apps/app-1/recipe');
    });

    expect(screen.getAllByText('aegis.toml').length).toBeGreaterThan(0);
    expect(screen.getByText(/Receita \(Dockerfile\)/)).toBeTruthy();
  });
});
