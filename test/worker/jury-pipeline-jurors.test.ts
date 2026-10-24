import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { isAssignedEvaluator } from "../../src/server/decks/assignments";

/**
 * **23-Oct tracker, P1 — the Jury Pipeline's jurors and their scores.**
 *
 * The client, twice by email: "each startup may be assigned to multiple jurors.
 * Therefore it should show multiple juror names and their respective scores next
 * to each startup name." `GET /api/decks` now carries `jurors` — per assignee, a
 * name, whether they have submitted, and a score ONLY where the viewer may see it.
 *
 * Every assertion is on the RESPONSE PAYLOAD (`role-boundary-leaks`): a score the
 * viewer may not see must not be in the JSON at all, whatever a screen renders.
 * The scores are deliberately odd numbers (6.15 · 7.35 · 8.55) so "absent" can be
 * asserted by searching the serialised panel for them, not by a key check alone.
 *
 * The rule is the hierarchy (23-Oct, the product owner reviewing P1): "anyone
 * senior should be able to see the junior persons scoring but the junior cant see
 * the seniors score" — per juror, on the report, AND in the deck-level averages.
 *
 * Negative controls, re-run 2026-10-23 after that change (each break restored by
 * copying the file back, never via git; 22/22 green before and after):
 *   • `evaluatorScoreRule.canSee` answering `true` past the identity check fails
 *     9 — every associate, hierarchy, peer, average and drift test. "Agrees with
 *     the report" stays green under it, as it must: both readers call the one
 *     function, so they break together;
 *   • `PEER_TOGGLE_REACHES_PEERS_ONLY.incubator` → false (the toggle hiding
 *     everyone again) fails 5 here, 7 across this file, `score-visibility-v3`
 *     and `issuelog-aug2026`;
 *   • `averagesSeenBy` never filtering fails 4 — the averages, by-id and
 *     see-none tests;
 *   • `shortlistBlocked` judged on the viewer's own average fails 1 — the
 *     fixture straddles the 7.0 floor so it can;
 *   • `DEFAULT_VISIBILITY.incubator` put back to the prototype's printed
 *     default fails 10 across this file, `score-visibility-v3`,
 *     `issuelog-aug2026` and `scoringFramework.test.tsx`;
 *   • a `LEFT JOIN deck_assignments` added to the `GET /` listing statement fails
 *     1 — "one row per deck";
 *   • `PANEL_PAIRS_SQL` swapped for `ASSIGNEE_PAIRS_SQL` fails 1 — "a delegate is
 *     not on the panel".
 */

const BASE = "https://example.com";

const SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin — in neither matrix
const PM = "raj.kumar@demo.startupjury.ai"; // program_manager — an ASSIGNABLE evaluator
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate — reads the screen, read-only
const JURY = "rajesh.kumar@demo.startupjury.ai"; // jury (inc_jury)
const FOUNDER = "meera.sharma@demo.startupjury.ai";
const VC_SUPER = "aarav.khanna@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const get = (path: string, cookie: string) => SELF.fetch(`${BASE}${path}`, { headers: { cookie } });

interface Juror {
  id: string;
  name: string;
  submitted: boolean;
  score?: number;
  scoreWithheld?: true;
}

interface Deck {
  id: string;
  statusId?: string;
  assigneeIds?: string[];
  jurors?: Juror[];
  aiScore?: number;
  juryScore?: number;
  decisionScore?: number;
  aiWeightPct?: number;
  shortlistBlocked?: boolean;
}

async function listing(cookie: string): Promise<Deck[]> {
  const res = await get("/api/decks", cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { decks: Deck[] }).decks;
}

async function panelOf(email: string, deckId: string): Promise<Juror[]> {
  const deck = (await listing(await login(email))).find((d) => d.id === deckId);
  expect(deck, `${deckId} is listed for ${email}`).toBeDefined();
  expect(deck!.jurors, `${deckId} carries a panel for ${email}`).toBeDefined();
  return deck!.jurors!;
}

