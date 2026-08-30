import { Server as SocketIOServer } from 'socket.io';

/**
 * Holds the Socket.IO server so services can emit without importing server.ts,
 * which would create an import cycle (server -> routes -> services -> server).
 */
let ioInstance: SocketIOServer | null = null;

export function setIo(instance: SocketIOServer): void {
  ioInstance = instance;
}

export function getIo(): SocketIOServer | null {
  return ioInstance;
}

/** Emits only when the realtime server is up; never throws into a caller. */
export function emit(event: string, payload: unknown): void {
  try {
    ioInstance?.emit(event, payload);
  } catch {
    // realtime delivery is best-effort and must not fail the calling operation
  }
}

export function connectedClients(): number {
  return ioInstance?.engine?.clientsCount ?? 0;
}
