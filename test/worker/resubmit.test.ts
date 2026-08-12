import { SELF, env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import {
  mintResubmitToken,
  verifyResubmitToken,
  hashToken,
  newResubmitToken,
  resubmitLink,
  notifyIncompleteDeck,
} from "../../src/server/resubmit";
import type { Env } from "../../src/server/types";

// Session 6 — the Incomplete → email → tokenized link → re-upload → re-score loop.
//
// NB worker-test storage is isolated per FILE, not per test: writes accumulate
// across the `it`s below, so every fixture uses a unique deck id.

const BASE = "https://example.com";

async function paramKeys(): Promise<string[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 ORDER BY sort_order",
    ).all<{ key: string }>()
  ).results;
  return rows.map((r) => r.key);
}

async function seedDeck(
  id: string,
  opts: { uploadedBy?: string | null; founderEmail?: string | null; name?: string } = {},
) {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, r2_key, complete, uploaded_by, founder_email) " +
      "VALUES (?, 'incubator', ?, 'pending_ai', ?, 1, ?, ?)",
  )
    .bind(
      id,
      opts.name ?? "TestCo",
      `decks/${id}.pdf`,
      opts.uploadedBy ?? null,
      opts.founderEmail ?? null,
    )
    .run();
  await env.DECKS.put(`decks/${id}.pdf`, new Uint8Array([37, 80, 68, 70])); // "%PDF"
}

/** A model response that scores well but omits a required contact column, so
 *  the deck is forced Incomplete regardless of score (Session 5 rule). */
function incompleteModel(extra: Partial<RawEvaluation> = {}) {
  return async (): Promise<RawEvaluation> => ({
    complete: true,
    founder: "Ada Founder",
    founder_email: "ada@testco.example",
    city: "Bengaluru",
    sector: "B2B SaaS",
    // founder_phone deliberately absent → missingFields = ["founderPhone"]
    extractions: [
      { label: "Cover", heading: "TestCo", text: "One-liner" },
      { label: "Traction", missing: true, text: null },
      { label: "Team", missing: true, text: null },
    ],
    scores: (await paramKeys()).map((key) => ({ key, value: 9 })),
    ...extra,
  });
}

function pdf(name = "updated.pdf"): File {
  return new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });
}

function postForm(path: string, form: FormData) {
  return SELF.fetch(`${BASE}${path}`, { method: "POST", body: form });
}

// ── Token primitives ─────────────────────────────────────────────────────────

describe("resubmit tokens", () => {
  it("mints high-entropy tokens and stores only their hash", async () => {
    const a = newResubmitToken();
    const b = newResubmitToken();
    expect(a).not.toBe(b);
    // 24 random bytes → 32 base64url chars, no padding or unsafe characters.
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);

    await seedDeck("tok_store");
    const { token, id } = await mintResubmitToken(env as Env, {
      deckId: "tok_store",
      edition: "incubator",
      toEmail: "founder@demo.io",
    });

    const row = await env.DB.prepare("SELECT token_hash FROM resubmit_tokens WHERE id = ?")
      .bind(id)
      .first<{ token_hash: string }>();
    expect(row?.token_hash).toBe(await hashToken(token));
    // The raw token must never be recoverable from the database.
    expect(row?.token_hash).not.toBe(token);
  });

  it("verifies a live token and rejects an unknown one", async () => {
    await seedDeck("tok_verify");
    const { token } = await mintResubmitToken(env as Env, {
      deckId: "tok_verify",
      edition: "incubator",
    });

    const ok = await verifyResubmitToken(env as Env, token);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.token.deck_id).toBe("tok_verify");

    expect(await verifyResubmitToken(env as Env, "not-a-real-token")).toEqual({
      ok: false,
      reason: "invalid_token",
    });
    expect(await verifyResubmitToken(env as Env, undefined)).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  it("rejects an expired token", async () => {
    await seedDeck("tok_expired");
    const { token } = await mintResubmitToken(env as Env, {
      deckId: "tok_expired",
      edition: "incubator",
      now: () => "2026-01-01T00:00:00Z",
    });
    // 30-day TTL: still live a week later, dead a year later.
    expect((await verifyResubmitToken(env as Env, token, () => "2026-01-08T00:00:00Z")).ok).toBe(
      true,
    );
    expect(await verifyResubmitToken(env as Env, token, () => "2027-01-01T00:00:00Z")).toEqual({
      ok: false,
      reason: "token_expired",
    });
  });

  it("revokes the deck's earlier token when a new one is minted", async () => {
    await seedDeck("tok_supersede");
    const first = await mintResubmitToken(env as Env, {
      deckId: "tok_supersede",
      edition: "incubator",
    });
    const second = await mintResubmitToken(env as Env, {
      deckId: "tok_supersede",
      edition: "incubator",
    });

    expect(await verifyResubmitToken(env as Env, first.token)).toEqual({
      ok: false,
      reason: "token_revoked",
    });
    expect((await verifyResubmitToken(env as Env, second.token)).ok).toBe(true);
  });

  it("builds the link from APP_BASE_URL, tolerating a trailing slash", () => {
    expect(resubmitLink({ ...(env as unknown as Env), APP_BASE_URL: "https://x.test/" }, "abc")).toBe(
      "https://x.test/resubmit/abc",
    );
  });
});

