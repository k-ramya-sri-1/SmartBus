import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:5000'

/**
 * The dashboard feed carries live student movement, so the connection is
 * authenticated with the same session token the REST calls use. The server
 * rejects an anonymous handshake.
 */
const socket = io(SOCKET_URL, {
  transports: ['websocket'],
  autoConnect: false,
  auth: {
    token: sessionStorage.getItem('smartbus_token'),
  },
})

export function connectSocket(): void {
  socket.auth = { token: sessionStorage.getItem('smartbus_token') }

  if (!socket.connected) {
    socket.connect()
  }
}

export function disconnectSocket(): void {
  if (socket.connected) {
    socket.disconnect()
  }
}

export default socket
