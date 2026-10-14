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

type UiState = {
  selectedProjectId: string | null;
  sidebarCollapsed: boolean;
  setSelectedProjectId: (id: string | null) => void;
  toggleSidebar: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  selectedProjectId: localStorage.getItem('cms:selected-project'),
  sidebarCollapsed: false,
  setSelectedProjectId: (id) => {
    if (id) localStorage.setItem('cms:selected-project', id);
    else localStorage.removeItem('cms:selected-project');
    set({ selectedProjectId: id });
  },
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
