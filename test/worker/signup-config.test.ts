import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type {
  FundRowView,
  RequiredDocumentView,
  SeatRowView,
  SignupDocumentSetView,
} from "../../src/shared/signupConfig";

/**
 * W5-A — Admin console → Sign-up: Required documents, Seat capacity and Fund
 * Deployment (`/api/signup-config`).
 *
 * Five things this suite exists to hold:
 *
 *  1. **The document lifecycle is a state machine at the route, not only in the
 *     helper.** Every legal transition is walked end to end; every illegal one
 *     is a 400 that writes NOTHING — asserted by reading the row back after the
 *     refusal, because a 400 with a silent write is the failure mode the plan
 *     names.
 *  2. **The bulk verify advances only what can advance.** "Verify all" on a set
 *     with one submitted item and two awaiting ones moves one and reports two
 *     blocked — it does not apply the skip wholesale.
 *  3. **`seatless` fires on completion with no seat, and completion is never
 *     refused for want of one.** Both halves matter: `s-suseat.html` and
 *     `0036`'s header say sign-up is never blocked by seats.
 *  4. **The roll-up follows the items.** `deck_onboarding.documents_status`
 *     stops being hand-set and is re-derived on every change (F0050), so the
 *     Sign up Pipeline column keeps agreeing with the truth.
 *  5. **AuthZ on every verb.** A non-admin gets 403 from all nine, and each
 *     edition-specific section refuses the other edition.
 */

const BASE = "https://example.com";

// Seed logins (migrations/0002_seed.sql, 0015_roles_users.sql).
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai"; // vc admin
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate — non-admin
const PM = "raj.kumar@demo.startupjury.ai"; // program_manager — non-admin

// Seeded sign-ups (0034's back-fill over 0020's decks).
const MEDIXIR = "su_inc_deck_medixir"; // status 'progress', cohort has 2 free seats
const LEDGERLITE = "su_inc_deck_meera_signup"; // status 'initiated', cohort AT capacity
const CLIMATE_COHORT = "coh_0001"; // Climate Cohort · Cohort 6 — 20 / 18
const SAAS_COHORT = "coh_0003"; // SaaS Accelerator · Cohort 6 — 12 / 12
const VC_SIGNUP = "su_vc_deck_quantiq";

// ── Per-test reset ───────────────────────────────────────────────────────────
//
// This project's Worker pool does NOT roll storage back between tests: one
// test's write is the next test's starting state. Every suite here mutates, so
// the seeded state is snapshotted once and restored before each test — without
// it the suite passes or fails on its own declaration order, which is the least
// useful property a test file can have.
//
// Only the tables this router writes are restored, and `decks` / `cohorts` /
// `programs` are UPDATEd rather than deleted: they are parents of half the
// schema, and a cascade would take the whole seed with it.

/** Tables restored wholesale, children first so the deletes are FK-safe. */
const RESTORED = ["signup_documents", "required_documents", "deck_onboarding"] as const;
type Row = Record<string, string | number | null>;

const wholesale = new Map<string, Row[]>();
let consoleCells: Row[] = [];
let signupState: Row[] = [];
let cohortSeats: Row[] = [];
let programFunds: Row[] = [];
let deckScopes: Row[] = [];

const rowsOf = async (sql: string): Promise<Row[]> =>
  (await env.DB.prepare(sql).all<Row>()).results;

/** `INSERT INTO t (cols…) VALUES (?…)` for one snapshotted row. */
function insertOf(table: string, row: Row) {
  const cols = Object.keys(row);
  return env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
  ).bind(...cols.map((c) => row[c]));
}

beforeAll(async () => {
  for (const t of RESTORED) wholesale.set(t, await rowsOf(`SELECT * FROM ${t}`));
  consoleCells = await rowsOf("SELECT * FROM role_permissions WHERE task_id = 'adminconsole'");
  signupState = await rowsOf(
    "SELECT id, status, seatless, seat_allocated_at, completed_at FROM signups",
  );
  cohortSeats = await rowsOf("SELECT id, seat_capacity, seats_filled FROM cohorts");
  programFunds = await rowsOf(
    "SELECT id, fund_size, fund_allocated, capital_deployed, fund_unutilised FROM programs",
  );
  deckScopes = await rowsOf("SELECT id, program_id, cohort_id FROM decks");
});

beforeEach(async () => {
  const stmts = [
    ...RESTORED.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    env.DB.prepare("DELETE FROM role_permissions WHERE task_id = 'adminconsole'"),
  ];
  // Re-inserted parents-first — the reverse of the delete order, or
  // `signup_documents` would arrive before the checklist rows it points at.
  for (const t of [...RESTORED].reverse()) {
    for (const row of wholesale.get(t)!) stmts.push(insertOf(t, row));
  }
  for (const row of consoleCells) stmts.push(insertOf("role_permissions", row));
  for (const r of signupState) {
    stmts.push(
      env.DB.prepare(
        "UPDATE signups SET status = ?, seatless = ?, seat_allocated_at = ?, completed_at = ? WHERE id = ?",
      ).bind(r.status, r.seatless, r.seat_allocated_at, r.completed_at, r.id),
    );
  }
  for (const r of cohortSeats) {
    stmts.push(
      env.DB.prepare("UPDATE cohorts SET seat_capacity = ?, seats_filled = ? WHERE id = ?").bind(
        r.seat_capacity,
        r.seats_filled,
        r.id,
      ),
    );
  }
  for (const r of programFunds) {
    stmts.push(
      env.DB.prepare(
        "UPDATE programs SET fund_size = ?, fund_allocated = ?, capital_deployed = ?, fund_unutilised = ? WHERE id = ?",
      ).bind(r.fund_size, r.fund_allocated, r.capital_deployed, r.fund_unutilised, r.id),
    );
  }
  for (const r of deckScopes) {
    stmts.push(
      env.DB.prepare("UPDATE decks SET program_id = ?, cohort_id = ? WHERE id = ?").bind(
        r.program_id,
        r.cohort_id,
        r.id,
      ),
    );
  }
  await env.DB.batch(stmts);
});

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

function send(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}
const put = (p: string, c: string, b?: unknown) => send("PUT", p, c, b);
const post = (p: string, c: string, b?: unknown) => send("POST", p, c, b);
const patch = (p: string, c: string, b?: unknown) => send("PATCH", p, c, b);

interface DocsPayload {
  edition: string;
  scope: { programId: string | null; cohortId: string | null };
  inherited: boolean;
  items: RequiredDocumentView[];
  retired: RequiredDocumentView[];
  signups: SignupDocumentSetView[];
}

