import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveDeployModal } from './LiveDeployModal';
import type { AppRecord } from '../../types';

const app: AppRecord = {
  id: 'app-1',
  name: 'demo',
  sourceType: 'git',
  port: 4100,
  internalPort: 3000,
  env: {},
  status: 'building',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('LiveDeployModal', () => {
  it('shows live step, status and build logs', () => {
    render(
      <LiveDeployModal
        state={{
          app,
          step: 4,
          stepName: 'Build Docker',
          logs: 'Step 4/5 compiling...\n',
          percentage: 70,
          status: 'running',
        }}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/Deploy em Tempo Real: demo/)).toBeTruthy();
    expect(screen.getByText(/Step 4\/5: Build Docker/)).toBeTruthy();
    expect(screen.getByText(/Step 4\/5 compiling/)).toBeTruthy();
    expect(screen.getByText('RUNNING')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Minimizar' })).toBeTruthy();
  });
});
