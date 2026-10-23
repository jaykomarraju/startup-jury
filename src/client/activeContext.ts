// A tiny client-only store for the user's "active context" — the program +
// cohort they're currently working within. Backed by localStorage, so it
// survives reloads.
//
// Who touches it, measured 2026-10-23 (this header used to name three readers;
// there are more, and the screens the client named were not among them):
//   WRITTEN by the Set up wizard's Select step (SetupWizard.tsx:884/888), the
//   Dashboard's Program and Cohort pickers (DashboardPage.tsx:1572/1578), the
//   Applies-to selector (ConfigPage.tsx:357/374) and the upload form
//   (UploadPage.tsx:236).
//   READ by the Dashboard's deck list AND its activity log (DashboardPage.tsx
//   :1207, :1301), the upload form's default cohort (UploadPage.tsx:211), the
//   Applies-to selector, the admin console's title-bar chip
//   (AdminConsole.tsx:424) — and, since S1 of the 23-Oct tracker, Assign, Query
//   and the pipeline stage screens, through `followedDeckFilter` below. Until
//   then those three listed every programme's decks whatever the Dashboard was
//   set to, which is tracker rows 20 and 23: "Only decks relevant to the
//   program of context must appear."
//   Still IGNORED, in files S1 does not own: Intro calls (CallsPage.tsx:601),
//   Evaluate and the jury's Assigned (EvaluatePage.tsx:211), and the Reports.
//
// ── KEYED BY WHO IS SIGNED IN, NOT BY EDITION ALONE (the 23-Oct incident) ────
// The key was `sj_active_context_${edition}`. Edition has two values and one
// browser now signs into two organisations, so a programme picked in
// `t_default` was applied in `t_gcw`: their CEO uploaded 28 decks, every one
// correctly filed under his tenant, programme and cohort, and his Dashboard
// listed none of them. The stored id matched no deck in his tenant AND no
// option in his Program picker — so the picker drew its "Program" placeholder
// (DashboardPage.tsx:824) and the title carried no programme suffix (:1558),
// which is exactly what an UNFILTERED Dashboard looks like.
//
// The key now carries the tenant and the user. The tenant because that is the
// organisation; the user because this is one person's working view, and two
// people sharing a device inside one organisation is the same failure with a
// smaller blast radius. `users.id` is a global primary key
// (migrations/0087_users_tenant_rebuild.sql), so the user alone already
// separates organisations — the tenant is in the key so that nothing has to
// rely on that.
//
// ── THE OLD KEY IS DISCARDED, NOT MIGRATED ──────────────────────────────────
// A value under the old key cannot be attributed to an organisation — that is
// the defect — so copying it into the current tenant's key would re-apply, on
// purpose, the exact filter that hid the CEO's decks. Keeping it only when its
// programme exists in the signed-in tenant was considered and rejected: it puts
// a network read inside a synchronous store that five screens read during
// render, to save one re-pick of a dropdown. So nobody reads it, and the first
// access after this ships removes it.

import { useContext, useSyncExternalStore } from "react";
import { AuthContext } from "./auth/AuthProvider";
import type { Edition } from "../shared/roles";

export interface ActiveContext {
  programId: string | null;
  cohortId: string | null;
}

/**
 * The two fields of the session principal the context is keyed by.
 *
 * `tenantId` is optional HERE because the client's `AuthUser`
 * (auth/AuthProvider.tsx:12 — not S1's file) does not declare it, although both
 * responses that set the principal carry it: `/api/auth/login` and
 * `/api/auth/me` spread the server's `SessionUser` (routes/auth.ts:351, :462),
 * whose `tenantId` is required (server/types.ts:102). Declaring it optional
 * lets an `AuthUser` be passed as it is — no cast — and read honestly as
 * "may be absent", which is the truth about that type today.
 */
export interface ContextPrincipal {
  readonly id: string;
  readonly tenantId?: string;
}

const EMPTY: ActiveContext = { programId: null, cohortId: null };

/** Every key the edition-only scheme ever wrote. A Record so a new edition cannot be missed. */
const LEGACY_KEYS: Record<Edition, string> = {
  incubator: "sj_active_context_incubator",
  vc: "sj_active_context_vc",
};

/**
 * The storage key for one principal's context in one edition.
 *
 * A principal the client cannot see a tenant on gets `no-tenant` in that
 * position rather than no persistence at all. In production that never happens
 * (the server refuses a session without one — server/types.ts:94-100), and if a
 * future change to `/me` ever dropped the field, the user id still keeps one
 * organisation's selection out of another's; refusing to persist would instead
 * leave every Program picker in the product silently doing nothing.
 */
