import { env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import {
  credentialRefFor,
  describeAttempt,
  esignDeliveryConfigured,
  isCredentialRef,
  recordESignAttempt,
  resolveESignClient,
  secretFor,
  type ESignClient,
} from "../../src/server/esign/provider";
import type { Env } from "../../src/server/types";

/**
 * W5-B — the e-signature provider interface and its recording stub (§1.3),
 * tested directly.
 *
 * The contract, in one line: **an attempt is recorded, not performed.** Which
 * gives three things to prove — nothing is dispatched, the row that lands says
 * `'recorded'` rather than `'sent'`, and a deployment that has set a secret but
 * registered no adapter still records rather than claiming a delivery it cannot
 * make.
 *
 * `'sent'` and `'failed'` are unreachable on the shipped build by design
 * (`ADAPTERS` is empty), so they are exercised through the same injected-client
 * seam `recordSyncAttempt` takes — otherwise the two branches that will matter
 * most on the day a provider is configured would never have been run.
 *
 * This file lives under the WORKER tsconfig, not test/unit: the module imports
 * `Env`. Storage is shared across the file, so each test uses its own sign-up
 * or none at all.
 */

const E = () => env as unknown as Env;

/** A live record (`0034` back-fills it) to hang attempts off. */
const SIGNUP = "su_inc_deck_meera_signup";

function stubClient(over: Partial<ESignClient> = {}): ESignClient {
  return {
    provider: "DocuSign",
    createEnvelope: vi.fn(async () => ({ reference: "env_live_9f2a" })),
    fetchStatus: vi.fn(async () => ({ completed: false, signedAt: null })),
    voidEnvelope: vi.fn(async () => {}),
    ...over,
  };
}

describe("resolveESignClient", () => {
  it("returns null on a deployment with no credential — the shipped build", () => {
    expect(resolveESignClient(E(), "DocuSign")).toBeNull();
    expect(esignDeliveryConfigured(E(), "DocuSign")).toBe(false);
  });

  it("still returns null when a secret IS set, because no adapter is registered", () => {
    // The honest outcome of §1.3: setting the secret without shipping an adapter
    // must not start reporting 'sent'.
    const withSecret = { ...E(), ESIGN_DOCUSIGN_TOKEN: "live-token-abc" } as unknown as Env;
    expect(secretFor(withSecret, credentialRefFor("DocuSign"))).toBe("live-token-abc");
    expect(resolveESignClient(withSecret, "DocuSign")).toBeNull();
  });

  it("derives the credential reference from the provider, and refuses anything else", () => {
    expect(credentialRefFor("eMudhra")).toBe("ESIGN_EMUDHRA_TOKEN");
    expect(isCredentialRef("ESIGN_DOCUSIGN_TOKEN")).toBe(true);
    // The containment `crm/provider.ts` explains: a ref may never name another
    // binding, so no adapter can reach the model key.
    expect(isCredentialRef("ANTHROPIC_API_KEY")).toBe(false);
    expect(secretFor({ ...E(), ANTHROPIC_API_KEY: "sk-x" } as unknown as Env, "ANTHROPIC_API_KEY")).toBeUndefined();
  });
});

describe("recordESignAttempt", () => {
  it("records rather than sends, with a recognisable stub reference", async () => {
    const record = await recordESignAttempt(E(), {
      kind: "envelope_create",
      signupId: SIGNUP,
      agreementId: null,
      provider: "SignDesk",
      sigType: "standard",
      recipients: ["founder@example.com"],
      documentName: "Incubation Agreement",
      dedupeKey: "test:record-not-send",
    });
    expect(record.status).toBe("recorded");
    expect(record.error).toBeNull();
    expect(record.providerReference).toMatch(/^stub:signdesk:/);
    expect(describeAttempt(record)).toBe(
      "Recorded — no e-signature provider is configured, so nothing was sent to SignDesk.",
    );

    const row = await env.DB.prepare(
      "SELECT kind, provider, sig_type, status, recipients_json, document_name FROM esign_outbox WHERE id = ?",
    )
      .bind(record.id)
      .first<Record<string, string>>();
    expect(row).toMatchObject({
      kind: "envelope_create",
      provider: "SignDesk",
      sig_type: "standard",
      status: "recorded",
      document_name: "Incubation Agreement",
    });
    expect(JSON.parse(row!.recipients_json)).toEqual(["founder@example.com"]);
  });

  it("reports 'sent' with the provider's reference when a client IS configured", async () => {
    const client = stubClient();
    const record = await recordESignAttempt(
      E(),
      {
        kind: "envelope_create",
        signupId: SIGNUP,
        agreementId: null,
        provider: "DocuSign",
        sigType: "certificate",
        recipients: ["founder@example.com"],
        documentName: "Term Sheet",
        dedupeKey: "test:sent",
      },
      () => "2026-09-12T10:00:00.000Z",
      client,
    );
    expect(record.status).toBe("sent");
    expect(record.providerReference).toBe("env_live_9f2a");
    expect(client.createEnvelope).toHaveBeenCalledWith({
      documentName: "Term Sheet",
      recipients: ["founder@example.com"],
      sigType: "certificate",
    });
    expect(describeAttempt(record)).toBe("Sent to DocuSign for signature.");
  });

  it("degrades a provider failure to an auditable row rather than throwing", async () => {
    const client = stubClient({
      createEnvelope: vi.fn(async () => {
        throw new Error("envelope quota exceeded");
      }),
    });
    const record = await recordESignAttempt(
      E(),
      {
        kind: "envelope_create",
        signupId: SIGNUP,
        agreementId: null,
        provider: "Zoho",
        sigType: "standard",
        recipients: [],
        documentName: null,
        dedupeKey: "test:failed",
      },
      undefined,
      client,
    );
    expect(record.status).toBe("failed");
    expect(record.error).toBe("Error: envelope quota exceeded");
    expect(describeAttempt(record)).toContain("Zoho Sign refused the request");
    const row = await env.DB.prepare("SELECT status, error FROM esign_outbox WHERE id = ?")
      .bind(record.id)
      .first<{ status: string; error: string }>();
    expect(row!.status).toBe("failed");
  });

  it("never records a credential, even when the provider error echoes one", async () => {
    const client = stubClient({
      createEnvelope: vi.fn(async () => {
        // A provider that helpfully quotes the request back at you.
        const err = new Error("401 for token live-token-abc");
        err.name = "AuthError";
        throw err;
      }),
    });
    const record = await recordESignAttempt(
      E(),
      {
        kind: "envelope_create",
        signupId: SIGNUP,
        agreementId: null,
        provider: "Adobe",
        sigType: "standard",
        recipients: [],
        documentName: null,
        dedupeKey: "test:credential-echo",
      },
      undefined,
      client,
    );
    // The message is kept because an operator needs it — what is NOT kept is
    // any request body, which is the only place a credential could travel.
    expect(record.error).toBe("AuthError: 401 for token live-token-abc");
    const row = await env.DB.prepare("SELECT * FROM esign_outbox WHERE id = ?")
      .bind(record.id)
      .first<Record<string, unknown>>();
    expect(Object.keys(row!)).not.toContain("payload_json");
    expect(Object.keys(row!)).not.toContain("credential");
  });

  it("is idempotent on its dedupe key — a retry returns the row that won", async () => {
    const attempt = {
      kind: "founder_signature" as const,
      signupId: SIGNUP,
      agreementId: null,
      provider: "SignDesk" as const,
      sigType: "standard" as const,
      recipients: ["founder@example.com"],
      documentName: "Once only",
      dedupeKey: "test:dedupe-once",
    };
    const first = await recordESignAttempt(E(), attempt);
    const second = await recordESignAttempt(E(), attempt);
    expect(second.id).toBe(first.id);
    expect(second.deduped).toBe(true);
    const n = await env.DB.prepare(
      "SELECT COUNT(*) n FROM esign_outbox WHERE dedupe_key = 'test:dedupe-once'",
    ).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("records an unkeyed attempt every time — only a key makes it once-only", async () => {
    const attempt = {
      kind: "void" as const,
      signupId: SIGNUP,
      agreementId: null,
      provider: "Zoho" as const,
      sigType: "standard" as const,
      recipients: [],
      documentName: "Twice",
    };
    const a = await recordESignAttempt(E(), attempt);
    const b = await recordESignAttempt(E(), attempt);
    expect(b.id).not.toBe(a.id);
    expect(b.deduped).toBeUndefined();
  });
});
