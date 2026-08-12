// Session 1 — Evaluator Workbench server surface: the auth'd PDF stream endpoint
// and the AI rescore guard (version-based). Runs against the migrated local D1 +
// R2 (miniflare) with the same login helper the other worker suites use.

import { SELF, env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import type { Env } from "../../src/server/types";

const BASE = "https://example.com";
const PDF_BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]); // "%PDF-1.7"

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

/** Insert a deck (optionally with an R2 PDF) for the tests. */
async function seedDeck(
  id: string,
  opts: { edition?: string; withPdf?: boolean; status?: string } = {},
): Promise<void> {
  const { edition = "incubator", withPdf = true, status = "ai_evaluated" } = opts;
  const r2key = withPdf ? `decks/${id}.pdf` : null;
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, r2_key, complete, content_version) VALUES (?, ?, 'StreamCo', ?, ?, 1, 1)",
  )
    .bind(id, edition, status, r2key)
    .run();
  if (withPdf) await env.DECKS.put(r2key as string, PDF_BYTES);
}

/** Current criteria version for an edition (tests accumulate state within a file). */
async function criteriaVersion(edition = "incubator"): Promise<number> {
  const row = await env.DB.prepare("SELECT criteria_version FROM org_settings WHERE edition = ?")
    .bind(edition)
    .first<{ criteria_version: number }>();
  return row?.criteria_version ?? 1;
}

/** Insert the AI evaluation roll-up (evaluator_id IS NULL) with scored versions. */
async function seedAiEval(deckId: string, criteriaVer: number, contentVersion = 1): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES (?, ?, NULL, 7.0, 'advanced', 'AI evaluation', '2026-05-01T00:00:00Z', ?, ?)",
  )
    .bind(`${deckId}_ai_eval`, deckId, criteriaVer, contentVersion)
    .run();
}

describe("GET /api/decks/:id/file — auth'd R2 PDF stream", () => {
  it("streams the deck PDF with an application/pdf content type", async () => {
    const cookie = await login("nisha.kapoor@demo.startupjury.ai"); // incubator admin
    const id = "wb_file_ok";
    await seedDeck(id);

    const res = await SELF.fetch(`${BASE}/api/decks/${id}/file`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([37, 80, 68, 70]); // %PDF
  });

  it("returns 404 when the deck has no stored PDF (seed / pending)", async () => {
    const cookie = await login("nisha.kapoor@demo.startupjury.ai");
    const id = "wb_file_nopdf";
    await seedDeck(id, { withPdf: false });

    const res = await SELF.fetch(`${BASE}/api/decks/${id}/file`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("is edition-scoped — a VC user cannot stream an incubator deck", async () => {
    const cookie = await login("ishaan.sethi@demo.startupjury.ai"); // VC partner
    const id = "wb_file_xedition";
    await seedDeck(id, { edition: "incubator" });

    const res = await SELF.fetch(`${BASE}/api/decks/${id}/file`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const id = "wb_file_unauth";
    await seedDeck(id);
    const res = await SELF.fetch(`${BASE}/api/decks/${id}/file`);
    expect(res.status).toBe(401);
  });
});

async function rescore(id: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/decks/${id}/rescore`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: "{}",
  });
}

describe("POST /api/decks/:id/rescore — AI rescore guard", () => {
  it("blocks a re-score when nothing changed (already_scored)", async () => {
    const cookie = await login("nisha.kapoor@demo.startupjury.ai");
    const id = "wb_rescore_block";
    await seedDeck(id);
    await seedAiEval(id, await criteriaVersion()); // scored under the current criteria + content

    const res = await rescore(id, cookie);
    expect(res.status).toBe(409);
    expect((await res.json<{ error: string }>()).error).toBe("already_scored");
  });

  it("unblocks after an admin criteria change, then attempts a re-run", async () => {
    const cookie = await login("nisha.kapoor@demo.startupjury.ai");
    const id = "wb_rescore_unblock";
    await seedDeck(id); // has an R2 PDF
    await seedAiEval(id, await criteriaVersion()); // scored under the current criteria

    // Same as above — blocked while criteria is unchanged.
    expect((await rescore(id, cookie)).status).toBe(409);

    // Admin edits the AI prompt → criteria_version bumps → the guard unblocks.
    const bump = await SELF.fetch(`${BASE}/api/config/ai-prompt`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Weight climate impact heavily." }),
    });
    expect(bump.status).toBe(200);

    // Now the guard lets it through to an actual re-run. There's no ANTHROPIC key
    // in tests, so the run fails (502) — the point is it is NOT already_scored.
    const res = await rescore(id, cookie);
    expect(res.status).toBe(502);
    expect((await res.json<{ error: string }>()).error).toBe("evaluation_failed");
  });

  it("refuses founders (403) — re-score is a team action", async () => {
    const cookie = await login("meera.sharma@demo.startupjury.ai"); // founder
    const id = "wb_rescore_founder";
    await seedDeck(id);
    await seedAiEval(id, await criteriaVersion());
    const res = await rescore(id, cookie);
    expect(res.status).toBe(403);
  });
});

describe("criteria versioning", () => {
  it("evaluateDeck stamps the AI evaluation with the current criteria + content versions", async () => {
    const id = "wb_eval_versions";
    await seedDeck(id, { status: "pending_ai" });
    const expectedCriteria = await criteriaVersion();
    const keys = (
      await env.DB.prepare(
        "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 ORDER BY sort_order",
      ).all<{ key: string }>()
    ).results.map((r) => r.key);

    const callModel = vi.fn(
      async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Lovelace",
        founder_email: "ada@testco.example",
        founder_phone: "+91 98450 11111",
        city: "Bengaluru",
        sector: "B2B SaaS",
        extractions: [{ label: "Cover", text: "One-liner" }],
        scores: keys.map((key) => ({ key, value: 8 })),
      }),
    );
    await evaluateDeck(env as Env, id, { callModel, now: () => "2026-07-21T00:00:00Z" });

    const row = await env.DB.prepare(
      "SELECT scored_criteria_version, scored_content_version FROM evaluations WHERE deck_id = ? AND evaluator_id IS NULL",
    )
      .bind(id)
      .first<{ scored_criteria_version: number; scored_content_version: number }>();
    expect(row?.scored_criteria_version).toBe(expectedCriteria);
    expect(row?.scored_content_version).toBe(1); // seeded deck content_version = 1
  });

  it("bumps org_settings.criteria_version when an admin changes the AI prompt", async () => {
    const cookie = await login("nisha.kapoor@demo.startupjury.ai");
    const before = await env.DB.prepare(
      "SELECT criteria_version FROM org_settings WHERE edition = 'incubator'",
    ).first<{ criteria_version: number }>();

    const res = await SELF.fetch(`${BASE}/api/config/ai-prompt`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Be rigorous about traction." }),
    });
    expect(res.status).toBe(200);

    const after = await env.DB.prepare(
      "SELECT criteria_version FROM org_settings WHERE edition = 'incubator'",
    ).first<{ criteria_version: number }>();
    expect((after?.criteria_version ?? 0)).toBe((before?.criteria_version ?? 0) + 1);
  });
});
