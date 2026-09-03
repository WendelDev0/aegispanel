import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CreateAppModal } from './CreateAppModal';

vi.mock('../../services/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../../services/api.js';

describe('CreateAppModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({
      data: [{ id: 'node-local', name: 'Este Servidor', isLocal: true, status: 'online' }],
    });
  });

  it('shows destination node select label', async () => {
    render(<CreateAppModal onCreated={() => {}} onCancel={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/nodes');
    });

    expect(screen.getByText(/Nó de destino/i)).toBeTruthy();
  });

  it('does not block git with the old image-only remote warning', async () => {
    render(<CreateAppModal onCreated={() => {}} onCancel={() => {}} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/nodes');
    });

    expect(screen.queryByText(/ainda só aceita origem imagem/i)).toBeNull();
  });
});