/** The three jury scores on THREE. None of these numbers occurs anywhere in the seed. */
const SCORES = { inc_jury: 6.15, p1_jury_b: 7.35, p1_jury_c: 8.55 } as const;

/** `day(0)` is today, UTC — the comparison `currentlyOutSql` makes. */
function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

async function setPeerVisibility(on: boolean): Promise<void> {
  await env.DB.prepare(
    "UPDATE org_scoring_settings SET jury_sees_peer_scores = ? WHERE tenant_id = 't_default' AND edition = 'incubator'",
  )
    .bind(on ? 1 : 0)
    .run();
}

async function seedDeck(id: string, name: string, status: string, assignedTo: string | null): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO decks (id, tenant_id, edition, name, status, ai_score, assigned_to, uploaded_by, founder, complete) " +
      "VALUES (?, 't_default', 'incubator', ?, ?, 7.0, ?, 'inc_founder', 'Ada Founder', 1)",
  )
    .bind(id, name, status, assignedTo)
    .run();
}

async function assign(deckId: string, evaluatorId: string, at: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO deck_assignments (deck_id, evaluator_id, assigned_by, assigned_at) VALUES (?, ?, 'inc_pa', ?)",
  )
    .bind(deckId, evaluatorId, at)
    .run();
}

async function evaluation(deckId: string, evaluatorId: string, total: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, submitted_at) " +
      "VALUES (?, ?, ?, ?, 'scored', '2026-10-20T10:00:00Z')",
  )
    .bind(`${deckId}_${evaluatorId}_eval`, deckId, evaluatorId, total)
    .run();
}

// File-level, not per-describe: a `beforeAll` inside a `describe` is rolled back
// when that suite ends (`worker-tests-isolated-storage-beforeall`).
beforeAll(async () => {
  for (const [id, name, initials, email] of [
    ["p1_jury_b", "Meera Iyer", "MI", "meera.iyer.p1@demo.startupjury.ai"],
    ["p1_jury_c", "Arjun Pillai", "AP", "arjun.pillai.p1@demo.startupjury.ai"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO users (id, tenant_id, edition, name, email, password_hash, role, initials, active) " +
        "VALUES (?, 't_default', 'incubator', ?, ?, NULL, 'jury', ?, 1)",
    )
      .bind(id, name, email, initials)
      .run();
  }

  // THREE — a panel of three, all submitted. `assigned_to` is the first of them
  // AND has its own `deck_assignments` row, which is how `POST /api/assignments`
  // writes it.
  await seedDeck("p1_three", "Panel of Three", "jury_evaluation", "inc_jury");
  await assign("p1_three", "inc_jury", "2026-10-19T09:00:00Z");
  await assign("p1_three", "p1_jury_b", "2026-10-19T09:00:01Z");
  await assign("p1_three", "p1_jury_c", "2026-10-19T09:00:02Z");
  for (const [who, total] of Object.entries(SCORES)) await evaluation("p1_three", who, total);

  // ONE — the same person in BOTH halves of the union. One name, never two.
  await seedDeck("p1_one", "Panel of One", "assigned", "inc_jury");
  await assign("p1_one", "inc_jury", "2026-10-19T09:00:00Z");

  // LEGACY — `assigned_to` with no join-table row (pre-0058, and every seed).
  await seedDeck("p1_legacy", "Legacy Assignee", "assigned", "inc_jury");

  // MIXED — one submitted, one not.
  await seedDeck("p1_mixed", "Half Scored", "jury_evaluation", "inc_jury");
  await assign("p1_mixed", "inc_jury", "2026-10-19T09:00:00Z");
  await assign("p1_mixed", "p1_jury_b", "2026-10-19T09:00:01Z");
  await evaluation("p1_mixed", "p1_jury_b", 7.35);

  // RANKED — one evaluation per rank, every total distinct, so each viewer's mean
  // is a number no other viewer's can be: PA 5 · jury 7 · PM 9 · admin 6.
  await seedDeck("p1_avg", "Ranked Panel", "jury_evaluation", "inc_jury");
  await assign("p1_avg", "inc_jury", "2026-10-19T09:00:00Z");
  for (const [who, total] of [
    ["inc_pa", 5],
    ["inc_jury", 7],
    ["inc_pm", 9],
    ["inc_admin", 6],
  ] as const) {
    await evaluation("p1_avg", who, total);
  }

  // DRIFT — an assignee id that resolves to ANOTHER customer's user.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO organizations (id, name, slug, status) VALUES ('t_p1x', 'P1 Other', 'p1-other', 'active')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO users (id, tenant_id, edition, name, email, password_hash, role, initials, active) " +
      "VALUES ('p1_other', 't_p1x', 'incubator', 'Other Customer Person', 'other.p1@p1other.test', NULL, 'jury', 'OC', 1)",
  ).run();
  await seedDeck("p1_drift", "Drifted Panel", "jury_evaluation", null);
  await assign("p1_drift", "p1_other", "2026-10-19T09:00:00Z");
  await evaluation("p1_drift", "p1_other", 9.95);
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM score_visibility").run();
  await setPeerVisibility(false);
});

