import { useEffect } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function overlayElement(): HTMLElement | null {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('.ldg-drawer-layer, .modal-backdrop')).filter(isVisible);
  if (overlays.length) return overlays[overlays.length - 1];
  const marked = Array.from(document.querySelectorAll<HTMLElement>('[data-focus-trap]'))
    .filter((element) => element.getAttribute('data-focus-trap') !== 'false' && element.getAttribute('aria-hidden') !== 'true' && isVisible(element));
  if (marked.length) return marked[marked.length - 1];
  const palette = document.querySelector<HTMLElement>('.command-palette-layer.is-visible');
  return palette && isVisible(palette) ? palette : null;
}

function popoverRoots() {
  return Array.from(document.querySelectorAll<HTMLElement>('.date-picker-popover, .select-popover')).filter(isVisible);
}

function focusRoots(overlay: HTMLElement) {
  const roots: HTMLElement[] = [overlay];
  for (const popover of popoverRoots()) {
    if (!overlay.contains(popover) && !roots.includes(popover)) roots.push(popover);
  }
  return roots;
}

function focusables(overlay: HTMLElement) {
  const seen = new Set<HTMLElement>();
  const items: HTMLElement[] = [];
  for (const root of focusRoots(overlay)) {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (seen.has(element) || !isVisible(element) || element.closest('[inert]')) continue;
      seen.add(element);
      items.push(element);
    }
  }
  return items;
}

function initialTarget(overlay: HTMLElement, items: HTMLElement[]) {
  const explicit = overlay.querySelector<HTMLElement>('[data-autofocus]');
  if (explicit && items.includes(explicit)) return explicit;
  const field = overlay.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])');
  if (field && items.includes(field)) return field;
  return items[0] ?? null;
}

function markDialog(overlay: HTMLElement) {
  if (overlay.getAttribute('data-focus-trap') === 'popover') return;
  const dialog = overlay.matches('.ldg-drawer, .dialog, .command-palette') ? overlay : overlay.querySelector<HTMLElement>('.ldg-drawer, .dialog, .command-palette');
  if (!dialog) return;
  if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
}

export default function FocusTrap() {
  useEffect(() => {
    let current: HTMLElement | null = null;
    let trigger: HTMLElement | null = null;
    let inerted: HTMLElement[] = [];
    let timer: number | null = null;

    const clearInert = () => {
      for (const element of inerted) element.removeAttribute('inert');
      inerted = [];
    };

    const applyInert = (overlay: HTMLElement) => {
      clearInert();
      let node: HTMLElement | null = overlay;
      while (node && node !== document.body) {
        const parent: HTMLElement | null = node.parentElement;
        if (!parent) break;
        for (const sibling of Array.from(parent.children)) {
          if (!(sibling instanceof HTMLElement) || sibling === node) continue;
          if (['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE'].includes(sibling.tagName)) continue;
          if (sibling.matches('.modal-backdrop, .ldg-drawer-layer, .command-palette-layer, .mobile-nav-backdrop, .quick-action-dismiss, .account-menu-dismiss')) continue;
          if (sibling.matches('.date-picker-popover, .select-popover') || sibling.querySelector('.date-picker-popover, .select-popover')) continue;
          if (sibling.hasAttribute('inert')) continue;
          sibling.setAttribute('inert', '');
          inerted.push(sibling);
        }
        node = parent;
      }
    };

    const restoreTrigger = () => {
      const target = trigger;
      trigger = null;
      if (target?.isConnected) window.requestAnimationFrame(() => target.focus());
    };

    const focusInitial = (overlay: HTMLElement) => {
      window.requestAnimationFrame(() => {
        if (!overlay.isConnected || overlay.contains(document.activeElement)) return;
        const items = focusables(overlay);
        initialTarget(overlay, items)?.focus();
      });
    };

    const check = () => {
      const next = overlayElement();
      if (next === current) return;
      if (!next) {
        current = null;
        clearInert();
        restoreTrigger();
        return;
      }
      const active = document.activeElement;
      if (!current && active instanceof HTMLElement && !next.contains(active)) trigger = active;
      current = next;
      markDialog(next);
      if (next.getAttribute('data-focus-trap') === 'popover') clearInert();
      else applyInert(next);
      focusInitial(next);
    };

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(check, 0);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const overlay = overlayElement();
      if (!overlay) return;
      const items = focusables(overlay);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !items.includes(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };

    const onFocusIn = (event: FocusEvent) => {
      const overlay = overlayElement();
      if (!overlay) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (overlay.getAttribute('data-focus-trap') === 'popover') return;
      if (target.closest('.mobile-nav-backdrop, .quick-action-dismiss, .account-menu-dismiss')) return;
      if (overlay.contains(target) || target.closest('.date-picker-popover, .select-popover')) return;
      const items = focusables(overlay);
      (items[0] ?? overlay).focus();
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden', 'open'] });
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    check();

    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      if (timer !== null) window.clearTimeout(timer);
      clearInert();
    };
  }, []);

  return null;
}