async function documents(cookie: string, query = ""): Promise<DocsPayload> {
  const res = await get(`/api/signup-config/documents${query}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as DocsPayload;
}

async function setOf(cookie: string, signupId: string): Promise<SignupDocumentSetView> {
  const payload = await documents(cookie);
  const set = payload.signups.find((s) => s.signupId === signupId);
  expect(set, `no document set for ${signupId}`).toBeTruthy();
  return set!;
}

const itemNamed = (set: SignupDocumentSetView, name: string) => {
  const item = set.items.find((i) => i.name === name);
  expect(item, `no item "${name}"`).toBeTruthy();
  return item!;
};

/** Read a document's stored status straight from D1, past the API. */
async function storedStatus(docId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT status FROM signup_documents WHERE id = ?")
    .bind(docId)
    .first<{ status: string }>();
  return row!.status;
}

const rollUp = async (deckId: string) =>
  (
    await env.DB.prepare("SELECT documents_status FROM deck_onboarding WHERE deck_id = ?")
      .bind(deckId)
      .first<{ documents_status: string }>()
  )?.documents_status;

const seatsOf = async (cohortId: string) =>
  (await env.DB.prepare("SELECT seat_capacity, seats_filled FROM cohorts WHERE id = ?")
    .bind(cohortId)
    .first<{ seat_capacity: number; seats_filled: number }>())!;

const signupRow = async (id: string) =>
  (await env.DB.prepare(
    "SELECT status, seatless, seat_allocated_at FROM signups WHERE id = ?",
  )
    .bind(id)
    .first<{ status: string; seatless: number; seat_allocated_at: string | null }>())!;

/** Walk one item to `status`, one legal step at a time. */
async function driveTo(
  cookie: string,
  signupId: string,
  docId: string,
  target: "awaiting" | "submitted" | "verified",
) {
  const order = ["awaiting", "submitted", "verified"] as const;
  for (const step of order) {
    const res = await patch(
      `/api/signup-config/signups/${signupId}/documents/${docId}`,
      cookie,
      { status: step },
    );
    // Already there — the no-op is refused by design; keep walking.
    if (res.status === 400) expect(((await res.json()) as { error: string }).error).toBe(
      "illegal_transition",
    );
    if (step === target) return;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The configured checklist
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/signup-config/documents", () => {
  it("serves the incubator default checklist from s-sudocs, in order", async () => {
    const payload = await documents(await login(ADMIN));
    expect(payload.edition).toBe("incubator");
    expect(payload.inherited).toBe(false);
    expect(payload.items.map((i) => [i.name, i.note, i.mandatory])).toEqual([
      ["Certificate of incorporation", "PDF · one file", true],
      ["Founder ID proof", "Per founder", true],
      ["Cap table", "Current shareholding", true],
      ["Bank account details", "Cancelled cheque", false],
      ["GST / tax registration", "If applicable", false],
    ]);
  });

  it("serves the VC checklist, which adds Audited financials · Last 2 years", async () => {
    const payload = await documents(await login(VC_ADMIN));
    expect(payload.edition).toBe("vc");
    expect(payload.items.map((i) => i.name)).toEqual([
      "Certificate of incorporation",
      "Founder ID proof",
      "Cap table",
      "Audited financials",
      "Bank account details",
      "GST / tax registration",
    ]);
    expect(payload.items.find((i) => i.name === "Audited financials")?.note).toBe("Last 2 years");
  });

  it("carries each open sign-up's inherited set, its roll-up and what a bulk verify would move", async () => {
    const set = await setOf(await login(ADMIN), MEDIXIR);
    expect(set.startup).toBe("Medixir");
    expect(set.items).toHaveLength(5);
    // 0034's back-fill: mandatory items land at awaiting, optional at not_requested.
    expect(itemNamed(set, "Cap table").status).toBe("awaiting");
    expect(itemNamed(set, "Cap table").mandatory).toBe(true);
    expect(itemNamed(set, "GST / tax registration").status).toBe("not_requested");
    expect(itemNamed(set, "GST / tax registration").mandatory).toBe(false);
    expect(set.documentsStatus).toBe("pending");
    expect(set.verifiable).toBe(0); // nothing submitted yet
  });

  it("tells each item which moves it will accept, and never offers a skip", async () => {
    const set = await setOf(await login(ADMIN), MEDIXIR);
    expect(itemNamed(set, "Cap table").next).toEqual(["not_requested", "submitted"]);
    expect(itemNamed(set, "GST / tax registration").next).toEqual(["awaiting"]);
  });

  it("falls back to the default for a programme with no list of its own, and says so", async () => {
    const cookie = await login(ADMIN);
    const prog = (await env.DB.prepare(
      "SELECT id FROM programs WHERE edition = 'incubator' ORDER BY sort_order LIMIT 1",
    ).first<{ id: string }>())!;
    const payload = await documents(cookie, `?programId=${prog.id}`);
    expect(payload.inherited).toBe(true);
    expect(payload.items).toHaveLength(5);
    expect(payload.scope).toEqual({ programId: prog.id, cohortId: null });
  });

  it("refuses a scope that does not exist, or a cohort with no programme", async () => {
    const cookie = await login(ADMIN);
    for (const q of ["?programId=prog_ghost", `?cohortId=${SAAS_COHORT}`]) {
      const res = await get(`/api/signup-config/documents${q}`, cookie);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("unknown_scope");
    }
  });

  it("refuses a programme from the other edition", async () => {
    const vcProg = (await env.DB.prepare(
      "SELECT id FROM programs WHERE edition = 'vc' LIMIT 1",
    ).first<{ id: string }>())!;
    const res = await get(`/api/signup-config/documents?programId=${vcProg.id}`, await login(ADMIN));
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/signup-config/documents", () => {
  it("saves the toggles, renames, and retires a removed item rather than deleting it", async () => {
    const cookie = await login(ADMIN);
    const before = await documents(cookie);
    const gst = before.items.find((i) => i.name === "GST / tax registration")!;

    const res = await put("/api/signup-config/documents", cookie, {
      applyTo: "new",
      items: before.items
        .filter((i) => i.id !== gst.id)
        .map((i) =>
          i.name === "Bank account details"
            ? { id: i.id, name: "Bank account details", note: "Cancelled cheque", mandatory: true }
            : { id: i.id, name: i.name, note: i.note, mandatory: i.mandatory },
        ),
    });
    expect(res.status).toBe(200);

    const after = await documents(cookie);
    expect(after.items.map((i) => i.name)).not.toContain("GST / tax registration");
    expect(after.items.find((i) => i.name === "Bank account details")?.mandatory).toBe(true);
    expect(after.retired.map((i) => i.name)).toContain("GST / tax registration");
    // Retired, not deleted: the row survives for the sign-ups that inherited it.
    expect(
      await env.DB.prepare("SELECT active FROM required_documents WHERE id = ?")
        .bind(gst.id)
        .first<{ active: number }>(),
    ).toEqual({ active: 0 });
  });

  it("adds a new item and gives it a dense sort order", async () => {
    const cookie = await login(ADMIN);
    const before = await documents(cookie);
    const res = await put("/api/signup-config/documents", cookie, {
      applyTo: "new",
      items: [
        ...before.items.map((i) => ({ id: i.id, name: i.name, note: i.note, mandatory: i.mandatory })),
        { name: "Board resolution", note: "Signed copy", mandatory: true },
      ],
    });
    expect(res.status).toBe(200);
    const after = await documents(cookie);
    expect(after.items.map((i) => i.name)).toContain("Board resolution");
    expect(after.items.map((i) => i.sortOrder)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("creates a programme's own list, which then replaces the default for it", async () => {
    const cookie = await login(ADMIN);
    const prog = (await env.DB.prepare(
      "SELECT id FROM programs WHERE edition = 'incubator' ORDER BY sort_order LIMIT 1",
    ).first<{ id: string }>())!;
    const res = await put("/api/signup-config/documents", cookie, {
      programId: prog.id,
      applyTo: "new",
      items: [{ name: "Certificate of incorporation", note: "PDF · one file", mandatory: true }],
    });
    expect(res.status).toBe(200);

    const scoped = await documents(cookie, `?programId=${prog.id}`);
    expect(scoped.inherited).toBe(false);
    expect(scoped.items.map((i) => i.name)).toEqual(["Certificate of incorporation"]);
    // The edition default is untouched.
    expect((await documents(cookie)).items).toHaveLength(5);
  });

  it("refuses an empty checklist, a duplicate name, and an id from another scope", async () => {
    const cookie = await login(ADMIN);
    const before = await documents(cookie);
    const cases: [unknown, string][] = [
      [{ applyTo: "new", items: [] }, "checklist_empty"],
      [
        {
          applyTo: "new",
          items: [
            { name: "Cap table", mandatory: true },
            { name: "cap  table", mandatory: false },
          ],
        },
        "duplicate_document",
      ],
      [{ applyTo: "new", items: [{ name: "  ", mandatory: true }] }, "name_required"],
      [
        { applyTo: "new", items: [{ id: "rd_vc_financials", name: "Audited financials" }] },
        "unknown_document",
      ],
      [{ applyTo: "new" }, "items_required"],
    ];
    for (const [body, error] of cases) {
      const res = await put("/api/signup-config/documents", cookie, body);
      expect(res.status, error).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(error);
    }
    // Nothing was written by any of the refusals.
    expect((await documents(cookie)).items.map((i) => i.name)).toEqual(
      before.items.map((i) => i.name),
    );
  });

  it("leaves open sign-ups alone when Applies to is 'New sign-ups only'", async () => {
    const cookie = await login(ADMIN);
    const before = await documents(cookie);
    const res = await put("/api/signup-config/documents", cookie, {
      applyTo: "new",
      items: [
        ...before.items.map((i) => ({ id: i.id, name: i.name, note: i.note, mandatory: i.mandatory })),
        { name: "Board resolution", note: "Signed copy", mandatory: true },
      ],
    });
    expect(((await res.json()) as { resynced: number }).resynced).toBe(0);
    const set = await setOf(cookie, MEDIXIR);
    expect(set.items.map((i) => i.name)).not.toContain("Board resolution");
  });

  it("pushes a new item onto open sign-ups when Applies to is 'All startups'", async () => {
    const cookie = await login(ADMIN);
    const before = await documents(cookie);
    const res = await put("/api/signup-config/documents", cookie, {
      applyTo: "all",
      items: [
        ...before.items.map((i) => ({ id: i.id, name: i.name, note: i.note, mandatory: i.mandatory })),
        { name: "Board resolution", note: "Signed copy", mandatory: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { resynced: number }).resynced).toBeGreaterThan(0);

    const set = await setOf(cookie, MEDIXIR);
    const added = itemNamed(set, "Board resolution");
    // A mandatory item is being asked for now, so it lands at awaiting.
    expect(added.status).toBe("awaiting");
    expect(added.mandatory).toBe(true);
  });

  it("resyncs each sign-up against the checklist that governs IT, not the one just saved", async () => {
    const cookie = await login(ADMIN);
    // Medixir's programme authors its own, deliberately shorter, list.
    const deck = (await env.DB.prepare(
      "SELECT program_id FROM decks d JOIN signups s ON s.deck_id = d.id WHERE s.id = ?",
    )
      .bind(MEDIXIR)
      .first<{ program_id: string }>())!;
    await put("/api/signup-config/documents", cookie, {
      programId: deck.program_id,
      applyTo: "new",
      items: [{ name: "Certificate of incorporation", note: "PDF · one file", mandatory: true }],
    });

    // Now widen the EDITION DEFAULT and push it to every open sign-up.
    const defaults = await documents(cookie);
    const res = await put("/api/signup-config/documents", cookie, {
      applyTo: "all",
      items: [
        ...defaults.items.map((i) => ({ id: i.id, name: i.name, note: i.note, mandatory: i.mandatory })),
        { name: "Board resolution", note: "Signed copy", mandatory: true },
      ],
    });
    expect(res.status).toBe(200);

    // The overriding programme turned those items off on purpose — the default
    // save must not push them back on.
    const set = await setOf(cookie, MEDIXIR);
    expect(set.items.map((i) => i.name)).not.toContain("Board resolution");
    // …while a sign-up with no programme override does inherit the new item.
    const other = (await documents(cookie)).signups.find((s) => s.signupId === LEDGERLITE);
    expect(other?.items.map((i) => i.name)).toContain("Board resolution");
  });

  it("drops a retired item from a sign-up only while it was never requested", async () => {
    const cookie = await login(ADMIN);
    const before = await documents(cookie);
    const bank = before.items.find((i) => i.name === "Bank account details")!; // not_requested
    const cap = before.items.find((i) => i.name === "Cap table")!; // awaiting

    const res = await put("/api/signup-config/documents", cookie, {
      applyTo: "all",
      items: before.items
        .filter((i) => i.id !== bank.id && i.id !== cap.id)
        .map((i) => ({ id: i.id, name: i.name, note: i.note, mandatory: i.mandatory })),
    });
    expect(res.status).toBe(200);

    const set = await setOf(cookie, MEDIXIR);
    expect(set.items.map((i) => i.name)).not.toContain("Bank account details");
    // Already requested from the founder — a config edit must not withdraw it.
    expect(set.items.map((i) => i.name)).toContain("Cap table");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("the document state machine", () => {
  it("walks not_requested → awaiting → submitted → verified, one step at a time", async () => {
    const cookie = await login(ADMIN);
    const gst = itemNamed(await setOf(cookie, MEDIXIR), "GST / tax registration");
    expect(gst.status).toBe("not_requested");

    for (const step of ["awaiting", "submitted", "verified"] as const) {
      const res = await patch(
        `/api/signup-config/signups/${MEDIXIR}/documents/${gst.id}`,
        cookie,
        { status: step },
      );
      expect(res.status, `→ ${step}`).toBe(200);
      expect(await storedStatus(gst.id)).toBe(step);
    }

    // Verification is attributed and timed — `0034` insists on the timestamp.
    const row = await env.DB.prepare(
      "SELECT verified_by, verified_at FROM signup_documents WHERE id = ?",
    )
      .bind(gst.id)
      .first<{ verified_by: string | null; verified_at: string | null }>();
    expect(row!.verified_by).toBe("inc_admin");
    expect(row!.verified_at).not.toBeNull();
  });

  it("allows the two backward steps below verified", async () => {
    const cookie = await login(ADMIN);
    const cap = itemNamed(await setOf(cookie, MEDIXIR), "Cap table"); // awaiting

    // awaiting → not_requested (stand down), then back up.
    expect(
      (await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`, cookie, {
        status: "not_requested",
      })).status,
    ).toBe(200);
    await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`, cookie, {
      status: "awaiting",
    });
    // submitted → awaiting (send a wrong file back).
    await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`, cookie, {
      status: "submitted",
    });
    expect(
      (await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`, cookie, {
        status: "awaiting",
      })).status,
    ).toBe(200);
    expect(await storedStatus(cap.id)).toBe("awaiting");
  });

  it("refuses every skip with a 400 that names both ends, and writes nothing", async () => {
    const cookie = await login(ADMIN);
    const gst = itemNamed(await setOf(cookie, MEDIXIR), "GST / tax registration");
    for (const to of ["submitted", "verified"] as const) {
      const res = await patch(
        `/api/signup-config/signups/${MEDIXIR}/documents/${gst.id}`,
        cookie,
        { status: to },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "illegal_transition",
        from: "not_requested",
        to,
      });
      expect(await storedStatus(gst.id)).toBe("not_requested");
    }

    const cap = itemNamed(await setOf(cookie, MEDIXIR), "Cap table"); // awaiting
    const res = await patch(
      `/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`,
      cookie,
      { status: "verified" },
    );
    expect(res.status).toBe(400);
    expect(await storedStatus(cap.id)).toBe("awaiting");
  });

  it("treats verified as terminal — nothing leaves it, in either direction", async () => {
    const cookie = await login(ADMIN);
    const gst = itemNamed(await setOf(cookie, MEDIXIR), "GST / tax registration");
    await driveTo(cookie, MEDIXIR, gst.id, "verified");
    expect(await storedStatus(gst.id)).toBe("verified");

    for (const to of ["not_requested", "awaiting", "submitted", "verified"] as const) {
      const res = await patch(
        `/api/signup-config/signups/${MEDIXIR}/documents/${gst.id}`,
        cookie,
        { status: to },
      );
      expect(res.status, `verified → ${to}`).toBe(400);
      expect(await storedStatus(gst.id)).toBe("verified");
    }
  });

  it("refuses a no-op and an unknown status", async () => {
    const cookie = await login(ADMIN);
    const cap = itemNamed(await setOf(cookie, MEDIXIR), "Cap table");
    const noop = await patch(
      `/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`,
      cookie,
      { status: "awaiting" },
    );
    expect(noop.status).toBe(400);
    expect(((await noop.json()) as { error: string }).error).toBe("illegal_transition");

    const bogus = await patch(
      `/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`,
      cookie,
      { status: "approved" },
    );
    expect(bogus.status).toBe(400);
    expect(((await bogus.json()) as { error: string }).error).toBe("unknown_status");
  });

  it("404s a document that is not on the named sign-up, or is in another edition", async () => {
    const cookie = await login(ADMIN);
    const cap = itemNamed(await setOf(cookie, MEDIXIR), "Cap table");
    expect(
      (await patch(`/api/signup-config/signups/${LEDGERLITE}/documents/${cap.id}`, cookie, {
        status: "submitted",
      })).status,
    ).toBe(404);
    expect(
      (await patch(`/api/signup-config/signups/${VC_SIGNUP}/documents/sd_ghost`, cookie, {
        status: "submitted",
      })).status,
    ).toBe(404);
  });
});

describe("waive, with a reason", () => {
  it("requires the reason and records it", async () => {
    const cookie = await login(ADMIN);
    const cap = itemNamed(await setOf(cookie, MEDIXIR), "Cap table");
    const bare = await patch(
      `/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`,
      cookie,
      { waived: true },
    );
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { error: string }).error).toBe("reason_required");

    const ok = await patch(
      `/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`,
      cookie,
      { waived: true, waivedReason: "Pre-incorporation — no cap table exists yet" },
    );
    expect(ok.status).toBe(200);
    const item = itemNamed(await setOf(cookie, MEDIXIR), "Cap table");
    expect(item.waived).toBe(true);
    expect(item.waivedReason).toBe("Pre-incorporation — no cap table exists yet");
    // A waived item is out of the lifecycle entirely.
    expect(item.next).toEqual([]);
  });

  it("refuses to move a waived item until the waiver is lifted", async () => {
    const cookie = await login(ADMIN);
    const cap = itemNamed(await setOf(cookie, MEDIXIR), "Cap table");
    await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`, cookie, {
      waived: true,
      waivedReason: "Not applicable",
    });
    const res = await patch(
      `/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`,
      cookie,
      { status: "submitted" },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("document_waived");

    await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`, cookie, {
      waived: false,
    });
    expect(
      (await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cap.id}`, cookie, {
        status: "submitted",
      })).status,
    ).toBe(200);
  });
});

