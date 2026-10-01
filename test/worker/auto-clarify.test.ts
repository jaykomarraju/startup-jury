import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import {
  autoClarifyBlock,
  clarifiableAreas,
  maybeAutoClarify,
} from "../../src/server/config/autoQuery";
import { areasNeedingResponse, shouldAutoClarify } from "../../src/shared/queries";
import { DEFAULT_TENANT_ID } from "../../src/shared/tenant";
import type { Env } from "../../src/server/types";

/**
 * **The auto-clarification TRIGGER, which had no test at all.**
 *
 * `grep -rn maybeAutoClarify test/ e2e/` returned nothing on 1-Oct-2026, and the
 * production consequence was measurable: all ELEVEN decks the tester uploaded
 * that morning carried a `queries` row at `email_status = 'sent'` with a fully
 * composed "Dear Founder, thank you for…" letter and no reply — the six whose
 * contact details were missing included. Those rows are what latched his
 * Dashboard (`queried` collapses an `incomplete` deck's status, and that
 * status's active-action whitelist is empty), so Edit and Archive became
 * unreachable on decks the spec grants them to.
 *
 * Every case below is the trigger decided through the REAL evaluation path
 * wherever there is one, so the gate is proved against the contact state
 * `evaluate.ts` actually writes rather than against a hand-built input.
 *
 * NB (worker-test gotcha, stated at the top of `automation.test.ts`): storage is
 * isolated per FILE, not per test, so every fixture below has a unique id.
 */

const PA_EMAIL = "sunita.rao@demo.startupjury.ai"; // `inc_pa`, the uploading analyst

interface SeedOpts {
  founder?: string | null;
  founderEmail?: string | null;
  founderPhone?: string | null;
  city?: string | null;
}

async function seedDeck(id: string, opts: SeedOpts = {}): Promise<void> {
  const {
    founder = "Ada Founder",
    founderEmail = "ada@testco.example",
    founderPhone = "+91 90000 00000",
    city = "Pune",
  } = opts;
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, sector, stage, city, founder, founder_email, founder_phone, " +
      "status, r2_key, uploaded_by, complete) " +
      "VALUES (?, 'incubator', ?, 'B2B SaaS', 'Seed', ?, ?, ?, ?, 'pending_ai', ?, 'inc_pa', 1)",
  )
    .bind(id, `Deck ${id}`, city, founder, founderEmail, founderPhone, `decks/${id}.pdf`)
    .run();
  await env.DECKS.put(`decks/${id}.pdf`, new Uint8Array([37, 80, 68, 70]));
}

async function paramKeys(): Promise<string[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 ORDER BY sort_order",
    ).all<{ key: string }>()
  ).results;
  return rows.map((r) => r.key);
}

/**
 * The AI path at a chosen flat score. 3 is below `WEAK_SIGNAL_MAX`, so every
 * core parameter lands in the Weak band and the deck has genuine weak signal to
 * be clarified about — which is the only thing this trigger is for.
 */
async function evaluate(id: string, score: number, raw: Partial<RawEvaluation> = {}) {
  const keys = await paramKeys();
  return evaluateDeck(env as Env, id, {
    callModel: async (): Promise<RawEvaluation> => ({
      complete: true,
      founder: "Ada Founder",
      founder_email: "ada@testco.example",
      founder_phone: "+91 90000 00000",
      city: "Pune",
      sector: "B2B SaaS",
      scores: keys.map((key) => ({ key, value: score })),
      ...raw,
    }),
    now: () => "2026-10-01T00:00:00Z",
  });
}

function queriesOf(deckId: string) {
  return env.DB.prepare(
    "SELECT id, questions, email_status FROM queries WHERE deck_id = ?",
  )
    .bind(deckId)
    .all<{ id: string; questions: string; email_status: string }>();
}

function queryMailOf(deckId: string) {
  return env.DB.prepare(
    "SELECT to_email, to_name, subject, body FROM email_outbox WHERE deck_id = ? AND kind = 'founder_query'",
  )
    .bind(deckId)
    .all<{ to_email: string; to_name: string | null; subject: string; body: string }>();
}

