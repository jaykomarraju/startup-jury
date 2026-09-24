import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

/**
 * R6-SCOPE · P0-1 — `GET /api/decks` scopes a jury member server-side.
 *
 * Before this, the only row filter on the listing was `role === "founder"`, so a
 * juror's response carried EVERY deck in the edition with founder name, email
 * and phone, and "My Pipeline", "Evaluated" and "My Archive" were client-side
 * filters over it (`DashboardPage.tsx:899`, in its own words: "F0193 asks the
 * API to scope this; until it does, the screen does"). Measured against the
 * running dev server on 2026-09-23 and recorded in `docs/plan_roles_incubator.md`
 * §7: 15 decks returned to `inc_jury`, 7 actually theirs, 8 of the rest carrying
 * full founder contact — FinStack, GreenGrid Energy, SolarCircuit and PayRoute
 * among them. Those four are asserted by name below, because a test that only
 * counts rows would go vacuous the moment the seed changes shape.
 *
 * **The negative control runs both ways**, which is the whole point of the file:
 *   • the juror must LOSE what was never theirs — including by id, on all four
 *     by-id reads, not just out of the index; and
 *   • the juror must KEEP every deck their screens actually draw (assigned by
 *     column, assigned through `deck_assignments`, on a call, delegated to
 *     schedule), and every other role must lose nothing at all.
 * Delete `OWN_DECKS_SQL` from `routes/decks.ts` and the first half fails; delete
 * a branch of its union and the second half fails.
 *
 * Fixtures are prefixed `sc_` and every set assertion is taken over that prefix,
 * so the file does not depend on what else is in the database (worker D1 state
 * persists across tests — see `test/worker/aiPrompts.test.ts`).
 */

const BASE = "https://example.com";
const JURY = "rajesh.kumar@demo.startupjury.ai"; // incubator jury — the scoped role
const PA = "sunita.rao@demo.startupjury.ai"; // staff control: unscoped
const PM = "raj.kumar@demo.startupjury.ai";
const ADMIN = "nisha.kapoor@demo.startupjury.ai";
const FOUNDER = "meera.sharma@demo.startupjury.ai";

/** The decks this file seeds, and whether `inc_jury` may see each one. */
const MINE = [
  "sc_col", // assigned via `decks.assigned_to`
  "sc_join", // assigned via `deck_assignments` only — no column
  "sc_call_user", // a call participant, by user id
  "sc_call_email", // a call participant, by email only (no login row on the invite)
  "sc_delegate", // delegated to schedule this deck's call (W9-E)
] as const;
const NOT_MINE = [
  "sc_open", // nobody's: the leak row, with founder contact
  "sc_other", // assigned to someone else
  "sc_archived", // archived and not theirs — the "My Archive" case in §5
] as const;
const ALL = [...MINE, ...NOT_MINE];

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function get(path: string, cookie: string) {
  return SELF.fetch(`${BASE}${path}`, { headers: { cookie } });
}

interface Row {
  id: string;
  name: string;
  founder?: string;
  founderEmail?: string;
  founderPhone?: string;
}

async function listDecks(cookie: string, query = ""): Promise<Row[]> {
  const res = await get(`/api/decks${query}`, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { decks: Row[] }).decks;
}

/** The fixture ids in a response, sorted — every set assertion goes through this. */
async function seenFixtures(cookie: string, query = ""): Promise<string[]> {
  return (await listDecks(cookie, query))
    .map((d) => d.id)
    .filter((id) => id.startsWith("sc_"))
    .sort();
}

async function seedDeck(id: string, opts: { status?: string; assignedTo?: string | null } = {}) {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, sector, city, status, ai_score, founder, founder_email, founder_phone, " +
      "r2_key, uploaded_by, assigned_to, complete) " +
      "VALUES (?, 'incubator', ?, 'Fintech', 'Pune', ?, 7.4, ?, ?, ?, ?, 'inc_pa', ?, 1)",
  )
    .bind(
      id,
      `Scope ${id}`,
      opts.status ?? "jury_evaluation",
      `Founder ${id}`,
      `${id}@scope.example`,
      "+91 90000 00000",
      `decks/${id}.pdf`,
      opts.assignedTo ?? null,
    )
    .run();
}

async function seedCall(callId: string, deckId: string) {
  await env.DB.prepare(
    "INSERT INTO calls (id, deck_id, kind, scheduled_at, status, organizer_id, ics_uid) " +
      "VALUES (?, ?, 'intro', '2026-09-30T09:00:00.000Z', 'scheduled', 'inc_pm', ?)",
  )
    .bind(callId, deckId, `${callId}@startup-jury`)
    .run();
}