afterEach(async () => {
  await env.DB.prepare("DELETE FROM score_visibility").run();
  await setPeerVisibility(false);
  await env.DB.prepare(
    "UPDATE users SET out_of_office_from = NULL, out_of_office_to = NULL, out_of_office_delegate = NULL WHERE id LIKE 'p1_%'",
  ).run();
});

// ── What the screen asked for ────────────────────────────────────────────────

describe("every juror on the panel, by name, with their status and score", () => {
  it("a deck with three jurors carries three names and three scores, first assignee first", async () => {
    const panel = await panelOf(SUPER, "p1_three");
    expect(panel).toEqual([
      { id: "inc_jury", name: "Rajesh Kumar", submitted: true, score: 6.15 },
      { id: "p1_jury_b", name: "Meera Iyer", submitted: true, score: 7.35 },
      { id: "p1_jury_c", name: "Arjun Pillai", submitted: true, score: 8.55 },
    ]);
  });

  it("a deck with one juror carries one — the same person in both halves is not listed twice", async () => {
    expect(await panelOf(SUPER, "p1_one")).toEqual([{ id: "inc_jury", name: "Rajesh Kumar", submitted: false }]);
    // The pre-0058 shape: the column alone still makes a panel of one.
    expect(await panelOf(SUPER, "p1_legacy")).toEqual([{ id: "inc_jury", name: "Rajesh Kumar", submitted: false }]);
  });

  it("a juror who has not submitted has no score key, and is not 'withheld' either", async () => {
    const panel = await panelOf(SUPER, "p1_mixed");
    expect(panel).toEqual([
      { id: "inc_jury", name: "Rajesh Kumar", submitted: false },
      { id: "p1_jury_b", name: "Meera Iyer", submitted: true, score: 7.35 },
    ]);
  });

  it("the panel is exactly `assigneeIds` on every listed deck — one definition of the set", async () => {
    const decks = await listing(await login(SUPER));
    expect(decks.length).toBeGreaterThan(0);
    for (const d of decks) {
      expect(new Set((d.jurors ?? []).map((j) => j.id)), d.id).toEqual(new Set(d.assigneeIds ?? []));
    }
  });
});

// ── The trap: who may see the numbers ────────────────────────────────────────

