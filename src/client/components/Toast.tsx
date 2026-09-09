import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleCheck, CircleAlert, Info } from "lucide-react";

/**
 * Transient action confirmation — the prototype's `showToast()`
 * (`_scripts.js:1561`): a fixed bottom-centre pill on `--ink`, 12.5px white
 * text, a green check glyph, 9px radius, a soft drop shadow, auto-dismissing
 * after 2.4s. 36 prototype actions confirm this way (14 in the incubator
 * superset, 22 in the VC superset), so it is the product's single confirmation
 * surface rather than a per-screen nicety.
 *
 * The prototype re-uses one element and overwrites the message; a real app
 * fires several in quick succession (bulk shortlist, multi-assign), so toasts
 * stack bottom-up in arrival order and each keeps its own timer.
 */

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  /** Show a toast. Returns its id so a caller can dismiss it early. */
  showToast: (message: string, tone?: ToastTone) => number;
  dismissToast: (id: number) => void;
  toasts: readonly Toast[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Prototype `_scripts.js:1572` — `setTimeout(…, 2400)`. */
export const TOAST_DURATION_MS = 2400;

const ICONS: Record<ToastTone, typeof CircleCheck> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};

const ICON_COLOR: Record<ToastTone, string> = {
  // The prototype hardcodes #5BC98B for the check — a lifted green that reads
  // on the dark --ink pill in both themes.
  success: "#5bc98b",
  error: "#f87171",
  info: "#93c5fd",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setToasts((current) => current.filter((t) => t.id !== id));
        }, TOAST_DURATION_MS),
      );
      return id;
    },
    [],
  );

  // A provider unmounting mid-flight (route teardown, test cleanup) must not
  // leave timers pointing at a dead setState.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ showToast, dismissToast, toasts }),
    [showToast, dismissToast, toasts],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: readonly Toast[];
  onDismiss: (id: number) => void;
}) {
  // The live region is always in the DOM, even empty: a polite region that only
  // appears at the moment its content does is frequently not announced at all.
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[3000] flex flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone];
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="pointer-events-auto flex items-center gap-[7px] rounded-[9px] bg-ink px-[18px] py-2.5 text-body font-medium text-white shadow-[0_8px_28px_rgba(0,0,0,0.28)]"
          >
            <Icon
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: ICON_COLOR[toast.tone] }}
              aria-hidden="true"
            />
            {toast.message}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Fire a toast from any component under <ToastProvider>. Outside a provider
 * (an isolated component test, a screen rendered on its own) it degrades to a
 * no-op rather than throwing — a missing confirmation must never take a screen
 * down with it.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  return ctx ?? FALLBACK;
}

const FALLBACK: ToastContextValue = {
  showToast: () => -1,
  dismissToast: () => {},
  toasts: [],
};
