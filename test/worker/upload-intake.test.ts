import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import { MAX_PDF_BYTES } from "../../src/server/decks/versions";
import { MAX_DECK_PDF_BYTES } from "../../src/shared/intake";
import type { Env } from "../../src/server/types";

/**
 * W7-B — bulk intake keeps what the operator told it (F0223, F0227, F0298).
 *
 *   • programme, cohort and the workspace sector are carried onto EVERY deck in
 *     a bulk batch, and a single upload resolves its sector the same way;
 *   • nothing a form sends is trusted — another edition's programme, or a cohort
 *     from a different programme, is dropped rather than written;
 *   • sector is never taken from the extraction and never marks a deck
 *     Incomplete, so an operator-supplied sector survives the AI run;
 *   • authZ: the uploading role is allowed and a mentor is refused.
 */

const BASE = "https://example.com";
const PA = "sunita.rao@demo.startupjury.ai"; // incubator program_associate
const MENTOR = "anil.mehta@demo.startupjury.ai"; // incubator mentor

async function login(email: string) {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function pdfForm(field: string, names: string[], extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const name of names) {
    form.append(field, new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" }));
  }
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

interface DeckRow {
  program_id: string | null;
  cohort_id: string | null;
  sector: string | null;
  missing_fields: string | null;
  status: string;
}

async function deckRow(id: string): Promise<DeckRow> {
  return (await env.DB.prepare("SELECT program_id, cohort_id, sector, missing_fields, status FROM decks WHERE id = ?")
    .bind(id)
    .first<DeckRow>())!;
}

async function bulk(cookie: string, names: string[], extra: Record<string, string>) {
  const res = await SELF.fetch(`${BASE}/api/decks/bulk`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: pdfForm("files", names, extra),
  });
  return { status: res.status, body: (await res.json()) as { count: number; deckIds: string[] } };
}

beforeEach(async () => {
  await env.DB.prepare("UPDATE org_settings SET credits_balance = 500 WHERE edition IN ('incubator', 'vc')").run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO programs (id, edition, sector, name, active) VALUES ('w7b_prog', 'incubator', 'CleanTech', 'W7-B Climate Programme', 1)",
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO programs (id, edition, sector, name, active) VALUES ('w7b_other', 'incubator', 'AgriTech', 'W7-B Other Programme', 1)",
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO programs (id, edition, sector, name, active) VALUES ('w7b_vc_prog', 'vc', 'Consumer', 'W7-B VC Fund', 1)",
    ),
    env.DB.prepare("INSERT OR IGNORE INTO cohorts (id, program_id, name, active) VALUES ('w7b_coh', 'w7b_prog', 'Cohort W7', 1)"),
    env.DB.prepare(
      "INSERT OR IGNORE INTO cohorts (id, program_id, name, active) VALUES ('w7b_coh_other', 'w7b_other', 'Other cohort', 1)",
    ),
    env.DB.prepare("INSERT OR IGNORE INTO sectors (id, edition, name, active) VALUES ('w7b_sec_fin', 'incubator', 'FinTech', 1)"),
  ]);
});

