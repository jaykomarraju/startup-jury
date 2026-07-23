import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { sendEmail, buildQueryEmail, buildSignupEmail } from "../../src/server/email/outbox";
import type { Env } from "../../src/server/types";

// This file lives under the WORKER tsconfig (not test/unit): outbox.ts imports
// `Env`, which references R2Bucket/Queue and needs @cloudflare/workers-types.

describe("buildQueryEmail (pure)", () => {
  it("personalises the greeting and embeds the questions", () => {
    const { subject, body } = buildQueryEmail({
      deckName: "GreenGrid",
      founderName: "Meera",
      questions: "What is your MRR?",
    });
    expect(subject).toContain("GreenGrid");
    expect(body).toContain("Hi Meera,");
    expect(body).toContain("What is your MRR?");
  });

  it("falls back to a neutral greeting when the founder is unknown", () => {
    const { body } = buildQueryEmail({ deckName: "GreenGrid", founderName: null, questions: "q" });
    expect(body).toContain("Hi,");
  });
});

describe("buildSignupEmail (pure)", () => {
  it("congratulates the founder and names the deck", () => {
    const { subject, body } = buildSignupEmail({ deckName: "GreenGrid", founderName: "Meera" });
    expect(subject).toContain("GreenGrid");
    expect(body).toContain("Congratulations Meera!");
  });
});

describe("sendEmail (stubbed outbox)", () => {
  it("persists a row with status 'sent' and returns it", async () => {
    const sent = await sendEmail(
      env as Env,
      {
        kind: "founder_query",
        toEmail: "founder@demo.io",
        toName: "Ada",
        subject: "hi",
        body: "body",
      },
      () => "2026-07-22T00:00:00Z",
    );
    expect(sent.status).toBe("sent");
    expect(sent.id).toMatch(/^mail_/);

    const row = await env.DB.prepare(
      "SELECT to_email, kind, status, created_at FROM email_outbox WHERE id = ?",
    )
      .bind(sent.id)
      .first<{ to_email: string; kind: string; status: string; created_at: string }>();
    expect(row).toMatchObject({
      to_email: "founder@demo.io",
      kind: "founder_query",
      status: "sent",
      created_at: "2026-07-22T00:00:00Z",
    });
  });
});