export function activeContextKey(principal: ContextPrincipal, edition: Edition): string {
  const tenant = typeof principal.tenantId === "string" && principal.tenantId !== "" ? principal.tenantId : "no-tenant";
  return `sj_active_context:${tenant}:${principal.id}:${edition}`;
}

const listeners = new Set<() => void>();
// Per-key snapshot cache so getSnapshot returns a referentially-stable value
// when nothing changed (required by useSyncExternalStore).
const cache = new Map<string, ActiveContext>();

let legacyDiscarded = false;
function discardLegacyKeys(): void {
  if (legacyDiscarded) return;
  legacyDiscarded = true;
  try {
    for (const key of Object.values(LEGACY_KEYS)) localStorage.removeItem(key);
  } catch {
    /* localStorage unavailable — there is nothing to discard either */
  }
}

function readRaw(key: string): ActiveContext {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const v = JSON.parse(raw) as Partial<ActiveContext>;
      return { programId: v.programId ?? null, cohortId: v.cohortId ?? null };
    }
  } catch {
    /* localStorage unavailable / malformed — fall through to empty */
  }
  return EMPTY;
}

function getSnapshot(key: string): ActiveContext {
  discardLegacyKeys();
  const fresh = readRaw(key);
  const cached = cache.get(key);
  if (cached && cached.programId === fresh.programId && cached.cohortId === fresh.cohortId) {
    return cached;
  }
  cache.set(key, fresh);
  return fresh;
}

function write(key: string, ctx: ActiveContext): void {
  discardLegacyKeys();
  try {
    localStorage.setItem(key, JSON.stringify(ctx));
  } catch {
    /* ignore persistence failure — in-memory cache still updates */
  }
  cache.set(key, ctx);
  listeners.forEach((l) => l());
}

export function getActiveContext(principal: ContextPrincipal, edition: Edition): ActiveContext {
  return getSnapshot(activeContextKey(principal, edition));
}

export function setActiveContext(principal: ContextPrincipal, edition: Edition, ctx: ActiveContext): void {
  write(activeContextKey(principal, edition), ctx);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * React hook: [activeContext, setActiveContext] for the signed-in principal in
 * an edition.
 *
 * The principal is read here rather than passed in, so none of the five callers
 * can key it wrongly — and through `AuthContext` directly rather than
 * `useAuth()`, which throws outside a provider: QueryPage never needed auth
 * before S1, and its tests mount it bare. Signed out (or outside a provider)
 * the context is empty and a write is dropped, because there is nobody to file
 * it under.
 */
export function useActiveContext(edition: Edition): [ActiveContext, (ctx: ActiveContext) => void] {
  const principal = useContext(AuthContext)?.user ?? null;
  const key = principal ? activeContextKey(principal, edition) : null;
  const ctx = useSyncExternalStore(
    subscribe,
    () => (key ? getSnapshot(key) : EMPTY),
    () => EMPTY,
  );
  return [
    ctx,
    (next: ActiveContext) => {
      if (key) write(key, next);
    },
  ];
}

/**
 * Do the deck screens OTHER than the Dashboard follow the context?
 *
 * Incubator only. Rows 20 and 23 are the incubator's, and the VC edition is out
 * of scope (client, 2026-10-01) and must render as it does today — Query and the
 * stage screens serve BOTH editions from one component (App.tsx:136/148 and
 * :140/:152), so the switch lives here once rather than in each of them. The
 * Dashboard has filtered by the context in both editions all along and is not
 * changed by this.
 */
const SCREENS_FOLLOW_CONTEXT: Record<Edition, boolean> = { incubator: true, vc: false };

/**
 * The `listDecks` filter a screen that follows the context passes. Empty when
 * nothing is selected — or in VC — so the request is byte-identical to the one
 * the screen sent before S1.
 *
 * This is a FILTER, not a boundary, and deliberately so: `GET /api/decks` takes
 * `programId` from the caller (routes/decks.ts:653) inside the tenant scope it
 * binds first (:648), so a caller can ask for any programme in its own
 * organisation and none outside it. Four Program Managers sharing one pipeline
 * is a client-accepted decision; only jurors are narrowed, server-side, to their
 * own allocation (`ASSIGNEE_SCOPED_ROLES`, :559). What this decides is the
 * DEFAULT a screen opens on.
 */
export function followedDeckFilter(edition: Edition, ctx: ActiveContext): { programId?: string; cohortId?: string } {
  if (!SCREENS_FOLLOW_CONTEXT[edition]) return {};
  return {
    ...(ctx.programId ? { programId: ctx.programId } : {}),
    ...(ctx.cohortId ? { cohortId: ctx.cohortId } : {}),
  };
}
