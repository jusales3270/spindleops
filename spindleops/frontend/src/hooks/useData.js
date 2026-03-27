import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = `ws://${window.location.hostname}:3001`;

export function useLiveData() {
  const [machines, setMachines] = useState({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const retryRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        clearTimeout(retryRef.current);
      };

      ws.onmessage = ({ data }) => {
        const msg = JSON.parse(data);
        if (msg.type === 'snapshot') {
          const map = {};
          msg.data.forEach(m => { map[m.machine_id] = m; });
          setMachines(map);
        } else if (msg.type === 'metrics') {
          setMachines(prev => ({ ...prev, [msg.machineId]: msg.data }));
        }
      };

      ws.onerror = () => setConnected(false);
      ws.onclose = () => {
        setConnected(false);
        retryRef.current = setTimeout(connect, 3000);
      };
    } catch {}
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { machines: Object.values(machines), connected };
}

export function useAPI(path, intervalMs = 0) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const res  = await fetch(`http://localhost:3001/api${path}`);
      const json = await res.json();
      setData(json);
    } catch {}
    finally { setLoading(false); }
  }, [path]);

  useEffect(() => {
    load();
    if (intervalMs > 0) {
      const t = setInterval(load, intervalMs);
      return () => clearInterval(t);
    }
  }, [load, intervalMs]);

  return { data, loading, refetch: load };
}
