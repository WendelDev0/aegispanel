import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastProvider } from '../Toast';
import { DomainModal } from './DomainModal';
import type { AppRecord } from '../../types';

vi.mock('../../services/api.js', () => ({
  api: { put: vi.fn() },
}));

const app: AppRecord = {
  id: 'app-1',
  name: 'demo',
  sourceType: 'image',
  port: 4100,
  internalPort: 3000,
  env: {},
  domain: 'api.meusite.com.br',
  status: 'running',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** These modals report through toasts, which require the provider. */
const renderWithToast = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<ToastProvider>{ui}</ToastProvider>);

describe('DomainModal', () => {
  it('prefills the current domain', () => {
    renderWithToast(<DomainModal app={app} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText(/Domínio \/ Subdomínio/)).toBeTruthy();
    expect(screen.getByDisplayValue('api.meusite.com.br')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Salvar Domínio/ })).toBeTruthy();
  });
});