// ── Auto-notify on Incomplete ────────────────────────────────────────────────

describe("evaluateDeck → founder notification on Incomplete", () => {
  it("emails the founder a tokenized link listing what is missing", async () => {
    await seedDeck("notify_basic", { name: "NotifyCo" });
    const result = await evaluateDeck(env as Env, "notify_basic", {
      callModel: await incompleteModel(),
    });
    expect(result.status).toBe("incomplete");
    expect(result.missingFields).toEqual(["founderPhone"]);

    const mail = await env.DB.prepare(
      "SELECT to_email, kind, subject, body, status, dedupe_key FROM email_outbox WHERE deck_id = ? AND kind = 'incomplete_resubmit'",
    )
      .bind("notify_basic")
      .first<{
        to_email: string;
        kind: string;
        subject: string;
        body: string;
        status: string;
        dedupe_key: string;
      }>();

    // Recipient = the EXTRACTED founder email (the point of the S5 intake merge).
    expect(mail?.to_email).toBe("ada@testco.example");
    expect(mail?.subject).toContain("NotifyCo");
    expect(mail?.status).toBe("recorded"); // no send_email binding under Miniflare
    expect(mail?.dedupe_key).toBe("incomplete:notify_basic:v1");

    // The body names the missing contact column AND the missing deck sections.
    expect(mail?.body).toContain("Phone");
    expect(mail?.body).toContain("Traction, Team");

    // …and carries a working link whose token resolves to this deck.
    const token = /\/resubmit\/([A-Za-z0-9_-]+)/.exec(mail!.body)?.[1];
    expect(token).toBeTruthy();
    const check = await verifyResubmitToken(env as Env, token!);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.token.deck_id).toBe("notify_basic");
  });

  it("falls back to the uploader when the founder's own email is what's missing", async () => {
    // inc_pa = Sunita Rao, incubator program associate (seed).
    await seedDeck("notify_fallback", { uploadedBy: "inc_pa" });
    await evaluateDeck(env as Env, "notify_fallback", {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Founder",
        city: "Pune",
        sector: "Fintech",
        // no founder_email and no founder_phone
        extractions: [{ label: "Cover", heading: "X", text: "y" }],
        scores: (await paramKeys()).map((key) => ({ key, value: 9 })),
      }),
    });

    const mail = await env.DB.prepare(
      "SELECT to_email FROM email_outbox WHERE deck_id = ? AND kind = 'incomplete_resubmit'",
    )
      .bind("notify_fallback")
      .first<{ to_email: string }>();
    expect(mail?.to_email).toBe("sunita.rao@demo.startupjury.ai");
  });

  it("sends nothing when there is no address at all", async () => {
    await seedDeck("notify_norecipient", { uploadedBy: null });
    const outcome = await notifyIncompleteDeck(env as Env, {
      deckId: "notify_norecipient",
      deckName: "NoAddr",
      edition: "incubator",
      contentVersion: 1,
      missingFields: ["founderEmail"],
    });
    expect(outcome).toEqual({ sent: false, reason: "no_recipient" });

    const n = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE deck_id = ?",
    )
      .bind("notify_norecipient")
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("does NOT re-notify when the same content is re-scored, but does for a new version", async () => {
    await seedDeck("notify_dedupe");
    const model = await incompleteModel();

    await evaluateDeck(env as Env, "notify_dedupe", { callModel: model });
    // Same content_version → the second run must not produce a second email.
    await evaluateDeck(env as Env, "notify_dedupe", { callModel: model });

    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE deck_id = ? AND kind = 'incomplete_resubmit'",
    )
      .bind("notify_dedupe")
      .first<{ n: number }>();
    expect(after?.n).toBe(1);

    // A new deck version bumps content_version → a fresh notification is due.
    await env.DB.prepare("UPDATE decks SET content_version = 2 WHERE id = ?")
      .bind("notify_dedupe")
      .run();
    await evaluateDeck(env as Env, "notify_dedupe", { callModel: model });

    const final = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE deck_id = ? AND kind = 'incomplete_resubmit'",
    )
      .bind("notify_dedupe")
      .first<{ n: number }>();
    expect(final?.n).toBe(2);
  });

  it("sends nothing when the deck is NOT incomplete", async () => {
    await seedDeck("notify_complete");
    await evaluateDeck(env as Env, "notify_complete", {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Founder",
        founder_email: "ada@ok.example",
        founder_phone: "+91 98450 11111",
        city: "Bengaluru",
        sector: "B2B SaaS",
        extractions: [{ label: "Cover", heading: "X", text: "y" }],
        scores: (await paramKeys()).map((key) => ({ key, value: 9 })),
      }),
    });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE deck_id = ?")
      .bind("notify_complete")
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("never fails the evaluation when notification throws", async () => {
    await seedDeck("notify_throws");
    const notify = vi.fn(async () => {
      throw new Error("mail exploded");
    });
    const result = await evaluateDeck(env as Env, "notify_throws", {
      callModel: await incompleteModel(),
      notify,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    // The evaluation itself stands: the deck is scored and persisted.
    expect(result.status).toBe("incomplete");
    const deck = await env.DB.prepare("SELECT status, missing_fields FROM decks WHERE id = ?")
      .bind("notify_throws")
      .first<{ status: string; missing_fields: string }>();
    expect(deck).toMatchObject({ status: "incomplete", missing_fields: "founderPhone" });
  });
});

