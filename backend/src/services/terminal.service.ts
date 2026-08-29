import { Socket } from 'socket.io';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import os from 'os';
import { CONFIG } from '../config.js';

export class TerminalService {
  static handleSocketConnection(socket: Socket) {
    let ptyProcess: ChildProcessWithoutNullStreams | null = null;

    socket.on('terminal:init', (options: { containerId?: string; shell?: string }) => {
      if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
      }

      const isWin = CONFIG.IS_WINDOWS;
      let command: string;
      let args: string[] = [];

      if (options.containerId) {
        // Execute inside docker container
        command = 'docker';
        args = ['exec', '-i', options.containerId, 'sh'];
      } else {
        // Host system shell
        if (isWin) {
          command = 'powershell.exe';
          args = ['-NoLogo'];
        } else {
          command = options.shell || 'bash';
          args = [];
        }
      }

      try {
        ptyProcess = spawn(command, args, {
          env: { ...process.env, TERM: 'xterm-256color' },
          shell: false,
        });

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
