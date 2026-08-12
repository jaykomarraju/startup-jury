import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// Session 7 — call scheduling + ICS invites (FINISH-PLAN §4/S7, §8).
//
// Seeds this file relies on (migration 0018): `call_seed_greenroute_intro`
// (incubator, GreenRoute at `shortlisted`), `call_seed_wealthos_intro` (VC,
// WealthOS at `associate_review`) and `call_seed_medgrid_partner`.
//
// NB worker-test storage is isolated **per file, not per test** — writes
// accumulate across `it` blocks, so every fixture below uses a distinct deck.

const BASE = "https://example.com";
const INC_PM = "raj.kumar@demo.startupjury.ai"; // program_manager — scheduler
const INC_JURY = "rajesh.kumar@demo.startupjury.ai"; // jury — read-only participant
const INC_PA = "sunita.rao@demo.startupjury.ai"; // program_associate — scheduler
const VC_ASSOCIATE = "sunita.rao.vc@demo.startupjury.ai";
const VC_ANALYST = "rhea.nair@demo.startupjury.ai"; // read-only
const VC_PARTNER = "ishaan.sethi@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

function req(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

interface CallShape {
  id: string;
  deckId: string;
  kind: string;
  title: string;
  scheduledAt: string | null;
  durationMinutes: number;
  status: string;
  participants: { email: string; kind: string; userId: string | null }[];
  canManage: boolean;
}

describe("calls — listing & visibility", () => {
  it("a scheduler sees the edition's calls; kinds are edition-scoped", async () => {
    const pm = await login(INC_PM);
    const res = await get("/api/calls", pm);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { calls: CallShape[]; canSchedule: boolean; kinds: string[] };
    expect(data.canSchedule).toBe(true);
    // The incubator runs one founder-facing call: the post-shortlist intro.
    expect(data.kinds).toEqual(["intro"]);
    expect(data.calls.some((c) => c.id === "call_seed_greenroute_intro")).toBe(true);
  });

  it("a read-only role sees ONLY the calls it is a participant on", async () => {
    // The jury member is seeded onto GreenRoute's intro call, and nothing else.
    const jury = await login(INC_JURY);
    const data = (await (await get("/api/calls", jury)).json()) as {
      calls: CallShape[];
      canSchedule: boolean;
    };
    expect(data.canSchedule).toBe(false);
    expect(data.calls.map((c) => c.id)).toEqual(["call_seed_greenroute_intro"]);
    expect(data.calls[0].canManage).toBe(false);
  });

  it("is edition-scoped — a VC call never appears for an incubator user", async () => {
    const pm = await login(INC_PM);
    const data = (await (await get("/api/calls", pm)).json()) as { calls: CallShape[] };
    expect(data.calls.some((c) => c.id === "call_seed_wealthos_intro")).toBe(false);

    const assoc = await login(VC_ASSOCIATE);
    const vc = (await (await get("/api/calls", assoc)).json()) as { calls: CallShape[]; kinds: string[] };
    expect(vc.calls.some((c) => c.id === "call_seed_wealthos_intro")).toBe(true);
    expect(vc.kinds).toEqual(["intro", "partner", "alignment"]);
  });

  it("filters by deck and by kind", async () => {
    const partner = await login(VC_PARTNER);
    const byKind = (await (await get("/api/calls?kind=partner", partner)).json()) as {
      calls: CallShape[];
    };
    expect(byKind.calls.every((c) => c.kind === "partner")).toBe(true);

    const byDeck = (await (await get("/api/calls?deckId=vc_deck_medgrid", partner)).json()) as {
      calls: CallShape[];
    };
    expect(byDeck.calls.every((c) => c.deckId === "vc_deck_medgrid")).toBe(true);
  });

  it("?mine=1 narrows a scheduler to their own calls", async () => {
    const partner = await login(VC_PARTNER);
    const mine = (await (await get("/api/calls?mine=1", partner)).json()) as { calls: CallShape[] };
    // The partner organises MedGrid + LearnLoop but is NOT on the WealthOS intro.
    expect(mine.calls.some((c) => c.id === "call_seed_medgrid_partner")).toBe(true);
    expect(mine.calls.some((c) => c.id === "call_seed_wealthos_intro")).toBe(false);
  });
});

describe("calls — scheduling", () => {
  it("a read-only role cannot schedule (403)", async () => {
    const analyst = await login(VC_ANALYST);
    const res = await req("POST", "/api/calls", analyst, {
      deckId: "vc_deck_wealthos",
      kind: "intro",
      scheduledAt: "2026-09-01T10:00:00.000Z",
      participants: [{ email: "founder@wealthos.example" }],
    });
    expect(res.status).toBe(403);
  });

  it("the directory is scheduler-only", async () => {
    expect((await get("/api/calls/directory", await login(VC_ANALYST))).status).toBe(403);
    const ok = await get("/api/calls/directory", await login(VC_ASSOCIATE));
    expect(ok.status).toBe(200);
    const { people } = (await ok.json()) as { people: { email: string; role: string }[] };
    expect(people.length).toBeGreaterThan(0);
    // Founders are never in the directory — they're invited by deck contact.
    expect(people.some((p) => p.role === "founder")).toBe(false);
  });

  it("rejects a kind the edition does not run", async () => {
    const pm = await login(INC_PM);
    const res = await req("POST", "/api/calls", pm, {
      deckId: "inc_deck_finstack",
      kind: "alignment",
      scheduledAt: "2026-09-01T10:00:00.000Z",
      participants: [],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("kind_not_in_edition");
  });

  it("validates the kind, the deck, the date, the duration and the emails", async () => {
    const partner = await login(VC_PARTNER);
    const bad = (path: unknown) =>
      req("POST", "/api/calls", partner, {
        deckId: "vc_deck_medgrid",
        kind: "partner",
        scheduledAt: "2026-09-01T10:00:00.000Z",
        participants: [],
        ...(path as object),
      });
    expect((await bad({ kind: "coffee" })).status).toBe(400);
    expect((await bad({ deckId: "nope" })).status).toBe(404);
    expect((await bad({ scheduledAt: "banana" })).status).toBe(400);
    expect((await bad({ durationMinutes: 1 })).status).toBe(400);
    expect((await bad({ participants: [{ email: "not-an-email" }] })).status).toBe(400);
  });

  it("creates a VC partner call with participants at any email domain", async () => {
    const partner = await login(VC_PARTNER);
    const res = await req("POST", "/api/calls", partner, {
      deckId: "vc_deck_solarnest",
      kind: "partner",
      scheduledAt: "2026-09-02T09:30:00.000Z",
      durationMinutes: 60,
      title: "SolarNest — partner call",
      location: "Zoom",
      notes: "Conviction call before IC sponsorship.",
      participants: [
        { email: "FOUNDER@SolarNest.com", name: "Solar Founder", kind: "founder" },
        { email: "advisor@gmail.com", name: "External advisor" },
      ],
    });
    expect(res.status).toBe(200);
    const { call } = (await res.json()) as { call: CallShape };
    expect(call.status).toBe("scheduled");
    expect(call.durationMinutes).toBe(60);
    const emails = call.participants.map((p) => p.email);
    // Emails are normalised to lowercase; the organizer is added automatically.
    expect(emails).toContain("founder@solarnest.com");
    expect(emails).toContain("advisor@gmail.com");
    expect(emails).toContain("ishaan.sethi@demo.startupjury.ai");
    expect(call.participants.find((p) => p.email === "ishaan.sethi@demo.startupjury.ai")?.kind).toBe(
      "organizer",
    );
  });

  it("scheduling an incubator intro call also performs `schedule_intro`", async () => {
    // GreenRoute is seeded at `shortlisted`; §8 has the PM deciding AND
    // scheduling in one act, so the deck should move to `intro`.
    const pm = await login(INC_PM);
    const res = await req("POST", "/api/calls", pm, {
      deckId: "inc_deck_greenroute",
      kind: "intro",
      scheduledAt: "2026-09-03T05:00:00.000Z",
      participants: [{ email: "founder@greenroute.example", kind: "founder" }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { advanced: boolean }).advanced).toBe(true);

    const deck = await env.DB.prepare("SELECT status FROM decks WHERE id = 'inc_deck_greenroute'").first<{
      status: string;
    }>();
    expect(deck?.status).toBe("intro");
  });

  it("a draft with no date is allowed and stays unscheduled", async () => {
    const pa = await login(INC_PA);
    const res = await req("POST", "/api/calls", pa, {
      deckId: "inc_deck_finstack",
      kind: "intro",
      scheduledAt: null,
      participants: [{ email: "founder@finstack.io", kind: "founder" }],
    });
    const { call, advanced } = (await res.json()) as { call: CallShape; advanced: boolean };
    expect(call.status).toBe("draft");
    expect(call.scheduledAt).toBeNull();
    // FinStack is at `ai_evaluated`, not `shortlisted` — no transition applies.
    expect(advanced).toBe(false);
  });
});

describe("calls — reschedule & cancel", () => {
  it("a reschedule bumps the ICS sequence so clients update the same event", async () => {
    const partner = await login(VC_PARTNER);
    const before = await env.DB.prepare(
      "SELECT ics_sequence AS seq, ics_uid AS uid FROM calls WHERE id = 'call_seed_learnloop_alignment'",
    ).first<{ seq: number; uid: string }>();

    const res = await req("PATCH", "/api/calls/call_seed_learnloop_alignment", partner, {
      scheduledAt: "2026-09-05T09:00:00.000Z",
      durationMinutes: 45,
    });
    expect(res.status).toBe(200);

    const after = await env.DB.prepare(
      "SELECT ics_sequence AS seq, ics_uid AS uid, scheduled_at AS at FROM calls WHERE id = 'call_seed_learnloop_alignment'",
    ).first<{ seq: number; uid: string; at: string }>();
    expect(after!.seq).toBe(before!.seq + 1);
    // Same UID: an update, not a second calendar entry.
    expect(after!.uid).toBe(before!.uid);
    expect(after!.at).toBe("2026-09-05T09:00:00.000Z");
  });

  it("cancelling flips the status and emits a CANCEL invite", async () => {
    const partner = await login(VC_PARTNER);
    const created = (await (
      await req("POST", "/api/calls", partner, {
        deckId: "vc_deck_dockflow",
        kind: "partner",
        scheduledAt: "2026-09-06T09:00:00.000Z",
        participants: [{ email: "founder@dockflow.example", kind: "founder" }],
      })
    ).json()) as { call: CallShape };

    expect((await req("PATCH", `/api/calls/${created.call.id}`, partner, { status: "cancelled" })).status).toBe(
      200,
    );
    const ics = await (await get(`/api/calls/${created.call.id}/ics`, partner)).text();
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("a read-only participant cannot patch, and an unknown call 404s", async () => {
    const jury = await login(INC_JURY);
    expect(
      (await req("PATCH", "/api/calls/call_seed_greenroute_intro", jury, { durationMinutes: 60 })).status,
    ).toBe(403);

    const pm = await login(INC_PM);
    expect((await req("PATCH", "/api/calls/call_nope", pm, { durationMinutes: 60 })).status).toBe(404);
    expect((await req("PATCH", "/api/calls/call_seed_greenroute_intro", pm, {})).status).toBe(400);
  });

  it("cross-edition access 404s rather than leaking the call", async () => {
    const pm = await login(INC_PM);
    expect((await get("/api/calls/call_seed_medgrid_partner/ics", pm)).status).toBe(404);
  });
});

describe("calls — ICS download", () => {
  it("serves a real calendar file with the right headers", async () => {
    const pm = await login(INC_PM);
    const res = await get("/api/calls/call_seed_greenroute_intro/ics", pm);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    expect(res.headers.get("content-disposition")).toContain(".ics");

    const ics = await res.text();
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:call_seed_greenroute_intro@startup-jury");
    // The founder, on their own domain, is a real ATTENDEE.
    expect(ics).toContain("mailto:founder@greenroute.example");
  });

  it("an invited read-only member can download their own invite", async () => {
    const jury = await login(INC_JURY);
    const res = await get("/api/calls/call_seed_greenroute_intro/ics", jury);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("BEGIN:VEVENT");
  });

  it("someone not on the call cannot download it", async () => {
    const analyst = await login(VC_ANALYST);
    // The analyst is on the WealthOS intro but not on the MedGrid partner call.
    expect((await get("/api/calls/call_seed_wealthos_intro/ics", analyst)).status).toBe(200);
    expect((await get("/api/calls/call_seed_medgrid_partner/ics", analyst)).status).toBe(404);
  });
});

describe("calls — invites", () => {
  it("mails every participant once per sequence, and dedupes a double-send", async () => {
    const assoc = await login(VC_ASSOCIATE);
    const first = await req("POST", "/api/calls/call_seed_wealthos_intro/invite", assoc);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { invited: number }).invited).toBe(3);

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE kind = 'call_invite' AND deck_id = 'vc_deck_wealthos'",
    ).first<{ n: number }>();
    expect(rows?.n).toBe(3);

    // A second click at the same sequence must not mail anyone again.
    await req("POST", "/api/calls/call_seed_wealthos_intro/invite", assoc);
    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE kind = 'call_invite' AND deck_id = 'vc_deck_wealthos'",
    ).first<{ n: number }>();
    expect(after?.n).toBe(3);
  });

  it("refuses to invite anyone to an unscheduled call", async () => {
    const pa = await login(INC_PA);
    const created = (await (
      await req("POST", "/api/calls", pa, {
        deckId: "inc_deck_insureflow",
        kind: "intro",
        scheduledAt: null,
        participants: [{ email: "founder@insureflow.example", kind: "founder" }],
      })
    ).json()) as { call: CallShape };
    const res = await req("POST", `/api/calls/${created.call.id}/invite`, pa);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("not_scheduled");
  });

  it("a read-only participant cannot trigger invites", async () => {
    const jury = await login(INC_JURY);
    expect((await req("POST", "/api/calls/call_seed_greenroute_intro/invite", jury)).status).toBe(403);
  });
});
