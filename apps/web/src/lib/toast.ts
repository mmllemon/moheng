export type ToastTone = 'default' | 'error';

export type ToastOptions = {
  description?: string;
  tone?: ToastTone;
  duration?: number;
  action?: { label: string; onClick: () => void };
};

export type ToastPayload = ToastOptions & { id: number; title: string };

const TOAST_EVENT = 'moheng:toast';
let nextToastId = 0;

export function toast(title: string, options: ToastOptions = {}) {
  if (typeof window === 'undefined') return;
  const payload: ToastPayload = { id: ++nextToastId, title, duration: 3200, ...options };
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }));
}

export function subscribeToast(handler: (payload: ToastPayload) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<ToastPayload>).detail);
  window.addEventListener(TOAST_EVENT, listener);
  return () => window.removeEventListener(TOAST_EVENT, listener);
}
