import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'default' | 'danger';
};
export type PromptOptions = ConfirmOptions & {
  inputLabel: string;
  placeholder?: string;
  minLength?: number;
  multiline?: boolean;
};
type Request =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void };

let enqueue: ((request: Request) => void) | null = null;

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!enqueue) { resolve(false); return; }
    enqueue({ kind: 'confirm', options, resolve });
  });
}

export function promptAction(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (!enqueue) { resolve(null); return; }
    enqueue({ kind: 'prompt', options, resolve });
  });
}

/** Promise-friendly confirm for inline handlers. */
export function confirmThen(message: string, action: () => void, options: Partial<ConfirmOptions> = {}) {
  void confirmAction({
    title: options.title ?? '请确认操作',
    description: options.description ?? message,
    confirmText: options.confirmText ?? '确认',
    cancelText: options.cancelText ?? '取消',
    tone: options.tone ?? 'default',
  }).then((ok) => { if (ok) action(); });
}

export default function ConfirmHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const currentRef = useRef<Request | null>(null);
  const queue = useRef<Request[]>([]);

  useEffect(() => {
    enqueue = (request) => {
      if (currentRef.current) { queue.current.push(request); return; }
      currentRef.current = request;
      setCurrent(request);
      setValue('');
    };
    return () => { enqueue = null; };
  }, []);

  useEffect(() => { setValue(''); }, [current]);

  if (!current) return null;
  const options = current.options;
  const isPrompt = current.kind === 'prompt';
  const prompt = isPrompt ? current.options as PromptOptions : null;
  const minLength = prompt?.minLength ?? 1;
  const canConfirm = !prompt || value.trim().length >= minLength;
  const danger = options.tone === 'danger';

  function finish(confirmed: boolean) {
    const request = currentRef.current;
    if (!request) return;
    if (request.kind === 'prompt') {
      request.resolve(confirmed && value.trim().length >= (request.options.minLength ?? 1) ? value.trim() : null);
    } else {
      request.resolve(confirmed);
    }
    const next = queue.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
    setValue('');
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (canConfirm) finish(true);
  }

  return createPortal(
    <div className="modal-backdrop confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) finish(false); }}>
      <section className="dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby={options.description ? 'confirm-dialog-description' : undefined}>
        <header className="dialog-header">
          <div className="confirm-dialog-heading">
            <span className={`confirm-dialog-icon ${danger ? 'is-danger' : ''}`}><AlertTriangle size={17} /></span>
            <div><h2 id="confirm-dialog-title">{options.title}</h2>{options.description && <p id="confirm-dialog-description">{options.description}</p>}</div>
          </div>
          <button type="button" className="icon-button" aria-label="关闭确认对话框" onClick={() => finish(false)}><X size={18} /></button>
        </header>
        <form onSubmit={submit}>
          {prompt && <div className="confirm-dialog-body">
            <div className="field">
              <label htmlFor="confirm-dialog-input">{prompt.inputLabel}</label>
              {prompt.multiline
                ? <textarea id="confirm-dialog-input" data-autofocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={prompt.placeholder} minLength={prompt.minLength} maxLength={500} />
                : <input id="confirm-dialog-input" data-autofocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={prompt.placeholder} minLength={prompt.minLength} maxLength={200} />}
              <small className="field-hint">{value.trim().length < minLength ? `至少填写 ${minLength} 个字符` : '内容会写入操作记录或业务备注。'}</small>
            </div>
          </div>}
          <footer className="dialog-footer">
            <button type="button" className="button button-secondary" data-autofocus={!prompt ? '' : undefined} onClick={() => finish(false)}>{options.cancelText ?? '取消'}</button>
            <button type="submit" className={`button ${danger ? 'button-danger confirm-danger' : 'button-primary'}`} disabled={!canConfirm}>{options.confirmText ?? (danger ? '确认执行' : '确认')}</button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
