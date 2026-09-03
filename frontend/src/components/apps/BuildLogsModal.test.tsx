import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BuildLogsModal } from './BuildLogsModal';
import type { DeploymentRecord } from '../../types';

const sample: DeploymentRecord = {
  id: 'dep-1',
  appId: 'app-1',
  appName: 'demo-app',
  branch: 'main',
  status: 'success',
  buildLogs: 'build ok line',
  durationSeconds: 3,
  triggeredBy: 'manual',
  createdAt: new Date().toISOString(),
};

describe('BuildLogsModal', () => {
  it('renders build output text', () => {
    render(<BuildLogsModal deployment={sample} onClose={() => {}} />);
    expect(screen.getByText(/Build Output: demo-app/)).toBeTruthy();
    expect(screen.getByText(/build ok line/)).toBeTruthy();
  });
});
