import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_VISIBILITY,
  VISIBILITY_ROLES,
  ladderVisibility,
} from "../../src/shared/scoreVisibility";

/**
 * **V3-SF · item 13 — the score visibility matrix.**
 *
 * The v3 superuser prototype's admin console (base64 `ADMIN_B64`, section
 * `s-fw`) replaces the single "Jury can see each other's scores" toggle with
 * two matrices — `Visibility for Incubator` (4×4) and `Visibility for VC`
 * (5×5), "Viewer (row) → can see scores of (column)".
 *
 * This is a PERMISSION SYSTEM, not a screen, and this repo has a named,
 * recurring history of exactly this class leaking (`role-boundary-leaks`,
 * Aug-2026 issue 21). So every assertion here is on the RESPONSE PAYLOAD of a
 * real request, never on what a component chose to render, and the payload
 * assertions are written so that **reverting the filter makes them fail**:
 *
 *   • the report is checked by COLUMN ROLES *and* by the CELL KEYS of the
 *     score rows — the numbers, not just the headers;
 *   • `/evaluators` is checked by the NAMES it lists;
 *   • `/drift` is checked by a mean that MOVES, because its row set does not
 *     (Wave 9 integration caught a vacuous issue-21 test that only ever
 *     compared row counts).
 *
 * Negative control run for this file: reverting `canSeeEvaluatorScoresIn` in
 * `decks.ts` to the unfiltered `evaluatorRole` pass fails
 * "the matrix decides the report, cells included" and
 * "turning a cell ON hands over columns that were withheld"; reverting the
 * three `analytics.ts` filters fails "the matrix decides the analytics reports".
 */

const BASE = "https://example.com";

const SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin — in NEITHER matrix
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate
const JURY = "rajesh.kumar@demo.startupjury.ai"; // jury
const PM = "raj.kumar@demo.startupjury.ai"; // program_manager
const FOUNDER = "meera.sharma@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const get = (path: string, cookie: string) => SELF.fetch(`${BASE}${path}`, { headers: { cookie } });

const send = (method: string, path: string, cookie: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

interface Report {
  columns: { id: string; kind: string; role?: string }[];
  core: { key: string; cells: Record<string, { value: number }> }[];
  hiddenEvaluators: number;
}

const DECK = "inc_deck_insureflow";

async function report(cookie: string): Promise<Report> {
  return (await get(`/api/decks/${DECK}/report`, cookie)).json() as Promise<Report>;
}

/** Every evaluator id that appears in ANY core row's cells — the numbers served. */
function cellOwners(r: Report): Set<string> {
  const ids = new Set<string>();
  for (const row of r.core) for (const id of Object.keys(row.cells)) ids.add(id);
  return ids;
}

/** F0109's toggle. The matrix is a conjunction with it, not a replacement. */
async function setPeerVisibility(on: boolean): Promise<void> {
  await env.DB.prepare(
    "UPDATE org_scoring_settings SET jury_sees_peer_scores = ? WHERE edition = 'incubator'",
  )
    .bind(on ? 1 : 0)
    .run();
}

/** Save one cell through the console's own route — no direct DB write. */
async function setCell(
  cookie: string,
  viewer: string,
  target: string,
  visible: boolean,
): Promise<Response> {
  const current = (await (await get("/api/config/scoring", cookie)).json()) as {
    scoring: Record<string, unknown>;
  };
  return send("PUT", "/api/config/scoring-framework", cookie, {
    ...current.scoring,
    visibility: { incubator: { [viewer]: { [target]: visible } } },
  });
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM score_visibility").run();
  await setPeerVisibility(false);
});

afterEach(async () => {
  await env.DB.prepare("DELETE FROM score_visibility").run();
  await env.DB.prepare("DELETE FROM audit_log WHERE action = 'score_visibility_changed'").run();
  await setPeerVisibility(false);
});

// ── The matrix itself ────────────────────────────────────────────────────────

