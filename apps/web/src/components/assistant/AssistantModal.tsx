import { useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  // 2026-11-04：挂到 body 而不是 layout 内部。原先 overlay 是 .app-shell 的子节点，
  // 窄屏（390×844）实测页面头部的 .page-actions 浮在上层，把弹窗顶边和关闭按钮盖住，
  // 命中测试却仍然返回弹窗内部元素（看得见却点不到，且不知道是谁盖的）。
  // 弹窗属于全局层，放在 body 下就不受任何页面容器的层叠影响。
  return createPortal(
    <div className="assistant-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="assistant-modal" role="dialog" aria-modal="true" aria-label="成本助手" data-focus-trap="modal">
        <button type="button" className="assistant-modal-close" aria-label="关闭成本助手" onClick={onClose}><X size={17} /></button>
        <AssistantWorkspace />
      </section>
    </div>,
    document.body,
  );
}