describe("the scores go through the report's rule, on the server", () => {
  it("the programme associate receives the names and the statuses, and NOT ONE number", async () => {
    const panel = await panelOf(PA, "p1_three");
    expect(panel.map((j) => j.name)).toEqual(["Rajesh Kumar", "Meera Iyer", "Arjun Pillai"]);
    expect(panel.every((j) => j.submitted)).toBe(true);
    expect(panel.every((j) => !("score" in j))).toBe(true);
    expect(panel.every((j) => j.scoreWithheld === true)).toBe(true);
    const served = JSON.stringify(panel);
    for (const n of Object.values(SCORES)) expect(served).not.toContain(String(n));
  });

  it("…and turning the peer toggle on does not hand them over: the matrix withholds them too", async () => {
    // The two gates are a conjunction. With the toggle ON, the shipped matrix
    // still says "Program Associate … see no one" (`DEFAULT_VISIBILITY`).
    await setPeerVisibility(true);
    const panel = await panelOf(PA, "p1_three");
    expect(panel.every((j) => !("score" in j) && j.scoreWithheld === true)).toBe(true);
    for (const n of Object.values(SCORES)) expect(JSON.stringify(panel)).not.toContain(String(n));
  });

  it("…and only a matrix cell an admin turns ON releases them", async () => {
    await setPeerVisibility(true);
    await env.DB.prepare(
      "INSERT INTO score_visibility (tenant_id, edition, viewer_role, target_role, visible, updated_at) " +
        "VALUES ('t_default', 'incubator', 'program_associate', 'jury', 1, '2026-10-23T00:00:00Z')",
    ).run();
    const panel = await panelOf(PA, "p1_three");
    expect(panel.map((j) => j.score)).toEqual([6.15, 7.35, 8.55]);
  });

  it("the PM, senior to the whole panel, sees every juror's number at the shipped settings", async () => {
    // 23-Oct: "anyone senior should be able to see the junior persons scoring".
    // Until then the peer toggle — OFF as shipped — reduced the PM to "AI + own"
    // and this panel read Hidden ×3 for them. It now reaches peers only, and
    // jurors are not the PM's peers. Toggle state does not move it either way.
    expect((await panelOf(PM, "p1_three")).map((j) => j.score)).toEqual([6.15, 7.35, 8.55]);
    await setPeerVisibility(true);
    expect((await panelOf(PM, "p1_three")).map((j) => j.score)).toEqual([6.15, 7.35, 8.55]);
  });

  it("the superuser and the admin see every juror's number at the shipped settings", async () => {
    for (const who of [SUPER, ADMIN]) {
      expect((await panelOf(who, "p1_three")).map((j) => j.score)).toEqual([6.15, 7.35, 8.55]);
    }
  });

  it("agrees with GET /:id/report for every viewer and both toggle states", async () => {
    for (const toggle of [false, true]) {
      await setPeerVisibility(toggle);
      for (const who of [SUPER, ADMIN, PM, PA]) {
        const cookie = await login(who);
        const deck = (await listing(cookie)).find((d) => d.id === "p1_three")!;
        const report = (await (await get("/api/decks/p1_three/report", cookie)).json()) as {
          columns: { id: string; total?: number }[];
        };
        // Compared as sets: the report orders its columns by rank, then name.
        const byId = (a: [string, number | undefined], b: [string, number | undefined]) => a[0].localeCompare(b[0]);
        const panelIds = new Set(deck.jurors!.map((j) => j.id));
        const reportScored = report.columns
          .filter((c) => panelIds.has(c.id))
          .map((c): [string, number | undefined] => [c.id, c.total])
          .sort(byId);
        const panelScored = deck.jurors!
          .filter((j) => "score" in j)
          .map((j): [string, number | undefined] => [j.id, j.score])
          .sort(byId);
        expect(panelScored, `${who}, peer toggle ${toggle ? "on" : "off"}`).toEqual(reportScored);
      }
    }
  });

  it("an assignee who resolves to another customer's user is unnamed and unscored, even for the superuser", async () => {
    const panel = await panelOf(SUPER, "p1_drift");
    expect(panel).toEqual([{ id: "p1_other", name: "Evaluator", submitted: true, scoreWithheld: true }]);
    expect(JSON.stringify(panel)).not.toContain("Other Customer Person");
    expect(JSON.stringify(panel)).not.toContain("9.95");
  });
});

// ── The hierarchy itself (23-Oct) ────────────────────────────────────────────

