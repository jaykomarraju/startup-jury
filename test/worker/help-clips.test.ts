/**
 * `GET /api/help/clips/:clipId` — the JURYbuddy clip stream (V3 item 15).
 *
 * The route's whole job is to keep 5.86 MB of video out of the bundle, so what
 * matters is: it needs a session, it 404s rather than 500s when the object is
 * absent (which is TRUE TODAY — the clips are uploaded to R2 by hand), it cannot
 * be talked out of the `help/clips/` prefix, and it honours a Range so `<video>`
 * can seek.
 */
import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

const BASE = "https://example.com";
const INC_JURY = "rajesh.kumar@demo.startupjury.ai";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

const clip = (id: string, cookie: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${BASE}/api/help/clips/${id}`, { headers: { cookie, ...headers } });

// 16 bytes, so a Range assertion has something unambiguous to slice.
const BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const PRESENT = "test_clip_present";

describe("help clips", () => {
  beforeAll(async () => {
    await env.HELP_MEDIA!.put(`help/clips/${PRESENT}.mp4`, BYTES);
  });

  it("streams a stored clip to any authenticated role", async () => {
    const jury = await login(INC_JURY);
    const res = await clip(PRESENT, jury);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    // Product media behind a session — a shared cache must not hold it.
    expect(res.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it("needs a session", async () => {
    const res = await clip(PRESENT, "");
    expect(res.status).toBe(401);
  });

  it("404s when the clip is not in R2 — the state the app ships in today", async () => {
    const jury = await login(INC_JURY);
    const res = await clip("faq_clip_1", jury);
    expect(res.status).toBe(404);
    // A 404, never a 500: the Help screen renders the answer text without a
    // player, so an un-uploaded clip is a missing video, not a broken screen.
    expect((await res.json()) as { error: string }).toEqual({ error: "no_clip" });
  });

  /**
   * `CLIP_ID` must reject BEFORE R2 is touched. Asserted against objects that
   * really are in the bucket, because a plain "does it 404" check would pass
   * with the guard deleted — R2 keys are flat strings, so a traversal id simply
   * names a key that does not exist. These ids name keys that DO.
   */
  it("refuses an id outside the manifest's shape, even when that key exists", async () => {
    const jury = await login(INC_JURY);
    const reachableOnlyIfUnguarded = ["UPPER", "has-dash", "has.dot", "../../decks/secret"];
    for (const bad of reachableOnlyIfUnguarded) {
      await env.HELP_MEDIA!.put(`help/clips/${bad}.mp4`, BYTES);
    }
    for (const bad of reachableOnlyIfUnguarded) {
      const res = await clip(encodeURIComponent(bad), jury);
      expect(res.status, `id ${JSON.stringify(bad)}`).toBe(404);
    }
    // The control: those objects are genuinely there, so the 404s above came
    // from the guard and not from an empty bucket.
    for (const bad of reachableOnlyIfUnguarded) {
      expect(await env.HELP_MEDIA!.get(`help/clips/${bad}.mp4`), bad).not.toBeNull();
    }
  });

  it("serves a byte range so the player can seek", async () => {
    const jury = await login(INC_JURY);
    const res = await clip(PRESENT, jury, { range: "bytes=4-7" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 4-7/16");
    expect(res.headers.get("content-length")).toBe("4");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES.slice(4, 8));
  });

  it("an open-ended range runs to the end of the object", async () => {
    const jury = await login(INC_JURY);
    const res = await clip(PRESENT, jury, { range: "bytes=12-" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 12-15/16");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES.slice(12));
  });

  /**
   * The bug three independent auditors found at wave integration (plan §12.9).
   * A `<video>` asks for a fixed first chunk — `bytes=0-524287` — whatever the
   * clip's real length. R2 clamps the READ to the bytes that exist; the headers
   * were computed from the requested `end`, so the response promised 524,288
   * bytes and wrote 16. A player treats that short read as a broken stream.
   */
  it("clamps a range that overruns the end of the clip to the bytes that exist", async () => {
    const jury = await login(INC_JURY);
    const res = await clip(PRESENT, jury, { range: "bytes=0-99" });
    expect(res.status).toBe(206);
    // The headers must describe the BODY, not the request.
    expect(res.headers.get("content-range")).toBe("bytes 0-15/16");
    expect(res.headers.get("content-length")).toBe("16");
    const got = new Uint8Array(await res.arrayBuffer());
    expect(got).toEqual(BYTES);
    // The assertion that actually binds the two together: whatever we promised,
    // that is what arrived. Without the clamp this reads 100 vs 16.
    expect(Number(res.headers.get("content-length"))).toBe(got.byteLength);
  });

  it("clamps an overrunning range that starts mid-object too", async () => {
    const jury = await login(INC_JURY);
    const res = await clip(PRESENT, jury, { range: "bytes=12-4095" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 12-15/16");
    const got = new Uint8Array(await res.arrayBuffer());
    expect(got).toEqual(BYTES.slice(12));
    expect(Number(res.headers.get("content-length"))).toBe(got.byteLength);
  });

  it("answers 416, not 500, for a range that cannot be satisfied", async () => {
    const jury = await login(INC_JURY);
    // Backwards — rejected by inspection, before R2 is asked.
    expect((await clip(PRESENT, jury, { range: "bytes=10-5" })).status).toBe(416);
    // Starts past the end of a 16-byte object — R2 THROWS on this rather than
    // returning null, so without the catch it would surface as a 500.
    const past = await clip(PRESENT, jury, { range: "bytes=99-120" });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */16");
  });

  it("falls back to the whole object for a range form R2 cannot slice", async () => {
    const jury = await login(INC_JURY);
    // A suffix range (`bytes=-4`) is legal HTTP the route deliberately does not
    // implement; 200 with everything is a correct answer, and `<video>` copes.
    const res = await clip(PRESENT, jury, { range: "bytes=-4" });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });
});
