import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("GET /api/health", () => {
  it("returns ok with the service name", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("startup-jury");
  });
});

describe("unknown API route", () => {
  it("returns a JSON 404, not the SPA", async () => {
    const res = await SELF.fetch("https://example.com/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
