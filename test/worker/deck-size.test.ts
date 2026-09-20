import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  callAnthropic,
  buildTool,
  buildSystemPrompt,
  buildUserPrompt,
  base64Length,
  inlineRequestBytes,
  fitsInlineRequest,
  deckFilename,
  uploadDeckFile,
  MAX_MESSAGES_REQUEST_BYTES,
  evaluateDeck,
  type ParameterRow,
  type RawEvaluation,
} from "../../src/server/ai/evaluate";
import { MAX_PDF_BYTES } from "../../src/server/decks/versions";
import { classifyEvalError } from "../../src/server/ai/health";
import type { Env } from "../../src/server/types";

/**
 * `V4-SIZE` — the client's "let's set it to 50MB", and the evaluation path that
 * had to come with it.
 *
 * The thing this file exists to stop is the failure the prompt named: raising
 * `MAX_PDF_BYTES` alone makes an upload SUCCEED and its AI evaluation FAIL,
 * which is strictly worse than the honest 24 MB refusal it replaced. So the
 * boundary tests and the transport tests are one file deliberately — they are
 * one change, and a future edit that moves the constant without the transport
 * should redden here immediately.
 *
 * Everything below is measured, not assumed. In particular `the 24 MB constant
 * was already one envelope too big` is not a rhetorical claim: it is asserted.
 */

const BASE = "https://example.com";
const PA = "sunita.rao@demo.startupjury.ai"; // incubator program_associate

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

/** A PDF of exactly `size` bytes — a real `%PDF-` header, then filler. */
function pdfOfSize(size: number): File {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-1.4\n"));
  return new File([bytes], "big.pdf", { type: "application/pdf" });
}

