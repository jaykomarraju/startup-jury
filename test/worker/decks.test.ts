import { SELF, env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { evaluateDeck, type RawEvaluation } from "../../src/server/ai/evaluate";
import { handleQueue, type Evaluator } from "../../src/server/queue";
import type { Env, EvalMessage } from "../../src/server/types";

const BASE = "https://example.com";

async function login(email: string) {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

async function incParamKeys(): Promise<string[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1 ORDER BY sort_order",
    ).all<{ key: string }>()
  ).results;
  return rows.map((r) => r.key);
}

async function seedDeck(id: string, edition = "incubator") {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, r2_key, complete) VALUES (?, ?, 'TestCo', 'pending_ai', ?, 1)",
  )
    .bind(id, edition, `decks/${id}.pdf`)
    .run();
  await env.DECKS.put(`decks/${id}.pdf`, new Uint8Array([37, 80, 68, 70])); // "%PDF"
}

describe("evaluateDeck (mocked Anthropic)", () => {
  it("writes extractions + AI scores, applies the gate, and transitions the stage", async () => {
    const id = "test_pass";
    await seedDeck(id);
    const keys = await incParamKeys();
    const callModel = vi.fn(
      async (): Promise<RawEvaluation> => ({
        complete: true,
        founder: "Ada Lovelace",
        extractions: [
          { label: "Cover", heading: "TestCo", text: "One-liner" },
          { label: "Team", missing: true, text: null },
        ],
        scores: keys.map((key) => ({ key, value: 9 })),
      }),
    );

    const result = await evaluateDeck(env as Env, id, {
      callModel,
      now: () => "2026-07-21T00:00:00Z",
    });

    expect(callModel).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      deckId: id,
      weightedTotal: 9,
      signal: "strong",
      status: "ai_evaluated",
      gatePassed: true,
    });

    const deck = await env.DB.prepare(
      "SELECT ai_score, signal, status, founder, complete FROM decks WHERE id = ?",
    )
      .bind(id)
      .first<{ ai_score: number; signal: string; status: string; founder: string; complete: number }>();
    expect(deck).toMatchObject({ signal: "strong", status: "ai_evaluated", founder: "Ada Lovelace", complete: 1 });
    expect(deck!.ai_score).toBe(9);

    const scoreCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM scores WHERE deck_id = ? AND evaluator_kind = 'ai'",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(scoreCount!.n).toBe(keys.length);

    const extCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM deck_extractions WHERE deck_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(extCount!.n).toBe(2);

    const evt = await env.DB.prepare(
      "SELECT from_stage, to_stage, action FROM pipeline_events WHERE deck_id = ?",
    )
      .bind(id)
      .first<{ from_stage: string; to_stage: string; action: string }>();
    expect(evt).toMatchObject({ from_stage: "pending_ai", to_stage: "ai_evaluated", action: "ai_evaluated" });
  });

  it("rejects a deck at or below the gate", async () => {
    const id = "test_fail";
    await seedDeck(id);
    const keys = await incParamKeys();
    const result = await evaluateDeck(env as Env, id, {
      callModel: async () => ({ complete: true, scores: keys.map((key) => ({ key, value: 3 })) }),
    });
    expect(result.gatePassed).toBe(false);
    expect(result.status).toBe("rejected");
  });

  it("re-evaluation is idempotent (no duplicate score rows)", async () => {
    const id = "test_reeval";
    await seedDeck(id);
    const keys = await incParamKeys();
    const call = async () => ({ complete: true, scores: keys.map((key) => ({ key, value: 8 })) });
    await evaluateDeck(env as Env, id, { callModel: call });
    await evaluateDeck(env as Env, id, { callModel: call });
    const n = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM scores WHERE deck_id = ? AND evaluator_kind = 'ai'",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(n!.n).toBe(keys.length);
  });
});

