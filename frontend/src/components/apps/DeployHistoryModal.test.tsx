import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeployHistoryModal } from './DeployHistoryModal';
import type { AppRecord, DeploymentRecord } from '../../types';

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

const deps: DeploymentRecord[] = [
  {
    id: 'dep-1',
    appId: 'app-1',
    appName: 'demo',
    branch: 'main',
    status: 'success',
    buildLogs: '',
    durationSeconds: 5,
    triggeredBy: 'manual',
    commitMessage: 'Primeiro deploy',
    authorName: 'dev',
    createdAt: new Date().toISOString(),
  },
];

describe('DeployHistoryModal', () => {
  it('lists deployments and rollback control', () => {
    render(
      <DeployHistoryModal
        app={app}
        deployments={deps}
        rollingBackId={null}
        onClose={() => {}}
        onOpenLogs={() => {}}
        onRollback={() => {}}
      />
    );
    expect(screen.getByText(/Histórico de Deploys: demo/)).toBeTruthy();
    expect(screen.getByText('Primeiro deploy')).toBeTruthy();
    expect(screen.getByText(/Rollback/)).toBeTruthy();
  });
});
