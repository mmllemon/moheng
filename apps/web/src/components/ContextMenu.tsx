import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

export type ContextMenuItem = {
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type ContextMenuEntry = ContextMenuItem | { heading: string } | { divider: true };

export default function ContextMenu({ x, y, items, label = '上下文菜单', onClose }: {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  label?: string;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const padding = 8;
    setPosition({
      left: Math.max(padding, Math.min(x, window.innerWidth - rect.width - padding)),
      top: Math.max(padding, Math.min(y, window.innerHeight - rect.height - padding)),
    });
  }, [x, y]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const enabledItems = () => itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
  const moveFocus = (direction: 1 | -1) => {
    const buttons = enabledItems();
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(current + direction + buttons.length) % buttons.length]?.focus();
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(-1); }
    else if (event.key === 'Home') { event.preventDefault(); enabledItems()[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); enabledItems().at(-1)?.focus(); }
  };

  let itemIndex = 0;
  return createPortal(
    <div
      ref={menuRef}
      className="hana-context-menu"
      role="menu"
      aria-label={label}
      style={position}
      onKeyDown={onMenuKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((entry, index) => {
        if ('divider' in entry) return <div className="hana-context-divider" role="separator" key={`divider-${index}`} />;
        if ('heading' in entry) return <div className="hana-context-heading" key={`heading-${index}`}>{entry.heading}</div>;
        const Icon = entry.icon;
        const currentIndex = itemIndex++;
        return <button
          key={`${entry.label}-${currentIndex}`}
          ref={(element) => { itemRefs.current[currentIndex] = element; }}
          type="button"
          role="menuitem"
          className={`hana-context-item ${entry.danger ? 'is-danger' : ''}`}
          disabled={entry.disabled}
          onClick={() => { if (!entry.disabled) { entry.onSelect(); onClose(); } }}
        >
          <span className="hana-context-icon">{Icon ? <Icon size={14} strokeWidth={1.6} /> : null}</span>
          <span>{entry.label}</span>
          {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
        </button>;
      })}
    </div>,
    document.body,
  );
}
