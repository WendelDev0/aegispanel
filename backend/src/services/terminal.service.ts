import { Socket } from 'socket.io';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { CONFIG } from '../config.js';
import { AuthUser, authenticateToken, adminHas2fa } from '../middleware/auth.js';
import { dockerService } from './docker.service.js';
import { AuditStore } from '../utils/audit.store.js';

/** Docker accepts a container id (hex) or a name; both are constrained here. */
const CONTAINER_REF = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export class TerminalService {
  /**
   * Attaches an interactive shell to an already-authenticated socket.
   *
   * Authentication happens in the Socket.IO handshake middleware; this method
   * additionally enforces what the caller's role is allowed to open. A host
   * shell in this process is equivalent to root on the machine, because the
   * container mounts the Docker socket.
   */
  static handleSocketConnection(socket: Socket, user: AuthUser) {
    let ptyProcess: ChildProcessWithoutNullStreams | null = null;

    const currentUser = (): AuthUser | null => {
      try {
        const token = socket.data.authToken as string | undefined;
        return token ? authenticateToken(token) : null;
      } catch {
        return null;
      }
    };

    const revokeSocket = () => {
      if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
      }
      socket.emit('terminal:data', '\r\n\x1b[31m[Sessão revogada. Faça login novamente.]\x1b[0m\r\n');
      socket.disconnect(true);
    };

    const deny = (reason: string) => {
      socket.emit('terminal:data', `\r\n\x1b[31m[${reason}]\x1b[0m\r\n`);
      socket.emit('terminal:ready', { success: false, error: reason });
    };

    socket.on('terminal:init', async (options: { containerId?: string; shell?: string } = {}) => {
      const sessionUser = currentUser();
      if (!sessionUser) {
        revokeSocket();
        return;
      }

      if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
      }

      const wantsHostShell = !options?.containerId;

      if (wantsHostShell && sessionUser.role !== 'admin') {
        AuditStore.append({
          actor: { id: sessionUser.id, username: sessionUser.username, role: sessionUser.role },
          sid: sessionUser.sid,
          action: 'terminal.host.open',
          outcome: 'forbidden',
        });
        deny('Permissão negada: o terminal do host é restrito ao perfil admin.');
        return;
      }

      if (wantsHostShell && CONFIG.REQUIRE_2FA_ADMIN && !adminHas2fa(sessionUser.id)) {
        AuditStore.append({
          actor: { id: sessionUser.id, username: sessionUser.username, role: sessionUser.role },
          sid: sessionUser.sid,
          action: 'terminal.host.open',
          outcome: 'forbidden',
          meta: { reason: '2fa_required' },
        });
        deny('Ative a autenticação em dois fatores para abrir o terminal do host.');
        return;
      }

      if (!wantsHostShell && sessionUser.role === 'viewer') {
        deny('Permissão negada: o perfil viewer não pode abrir terminais.');
        return;
      }

      let command: string;
      let args: string[] = [];

      if (options.containerId) {
        if (!CONTAINER_REF.test(options.containerId)) {
          deny('Identificador de contêiner inválido.');
          return;
        }
        const type = await dockerService.getManagedContainerType(options.containerId);
        if (!type || (sessionUser.role !== 'admin' && type !== 'app')) {
          deny('Permissão negada: o terminal só pode acessar workloads gerenciados pelo painel.');
          return;
        }
        command = 'docker';
        args = ['exec', '-i', options.containerId, 'sh'];
      } else if (CONFIG.IS_WINDOWS) {
        command = 'powershell.exe';
        args = ['-NoLogo'];
      } else {
        // The shell is never taken from the client: an arbitrary value here is
        // arbitrary command execution.
        command = 'bash';
        args = [];
      }

      try {
        ptyProcess = spawn(command, args, {
          env: { ...process.env, TERM: 'xterm-256color' },
          shell: false,
        });

        console.log(
          `🖥️  Terminal aberto por "${sessionUser.username}" (${sessionUser.role}) -> ${options.containerId ? `container ${options.containerId}` : 'host'}`
        );

        ptyProcess.stdout.on('data', (data: Buffer) => {
          socket.emit('terminal:data', data.toString('utf-8'));
        });

        ptyProcess.stderr.on('data', (data: Buffer) => {
          socket.emit('terminal:data', data.toString('utf-8'));
        });

        ptyProcess.on('close', (code) => {
          socket.emit('terminal:data', `\r\n\x1b[33m[Process completed with code ${code}]\x1b[0m\r\n`);
        });

        ptyProcess.on('error', (err) => {
          socket.emit('terminal:data', `\r\n\x1b[31m[Process error: ${err.message}]\x1b[0m\r\n`);
        });

        socket.emit('terminal:ready', { success: true });
        AuditStore.append({
          actor: { id: sessionUser.id, username: sessionUser.username, role: sessionUser.role },
          sid: sessionUser.sid,
          action: wantsHostShell ? 'terminal.host.open' : 'terminal.container.open',
          outcome: 'success',
          target: options.containerId
            ? { type: 'container', id: options.containerId }
            : { type: 'host', name: 'host' },
        });
      } catch (err: any) {
        socket.emit('terminal:data', `\r\n\x1b[31m[Failed to start shell: ${err.message}]\x1b[0m\r\n`);
      }
    });

    socket.on('terminal:input', (data: string) => {
      if (!currentUser()) {
        revokeSocket();
        return;
      }
      if (ptyProcess && ptyProcess.stdin.writable) {
        ptyProcess.stdin.write(data);
      }
    });

    socket.on('disconnect', () => {
      if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
      }
    });
  }
}
