import { useEffect } from 'react';

/**
 * Hana 的 section 标题位于正文卡片之外。
 * 旧页面把 .panel-heading 写在 .panel 卡片内部；这里不改业务 DOM，
 * 只测量标题高度，并用 ::before 在标题之后绘制真正的卡片表面。
 */
export function useDetachedPanelHeaders() {
  useEffect(() => {
    const observers = new Set<ResizeObserver>();
    const observedHeads = new WeakSet<Element>();

    const measure = (panel: HTMLElement, head: HTMLElement) => {
      const height = head.offsetHeight;
      panel.style.setProperty('--panel-head-h', `${Math.max(0, Math.round(height))}px`);
    };

    const scan = () => {
      document.querySelectorAll<HTMLElement>('.panel, .an-panel').forEach((panel) => {
        const head = Array.from(panel.children).find((child) => ['panel-heading', 'notice-list-heading', 'an-panel-head', 'report-standard-heading', 'audit-filter-heading'].some((name) => child.classList.contains(name))) as HTMLElement | undefined;
        if (!head) {
          panel.classList.remove('panel-detached');
          panel.style.removeProperty('--panel-head-h');
          return;
        }
        panel.classList.add('panel-detached');
        measure(panel, head);
        if (!observedHeads.has(head)) {
          observedHeads.add(head);
          const observer = new ResizeObserver(() => measure(panel, head));
          observer.observe(head);
          observers.add(observer);
        }
      });
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    };

    scan();
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      mutation.disconnect();
      window.removeEventListener('resize', schedule);
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);
}
