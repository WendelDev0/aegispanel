import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PanelUpdateButton } from './PanelUpdateButton';

vi.mock('../services/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../services/socket.js', () => ({
  socket: { on: vi.fn(), off: vi.fn() },
}));

import { api } from '../services/api.js';

describe('PanelUpdateButton', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows Atualizar when origin is ahead', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        available: true,
        canApply: true,
        updating: false,
        behind: 2,
        remoteSubject: 'feat(flows): native WhatsApp builder',
        currentSha: 'aaa',
        remoteSha: 'bbb',
      },
    });
    render(<PanelUpdateButton />);
    expect(await screen.findByText('Atualizar (2)')).toBeTruthy();
  });

  it('stays hidden when already up to date', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { available: false, canApply: true, updating: false, behind: 0, remoteSubject: '', currentSha: 'aaa', remoteSha: 'aaa' },
    });
    render(<PanelUpdateButton />);
    await vi.waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByText(/Atualizar/)).toBeNull();
  });
});