describe("GET /api/decks + /api/decks/:id (report)", () => {
  it("lists edition decks and returns the evaluation report", async () => {
    const id = "test_report";
    await seedDeck(id);
    const keys = await incParamKeys();
    await evaluateDeck(env as Env, id, {
      callModel: async () => ({
        complete: true,
        founder: "Grace Hopper",
        extractions: [{ label: "Cover", text: "summary" }],
        scores: keys.map((key) => ({ key, value: 9 })),
      }),
    });

    const cookie = await login("sunita.rao@demo.startupjury.ai"); // incubator program associate
    const list = await SELF.fetch(`${BASE}/api/decks`, { headers: { Cookie: cookie } });
    const listBody = (await list.json()) as { decks: Array<{ id: string; status: string }> };
    const listed = listBody.decks.find((d) => d.id === id);
    expect(listed).toBeDefined();
    expect(listed!.status).toBe("AI Evaluated");

    const rep = await SELF.fetch(`${BASE}/api/decks/${id}`, { headers: { Cookie: cookie } });
    const report = (await rep.json()) as {
      scores: unknown[];
      extraction: unknown[];
      weightedTotal: number;
      verdict: string;
    };
    expect(report.scores.length).toBe(keys.length);
    expect(report.extraction.length).toBe(1);
    expect(report.weightedTotal).toBe(9);
    expect(report.verdict).toBe("Advanced — AI gate passed");
  });

  it("hides another edition's deck (404 on cross-edition report)", async () => {
    const id = "test_vc_only";
    await seedDeck(id, "vc");
    const cookie = await login("sunita.rao@demo.startupjury.ai"); // incubator
    const res = await SELF.fetch(`${BASE}/api/decks/${id}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});

describe("upload → R2 → (queue/direct)", () => {
  function pdfForm(field: string, names: string[]): FormData {
    const form = new FormData();
    for (const name of names) {
      form.append(field, new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" }));
    }
    return form;
  }

  it("single upload stores the PDF, creates a pending deck, attempts direct eval", async () => {
    const cookie = await login("sunita.rao@demo.startupjury.ai");
    const form = pdfForm("file", ["acme.pdf"]);
    form.set("name", "Acme");
    const res = await SELF.fetch(`${BASE}/api/decks/upload`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    // No ANTHROPIC_API_KEY in tests → evaluation is deferred, deck stays pending.
    expect(res.status).toBe(202);
    const body = (await res.json()) as { deckId: string; evaluated: boolean };
    expect(body.evaluated).toBe(false);

    const deck = await env.DB.prepare("SELECT status, r2_key FROM decks WHERE id = ?")
      .bind(body.deckId)
      .first<{ status: string; r2_key: string }>();
    expect(deck!.status).toBe("pending_ai");
    expect(await env.DECKS.get(deck!.r2_key)).not.toBeNull();
  });

  it("bulk upload stores each PDF and enqueues a job per deck", async () => {
    const cookie = await login("sunita.rao@demo.startupjury.ai");
    const res = await SELF.fetch(`${BASE}/api/decks/bulk`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: pdfForm("files", ["a.pdf", "b.pdf"]),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; deckIds: string[] };
    expect(body.count).toBe(2);
    for (const id of body.deckIds) {
      const deck = await env.DB.prepare("SELECT status FROM decks WHERE id = ?").bind(id).first<{ status: string }>();
      expect(deck!.status).toBe("pending_ai");
    }
  });

  it("rejects a non-PDF upload", async () => {
    const cookie = await login("sunita.rao@demo.startupjury.ai");
    const form = new FormData();
    form.set("file", new File(["hi"], "notes.txt", { type: "text/plain" }));
    const res = await SELF.fetch(`${BASE}/api/decks/upload`, { method: "POST", headers: { Cookie: cookie }, body: form });
    expect(res.status).toBe(400);
  });
});

describe("handleQueue", () => {
  function batch(deckIds: string[]): { batch: MessageBatch<EvalMessage>; acked: string[]; retried: string[] } {
    const acked: string[] = [];
    const retried: string[] = [];
    const messages = deckIds.map((deckId) => ({
      id: deckId,
      timestamp: new Date(),
      attempts: 1,
      body: { deckId },
      ack: () => acked.push(deckId),
      retry: () => retried.push(deckId),
    }));
    return {
      batch: { queue: "startup-jury-evals", messages, ackAll: () => {}, retryAll: () => {} } as unknown as MessageBatch<EvalMessage>,
      acked,
      retried,
    };
  }

  it("acks each message when evaluation succeeds", async () => {
    const { batch: b, acked, retried } = batch(["d1", "d2"]);
    const evaluator: Evaluator = vi.fn(async () => undefined);
    await handleQueue(b, env as Env, evaluator);
    expect(evaluator).toHaveBeenCalledTimes(2);
    expect(acked).toEqual(["d1", "d2"]);
    expect(retried).toEqual([]);
  });

  it("retries a message when evaluation throws", async () => {
    const { batch: b, acked, retried } = batch(["boom"]);
    const evaluator: Evaluator = async () => {
      throw new Error("nope");
    };
    await handleQueue(b, env as Env, evaluator);
    expect(acked).toEqual([]);
    expect(retried).toEqual(["boom"]);
  });
});