describe("senior sees junior, junior never sees senior", () => {
  // The product owner, reviewing P1: "anyone senior should be able to see the
  // junior persons scoring but the junior cant see the seniors score". Ranks are
  // `EVALUATION_RANK`: associate 1 · jury 2 · PM 3 · admin / superuser 99.

  async function reportOf(email: string, deckId = "p1_avg") {
    const r = (await (await get(`/api/decks/${deckId}/report`, await login(email))).json()) as {
      deck: Deck;
      columns: { role?: string }[];
      hiddenEvaluators: number;
    };
    return { roles: r.columns.map((c) => c.role ?? "ai"), hidden: r.hiddenEvaluators, deck: r.deck };
  }

  async function listed(email: string, deckId = "p1_avg"): Promise<Deck> {
    const deck = (await listing(await login(email))).find((d) => d.id === deckId);
    expect(deck, `${deckId} is listed for ${email}`).toBeDefined();
    return deck!;
  }

  it("on the report, each role reads its own column and the ones ranked below it — at the shipped settings", async () => {
    expect(await reportOf(PA).then((r) => [r.roles, r.hidden])).toEqual([["ai", "program_associate"], 3]);
    expect(await reportOf(JURY).then((r) => [r.roles, r.hidden])).toEqual([["ai", "program_associate", "jury"], 2]);
    expect(await reportOf(PM).then((r) => [r.roles, r.hidden])).toEqual([
      ["ai", "program_associate", "jury", "program_manager"],
      1,
    ]);
    for (const top of [SUPER, ADMIN]) expect((await reportOf(top)).hidden).toBe(0);
  });

  it("peers are still the toggle's: a juror reads no fellow juror until both the toggle and the diagonal say so", async () => {
    // THREE's panel is three jurors. Off as shipped: own column only.
    const off = await reportOf(JURY, "p1_three");
    expect([off.roles, off.hidden]).toEqual([["ai", "jury"], 2]);
    // On, the diagonal still ships off ("jury members cannot see each other").
    await setPeerVisibility(true);
    expect((await reportOf(JURY, "p1_three")).hidden).toBe(2);
    await env.DB.prepare(
      "INSERT INTO score_visibility (tenant_id, edition, viewer_role, target_role, visible, updated_at) " +
        "VALUES ('t_default', 'incubator', 'jury', 'jury', 1, '2026-10-23T00:00:00Z')",
    ).run();
    const on = await reportOf(JURY, "p1_three");
    expect([on.roles, on.hidden]).toEqual([["ai", "jury", "jury", "jury"], 0]);
  });

  it("the listing's averages are taken over exactly the evaluations each viewer may see", async () => {
    // Superuser and admin see all four: the same SQL AVG as ever, (5+7+9+6)/4.
    expect((await listed(SUPER)).juryScore).toBe(6.75);
    expect((await listed(ADMIN)).juryScore).toBe(6.75);
    // The PM: associate, jury and their own — not the admin's 6, ranked above.
    expect((await listed(PM)).juryScore).toBe(7);
    // The juror: the associate's and their own — not the PM's 9 or the admin's 6.
    expect((await listed(JURY)).juryScore).toBe(6);
    // The associate: their own, and nothing else.
    expect((await listed(PA)).juryScore).toBe(5);
  });

  it("…and the blended average follows, while the shortlist hint stays the whole panel's", async () => {
    const top = await listed(SUPER);
    const w = (top.aiWeightPct ?? 50) / 100;
    const blend = (human: number) => Math.round((top.aiScore! * w + human * (1 - w)) * 100) / 100;
    expect(top.decisionScore).toBe(blend(6.75));
    expect((await listed(PA)).decisionScore).toBe(blend(5));
    expect((await listed(PM)).decisionScore).toBe(blend(7));
    // `shortlistBlocked` must agree with `checkShortlistFloor`, which judges every
    // evaluation; a hint judged on part of the panel is the W7-A defect. The
    // fixture straddles the shipped 7.0 floor on purpose, so this bites: the whole
    // panel blends to 6.85 (blocked) while the PM's own view blends to 7.00.
    expect(top.shortlistBlocked).toBe(true);
    expect((await listed(PM)).decisionScore).toBe(7);
    for (const who of [ADMIN, PM, JURY, PA]) {
      expect((await listed(who)).shortlistBlocked, who).toBe(top.shortlistBlocked);
    }
  });

  it("a viewer who may see none of them gets no jury number, and the AI score alone as the average", async () => {
    // THREE carries only jurors' evaluations; the associate has none of their own.
    const deck = await listed(PA, "p1_three");
    expect("juryScore" in deck).toBe(false);
    expect(deck.decisionScore).toBe(deck.aiScore);
    for (const n of Object.values(SCORES)) expect(JSON.stringify(deck)).not.toContain(String(n));
  });

  it("the by-id reads carry the same averages: GET /:id and the report's own deck row", async () => {
    const pa = await login(PA);
    const detail = (await (await get("/api/decks/p1_avg", pa)).json()) as { deck: Deck };
    expect(detail.deck.juryScore).toBe(5);
    expect((await reportOf(PA)).deck.juryScore).toBe(5);
    expect((await reportOf(PM)).deck.juryScore).toBe(7);
    expect((await reportOf(SUPER)).deck.juryScore).toBe(6.75);
  });
});