describe("POST /api/decks/bulk carries the operator's context onto every deck", () => {
  it("writes the programme, cohort and sector on each deck in the batch", async () => {
    const cookie = await login(PA);
    const { status, body } = await bulk(cookie, ["a.pdf", "b.pdf", "c.pdf"], {
      programId: "w7b_prog",
      cohortId: "w7b_coh",
      sector: "fintech",
    });
    expect(status).toBe(200);
    expect(body.count).toBe(3);
    for (const id of body.deckIds) {
      // The taxonomy's spelling, not the form's.
      expect(await deckRow(id)).toMatchObject({ program_id: "w7b_prog", cohort_id: "w7b_coh", sector: "FinTech" });
    }
  });

  it("takes the programme's sector when none is picked, and a cohort implies its programme", async () => {
    const cookie = await login(PA);
    const { body } = await bulk(cookie, ["d.pdf", "e.pdf"], { cohortId: "w7b_coh" });
    for (const id of body.deckIds) {
      expect(await deckRow(id)).toMatchObject({ program_id: "w7b_prog", cohort_id: "w7b_coh", sector: "CleanTech" });
    }
  });

  it("drops another edition's programme and a cohort from a different programme", async () => {
    const cookie = await login(PA);
    const foreign = await bulk(cookie, ["f.pdf"], { programId: "w7b_vc_prog" });
    expect(await deckRow(foreign.body.deckIds[0])).toMatchObject({ program_id: null, cohort_id: null });

    const mismatched = await bulk(cookie, ["g.pdf"], { programId: "w7b_prog", cohortId: "w7b_coh_other" });
    expect(await deckRow(mismatched.body.deckIds[0])).toMatchObject({
      program_id: "w7b_prog",
      cohort_id: null,
      sector: "CleanTech",
    });
  });

  it("still uploads untagged when the form says nothing", async () => {
    const cookie = await login(PA);
    const { status, body } = await bulk(cookie, ["h.pdf"], {});
    expect(status).toBe(200);
    expect(await deckRow(body.deckIds[0])).toMatchObject({ program_id: null, cohort_id: null });
  });

  it("refuses a mentor, who has no pipeline authority", async () => {
    const cookie = await login(MENTOR);
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM decks").first<{ n: number }>();
    const { status } = await bulk(cookie, ["m.pdf"], { programId: "w7b_prog" });
    expect(status).toBe(403);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM decks").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
});

describe("POST /api/decks/upload resolves the sector the same way", () => {
  it("falls back to the tagged programme's sector", async () => {
    const cookie = await login(PA);
    const res = await SELF.fetch(`${BASE}/api/decks/upload`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: pdfForm("file", ["single.pdf"], { name: "Single W7", programId: "w7b_prog" }),
    });
    expect(res.status).toBe(202); // stored; evaluation deferred without an API key
    const { deckId } = (await res.json()) as { deckId: string };
    expect(await deckRow(deckId)).toMatchObject({ program_id: "w7b_prog", sector: "CleanTech" });
  });
});

describe("sector survives the AI run", () => {
  async function keys(): Promise<string[]> {
    return (
      await env.DB.prepare("SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 ORDER BY sort_order").all<{
        key: string;
      }>()
    ).results.map((r) => r.key);
  }

  it("never overwrites an operator-supplied sector with the extracted one", async () => {
    const cookie = await login(PA);
    const { body } = await bulk(cookie, ["x.pdf"], { programId: "w7b_prog", sector: "FinTech" });
    const id = body.deckIds[0];
    const k = await keys();
    const result = await evaluateDeck(env as Env, id, {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Founder",
        founder_email: "ada@testco.example",
        founder_phone: "+91 98450 12345",
        city: "Pune",
        sector: "Climate Hardware",
        scores: k.map((key) => ({ key, value: 8 })),
      }),
    });
    expect(result.details?.sector).toBe("FinTech");
    expect(await deckRow(id)).toMatchObject({ sector: "FinTech", missing_fields: null });
  });

  it("does not fill a blank sector from the deck, and a blank sector is not Incomplete", async () => {
    const cookie = await login(PA);
    // No programme, several active sectors → nothing to resolve to.
    const { body } = await bulk(cookie, ["y.pdf"], {});
    const id = body.deckIds[0];
    const k = await keys();
    const result = await evaluateDeck(env as Env, id, {
      callModel: async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Founder",
        founder_email: "ada@testco.example",
        founder_phone: "+91 98450 12345",
        city: "Pune",
        sector: "Climate Hardware",
        scores: k.map((key) => ({ key, value: 8 })),
      }),
    });
    expect(result.missingFields).toEqual([]);
    const row = await deckRow(id);
    expect(row.sector).toBeNull();
    expect(row.missing_fields).toBeNull();
    expect(row.status).not.toBe("incomplete");
  });
});

describe("the size limit the Upload screen prints", () => {
  it("is the limit the upload routes enforce", () => {
    expect(MAX_DECK_PDF_BYTES).toBe(MAX_PDF_BYTES);
  });
});