describe("GET /api/decks — a jury member's rows are scoped by the SERVER (P0-1)", () => {
  let jury = "";
  let pa = "";

  beforeAll(async () => {
    jury = await login(JURY);
    pa = await login(PA);

    for (const id of ALL) {
      await seedDeck(id, {
        // `ai_evaluated` + complete, so every fixture routes to `assign` and the
        // `?list=` case below is not vacuous (`ASSIGNABLE_STAGES.incubator`).
        status: id === "sc_archived" ? "archived" : "ai_evaluated",
        assignedTo: id === "sc_col" ? "inc_jury" : id === "sc_other" ? "inc_pm" : null,
      });
    }

    // W7-E — a deck can carry several evaluators, and the join table is the only
    // record of the ones after the first. `assigned_to` stays NULL here on
    // purpose: reading `deck_assignments` alone, or the column alone, each miss
    // half the allocation.
    await env.DB.prepare(
      "INSERT INTO deck_assignments (deck_id, evaluator_id, assigned_by, assigned_at) VALUES ('sc_join', 'inc_jury', 'inc_pa', ?)",
    )
      .bind(new Date().toISOString())
      .run();

    // §8 — "jury/IC members involved in a call can view their calls". Both halves
    // of `ON_CALL_SQL`: the user id, and the invite typed as an email.
    await seedCall("sc_call_1", "sc_call_user");
    await seedCall("sc_call_2", "sc_call_email");
    await env.DB.prepare(
      "INSERT INTO call_participants (id, call_id, user_id, email, name, kind) VALUES " +
        "('sc_cp_1', 'sc_call_1', 'inc_jury', 'rajesh.kumar@demo.startupjury.ai', 'Rajesh Kumar', 'team'), " +
        // No user_id, and the case deliberately does not match the account's.
        "('sc_cp_2', 'sc_call_2', NULL, 'RAJESH.KUMAR@DEMO.STARTUPJURY.AI', 'Rajesh Kumar', 'team')",
    ).run();

    // W9-E — delegated to schedule THIS deck's intro call, whatever their role.
    await env.DB.prepare(
      "INSERT INTO call_schedulers (deck_id, kind, user_id, assigned_by, assigned_at) VALUES ('sc_delegate', 'intro', 'inc_jury', 'inc_pm', ?)",
    )
      .bind(new Date().toISOString())
      .run();
  });

  // ── The leak, closed ───────────────────────────────────────────────────────

  it("returns the juror their own decks and nothing else", async () => {
    expect(await seenFixtures(jury)).toEqual([...MINE].sort());
  });

  it("serves no founder name, email or phone for a deck that is not theirs", async () => {
    const rows = await listDecks(jury);
    // The assertion is on the PAYLOAD, not on a row count: those three fields are
    // what §7 measured and the whole reason this is a P0.
    for (const id of NOT_MINE) {
      expect(rows.find((d) => d.id === id), `${id} must not reach a juror`).toBeUndefined();
    }
    // Restated against the database rather than against the route, so the check
    // is of the POLICY and not of the query that implements it: every row the
    // juror was handed has to be one this independent reading also allows.
    const allowed = new Set(
      (
        await env.DB.prepare(
          "SELECT DISTINCT d.id FROM decks d WHERE d.edition = 'incubator' AND (" +
            "d.assigned_to = 'inc_jury' " +
            "OR d.id IN (SELECT deck_id FROM deck_assignments WHERE evaluator_id = 'inc_jury') " +
            "OR d.id IN (SELECT ca.deck_id FROM calls ca JOIN call_participants cp ON cp.call_id = ca.id " +
            "            WHERE cp.user_id = 'inc_jury' OR lower(cp.email) = 'rajesh.kumar@demo.startupjury.ai') " +
            "OR d.id IN (SELECT deck_id FROM call_schedulers WHERE user_id = 'inc_jury'))",
        ).all<{ id: string }>()
      ).results.map((r) => r.id),
    );
    const leaked = rows.filter((d) => !allowed.has(d.id));
    expect(leaked.map((d) => `${d.id} (${d.founder ?? "?"} · ${d.founderEmail ?? "?"})`)).toEqual([]);
  });

  it("drops the four seeded decks §7 named by name — including the archived one", async () => {
    // FinStack, GreenGrid Energy, SolarCircuit and PayRoute, verbatim from the
    // measured response. None is assigned to `inc_jury`; SolarCircuit is
    // `archived`, which is the screen the plan calls out — a juror opening
    // "My Archive" saw every archived deck in the workspace.
    const leaked = ["inc_deck_finstack", "inc_deck_greengrid", "inc_deck_solarc", "inc_deck_payroute"];
    const juryIds = new Set((await listDecks(jury)).map((d) => d.id));
    for (const id of leaked) expect(juryIds.has(id), `${id} must not reach a juror`).toBe(false);

    // ...and the control: they are all still there, with their founder contact,
    // for the staff role that is supposed to have them. A scope that also
    // narrowed staff would pass the assertion above for the wrong reason.
    const staff = await listDecks(pa);
    for (const id of leaked) {
      const row = staff.find((d) => d.id === id);
      expect(row, `${id} is still served to the programme associate`).toBeDefined();
      expect(row!.founderEmail, `${id} founder email`).toBeTruthy();
    }
  });

  it("keeps the juror's own seeded decks — the allocation is not emptied", async () => {
    const ids = new Set((await listDecks(jury)).map((d) => d.id));
    // InsureFlow and GreenRoute carry `assigned_to = 'inc_jury'` in the seed.
    expect(ids.has("inc_deck_insureflow")).toBe(true);
    expect(ids.has("inc_deck_greenroute")).toBe(true);
  });

  // ── Negative control, the other way ────────────────────────────────────────

  it("leaves every unscoped role's listing exactly as it was", async () => {
    for (const email of [PA, PM, ADMIN]) {
      expect(await seenFixtures(await login(email)), `${email} sees every fixture`).toEqual([...ALL].sort());
    }
  });

  it("still isolates a founder to their own submissions", async () => {
    const founder = await login(FOUNDER);
    // The fixtures are uploaded by `inc_pa`, so none of them is this founder's.
    expect(await seenFixtures(founder)).toEqual([]);
    const rows = await listDecks(founder);
    expect(rows.length).toBeGreaterThan(0); // they do have decks of their own
  });

  // ── Each branch of the union earns its place ───────────────────────────────

  it("counts an assignment held only in `deck_assignments`, not just the column", async () => {
    expect(await seenFixtures(jury)).toContain("sc_join");
    // Guard the fixture itself: if the column were set, this case would be
    // proving the wrong branch.
    const row = await env.DB.prepare("SELECT assigned_to FROM decks WHERE id = 'sc_join'").first<{
      assigned_to: string | null;
    }>();
    expect(row?.assigned_to).toBeNull();
  });

  it("counts a deck the juror is on a call for, by user id and by email", async () => {
    const seen = await seenFixtures(jury);
    expect(seen).toContain("sc_call_user");
    // The invite was typed in a different case and carries no user id — the same
    // two halves `routes/calls.ts` already matches on. Without this branch the
    // jury's thirteen-column "My Intro calls" screen loses its rows, because it
    // joins the calls listing to THIS response.
    expect(seen).toContain("sc_call_email");
  });

  it("counts a deck the juror was delegated to schedule", async () => {
    expect(await seenFixtures(jury)).toContain("sc_delegate");
  });

  // ── The scope cannot be widened back open ──────────────────────────────────

  it("narrows within the scope when a filter is applied, never outside it", async () => {
    // `?q=` matches the fixture founder names, so an unscoped server would hand
    // back all eight. The search runs INSIDE the scope.
    expect(await seenFixtures(jury, "?q=Founder%20sc_")).toEqual([...MINE].sort());
    expect(await seenFixtures(pa, "?q=Founder%20sc_")).toEqual([...ALL].sort());
  });

  it("applies to `?list=` too", async () => {
    // Jury has no Assign or Query screen, but the parameter is on the same route
    // and must not be a way around the clause. Every live fixture routes to
    // `assign`, so the staff control below is the proof this case has teeth.
    expect(await seenFixtures(pa, "?list=assign")).toEqual(
      [...ALL].filter((id) => id !== "sc_archived").sort(),
    );
    expect(await seenFixtures(jury, "?list=assign")).toEqual([...MINE].sort());
  });

  // ── By id: hiding the index is not a scope ─────────────────────────────────

  it("404s the four by-id reads for a deck outside the juror's scope", async () => {
    for (const path of ["", "/report", "/versions", "/file"]) {
      expect((await get(`/api/decks/sc_open${path}`, jury)).status, `GET /api/decks/sc_open${path}`).toBe(404);
    }
  });

  it("serves all four by-id reads for a deck inside it", async () => {
    // `sc_join` is the harder case: the allocation lives only in the join table.
    expect((await get("/api/decks/sc_join", jury)).status).toBe(200);
    expect((await get("/api/decks/sc_join/report", jury)).status).toBe(200);
    expect((await get("/api/decks/sc_join/versions", jury)).status).toBe(200);
    // No object in R2 for a seeded row, so the viewer's own "not stored" 404 —
    // what matters is that it is `no_pdf` and not the scope refusing it.
    const file = await get("/api/decks/sc_join/file", jury);
    expect(file.status).toBe(404);
    expect((await file.json()) as { error: string }).toEqual({ error: "no_pdf" });
  });

  it("leaves the by-id reads open to staff for the very same deck", async () => {
    for (const path of ["", "/report", "/versions"]) {
      expect((await get(`/api/decks/sc_open${path}`, pa)).status, `staff GET /api/decks/sc_open${path}`).toBe(200);
    }
  });
});
