import { useEffect, useRef, useState } from 'react';

export function useLiveSensors(onUpdate: () => void) {
  const [live, setLive] = useState(false);
  const cb = useRef(onUpdate);
  cb.current = onUpdate;
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => setLive(true);
    ws.onclose = () => setLive(false);
    ws.onmessage = () => cb.current();
    return () => ws.close();
  }, []);
  return live;
}