async function upload(cookie: string, file: File): Promise<{ status: number; body: unknown }> {
  const form = new FormData();
  form.set("file", file);
  const res = await SELF.fetch(`${BASE}/api/decks/upload`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

/** A realistic rubric: the meeting settled on 13 + 9 = 22 parameters. */
const PARAMS: ParameterRow[] = Array.from({ length: 22 }, (_, i) => ({
  id: `p${i}`,
  key: `param_${i}`,
  name: `Parameter number ${i} with a realistic name`,
  weight: 5,
}));

function envelope() {
  return {
    model: "claude-sonnet-5",
    system: buildSystemPrompt(null),
    userText: buildUserPrompt(PARAMS, []),
    tool: buildTool(PARAMS),
  };
}

beforeEach(async () => {
  await env.DB.prepare(
    "UPDATE org_settings SET credits_balance = 500 WHERE edition IN ('incubator', 'vc')",
  ).run();
});

// ── Step 1: the real ceiling, measured ───────────────────────────────────────

describe("the ceiling the model actually imposes", () => {
  it("is 32 MB of REQUEST, which base64 reaches at 24 MB of PDF", () => {
    expect(MAX_MESSAGES_REQUEST_BYTES).toBe(32 * 1024 * 1024);
    // 4 characters per 3 bytes, padded up — the document block's real cost.
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
    expect(base64Length(24 * 1024 * 1024)).toBe(33_554_432);
  });

  it("**the old 24 MB constant was already over it**, by exactly the envelope", () => {
    // This is the measurement that reverses the obvious reading of the task.
    // 24 MB of PDF base64-encodes to precisely 32 MB — leaving nothing at all
    // for the system prompt, the user prompt or the tool schema. So a deck at
    // the old limit was accepted by the server and refused by the model.
    const e = envelope();
    const atOldLimit = inlineRequestBytes({ ...e, pdfBytes: 24 * 1024 * 1024 });
    expect(atOldLimit).toBeGreaterThan(MAX_MESSAGES_REQUEST_BYTES);
    expect(fitsInlineRequest({ ...e, pdfBytes: 24 * 1024 * 1024 })).toBe(false);

    const overheadBytes = atOldLimit - MAX_MESSAGES_REQUEST_BYTES;
    expect(overheadBytes).toBeGreaterThan(0);
    // ...and it is small, which is why the off-by-an-envelope went unnoticed.
    expect(overheadBytes).toBeLessThan(64 * 1024);
  });

  it("shrinks as the org's own system prompt grows — so it is not a constant", () => {
    const e = envelope();
    const plain = inlineRequestBytes({ ...e, pdfBytes: 1024 });
    const custom = inlineRequestBytes({
      ...e,
      system: buildSystemPrompt("x".repeat(100_000)),
      pdfBytes: 1024,
    });
    expect(custom).toBeGreaterThan(plain + 99_000);
    // Which is the whole argument against picking a second magic number: the
    // same deck fits for one org and does not for another.
  });

  it("puts a 50 MB deck at more than twice the inline ceiling", () => {
    const weight = inlineRequestBytes({ ...envelope(), pdfBytes: 50 * 1024 * 1024 });
    expect(weight).toBeGreaterThan(2 * MAX_MESSAGES_REQUEST_BYTES);
    expect(weight).toBe(69_905_068 + inlineRequestBytes({ ...envelope(), pdfBytes: 0 }));
  });
});

// ── Step 2: the >24 MB evaluation path ───────────────────────────────────────

describe("how a deck reaches the model", () => {
  it("inlines a deck that fits, exactly as before", async () => {
    let body: Record<string, unknown> = {};
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          content: [{ type: "tool_use", name: "submit_evaluation", input: { complete: true } }],
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    try {
      await callAnthropic({ apiKey: "sk-test", ...envelope(), pdfBase64: "JVBERg==" });
    } finally {
      spy.mockRestore();
    }
    const content = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content;
    expect(content[0]).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBERg==" },
    });
    // The determinism contract is unchanged by the refactor that shared the
    // body builder with `inlineRequestBytes` — §8, and it has regressed before.
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_evaluation" });
    expect(body).not.toHaveProperty("temperature");
  });

  it("uploads a deck that does NOT fit and references it by file_id", async () => {
    const calls: Array<{ url: string; bodyBytes: number }> = [];
    let messagesBody: Record<string, unknown> = {};
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const req = new Request(String(url), init as RequestInit);
      const raw = await req.arrayBuffer();
      calls.push({ url: String(url), bodyBytes: raw.byteLength });
      if (String(url).endsWith("/v1/files")) {
        return new Response(JSON.stringify({ id: "file_abc123" }), {
          headers: { "content-type": "application/json" },
        });
      }
      messagesBody = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          content: [{ type: "tool_use", name: "submit_evaluation", input: { complete: true } }],
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    try {
      await callAnthropic({
        apiKey: "sk-test",
        ...envelope(),
        pdfFile: { bytes: new Uint8Array(30 * 1024 * 1024), filename: "NimbusHR.pdf" },
      });
    } finally {
      spy.mockRestore();
    }

    expect(calls.map((c) => c.url)).toEqual([
      "https://api.anthropic.com/v1/files",
      "https://api.anthropic.com/v1/messages",
    ]);
    const content = (
      messagesBody.messages as Array<{ content: Array<Record<string, unknown>> }>
    )[0].content;
    expect(content[0]).toEqual({
      type: "document",
      source: { type: "file", file_id: "file_abc123" },
    });

    // The point of the exercise, asserted on the wire rather than described:
    // the file rides its own 500 MB-ceiling request and the Messages request
    // carries a handle, so it lands far under the 32 MB that refused it inline.
    expect(calls[0].bodyBytes).toBeGreaterThan(30 * 1024 * 1024);
    expect(calls[1].bodyBytes).toBeLessThan(64 * 1024);
    expect(calls[1].bodyBytes).toBeLessThan(MAX_MESSAGES_REQUEST_BYTES);
  });

  it("gives the uploaded file an expiry, so evaluating never leaks storage", async () => {
    let fields: Record<string, string> = {};
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const form = await new Request(String(url), init as RequestInit).formData();
      fields = {
        expires_in_seconds: String(form.get("expires_in_seconds")),
        filename: (form.get("file") as File).name,
        type: (form.get("file") as File).type,
      };
      return new Response(JSON.stringify({ id: "file_ttl" }), {
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const id = await uploadDeckFile("sk-test", {
        bytes: new Uint8Array([37, 80, 68, 70]),
        filename: "NimbusHR.pdf",
      });
      expect(id).toBe("file_ttl");
    } finally {
      spy.mockRestore();
    }
    // An hour is the API minimum and orders of magnitude longer than a run, so
    // nothing has to be deleted afterwards — including when the run throws.
    expect(fields.expires_in_seconds).toBe("3600");
    expect(fields.filename).toBe("NimbusHR.pdf");
    expect(fields.type).toBe("application/pdf");
  });

  it("surfaces a Files API failure rather than sending a request with no deck", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/files")) {
        return new Response('{"error":{"message":"File too large"}}', { status: 413 });
      }
      throw new Error("the Messages request must not be attempted");
    });
    try {
      await expect(
        callAnthropic({
          apiKey: "sk-test",
          ...envelope(),
          pdfFile: { bytes: new Uint8Array(8), filename: "d.pdf" },
        }),
      ).rejects.toThrow(/Files API error 413/);
    } finally {
      spy.mockRestore();
    }
  });

  it("names the uploaded file after the deck, within the Files API's rules", () => {
    expect(deckFilename({ id: "d1", name: "NimbusHR" })).toBe("NimbusHR.pdf");
    // 1–255 characters, and none of < > : " | ? * \ / or control characters.
    expect(deckFilename({ id: "d1", name: 'a/b\\c:d*e?f"g<h>i|j' })).toBe("a b c d e f g h i j.pdf");
    expect(deckFilename({ id: "d1", name: null })).toBe("d1.pdf");
    expect(deckFilename({ id: "d1", name: "   " })).toBe("d1.pdf");
    expect(deckFilename({ id: "d1", name: "x".repeat(400) }).length).toBeLessThanOrEqual(255);
  });

  it("a size refusal reads as its own cause, not as a generic failure", () => {
    expect(classifyEvalError("Anthropic API error 413: request_too_large")).toBe(
      "Deck is too large for AI evaluation",
    );
    expect(classifyEvalError("Anthropic Files API error 413: File too large")).toBe(
      "Deck is too large for AI evaluation",
    );
    // Unchanged for everything else — the new branch must not swallow them.
    expect(classifyEvalError("Anthropic API error 429: rate")).toBe("AI provider rate limit");
    expect(classifyEvalError("Anthropic API error 500: oops")).toBe("AI provider unavailable");
  });
});

