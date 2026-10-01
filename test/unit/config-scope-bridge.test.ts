import { describe, it, expect } from "vitest";
import { configScope, inEdition } from "../../src/server/config/scope";
import { DEFAULT_TENANT_ID } from "../../src/shared/tenant";

/**
 * THE `ConfigScopeArg` RATCHET — T1-CONFIG's ONE TRANSITIONAL EDGE
 * ===============================================================
 *
 * `src/server/config/**` is T1-CONFIG's, but five of its exported loaders are
 * called from four other T1 sessions' route files. `src/server/config/scope.ts`
 * explains why they therefore accept a bare `Edition` as well as a `TenantScope`,
 * and why an edition-only call is a LEAK rather than a nicety: `org_settings`,
 * `org_scoring_settings` and `score_visibility` were all rebuilt with
 * `(tenant_id, edition)` in the key, so a second customer has rows of its own and
 * an edition-only read returns the first customer's.
 *
 * **This file is what stops that becoming permanent.** It is the same device
 * `test/worker/tenant-scope.test.ts` is: a ratchet that fails in BOTH directions.
 * A new edition-only call site fails it. A fixed one fails it too, and the fix is
 * to decrement the count below.
 *
 * ── WHY COUNTS PER FILE AND NOT LINE NUMBERS ────────────────────────────────
 *
 * Line numbers would make this test fail on any unrelated edit above a call site —
 * six sessions are editing these files in parallel this wave, so it would redden
 * for reasons that are not about tenancy and be switched off. A per-file count is
 * stable under unrelated edits and still catches both directions.
 *
 * ── WHAT INTEGRATION DOES WITH IT ───────────────────────────────────────────
 *
 * When every count below is zero, `ConfigScopeArg` loses its `Edition` arm, the
 * four loaders take a `TenantScope` and nothing else, the compiler carries the
 * invariant instead of a grep, and **this file is deleted**. The expectation at the
 * bottom is what says so out loud.
 */

/**
 * Every `src/server` module, as text.
 *
 * `import.meta.glob` rather than `node:fs`, and not a stylistic choice: `test/unit`
 * is compiled by `tsconfig.json`, whose `types` are `vite/client` + the testing
 * ones and deliberately NOT `node`. Adding `"node"` there to let one test call
 * `readFileSync` would hand ambient Node globals to all of `src/client` as well,
 * which is a much larger change than this file is worth. Vite's glob is typed by
 * `vite/client`, which that project already has.
 */
