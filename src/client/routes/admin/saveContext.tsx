/**
 * The console's global **Save changes** button lives in the section title bar
 * (prototype `.tb-save`), above the section that owns the state it saves. This
 * is the wire between them: a section calls `useAdminSave(...)` and the shell's
 * button becomes that section's.
 *
 * Wave 1 ships no section that owns state — every body is a placeholder, and
 * the Team & roles roster saves each row as it is edited — so the button
 * renders disabled with a hint. Waves 2–5 fill it in from their own sections
 * without touching the shell.
 */
import { createContext, useContext, useEffect, useRef } from "react";

export interface AdminSaveState {
  /** Enable the button — the section has unsaved changes. */
  dirty: boolean;
  /** A save already in flight. */
  saving?: boolean;
  onSave: () => void | Promise<void>;
  /** Shown on hover when the button is disabled. */
  hint?: string;
}

interface AdminSaveContextValue {
  register: (state: AdminSaveState | null) => void;
}

export const AdminSaveContext = createContext<AdminSaveContextValue | null>(null);

/**
 * Register this section's save handler with the console title bar. Re-registers
 * whenever `dirty`/`saving`/`hint` change; clears on unmount so a section that
 * navigates away never leaves a stale handler behind the button.
 */
export function useAdminSave(state: AdminSaveState | null): void {
  const ctx = useContext(AdminSaveContext);
  // The handler is read through a ref so an inline arrow function in the
  // caller does not re-register on every render.
  const onSave = useRef(state?.onSave);
  onSave.current = state?.onSave;

  const dirty = state?.dirty ?? false;
  const saving = state?.saving ?? false;
  const hint = state?.hint;
  const active = state !== null;

  useEffect(() => {
    if (!ctx) return;
    if (!active) {
      ctx.register(null);
      return;
    }
    ctx.register({ dirty, saving, hint, onSave: () => onSave.current?.() });
    return () => ctx.register(null);
  }, [ctx, active, dirty, saving, hint]);
}