describe("evaluateDeck picks the transport from the deck it actually has", () => {
  async function seed(id: string, bytes: number): Promise<void> {
    await env.DB.prepare("DELETE FROM decks WHERE id = ?").bind(id).run();
    await env.DB.prepare(
      "INSERT INTO decks (id, edition, name, status, r2_key, content_version) " +
        "VALUES (?, 'incubator', 'SizeProbe', 'pending_ai', ?, 1)",
    )
      .bind(id, `decks/${id}.pdf`)
      .run();
    await env.DECKS.put(`decks/${id}.pdf`, new Uint8Array(bytes));
  }

  async function transportFor(id: string): Promise<"base64" | "file"> {
    let seen: "base64" | "file" | null = null;
    const keys = (
      await env.DB.prepare(
        "SELECT key FROM parameters WHERE edition = 'incubator' AND active = 1",
      ).all<{ key: string }>()
    ).results.map((r) => r.key);
    await evaluateDeck(env as unknown as Env, id, {
      callModel: async (req): Promise<RawEvaluation> => {
        seen = req.pdfFile ? "file" : "base64";
        return { complete: true, scores: keys.map((key) => ({ key, value: 7 })) };
      },
    });
    expect(seen).not.toBeNull();
    return seen!;
  }

  it("inlines a small deck and uploads one past the inline ceiling", async () => {
    await seed("size_small", 4096);
    expect(await transportFor("size_small")).toBe("base64");

    // 25 MB: accepted by the 50 MB product limit, over the 32 MB inline one.
    await seed("size_large", 25 * 1024 * 1024);
    expect(await transportFor("size_large")).toBe("file");
  });
});

// ── Step 3: the new limit, at its boundary ───────────────────────────────────

