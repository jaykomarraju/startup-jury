/**
 * P2 (23-Oct tracker, row 12 — "Payment gateway") — the Razorpay adapter.
 *
 * A **Payment Link**, which is the shape `provider.ts`'s seam was cut to in W4-C:
 * one server call that returns a page Razorpay hosts, a reference that comes
 * back signed, and nothing card-shaped anywhere in this application (§1.2).
 *
 *   createCheckout  POST /v1/payment_links       → `short_url`, `plink_…`
 *   verifyReturn    the customer's redirect back  → HMAC over four query params
 *   verifyWebhook   `payment_link.paid` et al.    → HMAC over the RAW body
 *   lookup          GET  /v1/payment_links/:id    → for a return and a webhook that both went missing
 *
 * The contract, as Razorpay documents it (read 2026-10-23, docs cited in the
 * lane report) and as `razorpay-node`'s `validatePaymentVerification` implements it:
 *
 *   • API auth is HTTP Basic with `key_id:key_secret` — which is also the one
 *     secret this deployment stores, as `PAYMENTS_RAZORPAY_KEY` (`provider.ts`
 *     fixes the name). No key is in this repository.
 *   • The callback appends `razorpay_payment_id`, `razorpay_payment_link_id`,
 *     `razorpay_payment_link_reference_id`, `razorpay_payment_link_status` and
 *     `razorpay_signature` = hex HMAC-SHA256 of
 *     `link_id|reference_id|status|payment_id`, keyed with the KEY SECRET.
 *   • A webhook carries `X-Razorpay-Signature` = hex HMAC-SHA256 of the raw
 *     body, keyed with the WEBHOOK secret (`PAYMENTS_RAZORPAY_WEBHOOK_SECRET`),
 *     which is a different secret set in Razorpay's dashboard.
 *
 * Three choices, each the safer of two:
 *
 *   • `accept_partial: false`. A partially paid link is money taken for a
 *     purchase that cannot be granted in full — exactly the third state the
 *     brief forbids. With partial payments off, "paid" means the whole amount.
 *   • The return is verified AND then looked up. The signature proves Razorpay
 *     sent the customer back; it does not carry the amount. The lookup is the
 *     provider's own statement of what was paid, and `fulfilment.ts` refuses to
 *     grant on any amount but the intent's.
 *   • No SDK. `razorpay` on npm is a Node library (`crypto.createHmac`, `https`);
 *     the Worker has `fetch` and Web Crypto, and §1.3 keeps vendors off the
 *     critical path anyway.
 */
import type {
  PaymentAdapter,
  PaymentConfirmation,
  WebhookVerdict,
} from "./provider";

const API = "https://api.razorpay.com/v1";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Calling the global `fetch` detached from `globalThis` throws "Illegal
 * invocation" in workerd, so the default is a closure rather than `fetch` itself.
 */
const globalFetch: Fetch = (input, init) => fetch(input, init);

