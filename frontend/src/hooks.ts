import { useEffect, useRef, useState } from 'react';
import { BACKEND_URL } from './api.js';

export function useLiveSensors(onUpdate: () => void) {
  const [live, setLive] = useState(false);
  const cb = useRef(onUpdate);
  cb.current = onUpdate;
  useEffect(() => {
    const backend = BACKEND_URL ? new URL(BACKEND_URL, location.origin) : new URL(location.origin);
    backend.protocol = backend.protocol === 'https:' ? 'wss:' : 'ws:';
    backend.pathname = '/ws';
    backend.search = '';
    backend.hash = '';
    const ws = new WebSocket(backend.toString());
    ws.onopen = () => setLive(true);
    ws.onclose = () => setLive(false);
    ws.onmessage = () => cb.current();
    return () => ws.close();
  }, []);
  return live;
}
