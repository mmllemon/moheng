import { create } from 'zustand';
import type { User } from './types';

type AuthState = {
  accessToken: string | null;
  user: User | null;
  setSession: (accessToken: string, user: User) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ accessToken, user }),
  clearSession: () => set({ accessToken: null, user: null }),
}));

export type UiTheme = 'ivory' | 'champagne' | 'obsidian' | 'glacier' | 'system';
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
const defaultUiPreferences: UiPreferences = { theme: 'ivory', density: 'comfortable', accent: 'theme', reduceMotion: false, wideContent: false };
function readUiPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_KEY);
    if (!raw) return defaultUiPreferences;
    const value = JSON.parse(raw) as Partial<UiPreferences> & { theme?: UiTheme | 'dark' };
    return {
      theme: value.theme === 'champagne' || value.theme === 'obsidian' || value.theme === 'glacier' || value.theme === 'system' ? value.theme : value.theme === 'dark' ? 'obsidian' : 'ivory',
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
  setTheme: (theme) => set((state) => { const next = { theme, density: state.density, accent: state.accent, reduceMotion: state.reduceMotion, wideContent: state.wideContent }; persistUiPreferences(next); return { theme }; }),
  setDensity: (density) => set((state) => { const next = { theme: state.theme, density, accent: state.accent, reduceMotion: state.reduceMotion, wideContent: state.wideContent }; persistUiPreferences(next); return { density }; }),
  setAccent: (accent) => set((state) => { const next = { theme: state.theme, density: state.density, accent, reduceMotion: state.reduceMotion, wideContent: state.wideContent }; persistUiPreferences(next); return { accent }; }),
  toggleReduceMotion: () => set((state) => { const reduceMotion = !state.reduceMotion; persistUiPreferences({ theme: state.theme, density: state.density, accent: state.accent, reduceMotion, wideContent: state.wideContent }); return { reduceMotion }; }),
  toggleWideContent: () => set((state) => { const wideContent = !state.wideContent; persistUiPreferences({ theme: state.theme, density: state.density, accent: state.accent, reduceMotion: state.reduceMotion, wideContent }); return { wideContent }; }),
  resetUiPreferences: () => { persistUiPreferences(defaultUiPreferences); set(defaultUiPreferences); },
}));
