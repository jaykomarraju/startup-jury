import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

/**
 * W6-A — `/api/signups`: the sign-up workspace's own verbs, and the §8.3
 * assignment gate on them AND on esign's workspace routes.
 *
 * The properties this suite holds (§4, and the session prompt's TEST block):
 *
 *  1. **The PM read-only gate.** An unassigned Program Manager is refused with
 *     403 `read_only` on EVERY write verb of the workspace — this router's and
 *     esign's — and the same PM, once an admin assigns them, is not.
 *  2. **Founder isolation.** A founder reaches only a sign-up on a deck they
 *     uploaded. Anybody else's record is a 404 — never a 200, and never a 403
 *     that would confirm the id exists.
 *  3. **The founder verb obeys the lifecycle.** `awaiting → submitted` with a
 *     file; an item never requested, or already submitted, is a 400
 *     `illegal_transition` — the shared `canTransitionDocument`, not a rule here.
 *  4. **Completion** only after the countersign; it moves the deck and resolves
 *     the seat both ways (seated, and seatless → Allocate seat).
 *  5. **Materialisation** — a deck sent to sign-up after `0034` gets its record
 *     and its inherited checklist the first time the pipeline reads it.
 */

const BASE = "https://example.com";

const ADMIN = "nisha.kapoor@demo.startupjury.ai";
const SUPERUSER = "priya.sharma@demo.startupjury.ai";
const PM = "raj.kumar@demo.startupjury.ai";
const PA = "sunita.rao@demo.startupjury.ai";
const JURY = "rajesh.kumar@demo.startupjury.ai";
const FOUNDER = "meera.sharma@demo.startupjury.ai"; // uploaded LedgerLite
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";

/** LedgerLite — `initiated`, uploaded by the founder, SaaS Accelerator · Cohort 6 (12/12, full). */
const LEDGER = "su_inc_deck_meera_signup";
/** Medixir — `progress`, uploaded by the associate: NOT the founder's record. */
const MEDIXIR = "su_inc_deck_medixir";
const DOC = (signup: string, rd: string) => `sd_${signup}_${rd}`;

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return res.headers.get("set-cookie")?.split(";")[0] ?? "";
}

const get = (p: string, cookie: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie } });
function send(method: string, p: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${p}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}
const post = (p: string, c: string, b?: unknown) => send("POST", p, c, b);
const put = (p: string, c: string, b?: unknown) => send("PUT", p, c, b);

function attach(signup: string, doc: string, cookie: string, type = "application/pdf") {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([37, 80, 68, 70])], "incorporation.pdf", { type }));
  return SELF.fetch(`${BASE}/api/signups/${signup}/documents/${doc}/file`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
}

interface WorkspaceBody {
  signupId: string;
  status: string;
  deckStatus: string;
  documents: {
    documentsStatus: string;
    verifiable: number;
    items: { id: string; name: string; status: string; mandatory: boolean; hasFile: boolean; next: string[] }[];
  };
  seat: { seatless: boolean; seated: boolean };
  assignment: { userId: string | null; name: string | null } | null;
  readOnly: boolean;
  readOnlyReason: string | null;
  canAssign: boolean;
  programManagers: { id: string; name: string }[];
}

const row = <T>(sql: string, ...binds: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...binds)
    .first<T>();

