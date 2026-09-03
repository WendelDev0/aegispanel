import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiHelpModal } from './AiHelpModal';

describe('AiHelpModal', () => {
  it('shows the Vercel-to-Aegis prompt', () => {
    render(<AiHelpModal onClose={() => {}} />);
    expect(screen.getByText(/Prompt Mágico para IAs/)).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('process.env.PORT');
    expect(screen.getByRole('button', { name: /Copiar Prompt/ })).toBeTruthy();
  });
});
