import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/auth.store';

/** Use same origin in dev (Vite proxies /socket.io) */
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || '';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const token = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.userId);
  const role = useAuthStore((s) => s.role);

  useEffect(() => {
    if (!token || !userId) return;
    const s = io(API_ORIGIN, {
      transports: ['websocket', 'polling'],
      extraHeaders: { Authorization: `Bearer ${token}` },
    });
    socketRef.current = s;
    s.on('connect', () => {
      if (role) s.emit('rejoin_rooms', { user_id: userId, role });
    });
    return () => {
      s.disconnect();
    };
  }, [token, userId, role]);

  return socketRef.current;
}
