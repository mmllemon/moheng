import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { subscribeToast, type ToastPayload } from '../lib/toast';

type ActiveToast = ToastPayload & { leaving?: boolean };

export default function ToastHost() {
  const [items, setItems] = useState<ActiveToast[]>([]);
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    const dismiss = (id: number) => {
      setItems((current) => current.map((item) => item.id === id ? { ...item, leaving: true } : item));
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
        const timer = timers.current.get(id);
        if (timer) window.clearTimeout(timer);
        timers.current.delete(id);
      }, 180);
    };
    const unsubscribe = subscribeToast((payload) => {
      setItems((current) => [...current.filter((item) => item.id !== payload.id), payload].slice(-3));
      const timer = window.setTimeout(() => dismiss(payload.id), payload.duration ?? 3200);
      timers.current.set(payload.id, timer);
    });
    return () => {
      unsubscribe();
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  if (!items.length) return null;
  return <div className="hana-toast-host">
    {items.map((item) => <div key={item.id} className={`hana-toast ${item.tone === 'error' ? 'is-error' : ''} ${item.leaving ? 'is-leaving' : ''}`} role={item.tone === 'error' ? 'alert' : 'status'}>
      <div className="hana-toast-copy"><strong>{item.title}</strong>{item.description && <small>{item.description}</small>}</div>
      {item.action && <button type="button" className="hana-toast-action" onClick={() => { item.action?.onClick(); }}>{item.action.label}</button>}
      <button type="button" className="hana-toast-close" aria-label="关闭通知" onClick={() => { const timer = timers.current.get(item.id); if (timer) window.clearTimeout(timer); timers.current.delete(item.id); setItems((current) => current.filter((entry) => entry.id !== item.id)); }}><X size={14} /></button>
    </div>)}
  </div>;
}