const SOURCES: Record<string, string> = import.meta.glob("../../src/server/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** `../../src/server/routes/decks.ts` → `routes/decks.ts`. */
const PREFIX = "../../src/server/";

/** The five loaders in `src/server/config/**` that other sessions' files call. */
const BRIDGED = [
  "loadScoringSettings",
  "scoringSettingsFor",
  "loadScoreVisibility",
  "introCallPrompts",
] as const;

/**
 * The call sites that still pass an edition, per file, with the session that owns
 * each. MEASURED on this branch, not estimated.
 *
 * `routes/config.ts` is absent because it is T1-CONFIG's own and passes a
 * `TenantScope` at all eight of its call sites — which is the point: the bridge is
 * for files this session does not own, and T1-CONFIG does not use it.
 */
const EDITION_ONLY: Readonly<Record<string, { count: number; owner: string; note?: string }>> = {
  "routes/decks.ts": { count: 9, owner: "T1-DECKS" },
  "routes/analytics.ts": {
    count: 7,
    owner: "T1-REPORTS",
    note:
      "the largest concentration, and §11's warning about aggregates applies: three of these " +
      "feed `loadScoreVisibility` into report filters whose output is counts and means",
  },
  "routes/pipeline.ts": {
    count: 2,
    owner: "T1-DECKS",
    note: ":520 derives the key from `deck.edition`, and `loadDeck`'s SELECT does not carry " +
      "`tenant_id` — so this one cannot be fixed without editing that statement and its row type",
  },
  "routes/assignments.ts": { count: 1, owner: "T1-DECKS" },
  "routes/calls.ts": { count: 1, owner: "T1-FLOW" },
  "ai/evaluate.ts": {
    count: 1,
    owner: "T1-DECKS",
    note: ":897 derives the key from `deck.edition`; same SELECT problem as pipeline.ts:520",
  },
};

/**
 * Call sites whose argument is an edition rather than a scope.
 *
 * The test is textual on purpose: a `ConfigScopeArg` is deliberately ASSIGNABLE
 * from an `Edition`, so the type system cannot distinguish the two and only the
 * source can. An argument counts as scoped when it mentions `scope`, `scopeOf` or
 * `inEdition`; anything else — `edition`, `deck.edition`, `c.var.user.edition` — is
 * the bridge being used.
 */
function editionOnlyCalls(source: string): string[] {
  const found: string[] = [];
  for (const fn of BRIDGED) {
    const re = new RegExp(`\\b${fn}\\(([^)]*)\\)`, "g");
    for (const m of source.matchAll(re)) {
      const args = m[1];
      if (!/\bscope\b|\bscopeOf\b|\binEdition\b|\bresolved\b/.test(args)) found.push(m[0]);
    }
  }
  return found;
}

describe("tenancy · the ConfigScopeArg bridge is a ratchet, not a resting place", () => {
  it("resolves a bare edition to the default tenant, and a scope to itself", () => {
    expect(configScope("incubator")).toEqual({
      tenantId: DEFAULT_TENANT_ID,
      edition: "incubator",
    });
    const scope = { tenantId: "t_other", edition: "vc" } as const;
    expect(configScope(scope)).toBe(scope);
    // `inEdition` keeps the customer and changes the product variant — the one
    // judgement `routes/config.ts` needs six times, because `s-fw` draws both
    // score-visibility matrices on one screen.
    expect(inEdition(scope, "incubator")).toEqual({ tenantId: "t_other", edition: "incubator" });
  });

  it("sees the whole server tree, so a miss is a miss and not an empty scan", () => {
    // Without this, a glob that resolved to nothing would make the next case pass
    // with an empty map compared against an empty map — the exact vacuity this file
    // exists to prevent elsewhere.
    const files = Object.keys(SOURCES);
    expect(files.length, "the source glob matched nothing").toBeGreaterThan(40);
    expect(files.every((f) => f.startsWith(PREFIX))).toBe(true);
    for (const owned of Object.keys(EDITION_ONLY)) {
      expect(SOURCES[`${PREFIX}${owned}`], `${owned} was not read`).toBeTypeOf("string");
    }
  });

  it("every edition-only call site is one of the declared ones, in the declared number", () => {
    const actual = new Map<string, number>();
    for (const [path, source] of Object.entries(SOURCES)) {
      const rel = path.slice(PREFIX.length);
      // The loaders' own module defines them; `config/scope.ts` documents them.
      if (rel.startsWith("config/")) continue;
      const calls = editionOnlyCalls(source);
      if (calls.length > 0) actual.set(rel, calls.length);
    }

    const declared = new Map(Object.entries(EDITION_ONLY).map(([k, v]) => [k, v.count]));
    // Both directions. A file that gained a call site, a file that lost one, and a
    // file nobody declared all fail here with the same message — and the fix for
    // "lost one" is to decrement the count, never to loosen the assertion.
    expect(
      Object.fromEntries([...actual].sort()),
      "the set of edition-only config-loader calls has moved. If a session has scoped its " +
        "file, DECREMENT its count in EDITION_ONLY (and delete the entry at zero). If a NEW " +
        "edition-only call site has appeared, it is a cross-tenant read: pass a TenantScope " +
        "instead — see src/server/config/scope.ts.",
    ).toEqual(Object.fromEntries([...declared].sort()));
  });

  it("names the owning session for every file still on the bridge", () => {
    // So that a failure above is actionable by somebody rather than merely true.
    for (const [file, entry] of Object.entries(EDITION_ONLY)) {
      expect(entry.owner, `${file} has no owning session`).toMatch(/^T1-[A-Z]+$/);
      expect(entry.count, `${file} is declared with no call sites — delete the entry`).toBeGreaterThan(0);
    }
  });

  it("`maybeAutoClarify` is on the bridge too, and says so at the one call site", () => {
    // Its input carries an optional `tenantId` rather than a scope argument, so the
    // regex above cannot see it. The caller is `ai/evaluate.ts`, which builds the
    // input from a `decks` row whose SELECT has no `tenant_id`.
    const src = SOURCES[`${PREFIX}ai/evaluate.ts`];
    const at = src.indexOf("maybeAutoClarify(");
    expect(at, "ai/evaluate.ts no longer calls maybeAutoClarify — update this case").toBeGreaterThan(0);
    const call = src.slice(at, src.indexOf("\n    );", at));
    expect(
      /tenantId/.test(call),
      "ai/evaluate.ts now passes tenantId to maybeAutoClarify — T1-DECKS has closed this one. " +
        "Delete this case and the optional `tenantId` on AutoClarifyInput.",
    ).toBe(false);
  });

  it("is itself temporary, and the count that ends it is zero", () => {
    const remaining = Object.values(EDITION_ONLY).reduce((n, e) => n + e.count, 0);
    // When this reaches 0, T1 integration narrows `ConfigScopeArg` to `TenantScope`
    // and deletes this file. Until then the number is the worklist's length, and it
    // is printed on every run.
    expect(remaining, `${remaining} config-loader call sites still pass an edition alone`).toBe(21);
  });
});
