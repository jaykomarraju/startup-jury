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