describe("the matrix the prototype draws", () => {
  it("carries exactly the rows and columns of the decoded console, per edition", () => {
    // `admin` and `founder` are in NEITHER matrix — the prototype does not draw
    // them, so they must not become configurable here.
    expect(VISIBILITY_ROLES.incubator).toEqual([
      "superuser",
      "program_manager",
      "program_associate",
      "jury",
    ]);
    expect(VISIBILITY_ROLES.vc).toEqual([
      "superuser",
      "ic_member",
      "partner",
      "associate",
      "analyst",
    ]);
    for (const edition of ["incubator", "vc"] as const) {
      expect(VISIBILITY_ROLES[edition]).not.toContain("admin");
      expect(VISIBILITY_ROLES[edition]).not.toContain("founder");
    }
  });

  it("ships the prototype's printed defaults, and they are not the old ladder", () => {
    // "Super User & Program Manager see everyone; Program Associate and Jury
    // Member see no one — jury members cannot see each other (blind
    // evaluation) until turned on here."
    const inc = DEFAULT_VISIBILITY.incubator;
    expect(inc.superuser).toEqual({
      superuser: true,
      program_manager: true,
      program_associate: true,
      jury: true,
    });
    expect(inc.program_manager).toEqual({
      superuser: true,
      program_manager: true,
      program_associate: true,
      jury: true,
    });
    expect(Object.values(inc.program_associate!).every((v) => v === false)).toBe(true);
    expect(Object.values(inc.jury!).every((v) => v === false)).toBe(true);

    // "Managing Partner, IC member and Partner/Principal see everyone; Inv.
    // Associate and Analyst see no one until turned on here."
    const vc = DEFAULT_VISIBILITY.vc;
    for (const r of ["superuser", "ic_member", "partner"] as const) {
      expect(Object.values(vc[r]!).every((v) => v === true)).toBe(true);
    }
    for (const r of ["associate", "analyst"] as const) {
      expect(Object.values(vc[r]!).every((v) => v === false)).toBe(true);
    }

    // §4 Q71 — the four incubator cells this moves, named as data so the
    // question is answerable rather than described in prose.
    const ladder = ladderVisibility("incubator");
    const moved: string[] = [];
    for (const viewer of VISIBILITY_ROLES.incubator) {
      for (const target of VISIBILITY_ROLES.incubator) {
        if (inc[viewer]![target] !== ladder[viewer]![target]) moved.push(`${viewer}->${target}`);
      }
    }
    expect(moved.sort()).toEqual([
      "jury->jury",
      "jury->program_associate",
      "program_associate->program_associate",
      "program_manager->superuser",
    ]);
  });
});

// ── Enforcement · the deck report ────────────────────────────────────────────