/**
 * One D1 per file, shared by every test in it — so every test starts from the
 * seed rather than from its predecessor. Restored: LedgerLite's record, its
 * document set (re-inherited exactly as `0034` did), everything hanging off it,
 * EduLift back at `intro` with no record, and the two cohorts' seat counts.
 */
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE signups SET status = 'initiated', signing_provider = NULL, sig_type = NULL, in_app = 1, wet_ink = 0, " +
        "authorised_signatory_role = NULL, authorised_signatory_user_id = NULL, assigned_user_id = NULL, " +
        "founder_signed_at = NULL, completed_at = NULL, seatless = 0, seat_allocated_at = NULL WHERE id = ?",
    ).bind(LEDGER),
    env.DB.prepare(
      "UPDATE signups SET assigned_user_id = NULL WHERE id = ?",
    ).bind(MEDIXIR),
    env.DB.prepare(
      "DELETE FROM signatures WHERE agreement_id IN (SELECT id FROM agreements WHERE signup_id = ?)",
    ).bind(LEDGER),
    env.DB.prepare("DELETE FROM agreements WHERE signup_id = ?").bind(LEDGER),
    env.DB.prepare("DELETE FROM esign_outbox WHERE signup_id = ?").bind(LEDGER),
    env.DB.prepare("DELETE FROM signup_documents WHERE signup_id = ?").bind(LEDGER),
    env.DB.prepare(
      "INSERT INTO signup_documents (id, signup_id, required_document_id, name, note, status, sort_order) " +
        "SELECT 'sd_' || ? || '_' || rd.id, ?, rd.id, rd.name, rd.note, " +
        "CASE WHEN rd.mandatory = 1 THEN 'awaiting' ELSE 'not_requested' END, rd.sort_order " +
        "FROM required_documents rd WHERE rd.edition = 'incubator' AND rd.program_id IS NULL AND rd.active = 1",
    ).bind(LEDGER, LEDGER),
    env.DB.prepare("UPDATE decks SET status = 'signup' WHERE id = 'inc_deck_meera_signup'"),
    env.DB.prepare(
      "DELETE FROM signup_documents WHERE signup_id IN (SELECT id FROM signups WHERE deck_id = 'inc_deck_edulift')",
    ),
    env.DB.prepare("DELETE FROM signups WHERE deck_id = 'inc_deck_edulift'"),
    env.DB.prepare("UPDATE decks SET status = 'intro' WHERE id = 'inc_deck_edulift'"),
    env.DB.prepare("UPDATE cohorts SET seats_filled = 18 WHERE id = 'coh_0001'"),
    env.DB.prepare("UPDATE cohorts SET seats_filled = 12 WHERE id = 'coh_0003'"),
  ]);
});