// ── The public tokenized route ───────────────────────────────────────────────

describe("GET /api/resubmit/:token (public)", () => {
  it("serves the feedback sections with no session at all", async () => {
    await seedDeck("pub_get", { name: "PublicCo" });
    await evaluateDeck(env as Env, "pub_get", { callModel: await incompleteModel() });
    const { token } = await mintResubmitToken(env as Env, {
      deckId: "pub_get",
      edition: "incubator",
    });

    const res = await SELF.fetch(`${BASE}/api/resubmit/${token}`); // no cookie
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deck: { name: string; complete: boolean };
      missingFields: string[];
      missingSections: { label: string }[];
      usesLeft: number;
    };
    expect(body.deck.name).toBe("PublicCo");
    expect(body.deck.complete).toBe(false);
    expect(body.missingFields).toEqual(["founderPhone"]);
    expect(body.missingSections.map((s) => s.label)).toEqual(["Traction", "Team"]);
    expect(body.usesLeft).toBe(10);
  });

  it("never leaks scores or evaluator data to the link holder", async () => {
    await seedDeck("pub_noleak");
    await evaluateDeck(env as Env, "pub_noleak", { callModel: await incompleteModel() });
    const { token } = await mintResubmitToken(env as Env, {
      deckId: "pub_noleak",
      edition: "incubator",
    });

    const raw = await (await SELF.fetch(`${BASE}/api/resubmit/${token}`)).text();
    expect(raw).not.toContain("aiScore");
    expect(raw).not.toContain("ai_score");
    expect(raw).not.toContain("weightedTotal");
    expect(raw).not.toContain("scores");
  });

  it("404s an unknown token and 410s an expired one", async () => {
    expect((await SELF.fetch(`${BASE}/api/resubmit/nope`)).status).toBe(404);

    await seedDeck("pub_expired");
    const { token } = await mintResubmitToken(env as Env, {
      deckId: "pub_expired",
      edition: "incubator",
      now: () => "2020-01-01T00:00:00Z",
    });
    const res = await SELF.fetch(`${BASE}/api/resubmit/${token}`);
    expect(res.status).toBe(410);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "token_expired" });
  });
});

