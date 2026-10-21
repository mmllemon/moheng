import { APP_ICON_PALETTES, normalizeAppIcon, type AppIconId } from '../lib/app-icon';

export default function AppIcon({ id, className = '' }: { id: AppIconId; className?: string }) {
  const palette = APP_ICON_PALETTES[normalizeAppIcon(id)];
  return <svg className={`app-icon ${className}`} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
    <rect width="64" height="64" rx="14" fill={palette.background} />
    <path d="M10 24 32 8l22 16" stroke={palette.line} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 25v28h34V25M24 53V35h16v18M7 54h50M32 14v13m-9-2h18m-15 2-7 9h14l-7-9Zm14 0-7 9h14l-7-9Z" stroke={palette.line} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="32" cy="27" r="2.4" fill={palette.accent} />
  </svg>;
}
