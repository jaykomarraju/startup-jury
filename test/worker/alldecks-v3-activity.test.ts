import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

/**
 * V3-DASH — the two fields `GET /api/decks` gained for the reshared superuser
 * Dashboard: `lastActivityAt` (what the rows sort on, and what the "· 2h ago"
 * row clock prints) and `queried` (the row's `.ad-tag.q` tag).
 *
 * The trap this file exists for: D1 writes timestamps in TWO formats —
 * `datetime('now')` gives "2026-09-20 10:00:00" and `new Date().toISOString()`
 * gives "2026-09-20T09:00:00.000Z" — and those do not sort lexicographically
 * against each other, because " " sorts below "T". A SQL `MAX()` over the two
 * columns silently picks the ISO one every time. The last case below is that
 * exact pairing, with the space-format value the LATER of the two.
 *
 * Storage is isolated per file, so these decks reach no other suite.
 */

const BASE = "https://example.com";
const SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

interface ActivityView {
  id: string;
  lastActivityAt?: string;
  queried?: boolean;
  uploadedAt?: string;
}

async function listDecks(cookie: string): Promise<ActivityView[]> {
  const body = (await (await SELF.fetch(`${BASE}/api/decks`, { headers: { cookie } })).json()) as {
    decks: ActivityView[];
  };
  return body.decks;
}

async function seedDeck(id: string, createdAt: string, updatedAt: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, uploaded_by, complete, created_at, updated_at) " +
      "VALUES (?, 'incubator', ?, 'ai_evaluated', 'inc_pa', 1, ?, ?)",
  )
    .bind(id, `Act ${id}`, createdAt, updatedAt)
    .run();
}

describe("GET /api/decks — lastActivityAt and queried (V3-DASH)", () => {
  let cookie = "";

  beforeAll(async () => {
    cookie = await login(SUPER);

    // (a) nothing has happened: the upload is the activity.
    await seedDeck("act_fresh", "2026-03-01 10:00:00", "2026-03-01 10:00:00");

    // (b) a pipeline event, later than both deck timestamps.
    await seedDeck("act_evented", "2026-03-01 10:00:00", "2026-03-01 10:00:00");
    await env.DB.prepare(
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, created_at) " +
        "VALUES ('pe_act_1', 'act_evented', NULL, 'pending_ai', 'ai_evaluated', 'ai_evaluated', '2026-04-02 11:00:00')",
    ).run();
    // …and an EARLIER one, so a MIN/first-row read is caught too.
    await env.DB.prepare(
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, created_at) " +
        "VALUES ('pe_act_0', 'act_evented', NULL, 'uploaded', 'pending_ai', 'submit_for_ai', '2026-03-05 11:00:00')",
    ).run();

    // (c) edited after its last event: the edit is the activity.
    await seedDeck("act_edited", "2026-03-01 10:00:00", "2026-05-09T12:00:00.000Z");
    await env.DB.prepare(
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, created_at) " +
        "VALUES ('pe_act_2', 'act_edited', NULL, 'uploaded', 'pending_ai', 'submit_for_ai', '2026-04-01 11:00:00')",
    ).run();

    // (d) THE FORMAT TRAP — and it only bites on the SAME DAY. Once the dates
    // differ, lexicographic order happens to agree with real order, so a test
    // that varies the day proves nothing. Both of these are 2 June 2026.
    //
    // (d1) the SPACE-format value is the later one: event 15:00Z vs edit
    // 09:00Z. At index 10 the strings differ as " " (0x20) vs "T" (0x54), so a
    // lexicographic MAX picks the EDIT — six hours too early.
    await seedDeck("act_formats", "2026-03-01 10:00:00", "2026-06-02T09:00:00.000Z");
    await env.DB.prepare(
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, created_at) " +
        "VALUES ('pe_act_3', 'act_formats', NULL, 'uploaded', 'pending_ai', 'submit_for_ai', '2026-06-02 15:00:00')",
    ).run();

    // (d2) the same day the other way round: the ISO value is the later one
    // (edit 20:00Z vs event 08:00Z), and here lexicographic order is right by
    // accident. Both directions are pinned so the fix cannot be "always prefer
    // the space format".
    await seedDeck("act_formats_iso", "2026-03-01 10:00:00", "2026-06-02T20:00:00.000Z");
    await env.DB.prepare(
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, created_at) " +
        "VALUES ('pe_act_4', 'act_formats_iso', NULL, 'uploaded', 'pending_ai', 'submit_for_ai', '2026-06-02 08:00:00')",
    ).run();

    // (e) a founder query has been raised.
    await seedDeck("act_queried", "2026-03-01 10:00:00", "2026-03-01 10:00:00");
    await env.DB.prepare(
      "INSERT INTO queries (id, deck_id, questions, email_status, created_at) " +
        "VALUES ('q_act_1', 'act_queried', '[]', 'sent', '2026-03-02 10:00:00')",
    ).run();
  });

  it("falls back to the upload when nothing has happened to the deck", async () => {
    const deck = (await listDecks(cookie)).find((d) => d.id === "act_fresh");
    expect(deck?.lastActivityAt).toBe("2026-03-01 10:00:00");
  });

  it("uses the LATEST pipeline event, not the first", async () => {
    const deck = (await listDecks(cookie)).find((d) => d.id === "act_evented");
    expect(deck?.lastActivityAt).toBe("2026-04-02 11:00:00");
  });

  it("uses the deck's own last edit when that is newer than its last event", async () => {
    const deck = (await listDecks(cookie)).find((d) => d.id === "act_edited");
    expect(deck?.lastActivityAt).toBe("2026-05-09T12:00:00.000Z");
  });

  it("compares INSTANTS across D1's two timestamp formats, not strings", async () => {
    const decks = await listDecks(cookie);
    // A lexicographic MAX returns the 09:00 edit here; the 15:00 event is six
    // hours later in real time and must win.
    expect(decks.find((d) => d.id === "act_formats")?.lastActivityAt).toBe("2026-06-02 15:00:00");
    // The mirror case, where the ISO value is genuinely the later one.
    expect(decks.find((d) => d.id === "act_formats_iso")?.lastActivityAt).toBe("2026-06-02T20:00:00.000Z");
  });

  it("flags a deck a clarification letter has been raised on", async () => {
    const decks = await listDecks(cookie);
    expect(decks.find((d) => d.id === "act_queried")?.queried).toBe(true);
    expect(decks.find((d) => d.id === "act_fresh")?.queried).toBe(false);
  });

  it("every deck in the list carries the field", async () => {
    const decks = await listDecks(cookie);
    expect(decks.length).toBeGreaterThan(0);
    for (const d of decks) {
      expect(typeof d.lastActivityAt, `${d.id} lastActivityAt`).toBe("string");
      expect(typeof d.queried, `${d.id} queried`).toBe("boolean");
    }
  });
});