describe("POST …/documents/verify-all", () => {
  it("advances only the submitted items and reports what it left alone", async () => {
    const cookie = await login(ADMIN);
    const set = await setOf(cookie, MEDIXIR);
    const cert = itemNamed(set, "Certificate of incorporation"); // awaiting
    await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cert.id}`, cookie, {
      status: "submitted",
    });

    const res = await post(`/api/signup-config/signups/${MEDIXIR}/documents/verify-all`, cookie);
    expect(res.status).toBe(200);
    // One submitted item moved; the other two mandatory ones are still awaiting
    // the founder, and the two optional ones are not_requested.
    expect(await res.json()).toEqual({ ok: true, moved: 1, blocked: 4 });
    expect(await storedStatus(cert.id)).toBe("verified");
    expect(await storedStatus(itemNamed(set, "Founder ID proof").id)).toBe("awaiting");
  });

  it("moves nothing when nothing has been submitted", async () => {
    const cookie = await login(ADMIN);
    const res = await post(`/api/signup-config/signups/${MEDIXIR}/documents/verify-all`, cookie);
    expect(await res.json()).toEqual({ ok: true, moved: 0, blocked: 5 });
  });

  it("verifies a whole submitted set, and the roll-up follows", async () => {
    const cookie = await login(ADMIN);
    const set = await setOf(cookie, MEDIXIR);
    for (const item of set.items) {
      await driveTo(cookie, MEDIXIR, item.id, "submitted");
    }
    const res = await post(`/api/signup-config/signups/${MEDIXIR}/documents/verify-all`, cookie);
    expect(await res.json()).toEqual({ ok: true, moved: 5, blocked: 0 });

    const after = await setOf(cookie, MEDIXIR);
    expect(after.items.every((i) => i.status === "verified")).toBe(true);
    expect(after.documentsStatus).toBe("complete");
    expect(after.verifiable).toBe(0);
  });

  it("404s an unknown sign-up, and one from the other edition", async () => {
    const cookie = await login(ADMIN);
    expect(
      (await post("/api/signup-config/signups/su_ghost/documents/verify-all", cookie)).status,
    ).toBe(404);
    expect(
      (await post(`/api/signup-config/signups/${VC_SIGNUP}/documents/verify-all`, cookie)).status,
    ).toBe(404);
  });
});

describe("deck_onboarding.documents_status as a derived roll-up (F0050)", () => {
  it("is re-derived on every item change instead of being hand-set", async () => {
    const cookie = await login(ADMIN);
    const deck = (await env.DB.prepare("SELECT deck_id FROM signups WHERE id = ?")
      .bind(MEDIXIR)
      .first<{ deck_id: string }>())!.deck_id;
    // 0022 seeded this deck 'complete' by hand while every item is awaiting.
    const cert = itemNamed(await setOf(cookie, MEDIXIR), "Certificate of incorporation");
    await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cert.id}`, cookie, {
      status: "submitted",
    });
    expect(await rollUp(deck)).toBe("partial");

    for (const item of (await setOf(cookie, MEDIXIR)).items) {
      await driveTo(cookie, MEDIXIR, item.id, "submitted");
    }
    await post(`/api/signup-config/signups/${MEDIXIR}/documents/verify-all`, cookie);
    expect(await rollUp(deck)).toBe("complete");
  });

  it("creates the onboarding row when none exists yet", async () => {
    const cookie = await login(ADMIN);
    const deck = (await env.DB.prepare("SELECT deck_id FROM signups WHERE id = ?")
      .bind(MEDIXIR)
      .first<{ deck_id: string }>())!.deck_id;
    await env.DB.prepare("DELETE FROM deck_onboarding WHERE deck_id = ?").bind(deck).run();
    const cert = itemNamed(await setOf(cookie, MEDIXIR), "Certificate of incorporation");
    await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cert.id}`, cookie, {
      status: "submitted",
    });
    expect(await rollUp(deck)).toBe("partial");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Seat capacity
// ═══════════════════════════════════════════════════════════════════════════

interface SeatPayload {
  rows: SeatRowView[];
  note: { tone: string; text: string };
  seatless: { signupId: string; startup: string; cohortId: string | null }[];
  seatlessNote: string;
}

async function seats(cookie: string): Promise<SeatPayload> {
  const res = await get("/api/signup-config/seats", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as SeatPayload;
}

describe("GET /api/signup-config/seats", () => {
  it("lists every cohort as Program · Cohort with 0036's seeded figures and utilisation", async () => {
    const payload = await seats(await login(ADMIN));
    expect(payload.rows.map((r) => [r.name, r.capacity, r.filled, r.utilisation])).toEqual([
      ["Climate Cohort · Cohort 6", 20, 18, 90],
      ["Fintech Accelerator · Cohort 5", 15, 9, 60],
      ["SaaS Accelerator · Cohort 6", 12, 12, 100],
    ]);
    expect(payload.rows.every((r) => r.over === false)).toBe(true);
    expect(payload.rows.map((r) => r.remaining)).toEqual([2, 6, 0]);
  });

  it("shows the info note and an empty seatless queue on the seeded workspace", async () => {
    const payload = await seats(await login(ADMIN));
    expect(payload.note.tone).toBe("info");
    expect(payload.note.text).toContain("flagged seatless in the pipeline for allocation");
    expect(payload.seatless).toEqual([]);
    expect(payload.seatlessNote).toBe("Every completed sign-up holds a cohort seat.");
  });

  it("is not served to the VC edition — its console has Fund Deployment in that slot", async () => {
    const res = await get("/api/signup-config/seats", await login(VC_ADMIN));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "wrong_edition", section: "suseat" });
  });
});

describe("PUT /api/signup-config/seats", () => {
  it("saves capacity and filled, and recomputes utilisation", async () => {
    const cookie = await login(ADMIN);
    const res = await put("/api/signup-config/seats", cookie, {
      rows: [{ cohortId: CLIMATE_COHORT, capacity: 25, filled: 20 }],
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as SeatPayload & { saved: number };
    expect(payload.saved).toBe(1);
    const row = payload.rows.find((r) => r.cohortId === CLIMATE_COHORT)!;
    expect([row.capacity, row.filled, row.utilisation]).toEqual([25, 20, 80]);
    expect(await seatsOf(CLIMATE_COHORT)).toEqual({ seat_capacity: 25, seats_filled: 20 });
  });

  it("accepts over capacity and warns, because seats never block sign-up", async () => {
    const cookie = await login(ADMIN);
    const res = await put("/api/signup-config/seats", cookie, {
      rows: [{ cohortId: CLIMATE_COHORT, capacity: 20, filled: 23 }],
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as SeatPayload;
    const row = payload.rows.find((r) => r.cohortId === CLIMATE_COHORT)!;
    expect(row.over).toBe(true);
    expect(row.utilisation).toBe(115);
    expect(payload.note.tone).toBe("warn");
    expect(payload.note.text).toBe(
      "Over capacity: Climate Cohort · Cohort 6 (23/20). " +
        "Sign-up still proceeds, but these push past the cohort seat count.",
    );
  });

  it("refuses a fractional, negative or non-numeric count, and an unknown cohort", async () => {
    const cookie = await login(ADMIN);
    const cases: [unknown, string][] = [
      [{ rows: [{ cohortId: CLIMATE_COHORT, capacity: 1.5, filled: 0 }] }, "invalid_seats"],
      [{ rows: [{ cohortId: CLIMATE_COHORT, capacity: -1, filled: 0 }] }, "invalid_seats"],
      [{ rows: [{ cohortId: CLIMATE_COHORT, capacity: "20", filled: 0 }] }, "invalid_seats"],
      [{ rows: [{ cohortId: "coh_ghost", capacity: 5, filled: 0 }] }, "unknown_cohort"],
      [{}, "rows_required"],
    ];
    for (const [body, error] of cases) {
      const res = await put("/api/signup-config/seats", cookie, body);
      expect(res.status, error).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(error);
    }
    expect(await seatsOf(CLIMATE_COHORT)).toEqual({ seat_capacity: 20, seats_filled: 18 });
  });

  it("re-derives the seatless flag against the numbers that now hold", async () => {
    const cookie = await login(ADMIN);
    // Fill the cohort, complete the sign-up → seatless.
    await put("/api/signup-config/seats", cookie, {
      rows: [{ cohortId: CLIMATE_COHORT, capacity: 18, filled: 18 }],
    });
    await post(`/api/signup-config/signups/${MEDIXIR}/complete`, cookie);
    expect((await signupRow(MEDIXIR)).seatless).toBe(1);

    // Widen the cohort and the flag clears on the next save.
    const res = await put("/api/signup-config/seats", cookie, {
      rows: [{ cohortId: CLIMATE_COHORT, capacity: 25, filled: 18 }],
    });
    expect(res.status).toBe(200);
    expect((await signupRow(MEDIXIR)).seatless).toBe(0);
    expect(((await res.json()) as SeatPayload).seatless).toEqual([]);
  });
});

describe("POST …/signups/:id/complete — where the seatless flag fires", () => {
  it("takes a free cohort seat, and the filled count follows", async () => {
    const cookie = await login(ADMIN);
    const res = await post(`/api/signup-config/signups/${MEDIXIR}/complete`, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      status: "completed",
      seatless: false,
      seated: true,
    });
    const row = await signupRow(MEDIXIR);
    expect(row.status).toBe("completed");
    expect(row.seatless).toBe(0);
    expect(row.seat_allocated_at).not.toBeNull();
    expect((await seatsOf(CLIMATE_COHORT)).seats_filled).toBe(19);
  });

  it("completes anyway with no free seat, and raises the flag instead of refusing", async () => {
    const cookie = await login(ADMIN);
    await put("/api/signup-config/seats", cookie, {
      rows: [{ cohortId: CLIMATE_COHORT, capacity: 18, filled: 18 }],
    });

    const res = await post(`/api/signup-config/signups/${MEDIXIR}/complete`, cookie);
    expect(res.status).toBe(200); // never blocked by seats
    expect(await res.json()).toEqual({
      ok: true,
      status: "completed",
      seatless: true,
      seated: false,
    });
    const row = await signupRow(MEDIXIR);
    expect(row.status).toBe("completed");
    expect(row.seatless).toBe(1);
    expect(row.seat_allocated_at).toBeNull();
    // No seat was taken from a cohort that had none.
    expect((await seatsOf(CLIMATE_COHORT)).seats_filled).toBe(18);

    const payload = await seats(cookie);
    expect(payload.seatless.map((s) => s.startup)).toEqual(["Medixir"]);
    expect(payload.seatlessNote).toBe("1 signed record still needs a seat.");
  });

  it("flags a sign-up with no cohort at all as seatless", async () => {
    const cookie = await login(ADMIN);
    const deck = (await env.DB.prepare("SELECT deck_id FROM signups WHERE id = ?")
      .bind(MEDIXIR)
      .first<{ deck_id: string }>())!.deck_id;
    await env.DB.prepare("UPDATE decks SET cohort_id = NULL WHERE id = ?").bind(deck).run();

    const res = await post(`/api/signup-config/signups/${MEDIXIR}/complete`, cookie);
    expect(res.status).toBe(200);
    expect((await res.json() as { seatless: boolean }).seatless).toBe(true);

    const payload = await seats(cookie);
    expect(payload.seatless[0].cohortId).toBeNull();
  });

  it("refuses a status move that is not progress → completed", async () => {
    const cookie = await login(ADMIN);
    // LedgerLite is still 'initiated'.
    const res = await post(`/api/signup-config/signups/${LEDGERLITE}/complete`, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "illegal_transition",
      from: "initiated",
      to: "completed",
    });
    expect((await signupRow(LEDGERLITE)).status).toBe("initiated");

    // …and twice is refused too.
    await post(`/api/signup-config/signups/${MEDIXIR}/complete`, cookie);
    const again = await post(`/api/signup-config/signups/${MEDIXIR}/complete`, cookie);
    expect(again.status).toBe(400);
  });
});

describe("POST …/signups/:id/seat — Allocate seat", () => {
  async function seatless(cookie: string) {
    await put("/api/signup-config/seats", cookie, {
      rows: [{ cohortId: CLIMATE_COHORT, capacity: 18, filled: 18 }],
    });
    await post(`/api/signup-config/signups/${MEDIXIR}/complete`, cookie);
  }

  it("clears the flag, takes a seat and provisions the record as onboarded", async () => {
    const cookie = await login(ADMIN);
    await seatless(cookie);

    const res = await post(`/api/signup-config/signups/${MEDIXIR}/seat`, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, seated: true, over: true, status: "onboarded" });

    const row = await signupRow(MEDIXIR);
    expect(row.status).toBe("onboarded");
    expect(row.seatless).toBe(0);
    expect(row.seat_allocated_at).not.toBeNull();
    // Allocating past capacity is allowed — refusing would block a signed startup.
    expect((await seatsOf(CLIMATE_COHORT)).seats_filled).toBe(19);
    expect((await seats(cookie)).seatless).toEqual([]);
  });

  it("refuses a second allocation, and one before sign-up has completed", async () => {
    const cookie = await login(ADMIN);
    await seatless(cookie);
    expect((await post(`/api/signup-config/signups/${MEDIXIR}/seat`, cookie)).status).toBe(200);

    const twice = await post(`/api/signup-config/signups/${MEDIXIR}/seat`, cookie);
    expect(twice.status).toBe(400);
    expect(((await twice.json()) as { error: string }).error).toBe("already_seated");

    const early = await post(`/api/signup-config/signups/${LEDGERLITE}/seat`, cookie);
    expect(early.status).toBe(400);
    expect(await early.json()).toEqual({ error: "not_completed", status: "initiated" });
  });

  it("refuses a startup with no cohort to seat it in", async () => {
    const cookie = await login(ADMIN);
    const deck = (await env.DB.prepare("SELECT deck_id FROM signups WHERE id = ?")
      .bind(MEDIXIR)
      .first<{ deck_id: string }>())!.deck_id;
    await env.DB.prepare("UPDATE decks SET cohort_id = NULL WHERE id = ?").bind(deck).run();
    await post(`/api/signup-config/signups/${MEDIXIR}/complete`, cookie);

    const res = await post(`/api/signup-config/signups/${MEDIXIR}/seat`, cookie);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("no_cohort");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fund Deployment
// ═══════════════════════════════════════════════════════════════════════════

interface FundPayload {
  rows: FundRowView[];
  recon: { tone: string; text: string };
  totals: { allotted: number; deployed: number; unutilised: number; utilisation: number };
}

async function fund(cookie: string): Promise<FundPayload> {
  const res = await get("/api/signup-config/fund", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as FundPayload;
}

describe("GET /api/signup-config/fund", () => {
  it("reads allotted / deployed / unutilised off programs, with 0048's seeded third figure", async () => {
    const payload = await fund(await login(VC_ADMIN));
    const fundII = payload.rows.find((r) => r.name === "Fund II")!;
    expect([fundII.allotted, fundII.deployed, fundII.unutilised]).toEqual([210, 92, 118]);
    expect(fundII.utilisation).toBe(44);
    expect(fundII.reconcileDelta).toBe(0);
    expect(fundII.reconciles).toBe(true);
  });

  it("leaves an uncommitted fund's figures unset rather than zero", async () => {
    const payload = await fund(await login(VC_ADMIN));
    const deepTech = payload.rows.find((r) => r.name === "Deep Tech Fund")!;
    expect([deepTech.allotted, deepTech.deployed, deepTech.unutilised]).toEqual([null, null, null]);
    expect(deepTech.reconcileDelta).toBeNull();
    expect(deepTech.utilisation).toBe(0);
  });

  it("reports the seeded workspace as reconciling, and totals the figures for the report", async () => {
    const payload = await fund(await login(VC_ADMIN));
    expect(payload.recon).toEqual({
      tone: "ok",
      text: "Deployed + unutilised reconciles with allotted for every program.",
    });
    expect(payload.totals).toEqual({
      allotted: 210,
      deployed: 92,
      unutilised: 118,
      utilisation: 44,
    });
  });

  it("is not served to the incubator edition, whose console has Seat capacity there", async () => {
    const res = await get("/api/signup-config/fund", await login(ADMIN));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "wrong_edition", section: "sufund" });
  });
});

describe("PUT /api/signup-config/fund", () => {
  const fundII = async () =>
    (await env.DB.prepare(
      "SELECT id, fund_size, fund_allocated, capital_deployed, fund_unutilised FROM programs WHERE edition = 'vc' AND name = 'Fund II'",
    ).first<{
      id: string;
      fund_size: number;
      fund_allocated: number;
      capital_deployed: number;
      fund_unutilised: number;
    }>())!;

  it("saves the three figures and leaves fund_size — the committed size — alone", async () => {
    const cookie = await login(VC_ADMIN);
    const before = await fundII();
    const res = await put("/api/signup-config/fund", cookie, {
      rows: [{ programId: before.id, allotted: 300, deployed: 182, unutilised: 118 }],
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as FundPayload & { saved: number };
    expect(payload.saved).toBe(1);
    const row = payload.rows.find((r) => r.programId === before.id)!;
    expect([row.allotted, row.deployed, row.unutilised, row.utilisation]).toEqual([
      300, 182, 118, 61,
    ]);
    const after = await fundII();
    expect(after.fund_size).toBe(300); // untouched: analytics sums this column
    expect([after.fund_allocated, after.capital_deployed, after.fund_unutilised]).toEqual([
      300, 182, 118,
    ]);
  });

  it("saves figures that do NOT reconcile, and names them in the warning", async () => {
    const cookie = await login(VC_ADMIN);
    const id = (await fundII()).id;
    const res = await put("/api/signup-config/fund", cookie, {
      rows: [{ programId: id, allotted: 300, deployed: 182, unutilised: 130 }],
    });
    // Advisory, not a gate: an admin with one true figure must be able to save it.
    expect(res.status).toBe(200);
    const payload = (await res.json()) as FundPayload;
    expect(payload.recon.tone).toBe("warn");
    expect(payload.recon.text).toBe(
      "Deployed + unutilised doesn't match allotted for: Fund II (+12 Cr). Adjust so they reconcile.",
    );
    expect(payload.rows.find((r) => r.programId === id)!.reconcileDelta).toBe(12);
    expect((await fundII()).fund_unutilised).toBe(130);
  });

  it("accepts a drift inside the ±0.5 Cr tolerance without warning", async () => {
    const cookie = await login(VC_ADMIN);
    const id = (await fundII()).id;
    const res = await put("/api/signup-config/fund", cookie, {
      rows: [{ programId: id, allotted: 300, deployed: 182, unutilised: 118.4 }],
    });
    expect(((await res.json()) as FundPayload).recon.tone).toBe("ok");
  });

  it("withdraws a programme's figures when they are cleared to null", async () => {
    const cookie = await login(VC_ADMIN);
    const id = (await fundII()).id;
    const res = await put("/api/signup-config/fund", cookie, {
      rows: [{ programId: id, allotted: null, deployed: null, unutilised: null }],
    });
    expect(res.status).toBe(200);
    const row = ((await res.json()) as FundPayload).rows.find((r) => r.programId === id)!;
    expect([row.allotted, row.deployed, row.unutilised]).toEqual([null, null, null]);
    // The programme itself survives — a deployment table does not delete funds.
    expect(await fundII()).toBeTruthy();
  });

  it("refuses a negative, non-numeric or absurd figure, and an unknown programme", async () => {
    const cookie = await login(VC_ADMIN);
    const id = (await fundII()).id;
    const cases: [unknown, string][] = [
      [{ rows: [{ programId: id, allotted: -5 }] }, "invalid_fund"],
      [{ rows: [{ programId: id, allotted: "300" }] }, "invalid_fund"],
      [{ rows: [{ programId: id, allotted: 9e9 }] }, "invalid_fund"],
      [{ rows: [{ programId: "prog_ghost", allotted: 1 }] }, "unknown_program"],
      [{}, "rows_required"],
    ];
    for (const [body, error] of cases) {
      const res = await put("/api/signup-config/fund", cookie, body);
      expect(res.status, error).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(error);
    }
    expect((await fundII()).fund_allocated).toBe(210);
  });

  it("cannot be reached from the incubator edition", async () => {
    const res = await put("/api/signup-config/fund", await login(ADMIN), { rows: [] });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AuthZ
// ═══════════════════════════════════════════════════════════════════════════

describe("authZ", () => {
  const VERBS: [string, string, unknown?][] = [
    ["GET", "/api/signup-config/documents"],
    ["PUT", "/api/signup-config/documents", { items: [{ name: "x" }] }],
    ["PATCH", `/api/signup-config/signups/${MEDIXIR}/documents/sd_x`, { status: "verified" }],
    ["POST", `/api/signup-config/signups/${MEDIXIR}/documents/verify-all`, {}],
    ["GET", "/api/signup-config/seats"],
    ["PUT", "/api/signup-config/seats", { rows: [] }],
    ["POST", `/api/signup-config/signups/${MEDIXIR}/complete`, {}],
    ["POST", `/api/signup-config/signups/${MEDIXIR}/seat`, {}],
    ["GET", "/api/signup-config/fund"],
    ["PUT", "/api/signup-config/fund", { rows: [] }],
  ];

  for (const email of [PA, PM]) {
    it(`403s every verb for ${email.split("@")[0]}`, async () => {
      const cookie = await login(email);
      for (const [method, path, body] of VERBS) {
        const res =
          method === "GET" ? await get(path, cookie) : await send(method, path, cookie, body);
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    });
  }

  it("401s with no session at all", async () => {
    for (const [method, path, body] of VERBS) {
      const res = await SELF.fetch(`${BASE}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("lets the superuser through, in both editions", async () => {
    expect((await get("/api/signup-config/documents", await login("priya.sharma@demo.startupjury.ai"))).status).toBe(200);
    expect((await get("/api/signup-config/seats", await login("priya.sharma@demo.startupjury.ai"))).status).toBe(200);
    expect((await get("/api/signup-config/fund", await login("aarav.khanna@demo.startupjury.ai"))).status).toBe(200);
  });

  it("closes the API with the console: revoking the `adminconsole` cell 403s an admin", async () => {
    const cookie = await login(ADMIN);
    expect((await get("/api/signup-config/documents", cookie)).status).toBe(200);
    await env.DB.prepare(
      "INSERT INTO role_permissions (edition, role, task_id, granted) VALUES ('incubator', 'admin', 'adminconsole', 0) " +
        "ON CONFLICT (edition, role, task_id) DO UPDATE SET granted = 0",
    ).run();
    expect((await get("/api/signup-config/documents", cookie)).status).toBe(403);
    expect((await get("/api/signup-config/seats", cookie)).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The audit trail
// ═══════════════════════════════════════════════════════════════════════════

describe("the audit trail", () => {
  const lastAudit = async (action: string) =>
    env.DB.prepare(
      "SELECT category, summary FROM audit_log WHERE action = ? ORDER BY rowid DESC LIMIT 1",
    )
      .bind(action)
      .first<{ category: string; summary: string }>();

  it("files a checklist save, a lifecycle move and a bulk verify under Config", async () => {
    const cookie = await login(ADMIN);
    const before = await documents(cookie);
    await put("/api/signup-config/documents", cookie, {
      applyTo: "new",
      items: before.items.map((i) => ({ id: i.id, name: i.name, note: i.note, mandatory: true })),
    });
    expect(await lastAudit("required_documents_saved")).toEqual({
      category: "config",
      summary: "Required documents updated: 5 items, 5 mandatory",
    });

    const cert = itemNamed(await setOf(cookie, MEDIXIR), "Certificate of incorporation");
    await patch(`/api/signup-config/signups/${MEDIXIR}/documents/${cert.id}`, cookie, {
      status: "submitted",
    });
    expect((await lastAudit("signup_document_status"))!.summary).toBe(
      "Certificate of incorporation for Medixir: awaiting → submitted",
    );

    await post(`/api/signup-config/signups/${MEDIXIR}/documents/verify-all`, cookie);
    expect((await lastAudit("signup_documents_verified"))!.summary).toBe(
      "Verified all documents for Medixir: 1 items",
    );
  });

  it("records a seatless completion distinctly from a seated one", async () => {
    const cookie = await login(ADMIN);
    await put("/api/signup-config/seats", cookie, {
      rows: [{ cohortId: CLIMATE_COHORT, capacity: 18, filled: 18 }],
    });
    await post(`/api/signup-config/signups/${MEDIXIR}/complete`, cookie);
    expect((await lastAudit("signup_completed_seatless"))!.summary).toBe(
      "Medixir completed sign-up with no cohort seat — flagged seatless",
    );
    await post(`/api/signup-config/signups/${MEDIXIR}/seat`, cookie);
    expect((await lastAudit("seat_allocated"))!.summary).toBe(
      "Seat allocated to Medixir in Cohort 6 · now over capacity (19/18)",
    );
  });

  it("records a fund-deployment save", async () => {
    const cookie = await login(VC_ADMIN);
    const id = (await env.DB.prepare(
      "SELECT id FROM programs WHERE edition = 'vc' AND name = 'Fund II'",
    ).first<{ id: string }>())!.id;
    await put("/api/signup-config/fund", cookie, {
      rows: [{ programId: id, allotted: 300, deployed: 182, unutilised: 118 }],
    });
    expect(await lastAudit("fund_deployment_saved")).toEqual({
      category: "config",
      summary: "Fund deployment updated: Fund II 182/300 Cr deployed",
    });
  });
});
