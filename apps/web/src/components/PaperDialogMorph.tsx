import { useEffect } from 'react';
import { animatePaperIn } from '../lib/paper-morph';

function clickableOrigin(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>('button, a[href], [role="button"], input[type="submit"]');
  return element && !element.closest('.settings-overlay') ? element : null;
}

export default function PaperDialogMorph() {
  useEffect(() => {
    let lastOrigin: HTMLElement | null = null;
    let lastClickAt = 0;
    const animated = new WeakSet<HTMLElement>();

    for (const dialog of document.querySelectorAll<HTMLElement>('.modal-backdrop .dialog')) animated.add(dialog);

    const rememberOrigin = (event: MouseEvent) => {
      const origin = clickableOrigin(event.target);
      if (!origin) return;
      lastOrigin = origin;
      lastClickAt = Date.now();
    };

    const scan = () => {
      if (!lastOrigin || Date.now() - lastClickAt > 800) return;
      for (const dialog of document.querySelectorAll<HTMLElement>('.modal-backdrop .dialog')) {
        if (animated.has(dialog) || dialog.closest('.settings-overlay')) continue;
        animated.add(dialog);
        animatePaperIn(dialog, lastOrigin);
      }
    };

    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', rememberOrigin, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', rememberOrigin, true);
    };
  }, []);
  return null;
}