describe("the deck report is filtered by the matrix, on the server", () => {
  it("is unchanged at the shipped settings — the peer toggle answers first", async () => {
    // `jurySeesPeerScores` ships OFF, and off an assignable evaluator sees the
    // AI column and their own whatever the matrix says. This is why swapping
    // the ladder for the prototype's defaults moves nothing on a fresh org.
    const jury = await report(await login(JURY));
    expect(jury.columns.map((c) => c.role ?? "ai")).toEqual(["ai", "jury"]);
    const su = await report(await login(SUPER));
    expect(su.columns.length).toBeGreaterThan(2);
  });

  it("the matrix decides the report, cells included", async () => {
    await setPeerVisibility(true);
    // Default: the jury row is all off, so a juror reads only their own column
    // — and, critically, only their own CELLS.
    const jury = await report(await login(JURY));
    const own = jury.columns.find((c) => c.role === "jury")!.id;
    expect(jury.columns.map((c) => c.role ?? "ai")).toEqual(["ai", "jury"]);
    expect([...cellOwners(jury)].sort()).toEqual(["ai", own].sort());
    expect(jury.hiddenEvaluators).toBe(3);
  });

  it("turning a cell ON hands over columns that were withheld", async () => {
    await setPeerVisibility(true);
    const su = await login(SUPER);

    const before = await report(await login(JURY));
    expect(before.columns.some((c) => c.role === "program_associate")).toBe(false);

    const res = await setCell(su, "jury", "program_associate", true);
    expect(res.status).toBe(200);

    const after = await report(await login(JURY));
    expect(after.columns.some((c) => c.role === "program_associate")).toBe(true);
    expect(after.hiddenEvaluators).toBe(2);
    // The NUMBERS arrived too, not just the header.
    const paColumn = after.columns.find((c) => c.role === "program_associate")!.id;
    expect(cellOwners(after).has(paColumn)).toBe(true);
    expect(cellOwners(before).has(paColumn)).toBe(false);
  });

  it("turning a cell OFF withholds a column the default allowed", async () => {
    const su = await login(SUPER);
    const before = await report(su);
    expect(before.columns.some((c) => c.role === "jury")).toBe(true);

    expect((await setCell(su, "superuser", "jury", false)).status).toBe(200);

    const after = await report(await login(SUPER));
    expect(after.columns.some((c) => c.role === "jury")).toBe(false);
    const juryIds = before.columns.filter((c) => c.role === "jury").map((c) => c.id);
    for (const id of juryIds) expect(cellOwners(after).has(id)).toBe(false);
    expect(after.hiddenEvaluators).toBeGreaterThan(before.hiddenEvaluators);
  });

  it("identity beats the matrix: your own column survives your own row being off", async () => {
    await setPeerVisibility(true);
    const su = await login(SUPER);
    // The diagonal is the blind-evaluation control — it governs OTHER people
    // who hold your role, never the scores you submitted yourself.
    expect((await setCell(su, "program_associate", "program_associate", false)).status).toBe(200);
    const pa = await report(await login(PA));
    expect(pa.columns.map((c) => c.role ?? "ai")).toEqual(["ai", "program_associate"]);
  });

  it("the one cell that WIDENS: a PM now reads the superuser's column (§4 Q71)", async () => {
    // `program_manager → superuser` is off under the old ladder (rank 3 < 99)
    // and ON under the prototype's printed default, which is the only grant
    // this release makes. The seed holds no superuser evaluation, so the grant
    // is invisible until one exists — hence this test writes one, asserts the
    // PM receives it, and asserts an admin can take it away again.
    const su = (await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?",
    ).bind(SUPER).first<{ id: string }>())!.id;
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, submitted_at) " +
        "VALUES ('ev_v3sf_su', ?, ?, 8.25, datetime('now'))",
    )
      .bind(DECK, su)
      .run();
    try {
      await setPeerVisibility(true);
      const pm = await report(await login(PM));
      expect(pm.columns.some((c) => c.role === "superuser")).toBe(true);

      expect((await setCell(await login(SUPER), "program_manager", "superuser", false)).status).toBe(200);
      const after = await report(await login(PM));
      expect(after.columns.some((c) => c.role === "superuser")).toBe(false);
    } finally {
      await env.DB.prepare("DELETE FROM evaluations WHERE id = 'ev_v3sf_su'").run();
    }
  });

  it("a role the matrices do not draw is untouched — admin still oversees", async () => {
    const admin = await report(await login(ADMIN));
    expect(admin.hiddenEvaluators).toBe(0);
    expect(admin.columns.map((c) => c.role ?? "ai")).toEqual([
      "ai",
      "program_associate",
      "jury",
      "program_manager",
      "admin",
    ]);
  });
});

// ── Enforcement · the three analytics reports ────────────────────────────────

interface Evaluators {
  evaluators: Array<{ name: string; role: string }>;
}
interface Drift {
  rows: Array<{ name: string; humanScore: number }>;
}

describe("the matrix decides the analytics reports", () => {
  it("/evaluators names only evaluators the viewer's row allows", async () => {
    const admin = (await (await get("/api/analytics/evaluators", await login(ADMIN))).json()) as Evaluators;
    const pa = (await (await get("/api/analytics/evaluators", await login(PA))).json()) as Evaluators;
    expect(admin.evaluators.some((r) => r.role === "jury")).toBe(true);
    expect(pa.evaluators.some((r) => r.role !== "program_associate")).toBe(false);

    // Turn the associate's row on for jury and the names appear.
    expect((await setCell(await login(SUPER), "program_associate", "jury", true)).status).toBe(200);
    const after = (await (await get("/api/analytics/evaluators", await login(PA))).json()) as Evaluators;
    expect(after.evaluators.some((r) => r.role === "jury")).toBe(true);
    expect(after.evaluators.length).toBeGreaterThan(pa.evaluators.length);
  });

  it("/drift's mean MOVES with the matrix — the row set never does", async () => {
    // Wave 9 integration: a row-count assertion here passes with the filter
    // removed. The mean is what actually carries the leak.
    const deck = "GreenGrid Energy";
    const mean = async (email: string): Promise<number> => {
      const d = (await (await get("/api/analytics/drift", await login(email))).json()) as Drift;
      return d.rows.find((r) => r.name === deck)!.humanScore;
    };
    const adminMean = await mean(ADMIN);
    const paBefore = await mean(PA);
    expect(paBefore).not.toBe(adminMean);

    expect((await setCell(await login(SUPER), "program_associate", "jury", true)).status).toBe(200);
    const paAfter = await mean(PA);
    expect(paAfter).not.toBe(paBefore);
  });
});

