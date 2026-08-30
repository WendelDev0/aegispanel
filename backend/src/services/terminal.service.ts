import { Socket } from 'socket.io';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { CONFIG } from '../config.js';
import { AuthUser } from '../middleware/auth.js';

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

    const deny = (reason: string) => {
      socket.emit('terminal:data', `\r\n\x1b[31m[${reason}]\x1b[0m\r\n`);
      socket.emit('terminal:ready', { success: false, error: reason });
    };

    socket.on('terminal:init', (options: { containerId?: string; shell?: string }) => {
      if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
      }

      const wantsHostShell = !options?.containerId;

      if (wantsHostShell && user.role !== 'admin') {
        deny('Permissão negada: o terminal do host é restrito ao perfil admin.');
        return;
      }

      if (!wantsHostShell && user.role === 'viewer') {
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
          `🖥️  Terminal aberto por "${user.username}" (${user.role}) -> ${options.containerId ? `container ${options.containerId}` : 'host'}`
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
      } catch (err: any) {
        socket.emit('terminal:data', `\r\n\x1b[31m[Failed to start shell: ${err.message}]\x1b[0m\r\n`);
      }
    });

    socket.on('terminal:input', (data: string) => {
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