// ── Who receives a panel at all ──────────────────────────────────────────────

describe("who receives `jurors`", () => {
  it("not the jury — their screen draws no panel, and co-jurors' names stay off their wire", async () => {
    const decks = await listing(await login(JURY));
    expect(decks.some((d) => d.id === "p1_three")).toBe(true);
    expect(decks.every((d) => !("jurors" in d))).toBe(true);
    expect(JSON.stringify(decks)).not.toContain("Meera Iyer");
  });

  it("not founders (F0464)", async () => {
    const decks = await listing(await login(FOUNDER));
    expect(decks.length).toBeGreaterThan(0);
    expect(decks.every((d) => !("jurors" in d))).toBe(true);
  });

  it("not the VC edition — its payload is unchanged", async () => {
    const decks = await listing(await login(VC_SUPER));
    expect(decks.length).toBeGreaterThan(0);
    expect(decks.every((d) => !("jurors" in d))).toBe(true);
  });
});

// ── A delegate is authorised, not on the panel ───────────────────────────────

describe("out-of-office cover", () => {
  it("a delegate is not on the panel, though the authorisation union counts them", async () => {
    await env.DB.prepare(
      "UPDATE users SET out_of_office_from = ?, out_of_office_to = ?, out_of_office_delegate = 'inc_pm' WHERE id = 'p1_jury_c'",
    )
      .bind(day(-1), day(3))
      .run();
    // The precondition, so the assertion below is not vacuous: while Arjun is
    // away the PM may score THREE (`ASSIGNEE_PAIRS_SQL`'s delegation arm).
    expect(await isAssignedEvaluator(env.DB, "p1_three", "inc_pm")).toBe(true);

    const panel = await panelOf(SUPER, "p1_three");
    expect(panel.map((j) => j.id)).toEqual(["inc_jury", "p1_jury_b", "p1_jury_c"]);
  });
});

// ── The listing's shape is untouched ─────────────────────────────────────────

describe("one row per deck", () => {
  it("the listing is exactly the workspace's decks, each once, and the stage tallies match the table", async () => {
    const decks = await listing(await login(SUPER));
    const ids = decks.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "p1_three")).toHaveLength(1);

    const inDb = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM decks WHERE tenant_id = 't_default' AND edition = 'incubator'",
    ).first<{ n: number }>();
    expect(decks.length).toBe(inDb?.n);

    // The Jury Pipeline footer's four counts are tallies of `statusId`; a
    // multiplied row would move them. Compare each against the table itself.
    const byStage = (
      await env.DB.prepare(
        "SELECT status, COUNT(*) AS n FROM decks WHERE tenant_id = 't_default' AND edition = 'incubator' " +
          "AND status IN ('assigned', 'jury_evaluation', 'shortlisted', 'rejected') GROUP BY status",
      ).all<{ status: string; n: number }>()
    ).results;
    for (const { status, n } of byStage) {
      expect(decks.filter((d) => d.statusId === status), status).toHaveLength(n);
    }
  });
});