async function workspace(signup: string, cookie: string): Promise<WorkspaceBody> {
  const res = await get(`/api/signups/${signup}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as WorkspaceBody;
}

/** Walk LedgerLite to "founder has signed, a PM role is assigned to countersign". */
async function toSigned() {
  const admin = await login(ADMIN);
  expect((await put(`/api/esign/signups/${LEDGER}/signatory`, admin, { role: "program_manager" })).status).toBe(200);
  const founder = await login(FOUNDER);
  expect((await post(`/api/esign/signups/${LEDGER}/founder-signature`, founder)).status).toBe(200);
}

// ═══════════════════════════════════════════════════════════════════════════

describe("the workspace view", () => {
  it("serves one document set, the same rows staff and the founder read", async () => {
    const staff = await workspace(LEDGER, await login(PA));
    const founder = await workspace(LEDGER, await login(FOUNDER));
    expect(staff.documents.items.map((i) => [i.name, i.status])).toEqual([
      ["Certificate of incorporation", "awaiting"],
      ["Founder ID proof", "awaiting"],
      ["Cap table", "awaiting"],
      ["Bank account details", "not_requested"],
      ["GST / tax registration", "not_requested"],
    ]);
    expect(founder.documents.items).toEqual(staff.documents.items);
    // The founder is not told how the team staffs the record.
    expect(founder.assignment).toBeNull();
    expect(staff.assignment).toEqual({ userId: null, name: null });
  });

  it("lists every open sign-up for the pipeline, with the derived roll-up", async () => {
    const res = await get("/api/signups", await login(PA));
    expect(res.status).toBe(200);
    const { signups } = (await res.json()) as {
      signups: { signupId: string; startup: string; documentsStatus: string; readOnly: boolean }[];
    };
    const ledger = signups.find((s) => s.signupId === LEDGER)!;
    expect(ledger).toMatchObject({ startup: "LedgerLite", documentsStatus: "pending", readOnly: false });
    expect(signups.find((s) => s.signupId === MEDIXIR)).toBeTruthy();
  });

  it("offers the PM picker only to the roles that may assign", async () => {
    const admin = await workspace(LEDGER, await login(ADMIN));
    expect(admin.canAssign).toBe(true);
    expect(admin.programManagers.map((p) => p.id)).toContain("inc_pm");
    const pa = await workspace(LEDGER, await login(PA));
    expect(pa.canAssign).toBe(false);
    expect(pa.programManagers).toEqual([]);
  });

  it("refuses the roles that never touch a sign-up, and the other edition", async () => {
    const jury = await login(JURY);
    expect((await get("/api/signups", jury)).status).toBe(403);
    expect((await get(`/api/signups/${LEDGER}`, jury)).status).toBe(403);
    expect((await get("/api/signups", await login(VC_ADMIN))).status).toBe(403);
    expect((await get("/api/signups", "")).status).toBe(401);
    // A founder is not staff.
    expect((await get("/api/signups", await login(FOUNDER))).status).toBe(403);
  });

  it("opens a record, with its inherited checklist, for a deck sent to sign-up after 0034", async () => {
    const pa = await login(PA);
    expect((await post("/api/decks/inc_deck_edulift/send-signup", pa)).status).toBe(200);
    expect(await row("SELECT id FROM signups WHERE deck_id = 'inc_deck_edulift'")).toBeNull();

    const { signups } = (await (await get("/api/signups", pa)).json()) as {
      signups: { signupId: string; deckId: string; status: string }[];
    };
    const edulift = signups.find((s) => s.deckId === "inc_deck_edulift")!;
    expect(edulift).toMatchObject({ signupId: "su_inc_deck_edulift", status: "initiated" });

    const view = await workspace(edulift.signupId, pa);
    expect(view.documents.items.filter((i) => i.status === "awaiting").map((i) => i.name)).toEqual([
      "Certificate of incorporation",
      "Founder ID proof",
      "Cap table",
    ]);
    // Idempotent: a second read opens nothing twice.
    await get("/api/signups", pa);
    expect(
      (await row<{ n: number }>("SELECT COUNT(*) n FROM signups WHERE deck_id = 'inc_deck_edulift'"))!.n,
    ).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("the §8.3 assignment gate — a PM is read-only until assigned", () => {
  /** Every write verb the workspace has, on both routers. */
  const WRITES: [string, string, unknown?][] = [
    ["POST", `/api/signups/${LEDGER}/documents/verify-all`],
    ["POST", `/api/signups/${LEDGER}/complete`],
    ["POST", `/api/signups/${LEDGER}/seat`],
    ["PUT", `/api/esign/signups/${LEDGER}/method`, { provider: "DocuSign", sigType: "standard", inApp: true, wetInk: true }],
    ["PUT", `/api/esign/signups/${LEDGER}/signatory`, { role: "program_manager" }],
    ["POST", `/api/esign/signups/${LEDGER}/agreement`, { values: {} }],
    ["POST", `/api/esign/signups/${LEDGER}/founder-signature`],
    ["POST", `/api/esign/signups/${LEDGER}/countersign`],
  ];

  it("refuses an unassigned PM on every write verb, with the prototype's sentence", async () => {
    const pm = await login(PM);
    for (const [method, path, body] of WRITES) {
      const res = await send(method, path, pm, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error, `${method} ${path}`).toBe("read_only");
      expect(json.message).toMatch(/^Read-only — a Super user or Admin hasn't assigned you/);
    }
    // Nothing moved.
    expect((await row<{ n: string | null }>("SELECT signing_provider n FROM signups WHERE id = ?", LEDGER))!.n).toBeNull();
    expect((await row<{ n: string | null }>("SELECT founder_signed_at n FROM signups WHERE id = ?", LEDGER))!.n).toBeNull();
  });

  it("still lets the unassigned PM READ, and tells the screen it is read-only", async () => {
    const pm = await login(PM);
    const view = await workspace(LEDGER, pm);
    expect(view.readOnly).toBe(true);
    expect(view.readOnlyReason).toMatch(/You can view, but not act\.$/);
    expect((await get(`/api/esign/signups/${LEDGER}/method`, pm)).status).toBe(200);
  });

  it("lets the same PM act once an admin assigns them — and only on that record", async () => {
    const admin = await login(ADMIN);
    const assigned = await put(`/api/signups/${LEDGER}/assignee`, admin, { userId: "inc_pm" });
    expect(assigned.status).toBe(200);
    expect(((await assigned.json()) as WorkspaceBody).assignment).toEqual({ userId: "inc_pm", name: "Raj Kumar" });

    const pm = await login(PM);
    expect((await workspace(LEDGER, pm)).readOnly).toBe(false);
    expect(
      (await put(`/api/esign/signups/${LEDGER}/method`, pm, { provider: "DocuSign", sigType: "certificate", inApp: true, wetInk: false })).status,
    ).toBe(200);
    expect((await put(`/api/esign/signups/${LEDGER}/signatory`, pm, { role: "program_manager" })).status).toBe(200);
    expect((await post(`/api/signups/${LEDGER}/documents/verify-all`, pm)).status).toBe(200);
    // Assignment is per record: Medixir is still read-only for them.
    expect((await post(`/api/signups/${MEDIXIR}/documents/verify-all`, pm)).status).toBe(403);
    expect((await post(`/api/esign/signups/${MEDIXIR}/countersign`, pm)).status).toBe(403);

    // Unassigning closes it again.
    expect((await put(`/api/signups/${LEDGER}/assignee`, admin, { userId: null })).status).toBe(200);
    expect((await post(`/api/signups/${LEDGER}/documents/verify-all`, pm)).status).toBe(403);
  });

  it("does not gate the associate, the admin or the superuser", async () => {
    for (const email of [PA, ADMIN, SUPERUSER]) {
      const cookie = await login(email);
      expect((await workspace(LEDGER, cookie)).readOnly, email).toBe(false);
      expect((await post(`/api/signups/${LEDGER}/documents/verify-all`, cookie)).status, email).toBe(200);
    }
  });

  it("lets only a Super User or Admin assign, and only a Program Manager be assigned", async () => {
    expect((await put(`/api/signups/${LEDGER}/assignee`, await login(PA), { userId: "inc_pm" })).status).toBe(403);
    expect((await put(`/api/signups/${LEDGER}/assignee`, await login(PM), { userId: "inc_pm" })).status).toBe(403);
    const su = await login(SUPERUSER);
    expect((await put(`/api/signups/${LEDGER}/assignee`, su, { userId: "inc_pa" })).status).toBe(400);
    expect((await put(`/api/signups/${LEDGER}/assignee`, su, {})).status).toBe(400);
    expect((await put(`/api/signups/${LEDGER}/assignee`, su, { userId: "inc_pm" })).status).toBe(200);
    expect((await put(`/api/signups/__ghost__/assignee`, su, { userId: "inc_pm" })).status).toBe(404);
  });

  it("steps aside on a ghost id, so esign still answers with its own 404", async () => {
    const pm = await login(PM);
    expect((await put("/api/esign/signups/__ghost__/signatory", pm, {})).status).toBe(404);
    expect((await post("/api/signups/__ghost__/complete", pm)).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("founder isolation", () => {
  it("serves the founder their own record and 404s anybody else's", async () => {
    const founder = await login(FOUNDER);
    expect((await get(`/api/signups/${LEDGER}`, founder)).status).toBe(200);

    const theirs = await get(`/api/signups/${MEDIXIR}`, founder);
    expect(theirs.status).toBe(404);
    expect(((await theirs.json()) as { error: string }).error).toBe("not_found");
    // The same answer a ghost gets — the id's existence is not confirmed.
    expect((await get("/api/signups/__ghost__", founder)).status).toBe(404);
    // …and on the verb and the file.
    const medixirDoc = DOC(MEDIXIR, "rd_inc_incorporation");
    expect((await attach(MEDIXIR, medixirDoc, founder)).status).toBe(404);
    expect((await get(`/api/signups/${MEDIXIR}/documents/${medixirDoc}/file`, founder)).status).toBe(404);
  });

  it("lists only the founder's own sign-ups", async () => {
    const res = await get("/api/signups/mine", await login(FOUNDER));
    expect(res.status).toBe(200);
    const { signups } = (await res.json()) as { signups: WorkspaceBody[] };
    expect(signups.map((s) => s.signupId)).toEqual([LEDGER]);
    // Staff have no "mine".
    expect((await get("/api/signups/mine", await login(PA))).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("the founder's submission — awaiting → submitted, with a file", () => {
  const INCORP = DOC(LEDGER, "rd_inc_incorporation");
  const GST = DOC(LEDGER, "rd_inc_gst");

  it("moves a requested item to submitted, stores the file and re-derives the roll-up", async () => {
    const founder = await login(FOUNDER);
    const res = await attach(LEDGER, INCORP, founder);
    expect(res.status).toBe(200);
    const view = (await res.json()) as WorkspaceBody;
    const item = view.documents.items.find((i) => i.id === INCORP)!;
    expect(item).toMatchObject({ status: "submitted", hasFile: true, next: ["awaiting", "verified"] });
    expect(view.documents.verifiable).toBe(1);

    const stored = await row<{ file_url: string }>("SELECT file_url FROM signup_documents WHERE id = ?", INCORP);
    expect(stored!.file_url).toMatch(new RegExp(`^signups/${LEDGER}/${INCORP}/`));
    expect(
      (await row<{ s: string }>("SELECT documents_status s FROM deck_onboarding WHERE deck_id = 'inc_deck_meera_signup'"))!.s,
    ).toBe("partial");

    // Staff can open what the founder attached.
    const file = await get(`/api/signups/${LEDGER}/documents/${INCORP}/file`, await login(PA));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
  });

  it("refuses the illegal transitions — a skip from not_requested, and a second submission", async () => {
    const founder = await login(FOUNDER);
    const skip = await attach(LEDGER, GST, founder);
    expect(skip.status).toBe(400);
    expect(await skip.json()).toMatchObject({ error: "illegal_transition", from: "not_requested", to: "submitted" });

    expect((await attach(LEDGER, INCORP, founder)).status).toBe(200);
    const again = await attach(LEDGER, INCORP, founder);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: "illegal_transition", from: "submitted", to: "submitted" });
    // Nothing written by either refusal.
    expect((await row<{ status: string }>("SELECT status FROM signup_documents WHERE id = ?", GST))!.status).toBe(
      "not_requested",
    );
  });

  it("refuses a waived item, an unsupported file, and anybody who is not the founder", async () => {
    const founder = await login(FOUNDER);
    expect((await attach(LEDGER, INCORP, founder, "text/html")).status).toBe(400);
    await env.DB.prepare("UPDATE signup_documents SET waived = 1, waived_reason = 'test' WHERE id = ?").bind(INCORP).run();
    expect(await (await attach(LEDGER, INCORP, founder)).json()).toMatchObject({ error: "document_waived" });
    // Staff do not attach on the founder's behalf through this verb.
    expect((await attach(LEDGER, DOC(LEDGER, "rd_inc_cap_table"), await login(PA))).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("completion — after the countersign, moving the deck and resolving the seat", () => {
  it("refuses to complete before the countersign", async () => {
    const pa = await login(PA);
    const res = await post(`/api/signups/${LEDGER}/complete`, pa);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("not_countersigned");
    await toSigned();
    expect((await post(`/api/signups/${LEDGER}/complete`, pa)).status).toBe(409);
  });

  it("flags a full cohort seatless, then Allocate seat onboards it past capacity", async () => {
    await toSigned();
    const pm = await login(PM);
    await put(`/api/signups/${LEDGER}/assignee`, await login(ADMIN), { userId: "inc_pm" });
    expect((await post(`/api/esign/signups/${LEDGER}/countersign`, pm)).status).toBe(200);

    const done = await post(`/api/signups/${LEDGER}/complete`, pm);
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ deckStatus: "onboard_ready", seated: false, seatless: true });
    expect((await row<{ status: string }>("SELECT status FROM decks WHERE id = 'inc_deck_meera_signup'"))!.status).toBe(
      "onboard_ready",
    );
    expect(
      await row("SELECT action FROM pipeline_events WHERE deck_id = 'inc_deck_meera_signup' AND to_stage = 'onboard_ready' ORDER BY created_at DESC"),
    ).toMatchObject({ action: "complete_signup" });
    // Done once.
    expect((await post(`/api/signups/${LEDGER}/complete`, pm)).status).toBe(409);

    const seat = await post(`/api/signups/${LEDGER}/seat`, pm);
    expect(seat.status).toBe(200);
    const view = ((await seat.json()) as { view: WorkspaceBody }).view;
    expect(view.status).toBe("onboarded");
    expect(view.seat).toMatchObject({ seatless: false, seated: true });
    expect((await row<{ n: number }>("SELECT seats_filled n FROM cohorts WHERE id = 'coh_0003'"))!.n).toBe(13);
    expect((await post(`/api/signups/${LEDGER}/seat`, pm)).status).toBe(400);
  });

  it("takes a free cohort seat when there is one", async () => {
    const pa = await login(PA);
    await post("/api/decks/inc_deck_edulift/send-signup", pa);
    await get("/api/signups", pa);
    const su = "su_inc_deck_edulift";
    const admin = await login(ADMIN);
    const superuser = await login(SUPERUSER);
    await put(`/api/esign/signups/${su}/signatory`, admin, { role: "superuser" });
    // No founder account owns EduLift, so staff record the wet-ink signature.
    expect((await post(`/api/esign/signups/${su}/founder-signature`, pa)).status).toBe(200);
    expect((await post(`/api/esign/signups/${su}/countersign`, superuser)).status).toBe(200);

    const done = await post(`/api/signups/${su}/complete`, superuser);
    expect(await done.json()).toMatchObject({ seated: true, seatless: false });
    expect((await row<{ n: number }>("SELECT seats_filled n FROM cohorts WHERE id = 'coh_0001'"))!.n).toBe(19);
  });
});
