import { create } from 'zustand';
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

type UiPreferences = {
  theme: UiTheme;
  density: UiDensity;
  accent: UiAccent;
  reduceMotion: boolean;
  wideContent: boolean;
};
const UI_PREFERENCES_KEY = 'moheng:ui-preferences';
const defaultUiPreferences: UiPreferences = { theme: 'warm-paper', density: 'comfortable', accent: 'theme', reduceMotion: false, wideContent: false };
function readUiPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_KEY);
    if (!raw) return defaultUiPreferences;
    const value = JSON.parse(raw) as Partial<UiPreferences> & { theme?: string };
    const savedTheme = value.theme;
    const theme: UiTheme = savedTheme === 'plain-white' || savedTheme === 'midnight' ? savedTheme : 'warm-paper';
    return {
      theme,
      density: value.density === 'compact' ? 'compact' : 'comfortable',
      accent: value.accent === 'indigo' || value.accent === 'jade' || value.accent === 'cinnabar' ? value.accent : 'theme',
      reduceMotion: Boolean(value.reduceMotion),
      wideContent: Boolean(value.wideContent),
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
  const themeColors = { 'warm-paper': '#f8f4ed', 'plain-white': '#fbfaf7', midnight: '#26343d' } as const;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[value.theme]);
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
  resetUiPreferences: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  selectedProjectId: (() => { try { return localStorage.getItem('cms:selected-project'); } catch { return null; } })(),
  sidebarCollapsed: false,
  ...readUiPreferences(),
  setSelectedProjectId: (id) => {
    try { if (id) localStorage.setItem('cms:selected-project', id); else localStorage.removeItem('cms:selected-project'); } catch { /* Selected project is also kept in memory. */ }
    set({ selectedProjectId: id });
  },
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setTheme: (theme) => set((state) => {
    const next = { theme, density: state.density, accent: state.accent, reduceMotion: state.reduceMotion, wideContent: state.wideContent };
    commitUiPreferences(set, next);
    return { theme };
  }),
  setDensity: (density) => set((state) => {
    const next = { theme: state.theme, density, accent: state.accent, reduceMotion: state.reduceMotion, wideContent: state.wideContent };
    commitUiPreferences(set, next);
    return { density };
  }),
  setAccent: (accent) => set((state) => {
    const next = { theme: state.theme, density: state.density, accent, reduceMotion: state.reduceMotion, wideContent: state.wideContent };
    commitUiPreferences(set, next);
    return { accent };
  }),
  toggleReduceMotion: () => set((state) => {
    const next = { theme: state.theme, density: state.density, accent: state.accent, reduceMotion: !state.reduceMotion, wideContent: state.wideContent };
    commitUiPreferences(set, next);
    return { reduceMotion: next.reduceMotion };
  }),
  toggleWideContent: () => set((state) => {
    const next = { theme: state.theme, density: state.density, accent: state.accent, reduceMotion: state.reduceMotion, wideContent: !state.wideContent };
    commitUiPreferences(set, next);
    return { wideContent: next.wideContent };
  }),
  resetUiPreferences: () => { commitUiPreferences(set, defaultUiPreferences); },
}));
