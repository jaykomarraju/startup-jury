import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getConfigSummary } from "../api";
import { useAuth } from "../auth/useAuth";
import { useTheme } from "./useTheme";
import { applyBranding, readBranding, DEFAULT_BRANDING, type Branding } from "./branding";

export interface BrandingContextValue {
  branding: Branding;
  /** False until the first read settles — the mark renders its default meanwhile. */
  loaded: boolean;
  /**
   * Publish what was just saved. The Branding section calls this so the console,
   * the top bar and every token repaint on Save, with no reload — the prototype's
   * "changes apply across the entire admin console instantly".
   */
  setBranding: (raw: Record<string, unknown>) => void;
  /** Re-read from the server (after a save elsewhere, or a sign-in). */
  refresh: () => Promise<void>;
}

export const BrandingContext = createContext<BrandingContextValue | null>(null);

/**
 * Reads the workspace's saved branding once per session and applies it to the
 * document, then keeps it applied.
 *
 * Mounted in `main.tsx` INSIDE `AuthProvider` (branding comes from
 * `GET /api/config/summary`, which needs a session) and inside `ThemeProvider`
 * (the applier is theme-aware — see `branding.ts`). Every consumer degrades to
 * the shipped defaults when the context is absent or the read fails, so the
 * login page, the founder resubmit page and every test that renders a bare
 * component keep working untouched.
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [branding, setBrandingState] = useState<Branding>(DEFAULT_BRANDING);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const summary = await getConfigSummary();
      setBrandingState(readBranding(summary.branding));
    } catch {
      // Unauthenticated, offline, or a workspace with no branding row: the
      // defaults are already applied and are the correct answer.
      setBrandingState(DEFAULT_BRANDING);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Re-read on sign-in and sign-out: branding is per workspace, and the user
  // who just signed in may belong to a different one than the last. Keyed on the
  // id, not the object — `AuthProvider` hands out a new principal object on
  // every patch (`updateUser`), and re-fetching on each of those would put the
  // provider in a render loop.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      setBrandingState(DEFAULT_BRANDING);
      setLoaded(false);
      return;
    }
    void refresh();
  }, [userId, refresh]);

  // The applier. Runs on load, on save and on every theme flip, because the
  // token set that survives dark mode is smaller than the one light takes.
  useEffect(() => {
    applyBranding(branding.tokens, theme);
  }, [branding, theme]);

  const setBranding = useCallback(
    (raw: Record<string, unknown>) => setBrandingState(readBranding(raw)),
    [],
  );

  const value = useMemo(
    () => ({ branding, loaded, setBranding, refresh }),
    [branding, loaded, setBranding, refresh],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}
