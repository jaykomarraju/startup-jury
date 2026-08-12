// A tiny client-only store for the user's "active context" — the program +
// cohort they're currently working within. Set from the Set up wizard's Select
// step and the dashboard's / config's filter dropdowns; read by the decks
// toolbar (default filter), the upload form, and the Applies-to selector. Backed
// by localStorage and namespaced per edition, so it survives reloads.

import { useSyncExternalStore } from "react";
import type { Edition } from "../shared/roles";

export interface ActiveContext {
  programId: string | null;
  cohortId: string | null;
}

const EMPTY: ActiveContext = { programId: null, cohortId: null };
const storageKey = (edition: Edition) => `sj_active_context_${edition}`;
const listeners = new Set<() => void>();
// Per-edition snapshot cache so getSnapshot returns a referentially-stable value
// when nothing changed (required by useSyncExternalStore).
const cache = new Map<string, ActiveContext>();

function readRaw(edition: Edition): ActiveContext {
  try {
    const raw = localStorage.getItem(storageKey(edition));
    if (raw) {
      const v = JSON.parse(raw) as Partial<ActiveContext>;
      return { programId: v.programId ?? null, cohortId: v.cohortId ?? null };
    }
  } catch {
    /* localStorage unavailable / malformed — fall through to empty */
  }
  return EMPTY;
}

function getSnapshot(edition: Edition): ActiveContext {
  const key = storageKey(edition);
  const fresh = readRaw(edition);
  const cached = cache.get(key);
  if (cached && cached.programId === fresh.programId && cached.cohortId === fresh.cohortId) {
    return cached;
  }
  cache.set(key, fresh);
  return fresh;
}

export function getActiveContext(edition: Edition): ActiveContext {
  return getSnapshot(edition);
}

export function setActiveContext(edition: Edition, ctx: ActiveContext): void {
  try {
    localStorage.setItem(storageKey(edition), JSON.stringify(ctx));
  } catch {
    /* ignore persistence failure — in-memory cache still updates */
  }
  cache.set(storageKey(edition), ctx);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: [activeContext, setActiveContext] scoped to an edition. */
export function useActiveContext(edition: Edition): [ActiveContext, (ctx: ActiveContext) => void] {
  const ctx = useSyncExternalStore(
    subscribe,
    () => getSnapshot(edition),
    () => EMPTY,
  );
  return [ctx, (next: ActiveContext) => setActiveContext(edition, next)];
}