describe("the 50 MB upload limit", () => {
  it("is 50 MB on the server", () => {
    expect(MAX_PDF_BYTES).toBe(50 * 1024 * 1024);
  });

  it("refuses one byte over it with a 413 pdf_too_large", async () => {
    const cookie = await login(PA);
    const { status, body } = await upload(cookie, pdfOfSize(MAX_PDF_BYTES + 1));
    expect(status).toBe(413);
    expect(body).toEqual({ error: "pdf_too_large" });
  });

  it("accepts a deck exactly at it — the check is >, not >=", async () => {
    const cookie = await login(PA);
    const { status, body } = await upload(cookie, pdfOfSize(MAX_PDF_BYTES));
    // No ANTHROPIC_API_KEY in tests, so the evaluation is deferred to the queue
    // — which is the honest 202, NOT the 413 this size used to earn.
    expect(status).not.toBe(413);
    expect(body).not.toEqual({ error: "pdf_too_large" });
    expect((body as { deckId?: string }).deckId).toBeTruthy();
  });
});

describe("inlineRequestBytes measures BYTES, not UTF-16 code units", () => {
  /**
   * V4 integration. The original used `JSON.stringify(...).length` — UTF-16 code
   * units — against a BYTE ceiling. Latin prompts hide it (1 unit ~ 1 byte); a
   * non-Latin `ai_system_prompt` does not: Devanagari runs ~3 bytes per unit.
   * Measured before the fix, a 25 MB deck with such a prompt reported as
   * fitting while its real wire size was 84,005 bytes OVER — it uploads, 413s,
   * retries, dead-letters and refunds, and re-running never fixes it.
   * This client prices in ₹; a Devanagari system prompt is not hypothetical.
   *
   * The ONLY assertion that distinguishes the fix from the bug is a request
   * that sits INSIDE the gap: under the ceiling counted in code units, over it
   * counted in bytes. Anything weaker passes either way — the first draft of
   * this test did, and its negative control caught it.
   */
  const tool = buildTool([{ id: "p1", name: "Team", weight: 10 }] as never);
  const base = { model: "claude-opus-5", userText: "Evaluate this deck.", tool };

  it("a deck inside the units-vs-bytes gap is refused inline", () => {
    const system = "मूल्यांकन के लिए यह प्रणाली संकेत है। ".repeat(4000);
    const envelope = JSON.stringify({ model: base.model, system, userText: base.userText, tool });
    const units = envelope.length;
    const bytes = new TextEncoder().encode(envelope).length;

    // Premise: the two measurements really do differ, and by a lot.
    const gap = bytes - units;
    expect(gap).toBeGreaterThan(100_000);

    // Choose a deck that lands between them: units-count fits, byte-count does not.
    // base64Length is the encoded size of the PDF on the wire.
    let pdfBytes = 1024;
    while (base64Length(pdfBytes) + bytes <= MAX_MESSAGES_REQUEST_BYTES) pdfBytes += 64 * 1024;
    // Now over in bytes. Confirm it is still UNDER when counted in code units —
    // i.e. the old implementation would have waved this exact request through.
    expect(base64Length(pdfBytes) + units).toBeLessThan(MAX_MESSAGES_REQUEST_BYTES);

    const req = { ...base, system, pdfBytes };
    expect(inlineRequestBytes(req)).toBeGreaterThan(MAX_MESSAGES_REQUEST_BYTES);
    expect(fitsInlineRequest(req)).toBe(false); // the bug returns true here
  });

  it("a Latin prompt is barely affected — which is exactly why this hid so long", () => {
    const system = "Evaluate the deck for this area. ".repeat(4000);
    const envelope = JSON.stringify({ model: base.model, system, userText: base.userText, tool });
    const drift = new TextEncoder().encode(envelope).length - envelope.length;
    // Not zero — the shipped tool definition itself carries a few non-ASCII
    // characters — but a rounding error next to the 130 KB the Devanagari case
    // drifts by. Any test written against a Latin prompt would have passed
    // before and after the fix, which is how the bug survived review.
    expect(drift).toBeGreaterThanOrEqual(0);
    expect(drift).toBeLessThan(100);
    expect(fitsInlineRequest({ ...base, system, pdfBytes: 1024 })).toBe(true);
  });
});
