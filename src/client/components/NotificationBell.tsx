import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import type { NotificationView } from "../../shared/notifications";

/**
 * The ribbon's notification bell and the centre behind it (F0058).
 *
 * Every one of the eleven prototypes carries `<button class="nb">` with a
 * Tabler bell in the right-hand nav cluster of `_topnav.html`, and in all
 * eleven it is **inert** — there is no dropdown markup anywhere in the
 * document, so the panel's contents are unspecified. What it should hold is
 * therefore settled by the section that governs it: `admin/s-nt.html` promises
 * "email **and in-app** alerts", and the in-app half is this. The panel shows
 * the same ten events the toggle grid lists, for whoever is signed in, newest
 * first.
 *
 * Self-contained on purpose: `Topbar.tsx` is shared chrome this session does
 * not own (plan §2.2), so the bell takes no props, fetches its own state and
 * mounts as one element. Anything it needed from the ribbon would have been a
 * cross-session request instead.
 */

/** Background refresh. Long enough to be free; short enough to feel live. */
const POLL_MS = 60_000;

/** `2026-09-10T08:13:00Z` → `3m` / `4h` / `2d` / `10 Sep`. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(then.getTime())) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(then);
}

interface BellPayload {
  notifications: NotificationView[];
  unread: number;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/bell");
      if (!res.ok) return;
      const payload = (await res.json()) as BellPayload;
      setItems(payload.notifications ?? []);
      setUnread(payload.unread ?? 0);
    } catch {
      // A failed poll leaves the last good state on screen. The bell is an
      // ambient surface; an error banner in the ribbon would be worse than a
      // count that is a minute stale.
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Dismiss on an outside click or Escape, like the prototype's profile menu.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(id?: string) {
    // Optimistic, then reconcile: the count is the whole point of the control
    // and must not lag a round trip behind the click that cleared it.
    setItems((cur) =>
      cur.map((n) =>
        (id === undefined || n.id === id) && !n.readAt
          ? { ...n, readAt: new Date().toISOString() }
          : n,
      ),
    );
    setUnread((n) => (id === undefined ? 0 : Math.max(0, n - 1)));
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      });
    } finally {
      await refresh();
    }
  }

  function openItem(n: NotificationView) {
    setOpen(false);
    if (!n.readAt) void markRead(n.id);
    if (n.link) navigate(n.link);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        data-testid="notification-bell"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md border border-white/15 px-[9px] py-1 text-topbar-fg/65 hover:bg-white/10 hover:text-topbar-fg"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span
            data-testid="notification-bell-count"
            className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-signal-flagged px-[3px] text-[9px] font-semibold leading-none text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          data-testid="notification-centre"
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-[330px] overflow-hidden rounded-xl border border-line bg-surface text-fg shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[12.5px] font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                data-testid="notification-mark-all"
                onClick={() => markRead()}
                className="inline-flex items-center gap-1 text-[11.5px] text-fg-muted hover:text-fg"
              >
                <Check className="h-3 w-3" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-fg-muted">
                Nothing yet. Alerts you have switched on in the Admin console appear here.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  data-testid={`notification-item-${n.id}`}
                  data-unread={n.readAt ? undefined : "1"}
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-2 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-surface-2 ${
                    n.readAt ? "" : "bg-olive-lt/40"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full ${
                      n.readAt ? "bg-transparent" : "bg-olive"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">{n.title}</span>
                    {n.body && (
                      <span className="mt-[1px] line-clamp-2 block text-[11px] text-fg-muted">
                        {n.body}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-fg-muted">
                    {relativeTime(n.createdAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
