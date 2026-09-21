import { describe, it, expect, vi } from "vitest";
import { uploadDeckFile, deckFilename } from "../../src/server/ai/evaluate";

/**
 * V4 integration — the Files API wire format, checked against the PUBLISHED
 * contract rather than against a mock we wrote ourselves.
 *
 * Source: platform.claude.com/docs/en/build-with-claude/files (fetched
 * 2026-09-20). The session that built this path could only test its own mock,
 * so every expectation below quotes the spec it comes from.
 */

const SPEC = {
  endpoint: "https://api.anthropic.com/v1/files",
  // "The Files API is out of beta and needs no beta header."
  betaHeader: "anthropic-beta",
  // curl: -F "file=@/path/to/document.pdf"
  fileField: "file",
  // "include an `expires_in_seconds` form field ... an integer number of
  //  seconds between 3,600 (1 hour) and 7,776,000 (90 days)"
  ttlField: "expires_in_seconds",
  ttlMin: 3_600,
  ttlMax: 7_776_000,
  // "Invalid filename (400): ... 1-255 characters ... forbidden characters
  //  (<, >, :, ", |, ?, *, \\, /, or Unicode characters 0-31)"
  forbidden: ["<", ">", ":", '"', "|", "?", "*", "\\\\", "/"],
  maxFilenameLen: 255,
};

function capture() {
  const seen: { url?: string; init?: RequestInit } = {};
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify({ id: "file_abc123" }), { status: 200 });
  });
  return { seen, fetchMock };
}

describe("Files API upload matches the published contract", () => {
  it("posts to /v1/files with no beta header — the API is GA", async () => {
    const { seen, fetchMock } = capture();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const id = await uploadDeckFile("sk-test", {
        bytes: new Uint8Array([1, 2, 3]),
        filename: "deck.pdf",
      });
      expect(id).toBe("file_abc123");
      expect(seen.url).toBe(SPEC.endpoint);

      const headers = (seen.init!.headers ?? {}) as Record<string, string>;
      // Sending the beta header would pin us to the OLD response shapes
      // (`has_more` / `first_id` / `last_id`, and no `expires_at`).
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain(SPEC.betaHeader);
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(headers["x-api-key"]).toBe("sk-test");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends the two documented form fields, with a TTL inside the legal range", async () => {
    const { seen, fetchMock } = capture();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await uploadDeckFile("sk-test", {
        bytes: new Uint8Array([1, 2, 3]),
        filename: "deck.pdf",
      });
      const form = seen.init!.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get(SPEC.fileField)).toBeInstanceOf(File);

      // 3600 is the documented MINIMUM and we sit exactly on it, so a future
      // "make it ten minutes" would 400 at upload — in production, on exactly
      // the decks too big to ride inline. This is the guard for that edit.
      const ttl = Number(form.get(SPEC.ttlField));
      expect(Number.isInteger(ttl)).toBe(true);
      expect(ttl).toBeGreaterThanOrEqual(SPEC.ttlMin);
      expect(ttl).toBeLessThanOrEqual(SPEC.ttlMax);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("deckFilename satisfies the documented filename rules", () => {
  it("strips every forbidden character the spec lists", () => {
    const nasty = 'a<b>c:d"e|f?g*h' + String.fromCharCode(92) + "i/j.pdf";
    const safe = deckFilename({ id: "d1", name: nasty });
    for (const ch of SPEC.forbidden) {
      const real = ch === "\\\\" ? String.fromCharCode(92) : ch;
      expect(safe, "forbidden character survived: " + real).not.toContain(real);
    }
  });

  it("strips control characters — the class the spec calls Unicode 0-31", () => {
    // This is the regex that carried a literal NUL and made the whole source
    // file binary to grep until V4 integration escaped it.
    const withControls = "deck" + String.fromCharCode(0, 7, 31) + "name.pdf";
    const safe = deckFilename({ id: "d1", name: withControls });
    expect([...safe].some((c) => c.charCodeAt(0) <= 31)).toBe(false);
  });

  it("stays inside 1-255 characters", () => {
    const long = "x".repeat(400) + ".pdf";
    const safe = deckFilename({ id: "d1", name: long });
    expect(safe.length).toBeGreaterThanOrEqual(1);
    expect(safe.length).toBeLessThanOrEqual(SPEC.maxFilenameLen);
  });
});
