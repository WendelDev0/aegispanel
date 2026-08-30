import { io, Socket } from 'socket.io-client';

export const TOKEN_KEY = 'aegis_token';

/**
 * The realtime channel carries the interactive terminal, so the server rejects
 * an unauthenticated handshake. The socket therefore starts disconnected and
 * is opened only once a session token exists.
 */
export const socket: Socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  auth: (cb) => cb({ token: localStorage.getItem(TOKEN_KEY) || '' }),
});

/** Opens the connection with the current token, reconnecting if it changed. */
export function connectSocket(): void {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  if (socket.connected) return;
  socket.connect();
}

export function disconnectSocket(): void {
  if (socket.connected || socket.active) {
    socket.disconnect();
  }
}

socket.on('connect_error', (err) => {
  // An expired token cannot be recovered by retrying; the HTTP layer will
  // redirect to the login screen on the next request.
  if (err.message.startsWith('unauthorized')) {
    socket.disconnect();
    console.warn('WebSocket não autorizado:', err.message);
  }
});
