import { env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import {
  sendEmail,
  buildQueryEmail,
  buildSignupEmail,
  buildIncompleteEmail,
  buildCallInviteEmail,
  type EmailSender,
} from "../../src/server/email/outbox";
import type { Env } from "../../src/server/types";

// This file lives under the WORKER tsconfig (not test/unit): outbox.ts imports
// `Env`, which references R2Bucket/Queue and needs @cloudflare/workers-types.
//
// NB storage is isolated per FILE, not per test — writes accumulate across the
// `it`s below, so every fixture uses a unique dedupe key / recipient.

/** An Env with a stub Cloudflare Email Sending binding wired in. */
function withSender(sender: EmailSender, from = "no-reply@example.test"): Env {
  return { ...(env as unknown as Env), EMAIL: sender, EMAIL_FROM: from };
}

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

describe("buildIncompleteEmail (pure)", () => {
  const link = "https://app.example/resubmit/abc123";

  it("names the deck, the missing details, the missing sections and the link", () => {
    const { subject, body, html } = buildIncompleteEmail({
      deckName: "NimbusHR",
      founderName: "Meera",
      missingFields: ["founderPhone", "city"],
      missingSections: ["Traction", "Team"],
      link,
      orgName: "Sunrise Incubator",
    });

    expect(subject).toBe("Action needed: NimbusHR is incomplete");
    expect(body).toContain("Hi Meera,");
    expect(body).toContain("Sunrise Incubator");
    // Labelled from INTAKE_FIELD_LABELS, not raw field keys.
    expect(body).toContain("Phone, City");
    expect(body).not.toContain("founderPhone");
    expect(body).toContain("Traction, Team");
    expect(body).toContain(link);

    // The HTML alternative carries the same facts plus a real anchor.
    expect(html).toContain(`href="${link}"`);
    expect(html).toContain("NimbusHR");
    expect(html).toContain("Phone, City");
  });

  it("omits the bullet list entirely when nothing specific is known", () => {
    const { body, html } = buildIncompleteEmail({
      deckName: "NimbusHR",
      founderName: null,
      missingFields: [],
      missingSections: [],
      link,
    });
    expect(body).toContain("Hi,");
    expect(body).toContain("the programme"); // orgName fallback
    expect(body).not.toContain("  • ");
    expect(html).not.toContain("<ul");
    // The call to action survives regardless.
    expect(body).toContain(link);
  });

  it("escapes HTML-significant characters in interpolated values", () => {
    const { html } = buildIncompleteEmail({
      deckName: '<script>alert("x")</script>',
      founderName: null,
      missingFields: [],
      missingSections: [],
      link,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("sendEmail — audit-only path (no binding configured)", () => {
  it("records status 'recorded' rather than claiming a delivery", async () => {
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
    expect(sent.status).toBe("recorded");
    expect(sent.id).toMatch(/^mail_/);

    const row = await env.DB.prepare(
      "SELECT to_email, kind, status, created_at, error, provider_id FROM email_outbox WHERE id = ?",
    )
      .bind(sent.id)
      .first<{
        to_email: string;
        kind: string;
        status: string;
        created_at: string;
        error: string | null;
        provider_id: string | null;
      }>();
    expect(row).toMatchObject({
      to_email: "founder@demo.io",
      kind: "founder_query",
      status: "recorded",
      created_at: "2026-07-22T00:00:00Z",
      error: null,
      provider_id: null,
    });
  });
});

describe("sendEmail — real delivery (Cloudflare Email Sending)", () => {
  it("sends through the binding and records status 'sent' with the provider id", async () => {
    let payload: Parameters<EmailSender["send"]>[0] | null = null;
    const send = vi.fn(async (m: Parameters<EmailSender["send"]>[0]) => {
      payload = m;
      return { messageId: "cf-msg-1" };
    });
    const sent = await sendEmail(withSender({ send }), {
      kind: "incomplete_resubmit",
      toEmail: "founder@real.io",
      toName: "Ada",
      subject: "Action needed",
      body: "text body",
      html: "<p>html body</p>",
    });

    expect(sent.status).toBe("sent");
    expect(sent.providerId).toBe("cf-msg-1");
    expect(send).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({
      to: "founder@real.io",
      from: { email: "no-reply@example.test", name: "ai.STARTUPJURY" },
      subject: "Action needed",
      text: "text body",
      html: "<p>html body</p>",
    });

    const row = await env.DB.prepare("SELECT status, provider_id FROM email_outbox WHERE id = ?")
      .bind(sent.id)
      .first<{ status: string; provider_id: string | null }>();
    expect(row).toMatchObject({ status: "sent", provider_id: "cf-msg-1" });
  });

  it("does not attempt a send when EMAIL_FROM is unset, even with a binding", async () => {
    const send = vi.fn(async () => ({ messageId: "never" }));
    const sent = await sendEmail(withSender({ send }, ""), {
      kind: "signup_invite",
      toEmail: "founder@nofrom.io",
      subject: "s",
      body: "b",
    });
    expect(send).not.toHaveBeenCalled();
    expect(sent.status).toBe("recorded");
  });

  it("records status 'failed' with the reason instead of throwing", async () => {
    const send = vi.fn(async () => {
      throw new Error("E_SENDER_NOT_VERIFIED");
    });
    const sent = await sendEmail(withSender({ send }), {
      kind: "incomplete_resubmit",
      toEmail: "founder@unverified.io",
      subject: "s",
      body: "b",
    });

    expect(sent.status).toBe("failed");
    expect(sent.error).toContain("E_SENDER_NOT_VERIFIED");

    const row = await env.DB.prepare("SELECT status, error FROM email_outbox WHERE id = ?")
      .bind(sent.id)
      .first<{ status: string; error: string | null }>();
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("E_SENDER_NOT_VERIFIED");
  });
});

describe("sendEmail — dedupe key", () => {
  it("sends once and returns the original row on every repeat", async () => {
    const send = vi.fn(async () => ({ messageId: "cf-dedupe" }));
    const e = withSender({ send });
    const payload = {
      kind: "incomplete_resubmit" as const,
      toEmail: "founder@dedupe.io",
      subject: "s",
      body: "b",
      dedupeKey: "incomplete:dedupe_deck:v2",
    };

    const first = await sendEmail(e, payload);
    const second = await sendEmail(e, payload);

    expect(first.deduped).toBeUndefined();
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(send).toHaveBeenCalledTimes(1);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE dedupe_key = ?",
    )
      .bind(payload.dedupeKey)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("treats a different key as a different message", async () => {
    const send = vi.fn(async () => ({ messageId: "cf-dedupe-2" }));
    const e = withSender({ send });
    await sendEmail(e, {
      kind: "incomplete_resubmit",
      toEmail: "founder@dedupe2.io",
      subject: "s",
      body: "b",
      dedupeKey: "incomplete:dedupe_deck2:v1",
    });
    await sendEmail(e, {
      kind: "incomplete_resubmit",
      toEmail: "founder@dedupe2.io",
      subject: "s",
      body: "b",
      dedupeKey: "incomplete:dedupe_deck2:v2",
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

// ── Session 7 — call invitations ─────────────────────────────────────────────

describe("buildCallInviteEmail", () => {
  const base = {
    deckName: "GreenRoute",
    callTitle: "GreenRoute — intro call",
    kindLabel: "Intro call",
    whenLabel: "Tue, 18 Aug 2026, 10:30 UTC",
    durationMinutes: 45,
    location: "Google Meet",
    organizerName: "Raj Kumar",
    participantNames: ["Raj Kumar", "Rajesh Kumar", "founder@greenroute.example"],
    notes: "Walk the founder through the cohort plan.",
  };

  it("states when, where, who — in both text and HTML", () => {
    const mail = buildCallInviteEmail(base);
    expect(mail.subject).toBe("Invitation: GreenRoute — intro call");
    expect(mail.body).toContain("Tue, 18 Aug 2026, 10:30 UTC");
    expect(mail.body).toContain("45 min");
    expect(mail.body).toContain("Google Meet");
    expect(mail.body).toContain("Raj Kumar");
    expect(mail.body).toContain("founder@greenroute.example");
    expect(mail.body).toContain(".ics");
    expect(mail.html).toContain("<li");
    expect(mail.html).toContain("Google Meet");
  });

  it("switches to cancellation language", () => {
    const mail = buildCallInviteEmail({ ...base, cancelled: true });
    expect(mail.subject).toBe("Cancelled: GreenRoute — intro call");
    expect(mail.body).toContain("has been cancelled");
    expect(mail.body).toContain("removes it from your calendar");
    expect(mail.html).toContain("removes it from your calendar");
  });

  it("omits lines it has no value for", () => {
    const mail = buildCallInviteEmail({
      ...base,
      location: null,
      organizerName: null,
      participantNames: [],
      notes: null,
    });
    expect(mail.body).not.toContain("Where:");
    expect(mail.body).not.toContain("Organiser:");
    expect(mail.body).not.toContain("Participants:");
    expect(mail.body).not.toContain("Notes:");
  });

  it("escapes HTML in interpolated values", () => {
    const mail = buildCallInviteEmail({ ...base, location: '<script>alert("x")</script>' });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("says 'To be confirmed' via the caller's label when there's no date", () => {
    const mail = buildCallInviteEmail({ ...base, whenLabel: "To be confirmed" });
    expect(mail.body).toContain("When: To be confirmed");
  });
});

describe("sendEmail with attachments", () => {
  it("passes the .ics through to the binding and audits the message", async () => {
    const seen: { attachments?: { filename: string; type: string; content: string }[] }[] = [];
    const stub = {
      send: async (message: {
        attachments?: { filename: string; type: string; content: string }[];
      }) => {
        seen.push(message);
        return { messageId: "prov_1" };
      },
    };
    const sent = await sendEmail(
      { ...env, EMAIL: stub, EMAIL_FROM: "no-reply@example.com" } as unknown as typeof env,
      {
        kind: "call_invite",
        toEmail: "founder@anywhere.example",
        subject: "Invitation: X",
        body: "text",
        html: "<p>html</p>",
        attachments: [
          { content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", filename: "x.ics", type: "text/calendar" },
        ],
        dedupeKey: "call:test:s0:founder@anywhere.example",
      },
    );
    expect(sent.status).toBe("sent");
    expect(seen[0].attachments?.[0].filename).toBe("x.ics");
    expect(seen[0].attachments?.[0].content).toContain("BEGIN:VCALENDAR");
  });
});
