import { create } from 'zustand';
import { applyAppIcon, normalizeAppIcon, type AppIconId } from './lib/app-icon';
import type { User } from './types';

export type RestrictedAuthFlow = 'mfa-enrollment' | 'password-change';
type AuthState = {
  accessToken: string | null;
  user: User | null;
  restrictedFlow: RestrictedAuthFlow | null;
  setSession: (accessToken: string, user: User) => void;
  setRestrictedSession: (accessToken: string, user: User, flow: RestrictedAuthFlow) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  restrictedFlow: null,
  setSession: (accessToken, user) => set({ accessToken, user, restrictedFlow: null }),
  setRestrictedSession: (accessToken, user, restrictedFlow) => set({ accessToken, user, restrictedFlow }),
  clearSession: () => set({ accessToken: null, user: null, restrictedFlow: null }),
}));

export type UiTheme = 'warm-paper' | 'plain-white' | 'midnight';
export type UiDensity = 'comfortable' | 'compact';
export type UiAccent = 'theme' | 'indigo' | 'jade' | 'cinnabar';
export type PaperTextureStyle = 'off' | 'rice' | 'cotton' | 'fine';
export type UiHeadingFont = 'serif' | 'sans' | 'latin';

export const PAPER_TEXTURE_STRENGTHS = [0.5, 0.75, 1, 1.25, 1.5] as const;
export function normalizePaperTextureStrength(value: number) {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(1.5, Math.max(0.5, value));
  return PAPER_TEXTURE_STRENGTHS.reduce((nearest, candidate) => Math.abs(candidate - clamped) < Math.abs(nearest - clamped) ? candidate : nearest, 1);
}

type UiPreferences = {
  theme: UiTheme;
  density: UiDensity;
  accent: UiAccent;
  reduceMotion: boolean;
  wideContent: boolean;
  paperTexture: PaperTextureStyle;
  paperTextureStrength: number;
  headingFont: UiHeadingFont;
  appIcon: AppIconId;
};
const UI_PREFERENCES_KEY = 'moheng:ui-preferences';
const defaultUiPreferences: UiPreferences = {
  theme: 'warm-paper',
  density: 'comfortable',
  accent: 'theme',
  reduceMotion: false,
  wideContent: false,
  paperTexture: 'rice',
  paperTextureStrength: 1,
  headingFont: 'serif',
  appIcon: 'ink',
};

function readUiPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_KEY);
    if (!raw) return defaultUiPreferences;
    const value = JSON.parse(raw) as Partial<UiPreferences> & { theme?: string };
    const savedTheme = value.theme;
    const theme: UiTheme = savedTheme === 'plain-white' || savedTheme === 'midnight' ? savedTheme : 'warm-paper';
    const paperTexture: PaperTextureStyle = value.paperTexture === 'off' || value.paperTexture === 'cotton' || value.paperTexture === 'fine' ? value.paperTexture : 'rice';
    const headingFont: UiHeadingFont = value.headingFont === 'sans' || value.headingFont === 'latin' ? value.headingFont : 'serif';
    return {
      theme,
      density: value.density === 'compact' ? 'compact' : 'comfortable',
      accent: value.accent === 'indigo' || value.accent === 'jade' || value.accent === 'cinnabar' ? value.accent : 'theme',
      reduceMotion: Boolean(value.reduceMotion),
      wideContent: Boolean(value.wideContent),
      paperTexture,
      paperTextureStrength: normalizePaperTextureStrength(Number(value.paperTextureStrength ?? 1)),
      headingFont,
      appIcon: normalizeAppIcon(value.appIcon),
    };
  } catch { return defaultUiPreferences; }
}

function persistUiPreferences(value: UiPreferences) {
  try { localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(value)); } catch { /* Preferences are optional when storage is blocked. */ }
}

export function applyUiPreferences(value: UiPreferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = value.theme;
  root.dataset.density = value.density;
  root.dataset.motion = value.reduceMotion ? 'reduced' : 'full';
  root.dataset.contentWidth = value.wideContent ? 'wide' : 'standard';
  root.dataset.headingFont = value.headingFont;
  root.dataset.appIcon = value.appIcon;
  if (value.paperTexture === 'off') root.removeAttribute('data-paper-texture');
  else root.dataset.paperTexture = value.paperTexture;
  root.style.setProperty('--paper-texture-strength', String(value.paperTextureStrength));
  const themeColors = { 'warm-paper': '#f8f4ed', 'plain-white': '#fbfaf7', midnight: '#26343d' } as const;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[value.theme]);
  applyAppIcon(value.appIcon);
}

function commitUiPreferences(set: (partial: Partial<UiState>) => void, value: UiPreferences) {
  persistUiPreferences(value);
  applyUiPreferences(value);
  set(value);
}

type UiState = UiPreferences & {
  selectedProjectId: string | null;
  sidebarCollapsed: boolean;
  setSelectedProjectId: (id: string | null) => void;
  toggleSidebar: () => void;
  setTheme: (theme: UiTheme) => void;
  setDensity: (density: UiDensity) => void;
  setAccent: (accent: UiAccent) => void;
  toggleReduceMotion: () => void;
  toggleWideContent: () => void;
  setPaperTexture: (texture: PaperTextureStyle) => void;
  setPaperTextureStrength: (strength: number) => void;
  setHeadingFont: (font: UiHeadingFont) => void;
  setAppIcon: (icon: AppIconId) => void;
  resetUiPreferences: () => void;
};

function preferencesFromState(state: UiState): UiPreferences {
  return {
    theme: state.theme,
    density: state.density,
    accent: state.accent,
    reduceMotion: state.reduceMotion,
    wideContent: state.wideContent,
    paperTexture: state.paperTexture,
    paperTextureStrength: state.paperTextureStrength,
    headingFont: state.headingFont,
    appIcon: state.appIcon,
  };
}

function updateUiPreferences(set: (partial: Partial<UiState>) => void, state: UiState, patch: Partial<UiPreferences>) {
  commitUiPreferences(set, { ...preferencesFromState(state), ...patch });
  return patch;
}

export const useUiStore = create<UiState>((set) => ({
  selectedProjectId: (() => { try { return localStorage.getItem('cms:selected-project'); } catch { return null; } })(),
  sidebarCollapsed: false,
  ...readUiPreferences(),
  setSelectedProjectId: (id) => {
    try { if (id) localStorage.setItem('cms:selected-project', id); else localStorage.removeItem('cms:selected-project'); } catch { /* Selected project is also kept in memory. */ }
    set({ selectedProjectId: id });
  },
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setTheme: (theme) => set((state) => updateUiPreferences(set, state, { theme })),
  setDensity: (density) => set((state) => updateUiPreferences(set, state, { density })),
  setAccent: (accent) => set((state) => updateUiPreferences(set, state, { accent })),
  toggleReduceMotion: () => set((state) => updateUiPreferences(set, state, { reduceMotion: !state.reduceMotion })),
  toggleWideContent: () => set((state) => updateUiPreferences(set, state, { wideContent: !state.wideContent })),
  setPaperTexture: (paperTexture) => set((state) => updateUiPreferences(set, state, { paperTexture })),
  setPaperTextureStrength: (strength) => set((state) => updateUiPreferences(set, state, { paperTextureStrength: normalizePaperTextureStrength(strength) })),
  setHeadingFont: (headingFont) => set((state) => updateUiPreferences(set, state, { headingFont })),
  setAppIcon: (appIcon) => set((state) => updateUiPreferences(set, state, { appIcon })),
  resetUiPreferences: () => { commitUiPreferences(set, defaultUiPreferences); },
}));
