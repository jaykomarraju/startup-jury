import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  Armchair,
  Bell,
  ChartBar,
  CircleHelp,
  Coins,
  FileCheck,
  FileText,
  History,
  IndianRupee,
  Key,
  ListChecks,
  Menu,
  Palette,
  PieChart,
  RefreshCw,
  Save,
  ShieldCheck,
  Signature,
  SlidersHorizontal,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "../../components";
import { useAuth } from "../../auth/useAuth";
import { useActiveContext } from "../../activeContext";
import { listPrograms, listUsers, type ProgramView } from "../../api";
import { landingNavId } from "../../../shared/nav";
import { roleLabel } from "../../../shared/roles";
import { AdminSaveContext, type AdminSaveState } from "./saveContext";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SECTION_COMPONENTS } from "./registry";
import {
  adminGroupsFor,
  adminSectionsFor,
  pendingInviteCount,
  resolveAdminSection,
  type AdminSection,
} from "./sections";

/**
 * The Admin console — a full-screen overlay with a 46 px header, a 210 px olive
 * section rail of four groups and sixteen sections, and a section title bar
 * carrying the program/cohort context chip and the global Save changes button.
 *
 * The prototype builds this as a separate document injected into an iframe by
 * `openAdmin()` (`_scripts.js:2618-2642`): a modal surface at the top of the
 * z-order with its own olive chrome, a body scroll lock and Escape-to-close.
 * The repo previously rendered a single flat user-CRUD page in the app shell
 * instead — a different navigation model with fifteen sections missing. This
 * restores the console's shape; Waves 2–5 fill the sections.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────
 * The console document carries its OWN palette: `--olive:#4A6644`, materially
 * darker than the main app's `--olive:#6B8454` that W1-A is adding to
 * `index.css`. They are two different surfaces in the prototype, so the
 * console's values are declared here, scoped to this overlay and prefixed
 * `--ac-` where they cannot collide with W1-A's global family. If the console
 * should adopt the app hue instead, it is an edit to these four values and
 * nothing else — recorded in plan_parity.md §9.
 *
 * The chrome (header + rail) stays olive in both themes — it is a fixed brand
 * surface in the prototype. The content pane uses the app's semantic tokens, so
 * the sections Waves 2–5 land inside it are theme-aware for free.
 */

const CONSOLE_VARS = {
  "--ac-olive": "#4A6644",
  "--ac-gold": "#E8A020",
  "--ac-gold-dk": "#BA7517",
} as CSSProperties;

const SECTION_ICONS: Record<string, LucideIcon> = {
  SlidersHorizontal,
  ChartBar,
  ListChecks,
  CircleHelp,
  Users,
  RefreshCw,
  Coins,
  IndianRupee,
  FileCheck,
  FileText,
  Signature,
  Armchair,
  PieChart,
  Bell,
  History,
  Key,
  Palette,
};

