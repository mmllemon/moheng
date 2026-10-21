let pendingOrigin: HTMLElement | null = null;
let activeMorph: (() => void) | null = null;

type Box = { cx: number; cy: number; width: number; height: number; radius: number };

function reducedMotion() {
  return document.documentElement.dataset.motion === 'reduced'
    || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function boxOf(element: HTMLElement | null): Box | null {
  if (!element || !element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, width: rect.width, height: rect.height, radius };
}

function transformBetween(origin: Box, panel: Box, progress: number) {
  const p = Math.min(Math.max(progress, 0), 1);
  const tx = (origin.cx - panel.cx) * (1 - p);
  const ty = (origin.cy - panel.cy) * (1 - p);
  const sx = 1 + (origin.width / panel.width - 1) * (1 - p);
  const sy = 1 + (origin.height / panel.height - 1) * (1 - p);
  const radius = origin.radius + (panel.radius - origin.radius) * p;
  return { tx, ty, sx, sy, radius };
}

function transformCss(value: { tx: number; ty: number; sx: number; sy: number }) {
  return `translate(${value.tx.toFixed(3)}px, ${value.ty.toFixed(3)}px) scale(${value.sx.toFixed(4)}, ${value.sy.toFixed(4)})`;
}

export function rememberPaperOrigin(element: HTMLElement | null) {
  pendingOrigin = element;
}

export function takePaperOrigin() {
  const origin = pendingOrigin;
  pendingOrigin = null;
  return origin;
}

export function animatePaperIn(panel: HTMLElement | null, origin: HTMLElement | null) {
  if (activeMorph) { activeMorph(); activeMorph = null; }
  if (!panel || !origin || reducedMotion() || window.innerWidth <= 700) return () => {};
  const panelBox = boxOf(panel);
  const originBox = boxOf(origin);
  if (!panelBox || !originBox) return () => {};

  const initial = transformBetween(originBox, panelBox, 0);
  panel.dataset.paperMorph = 'in';
  panel.style.animation = 'none';
  panel.style.transformOrigin = 'center';
  panel.style.transform = transformCss(initial);
  panel.style.opacity = '0';
  panel.style.borderRadius = `${initial.radius}px`;
  void panel.getBoundingClientRect();

  const frame = requestAnimationFrame(() => {
    panel.style.transition = 'transform var(--duration-paper-unfold) var(--ease-paper-unfold), opacity 100ms var(--ease-out) 80ms, border-radius var(--duration-paper-unfold) var(--ease-paper-unfold)';
    panel.style.transform = 'none';
    panel.style.opacity = '1';
    panel.style.borderRadius = `${panelBox.radius}px`;
  });
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    delete panel.dataset.paperMorph;
    panel.style.removeProperty('transform');
    panel.style.removeProperty('transform-origin');
    panel.style.removeProperty('opacity');
    panel.style.removeProperty('border-radius');
    panel.style.removeProperty('transition');
    if (activeMorph === cleanup) activeMorph = null;
  };
  activeMorph = cleanup;
  window.setTimeout(cleanup, 580);
  return cleanup;
}

export function animatePaperOut(panel: HTMLElement | null, origin: HTMLElement | null, onDone: () => void) {
  if (!panel || !origin || reducedMotion() || window.innerWidth <= 700) return false;
  const from = boxOf(panel);
  const to = boxOf(origin);
  if (!from || !to) return false;
  if (activeMorph) { activeMorph(); activeMorph = null; }
  const target = transformBetween(to, from, 0);
  panel.dataset.paperMorph = 'out';
  panel.style.animation = 'none';
  panel.style.transformOrigin = 'center';
  panel.style.transition = 'transform 120ms cubic-bezier(0.4, 0, 1, 1), opacity 120ms ease, border-radius 120ms ease';
  panel.style.transform = transformCss(target);
  panel.style.opacity = '0';
  panel.style.borderRadius = `${target.radius}px`;
  const overlay = panel.closest<HTMLElement>('.settings-overlay');
  if (overlay) { overlay.style.transition = 'opacity 120ms ease'; overlay.style.opacity = '0'; }
  window.setTimeout(() => {
    delete panel.dataset.paperMorph;
    onDone();
  }, 120);
  return true;
}
