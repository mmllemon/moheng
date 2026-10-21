import { useEffect } from 'react';
import { X } from 'lucide-react';
import AssistantWorkspace from './AssistantWorkspace';

export default function AssistantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('.date-picker-popover, .select-popover')) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return <div className="assistant-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="assistant-modal" role="dialog" aria-modal="true" aria-label="成本助手" data-focus-trap="modal">
      <button type="button" className="assistant-modal-close" aria-label="关闭成本助手" onClick={onClose}><X size={17} /></button>
      <AssistantWorkspace />
    </section>
  </div>;
}