// ── The write path ───────────────────────────────────────────────────────────

describe("only a console admin may change the matrix", () => {
  it("a juror's save is refused, and the matrix does not move", async () => {
    const jury = await login(JURY);
    const res = await send("PUT", "/api/config/scoring-framework", jury, {
      visibility: { incubator: { jury: { program_manager: true } } },
    });
    expect(res.status).toBe(403);
    const { n } = (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM score_visibility",
    ).first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it("a founder cannot even read it", async () => {
    expect((await get("/api/config/scoring", await login(FOUNDER))).status).toBe(403);
  });

  it("drops a cell naming a role the edition's matrix does not draw", async () => {
    const su = await login(SUPER);
    const current = (await (await get("/api/config/scoring", su)).json()) as {
      scoring: Record<string, unknown>;
    };
    const res = await send("PUT", "/api/config/scoring-framework", su, {
      ...current.scoring,
      visibility: {
        incubator: { jury: { admin: true, program_associate: true }, founder: { jury: true } },
      },
    });
    expect(res.status).toBe(200);
    const stored = (
      await env.DB.prepare("SELECT viewer_role, target_role FROM score_visibility").all<{
        viewer_role: string;
        target_role: string;
      }>()
    ).results;
    expect(stored).toEqual([{ viewer_role: "jury", target_role: "program_associate" }]);
  });

  it("audits the CELLS that moved, by name, and stays quiet when none did", async () => {
    // A permission grant is the thing a reader of the log has to be able to
    // find. The toggle this control replaced was audited (`peer_scores_toggled`);
    // so is this.
    const su = await login(SUPER);
    const count = async () =>
      (await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'score_visibility_changed'",
      ).first<{ n: number }>())!.n;
    const before = await count();

    expect((await setCell(su, "jury", "program_manager", true)).status).toBe(200);
    expect(await count()).toBe(before + 1);
    const row = (await env.DB.prepare(
      "SELECT summary FROM audit_log WHERE action = 'score_visibility_changed' ORDER BY rowid DESC LIMIT 1",
    ).first<{ summary: string }>())!;
    expect(row.summary).toContain("can now see");
    expect(row.summary).toContain("Incubator");

    // Saving the same value again moves nothing, so it logs nothing.
    expect((await setCell(su, "jury", "program_manager", true)).status).toBe(200);
    expect(await count()).toBe(before + 1);

    // …and turning it back off is its own line.
    expect((await setCell(su, "jury", "program_manager", false)).status).toBe(200);
    expect(await count()).toBe(before + 2);
    const off = (await env.DB.prepare(
      "SELECT summary FROM audit_log WHERE action = 'score_visibility_changed' ORDER BY rowid DESC LIMIT 1",
    ).first<{ summary: string }>())!;
    expect(off.summary).toContain("can no longer see");
  });

  it("round-trips through GET, resolved, so the console renders what is enforced", async () => {
    const su = await login(SUPER);
    expect((await setCell(su, "jury", "jury", true)).status).toBe(200);
    const body = (await (await get("/api/config/scoring", su)).json()) as {
      visibility: { incubator: Record<string, Record<string, boolean>>; vc: Record<string, unknown> };
    };
    expect(body.visibility.incubator.jury.jury).toBe(true);
    expect(body.visibility.incubator.jury.program_manager).toBe(false); // still the default
    expect(body.visibility.vc).toEqual(DEFAULT_VISIBILITY.vc); // VC untouched
  });
});
