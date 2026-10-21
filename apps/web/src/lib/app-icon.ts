export type AppIconId = 'ink' | 'paper' | 'jade' | 'seal';

export const APP_ICON_IDS: AppIconId[] = ['ink', 'paper', 'jade', 'seal'];

export const APP_ICON_PALETTES: Record<AppIconId, { background: string; line: string; accent: string; label: string; note: string }> = {
  ink: { background: '#202B43', line: '#F2EBDD', accent: '#C57961', label: '墨夜', note: '深墨与宣纸线' },
  paper: { background: '#F1EBDD', line: '#3A3F3E', accent: '#A23A2A', label: '宣纸', note: '浅纸与墨线' },
  jade: { background: '#466B80', line: '#F8F4ED', accent: '#D8C7A0', label: '远山', note: '青灰与金线' },
  seal: { background: '#A23A2A', line: '#F8ECDA', accent: '#D8C7A0', label: '朱印', note: '朱砂与米白' },
};

export function normalizeAppIcon(value: unknown): AppIconId {
  return value === 'paper' || value === 'jade' || value === 'seal' ? value : 'ink';
}

export function appIconSvg(id: AppIconId) {
  const palette = APP_ICON_PALETTES[normalizeAppIcon(id)];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="14" fill="${palette.background}"/><path d="M10 24 32 8l22 16" stroke="${palette.line}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 25v28h34V25M24 53V35h16v18M7 54h50M32 14v13m-9-2h18m-15 2-7 9h14l-7-9Zm14 0-7 9h14l-7-9Z" stroke="${palette.line}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="27" r="2.4" fill="${palette.accent}"/></svg>`;
}

export function applyAppIcon(id: AppIconId) {
  if (typeof document === 'undefined') return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  const href = `data:image/svg+xml,${encodeURIComponent(appIconSvg(id))}`;
  if (link.getAttribute('href') === href) return;
  link.type = 'image/svg+xml';
  link.href = href;
}