// ── Small, honest JSON readers — no cast stands in for a check ──────────────

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(o: Json, key: string): string | null {
  const v = o[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
function int(o: Json, key: string): number | null {
  const v = o[key];
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}
function child(o: Json, ...path: string[]): Json | null {
  let at: unknown = o;
  for (const key of path) {
    if (!isObject(at)) return null;
    at = at[key];
  }
  return isObject(at) ? at : null;
}

// ── Crypto ───────────────────────────────────────────────────────────────────

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Equal-time comparison, so a forged signature learns nothing from the timing. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Reading a link ───────────────────────────────────────────────────────────

/**
 * A paid link as a confirmation, or null when it is not fully paid. Used by both
 * the API lookup and the webhook, whose `payment_link.entity` is the same object.
 */
function confirmationOf(link: Json, paymentId: string | null): PaymentConfirmation | null {
  const providerRef = str(link, "id");
  const reference = str(link, "reference_id");
  const amountPaid = int(link, "amount_paid");
  const amount = int(link, "amount");
  const currency = str(link, "currency");
  if (str(link, "status") !== "paid") return null;
  if (!providerRef || !reference || amountPaid === null || amount === null || !currency) return null;
  // Partial payments are off at creation; a link that says "paid" for less than
  // its amount is not a state this application can grant against.
  if (amountPaid !== amount) return null;
  const pay =
    paymentId ??
    (() => {
      const payments = link.payments;
      if (!Array.isArray(payments)) return null;
      for (const p of payments) {
        if (isObject(p) && str(p, "status") === "captured") return str(p, "payment_id");
      }
      return null;
    })();
  if (!pay) return null;
  return { reference, providerRef, paymentId: pay, amountMinor: amountPaid, currency };
}

/**
 * The Razorpay adapter, or null when the credential is not `key_id:key_secret`.
 * `fetchImpl` is the test seam; production passes nothing.
 */
export function razorpayAdapter(
  credential: string,
  webhookSecret: string | undefined,
  fetchImpl: Fetch = globalFetch,
): PaymentAdapter | null {
  const at = credential.indexOf(":");
  const keyId = at > 0 ? credential.slice(0, at).trim() : "";
  const keySecret = at > 0 ? credential.slice(at + 1).trim() : "";
  if (!keyId || !keySecret) return null;
  const auth = `Basic ${btoa(`${keyId}:${keySecret}`)}`;

  async function api(path: string, init: RequestInit = {}): Promise<Json> {
    const res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { authorization: auth, "content-type": "application/json" },
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok || !isObject(body)) {
      // Razorpay's own `error.description` — never the request, which carries the amount
      // and, through `auth`, would carry the key if it were echoed.
      const reason = isObject(body) ? str(child(body, "error") ?? {}, "description") : null;
      throw new Error(`razorpay ${res.status}${reason ? `: ${reason}` : ""}`);
    }
    return body;
  }

  async function lookup(providerRef: string): Promise<PaymentConfirmation | null> {
    if (!/^plink_[A-Za-z0-9]+$/.test(providerRef)) return null;
    return confirmationOf(await api(`/payment_links/${providerRef}`), null);
  }

  return {
    provider: "razorpay",

    async createCheckout(req) {
      const link = await api("/payment_links", {
        method: "POST",
        body: JSON.stringify({
          amount: req.amountMinor,
          currency: req.currency,
          accept_partial: false,
          // `pi_<uuid>` is 39 characters; Razorpay's limit is 40.
          reference_id: req.reference,
          description: req.description.slice(0, 2048),
          callback_url: req.returnUrl,
          callback_method: "get",
          notes: { intent: req.reference },
        }),
      });
      const url = str(link, "short_url");
      const id = str(link, "id");
      if (!url || !id) throw new Error("razorpay: payment link created without a url");
      return { url, providerRef: id };
    },

    async verifyReturn(query) {
      const paymentId = query.get("razorpay_payment_id");
      const linkId = query.get("razorpay_payment_link_id");
      const reference = query.get("razorpay_payment_link_reference_id");
      const status = query.get("razorpay_payment_link_status");
      const signature = query.get("razorpay_signature");
      if (!paymentId || !linkId || !reference || !status || !signature) return null;
      const expected = await hmacHex(keySecret, `${linkId}|${reference}|${status}|${paymentId}`);
      if (!sameHex(expected, signature.toLowerCase())) return null;
      if (status !== "paid") return null;
      // Signed, so Razorpay did send this customer back paid. The AMOUNT is not in
      // the signature; ask for it rather than assume it.
      const confirmed = await lookup(linkId);
      if (!confirmed || confirmed.reference !== reference) return null;
      return { ...confirmed, paymentId };
    },

    async verifyWebhook(rawBody, headers): Promise<WebhookVerdict> {
      const signature = headers.get("x-razorpay-signature");
      if (!webhookSecret || !signature) return { kind: "unverified" };
      const expected = await hmacHex(webhookSecret, rawBody);
      if (!sameHex(expected, signature.toLowerCase())) return { kind: "unverified" };

      let event: unknown;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return { kind: "unverified" };
      }
      if (!isObject(event)) return { kind: "unverified" };
      const name = str(event, "event") ?? "";
      const link = child(event, "payload", "payment_link", "entity");
      if (name === "payment_link.paid" && link) {
        const payment = child(event, "payload", "payment", "entity");
        const confirmation = confirmationOf(link, payment ? str(payment, "id") : null);
        return confirmation ? { kind: "paid", confirmation } : { kind: "ignored", event: name };
      }
      if ((name === "payment_link.expired" || name === "payment_link.cancelled") && link) {
        const reference = str(link, "reference_id");
        const providerRef = str(link, "id");
        if (reference && providerRef) return { kind: "closed", reference, providerRef };
      }
      return { kind: "ignored", event: name };
    },

    lookup,
  };
}