export function AdminConsole() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [save, setSave] = useState<AdminSaveState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Whether Escape/Close can step back into the app, decided once: a direct
  // visit to /app/admin has nothing behind it, and switching sections replaces
  // the entry rather than pushing, so this must not be re-read per render.
  const [cameFromApp] = useState(() => location.key !== "default");

  const edition = user?.edition ?? "incubator";
  const role = user?.role ?? "admin";

  const sections = useMemo(() => adminSectionsFor(edition, role), [edition, role]);
  const groups = useMemo(() => adminGroupsFor(edition, role), [edition, role]);
  const active = resolveAdminSection(edition, role, params.get("section"));

  const close = useCallback(() => {
    if (cameFromApp) navigate(-1);
    else navigate(`/app/${landingNavId(edition, role)}`, { replace: true });
  }, [cameFromApp, navigate, edition, role]);

  // Escape closes the console (prototype `_scripts.js:2641`).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (drawerOpen) {
        setDrawerOpen(false);
        return;
      }
      close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, drawerOpen]);

  // Body scroll lock while the overlay is up (prototype `openAdmin`/`closeAdmin`).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Move focus into the overlay, and RESTORE it to whatever opened the console on
  // the way out — otherwise a keyboard user is dropped on <body>.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // `aria-modal` is a promise to assistive tech, not an implementation. The app
  // shell stays mounted behind this overlay, so without `inert` the whole of it —
  // the top bar's theme toggle and Log out, every sidebar link, and below 640px
  // the shell's "Open menu" — is still in the tab order beneath an opaque
  // surface. Tab out, press Enter, and the console unmounts mid-edit.
  //
  // This only appears once the console renders inside the shell, which is why it
  // survived W1-C: its client tests mount the console in a bare router and the
  // e2e walk never presses Tab. Found at Wave 1 integration.
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>("[data-app-shell-frame]");
    if (!shell) return;
    shell.setAttribute("inert", "");
    shell.setAttribute("aria-hidden", "true");
    return () => {
      shell.removeAttribute("inert");
      shell.removeAttribute("aria-hidden");
    };
  }, []);

  const register = useCallback((next: AdminSaveState | null) => setSave(next), []);
  const saveCtx = useMemo(() => ({ register }), [register]);

  function openSection(id: string) {
    // `show()` in the prototype does not touch history; replace keeps the back
    // stack pointing at the app screen the admin came from.
    setParams({ section: id }, { replace: true });
    setDrawerOpen(false);
  }

  if (!user) return null;

  // Built section, or the placeholder that names what will fill it.
  const Body = SECTION_COMPONENTS[active.id];

  // Portalled to <body> so the overlay is a SIBLING of the app shell rather than
  // a descendant of it. That is what lets the shell be marked `inert` above
  // without disabling the console itself, and it matches the prototype, whose
  // console is injected as its own document rather than nested inside the app.
  return createPortal(
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Admin console"
      style={CONSOLE_VARS}
      className="fixed inset-0 z-50 flex flex-col bg-bg outline-none"
    >
      {/* ── 46 px overlay header ── */}
      <header
        className="flex h-[46px] shrink-0 items-center justify-between px-3.5 shadow-[0_1px_6px_rgba(0,0,0,.15)]"
        style={{ background: "var(--ac-olive)" }}
      >
        <h1 className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
          <ShieldCheck className="h-[15px] w-[15px]" style={{ color: "var(--ac-gold)" }} />
          Admin console
        </h1>
        <button
          type="button"
          onClick={close}
          className="flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
        >
          <X className="h-3.5 w-3.5" />
          Close
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ── 210 px olive section rail; off-canvas drawer below 760 px ── */}
        <nav
          id="admin-console-rail"
          aria-label="Admin console sections"
          data-open={drawerOpen ? "true" : "false"}
          className={[
            "flex w-[210px] min-w-[210px] shrink-0 flex-col overflow-y-auto",
            "transition-transform duration-200 ease-out",
            "max-[760px]:absolute max-[760px]:inset-y-0 max-[760px]:left-0 max-[760px]:z-30",
            "max-[760px]:w-[250px] max-[760px]:min-w-[250px]",
            "max-[760px]:shadow-[0_0_44px_rgba(0,0,0,.32)]",
            drawerOpen ? "max-[760px]:translate-x-0" : "max-[760px]:-translate-x-full",
          ].join(" ")}
          style={{ background: "var(--ac-olive)" }}
        >
          <div className="flex items-center gap-2.5 border-b border-white/10 px-3 py-3.5 text-white">
            {/* The mark carries no accessible name of its own — the wordmark
                beside it is the console's brand text. */}
            <span aria-hidden="true" className="shrink-0 text-white/85">
              <Logo wordmark={false} size={30} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight">
                ai<span style={{ color: "var(--ac-gold)" }}>·</span>
                <span style={{ color: "var(--ac-gold)" }}>STARTUPJURY</span>
              </div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.08em] text-white/45">
                Venture Intelligence First
              </div>
            </div>
          </div>

          {groups.map((group, i) => (
            <div key={group}>
              {i > 0 && <div className="mx-0 h-px bg-white/[0.07]" />}
              <div className="py-2">
                <div className="px-3.5 pb-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white/20">
                  {group}
                </div>
                {sections
                  .filter((s) => s.group === group)
                  .map((section) => (
                    <RailItem
                      key={section.id}
                      section={section}
                      active={section.id === active.id}
                      onSelect={() => openSection(section.id)}
                    />
                  ))}
              </div>
            </div>
          ))}

          <div className="mt-auto flex items-center gap-2.5 border-t border-white/10 px-3.5 py-3">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-navy"
              style={{ background: "var(--ac-gold)" }}
            >
              {user.initials}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold text-white">{user.name}</div>
              <div className="truncate text-[9px] text-white/30">
                {user.title ?? roleLabel(edition, role)}
              </div>
            </div>
          </div>
        </nav>

        {/* Drawer scrim (below 760 px only — the rail is in flow above it). */}
        {drawerOpen && (
          <div
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 z-20 hidden bg-navy/45 max-[760px]:block"
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* ── Section title bar ── */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-surface px-5 py-3 max-[760px]:px-3.5">
            <button
              type="button"
              // The app shell's own top bar carries an "Open menu" button that
              // stays in the DOM behind this overlay, so this one needs a name
              // of its own to stay addressable.
              aria-label="Open admin console sections"
              aria-expanded={drawerOpen}
              aria-controls="admin-console-rail"
              onClick={() => setDrawerOpen((v) => !v)}
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-fg max-[760px]:flex"
            >
              <Menu className="h-[19px] w-[19px]" />
            </button>
            <div
              data-testid="admin-section-title"
              className="flex-1 truncate text-[15px] font-bold tracking-tight text-fg"
            >
              {active.label}
            </div>
            <ContextChip />
            <SaveChangesButton save={save} />
          </div>

          {/* ── Section content ── */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5 max-[760px]:p-3.5">
            <AdminSaveContext.Provider value={saveCtx}>
              {Body ? <Body /> : <SectionPlaceholder section={active} />}
            </AdminSaveContext.Provider>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One rail item, with the prototype's red pending-invite badge. */
function RailItem({
  section,
  active,
  onSelect,
}: {
  section: AdminSection;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = SECTION_ICONS[section.icon] ?? SlidersHorizontal;
  const badge = useRailBadge(section.id);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={[
        "flex w-full items-center gap-2 border-l-2 px-3.5 py-2 text-left text-[11.5px] transition-colors",
        active
          ? "border-l-[var(--ac-gold)] bg-[rgba(232,160,32,0.11)] font-semibold text-white"
          : "border-l-transparent text-white/50 hover:bg-white/5 hover:text-white/85",
      ].join(" ")}
    >
      <Icon className={`h-[15px] w-[15px] shrink-0 ${active ? "opacity-100" : "opacity-80"}`} />
      <span className="truncate">{section.label}</span>
      {badge > 0 && (
        <span
          className="ml-auto rounded-lg bg-signal-flagged px-1.5 py-px text-[9px] font-bold text-white"
          aria-label={`${badge} pending invite${badge === 1 ? "" : "s"}`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

/**
 * The Team & roles badge counts members whose invite has not been accepted.
 * The API cannot report that yet (W4-A owns the invite lifecycle), so this is 0
 * today and the badge does not render — see `pendingInviteCount`.
 */
function useRailBadge(sectionId: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (sectionId !== "tm") return;
    let cancelled = false;
    listUsers()
      .then((r) => {
        if (!cancelled) setCount(pendingInviteCount(r.users));
      })
      .catch(() => {
        /* the badge is an ornament — a failed read simply shows none */
      });
    return () => {
      cancelled = true;
    };
  }, [sectionId]);
  return sectionId === "tm" ? count : 0;
}

/**
 * The scope these settings apply to (prototype `.tb-ctx`, seeded
 * "Cohort 2026-A · FinTech"). Reads the shared active program/cohort the Set up
 * wizard and the decks toolbar already write. Hidden below 760 px, as drawn.
 */
function ContextChip() {
  const { user } = useAuth();
  const edition = user?.edition ?? "incubator";
  const [ctx] = useActiveContext(edition);
  const [programs, setPrograms] = useState<ProgramView[]>([]);

  useEffect(() => {
    let cancelled = false;
    listPrograms()
      .then((r) => {
        if (!cancelled) setPrograms(r.programs);
      })
      .catch(() => {
        /* no programs — the chip falls back to the all-programs label */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const program = programs.find((p) => p.id === ctx.programId) ?? null;
  const cohort = program?.cohorts.find((c) => c.id === ctx.cohortId) ?? null;
  const label = !program
    ? "All programs"
    : [cohort?.name ?? program.name, program.sector].filter(Boolean).join(" · ");

  return (
    <div
      data-testid="admin-context-chip"
      className="flex items-center gap-1 rounded-md border border-line bg-bg px-2.5 py-1 text-[10px] text-fg-muted max-[760px]:hidden"
    >
      <UsersRound className="h-[11px] w-[11px]" />
      {label}
    </div>
  );
}

/**
 * The console-level Save changes button. Sections register a handler through
 * `useAdminSave`; with none registered it is disabled and says why, which is
 * the honest state for a placeholder and for Team & roles (which saves each row
 * as it is edited).
 */
function SaveChangesButton({ save }: { save: AdminSaveState | null }) {
  const enabled = save !== null && save.dirty && !save.saving;
  const hint = save
    ? (save.hint ?? "No unsaved changes in this section.")
    : "This section has nothing to save.";
  return (
    <button
      type="button"
      disabled={!enabled}
      title={enabled ? undefined : hint}
      onClick={() => save?.onSave()}
      className="flex shrink-0 items-center gap-1.5 rounded-md px-4 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-45 max-[760px]:px-3"
      style={{ background: "var(--ac-gold-dk)" }}
    >
      <Save className="h-3.5 w-3.5" />
      {save?.saving ? "Saving…" : "Save changes"}
    </button>
  );
}
