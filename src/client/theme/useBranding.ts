import { useContext } from "react";
import { BrandingContext, type BrandingContextValue } from "./BrandingProvider";
import { DEFAULT_BRANDING } from "./branding";

/**
 * The workspace's branding. Unlike `useTheme`, this does NOT throw outside its
 * provider: `Logo` renders on the login screen and the founder resubmit page,
 * both of which sit outside the authenticated tree, and a brand mark that
 * crashes when it cannot read a wordmark would be worse than one that shows the
 * shipped default.
 */
export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (ctx) return ctx;
  return {
    branding: DEFAULT_BRANDING,
    loaded: false,
    setBranding: () => {},
    refresh: async () => {},
  };
}
