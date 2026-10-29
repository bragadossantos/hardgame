import { create } from 'zustand';
import type { AuthUser } from '@hardgame/shared';

const TOKEN_STORAGE_KEY = 'hardgame_auth_token';
const USER_STORAGE_KEY = 'hardgame_auth_user';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  sessionReplacedMessage: string | null;
  setSession: (token: string, user: AuthUser) => void;
  clearSession: (replacedReason?: string) => void;
}

function loadInitialToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function loadInitialUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: loadInitialToken(),
  user: loadInitialUser(),
  sessionReplacedMessage: null,
  setSession: (token, user) => {
    try {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } catch {
      // Ignorar se sessionStorage estiver indisponível
    }
    set({ token, user, sessionReplacedMessage: null });
  },
  clearSession: (replacedReason) => {
    try {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      // Ignorar
    }
    set({
      token: null,
      user: null,
      sessionReplacedMessage: replacedReason ?? null,
    });
  },
}));