const INPUT = (deckId: string) => ({
  deckId,
  edition: "incubator" as const,
  tenantId: DEFAULT_TENANT_ID,
  deckName: `Deck ${deckId}`,
  founderName: "Ada Founder",
  founderEmail: "ada@testco.example",
  missingFields: [],
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · The state it IS for — weak signal, and a founder we can reach
// ═══════════════════════════════════════════════════════════════════════════

describe("a weak deck with complete contact is clarified, to the founder's own address", () => {
  it("raises exactly one letter, addressed to the founder and not to the uploader", async () => {
    await seedDeck("ac_weak");
    const res = await evaluate("ac_weak", 3);
    expect(res.status).toBe("ai_evaluated");
    expect(res.missingFields).toEqual([]);

    const rows = (await queriesOf("ac_weak")).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].email_status).toBe("sent");
    expect(rows[0].questions).not.toBe("");

    const mail = (await queryMailOf("ac_weak")).results;
    expect(mail).toHaveLength(1);
    // The whole of the recipient fix: the founder's address, never the analyst
    // who uploaded the deck and never `founder@portal.local`.
    expect(mail[0].to_email).toBe("ada@testco.example");
    expect(mail[0].to_email).not.toBe(PA_EMAIL);
    expect(mail[0].to_name).toBe("Ada Founder");
  });

  it("asks about the areas the AI scored weak, and about nothing else", async () => {
    await seedDeck("ac_weak_body");
    await evaluate("ac_weak_body", 3);
    const body = (await queryMailOf("ac_weak_body")).results[0].body;

    const names = (
      await env.DB.prepare(
        "SELECT name FROM parameters WHERE edition = 'incubator' AND active = 1 AND informational = 0",
      ).all<{ name: string }>()
    ).results.map((r) => r.name);
    expect(names.some((n) => body.includes(n))).toBe(true);

    // The contact labels are absent, but note WHY: the `no_contact` gate already
    // required an empty contact block to get this far, so the only `detail`
    // areas that could appear do not exist on this deck. `clarifiableAreas`'s
    // own control is the predicate case in §4 — this is the implied invariant,
    // which is worth pinning and is not evidence the filter works.
    for (const label of ["Founder name", "Founder email", "Phone", "City"]) {
      expect(body).not.toContain(label);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Issue 4 — the states it must NOT fire in
// ═══════════════════════════════════════════════════════════════════════════

describe("a founder we cannot reach is never written to (tester issue 4)", () => {
  it("records nothing at all when the deck has no founder address", async () => {
    await seedDeck("ac_noemail", { founderEmail: null });
    const res = await evaluate("ac_noemail", 3, { founder_email: null });
    // The deck READ fine; it is the contact details that are missing — the six
    // production decks exactly.
    expect(res.status).toBe("incomplete");
    expect(res.missingFields).toContain("founderEmail");

    // No row, so no `queried = true`, so no latched status pill and no empty
    // action whitelist on the Dashboard.
    expect((await queriesOf("ac_noemail")).results).toHaveLength(0);
    expect((await queryMailOf("ac_noemail")).results).toHaveLength(0);
  });

  it("never substitutes the uploading analyst for the founder", async () => {
    await seedDeck("ac_analyst", { founderEmail: null });
    await evaluate("ac_analyst", 3, { founder_email: null });
    // The precise production outcome being closed: `founderEmail ??
    // uploader?.email ?? "founder@portal.local"` mailed `inc_pa` a letter about
    // a company they do not run.
    const leaked = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE kind = 'founder_query' AND to_email IN (?, 'founder@portal.local')",
    )
      .bind(PA_EMAIL)
      .first<{ n: number }>();
    expect(leaked!.n).toBe(0);
  });

  it("does not ask a deck with a half-filled contact block to defend its score", async () => {
    // Reachable by email, but the phone is absent: the client's INCOMPLETE
    // CONTACT state, where his decision tree disables Query outright. The
    // founder is being asked to finish their details (`notifyIncompleteDeck`
    // fires from the same evaluation), not to answer for a weak area.
    await seedDeck("ac_halfcontact", { founderPhone: null });
    const res = await evaluate("ac_halfcontact", 3, { founder_phone: null });
    expect(res.missingFields).toEqual(["founderPhone"]);
    expect((await queriesOf("ac_halfcontact")).results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · The reason codes, read straight off the trigger
// ═══════════════════════════════════════════════════════════════════════════

describe("maybeAutoClarify reports why it declined", () => {
  it("no_contact for an unusable address, and for an incomplete contact block", async () => {
    await seedDeck("ac_reason_contact");
    await evaluate("ac_reason_contact", 3);
    await env.DB.prepare("DELETE FROM queries WHERE deck_id = 'ac_reason_contact'").run();

    for (const founderEmail of [null, "", "   ", "ada@", "not an address"]) {
      expect(
        await maybeAutoClarify(env as Env, { ...INPUT("ac_reason_contact"), founderEmail }),
      ).toMatchObject({ triggered: false, reason: "no_contact" });
    }
    expect(
      await maybeAutoClarify(env as Env, {
        ...INPUT("ac_reason_contact"),
        missingFields: ["city"],
      }),
    ).toMatchObject({ triggered: false, reason: "no_contact" });
    // Declining is silent: nothing was written on any of those passes.
    expect((await queriesOf("ac_reason_contact")).results).toHaveLength(0);
  });

  it("no_weak_signal when the deck is reachable and has nothing weak", async () => {
    await seedDeck("ac_reason_strong");
    // 9 is comfortably above `WEAK_SIGNAL_MAX`, and nothing is marked missing.
    await evaluate("ac_reason_strong", 9);
    expect((await queriesOf("ac_reason_strong")).results).toHaveLength(0);
    expect(
      await maybeAutoClarify(env as Env, INPUT("ac_reason_strong")),
    ).toMatchObject({ triggered: false, reason: "no_weak_signal" });
  });

  it("disabled when the Scoring framework toggle is off, and already_open on the second pass", async () => {
    await seedDeck("ac_reason_toggle");
    await env.DB.prepare(
      "UPDATE org_scoring_settings SET auto_clarification = 0 WHERE edition = 'incubator'",
    ).run();
    await evaluate("ac_reason_toggle", 3);
    expect((await queriesOf("ac_reason_toggle")).results).toHaveLength(0);
    expect(
      await maybeAutoClarify(env as Env, INPUT("ac_reason_toggle")),
    ).toMatchObject({ triggered: false, reason: "disabled" });

    await env.DB.prepare(
      "UPDATE org_scoring_settings SET auto_clarification = 1 WHERE edition = 'incubator'",
    ).run();
    expect(await maybeAutoClarify(env as Env, INPUT("ac_reason_toggle"))).toMatchObject({
      triggered: true,
    });
    // One open ask per deck: a queue retry must not write a second letter.
    expect(
      await maybeAutoClarify(env as Env, INPUT("ac_reason_toggle")),
    ).toMatchObject({ triggered: false, reason: "already_open" });
    expect((await queriesOf("ac_reason_toggle")).results).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · The predicate, and the one it must not contradict
// ═══════════════════════════════════════════════════════════════════════════

describe("autoClarifyBlock is the authoritative predicate", () => {
  const AREAS = areasNeedingResponse({
    missingFields: ["founderPhone", "city"],
    missingSections: ["Traction"],
    weakAreas: ["Team"],
  });

  it("drops the founder's own contact columns and keeps the signal areas", () => {
    expect(AREAS.map((a) => a.kind)).toEqual(["detail", "detail", "section", "parameter"]);
    expect(clarifiableAreas(AREAS).map((a) => a.label)).toEqual(["Traction", "Team"]);
  });

  it("a deck whose only areas are missing contact columns has nothing to be asked", () => {
    const details = areasNeedingResponse({ missingFields: ["city"] });
    expect(details).toHaveLength(1);
    expect(
      autoClarifyBlock({
        autoClarification: true,
        founderEmail: "ada@testco.example",
        missingFields: [],
        areas: details,
      }),
    ).toBe("no_weak_signal");
  });

  it("never fires where shared/queries' shouldAutoClarify would not", () => {
    // `shouldAutoClarify` (`src/shared/queries.ts`) answers the same question for
    // the Query screen's `triggered` flag and knows only the toggle and the area
    // count, so it is the LOOSER of the two. This pins the direction that must
    // hold in every case: whatever this trigger fires on, that flag also shows.
    // The other direction is the open cross-lane item — `routes/questions.ts`
    // adopting this predicate; see `docs/parity-requests/OCT1-AUTOQUERY.md`.
    for (const areas of [AREAS, clarifiableAreas(AREAS), [], areasNeedingResponse({ missingFields: ["city"] })]) {
      for (const autoClarification of [true, false]) {
        for (const founderEmail of [null, "ada@testco.example"]) {
          const gate = { autoClarification, founderEmail, missingFields: [], areas };
          if (autoClarifyBlock(gate) === null) {
            expect(shouldAutoClarify({ autoClarification, areas })).toBe(true);
          }
        }
      }
    }
  });
});