describe("POST /api/resubmit/:token (public) — the resubmit loop", () => {
  it("stores a new version, re-scores, and returns the deck to the evaluator", async () => {
    await seedDeck("pub_loop", { name: "LoopCo" });
    await evaluateDeck(env as Env, "pub_loop", { callModel: await incompleteModel() });

    const before = await env.DB.prepare(
      "SELECT status, content_version FROM decks WHERE id = ?",
    )
      .bind("pub_loop")
      .first<{ status: string; content_version: number }>();
    expect(before).toMatchObject({ status: "incomplete", content_version: 1 });

    const { token } = await mintResubmitToken(env as Env, {
      deckId: "pub_loop",
      edition: "incubator",
    });

    // The founder's corrected deck now carries the phone number.
    const keys = await paramKeys();
    const form = new FormData();
    form.set("file", pdf("LoopCo-v2.pdf"));
    // The route calls the real evaluateDeck (no seam), which has no API key in
    // tests → it throws, is caught, and the deck rides the retry queue. Assert
    // the durable half of the loop: version stored, deck re-pointed, guard bumped.
    const res = await postForm(`/api/resubmit/${token}`, form);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; version: number; evaluated: boolean };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(2);

    const after = await env.DB.prepare(
      "SELECT r2_key, content_version FROM decks WHERE id = ?",
    )
      .bind("pub_loop")
      .first<{ r2_key: string; content_version: number }>();
    // content_version is the exact signal the Session-1 rescore guard waits on.
    expect(after?.content_version).toBe(2);
    expect(after?.r2_key).toBe("decks/pub_loop_v2.pdf");
    // The previous version's object is kept — history is never overwritten.
    expect(await env.DECKS.head("decks/pub_loop.pdf")).not.toBeNull();
    expect(await env.DECKS.head("decks/pub_loop_v2.pdf")).not.toBeNull();

    const versions = (
      await env.DB.prepare(
        "SELECT version, note, uploaded_by FROM deck_versions WHERE deck_id = ? ORDER BY version",
      )
        .bind("pub_loop")
        .all<{ version: number; note: string; uploaded_by: string | null }>()
    ).results;
    // The fixture is inserted directly (not via the upload route), so it has no
    // v1 history row — the resubmit appends v2 on top of whatever was there.
    expect(versions.map((v) => v.version)).toEqual([2]);
    // Attributed to no user account: the actor is a link holder, not a login.
    expect(versions[0]).toMatchObject({
      note: "Founder resubmission via secure link",
      uploaded_by: null,
    });

    // Re-scoring the new version lands it back with the evaluator.
    await evaluateDeck(env as Env, "pub_loop", {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Founder",
        founder_email: "ada@testco.example",
        founder_phone: "+91 98450 11111",
        city: "Bengaluru",
        sector: "B2B SaaS",
        extractions: [{ label: "Cover", heading: "LoopCo", text: "now complete" }],
        scores: keys.map((key) => ({ key, value: 9 })),
      }),
    });
    const done = await env.DB.prepare(
      "SELECT status, complete, missing_fields FROM decks WHERE id = ?",
    )
      .bind("pub_loop")
      .first<{ status: string; complete: number; missing_fields: string | null }>();
    expect(done).toMatchObject({ status: "ai_evaluated", complete: 1, missing_fields: null });
  });

  it("records the token use and spends exactly one credit", async () => {
    await seedDeck("pub_credit");
    const { token, id } = await mintResubmitToken(env as Env, {
      deckId: "pub_credit",
      edition: "incubator",
    });
    const start = await env.DB.prepare(
      "SELECT credits_balance AS b FROM org_settings WHERE edition = 'incubator'",
    ).first<{ b: number }>();

    const form = new FormData();
    form.set("file", pdf());
    expect((await postForm(`/api/resubmit/${token}`, form)).status).toBe(200);

    const end = await env.DB.prepare(
      "SELECT credits_balance AS b FROM org_settings WHERE edition = 'incubator'",
    ).first<{ b: number }>();
    expect(end!.b).toBe(start!.b - 1);

    const row = await env.DB.prepare(
      "SELECT use_count, used_at FROM resubmit_tokens WHERE id = ?",
    )
      .bind(id)
      .first<{ use_count: number; used_at: string | null }>();
    expect(row?.use_count).toBe(1);
    expect(row?.used_at).toBeTruthy();
  });

  it("rejects a non-PDF and an unknown token without touching the deck", async () => {
    await seedDeck("pub_reject");
    const { token } = await mintResubmitToken(env as Env, {
      deckId: "pub_reject",
      edition: "incubator",
    });

    const bad = new FormData();
    bad.set("file", new File([new Uint8Array([1, 2])], "notes.txt", { type: "text/plain" }));
    const res = await postForm(`/api/resubmit/${token}`, bad);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "pdf_required" });

    const good = new FormData();
    good.set("file", pdf());
    expect((await postForm(`/api/resubmit/definitely-not-a-token`, good)).status).toBe(404);

    const deck = await env.DB.prepare("SELECT content_version FROM decks WHERE id = ?")
      .bind("pub_reject")
      .first<{ content_version: number }>();
    expect(deck?.content_version).toBe(1);
  });

  it("caps how many times one link may be used, bounding the credit spend", async () => {
    await seedDeck("pub_cap");
    const { token, id } = await mintResubmitToken(env as Env, {
      deckId: "pub_cap",
      edition: "incubator",
    });
    // Fast-forward the counter to the cap rather than uploading ten times.
    await env.DB.prepare("UPDATE resubmit_tokens SET use_count = 10 WHERE id = ?").bind(id).run();

    const form = new FormData();
    form.set("file", pdf());
    const res = await postForm(`/api/resubmit/${token}`, form);
    expect(res.status).toBe(429);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "too_many_resubmits" });
  });

  it("stops working once the link has been superseded by a newer one", async () => {
    await seedDeck("pub_superseded");
    const old = await mintResubmitToken(env as Env, {
      deckId: "pub_superseded",
      edition: "incubator",
    });
    await mintResubmitToken(env as Env, { deckId: "pub_superseded", edition: "incubator" });

    const form = new FormData();
    form.set("file", pdf());
    const res = await postForm(`/api/resubmit/${old.token}`, form);
    expect(res.status).toBe(410);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "token_revoked" });
  });
});

// ── The seeded demo fixture ──────────────────────────────────────────────────

describe("demo seed", () => {
  it("ships a working link for the canonical Incomplete deck (NimbusHR)", async () => {
    const res = await SELF.fetch(`${BASE}/api/resubmit/aisj-demo-nimbushr-resubmit-2026`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deck: { name: string; complete: boolean };
      missingFields: string[];
    };
    expect(body.deck.name).toBe("NimbusHR");
    expect(body.deck.complete).toBe(false);
    expect(body.missingFields).toEqual(["founderPhone"]);
  });
});
