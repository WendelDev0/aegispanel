import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpPage } from './HelpPage';
import { findHelpStack } from './helpStacks';

afterEach(() => {
  cleanup();
});

describe('HelpPage', () => {
  it('starts on the Node family with the universal Vercel prompt', () => {
    render(<HelpPage />);

    expect(screen.getByRole('button', { name: /Node \/ frontend/i, pressed: true })).toBeTruthy();
    expect(screen.getByText(/Checklist: Vercel vs AegisPanel/)).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(findHelpStack('universal').prompt);
  });

  it('switches to Python and shows FastAPI, Django and Flask prompts', async () => {
    const user = userEvent.setup();
    render(<HelpPage />);

    await user.click(screen.getByRole('button', { name: /Python/i }));

    expect(screen.getByRole('button', { name: /^Python$/i, pressed: true })).toBeTruthy();
    expect(screen.getByText(/Como o Aegis hospeda Python/)).toBeTruthy();
    expect(screen.getByText(/Checklist rápido Python/)).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(findHelpStack('python').prompt);
    expect(screen.queryByText(/Checklist: Vercel vs AegisPanel/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'FastAPI' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('uvicorn main:app');

    await user.click(screen.getByRole('button', { name: 'Django' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('python manage.py migrate --noinput');

    await user.click(screen.getByRole('button', { name: 'Flask' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('gunicorn --bind 0.0.0.0:$PORT');
  });

  it('copies the selected Python prompt', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<HelpPage />);
    await user.click(screen.getByRole('button', { name: /Python/i }));
    await user.click(screen.getByRole('button', { name: /Copiar prompt/i }));

    expect(writeText).toHaveBeenCalledWith(findHelpStack('python').prompt);
    expect(screen.getByText(/Prompt copiado com sucesso/)).toBeTruthy();
  });
});
