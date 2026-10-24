import type { AuthState, SiteSettings } from "../types";
import { setCsrfToken } from "./api";

export type AppContextValue = {
  settings: SiteSettings;
  auth: AuthState;
  refreshAuth: () => Promise<AuthState>;
  updateSettings: (settings: SiteSettings) => void;
};

let contextValue: AppContextValue | null = null;

export function configureContext(settings: SiteSettings, auth: AuthState) {
  contextValue = {
    settings,
    auth,
    refreshAuth: async () => {
      const response = await fetch("/api/auth/me", { credentials: "same-origin" });
      const next = await response.json() as AuthState;
      if (contextValue) contextValue.auth = next;
      setCsrfToken(next.csrfToken);
      return next;
    },
    updateSettings: (next: SiteSettings) => {
      if (contextValue) contextValue.settings = next;
    }
  };
  setCsrfToken(auth.csrfToken);
  return contextValue;
}

export function getContext(): AppContextValue {
  if (!contextValue) throw new Error("App context not initialized");
  return contextValue;
}