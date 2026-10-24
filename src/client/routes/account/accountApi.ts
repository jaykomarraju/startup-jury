/**
 * W6-B — the account wizard's calls. Kept beside the screen rather than in
 * `src/client/api.ts` (a file every wave touches) so this session owns every
 * line it depends on.
 */
import type { PublishedPriceBook } from "../../../shared/priceBook";
import type { BillingAddress, BillingLocale, FreeTrialStatus } from "../../../shared/plans";
import type {
  AccountOrderView,
  AccountProfile,
  FieldErrors,
  OrgDetails,
  PaymentMethod,
} from "../../../shared/accountOrder";

/**
 * V6 · what `GET /api/account` serves for `#acs-billing` — the four captured
 * fields, each null until the screen has been filled, plus the ONE resolved
 * answer about currency and tax.
 *
 * `locale.currency` is null when no billing country is on file. That is the
 * screens' cue that the step has not been taken, and it is **not** a default:
 * `POST /orders` enforces the currency only once a country exists.
 */
export interface AccountBillingView {
  name: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
  locale: BillingLocale;
}

export interface AccountState {
  profile: AccountProfile;
  saved: boolean;
  billing: AccountBillingView;
  orders: AccountOrderView[];
  paymentConfigured: boolean;
  /** P2 — the free trial as `credit_ledger` records it. */
  trial: FreeTrialStatus;
  /** P2 — `org_settings.credits_balance`, what an upload spends. */
  balance: number;
}

/** What `POST /api/account/trial` answers, granted or already taken. */
export interface TrialResult {
  /** True when THIS call granted the trial; false when the workspace already had one. */
  granted: boolean;
  trial: FreeTrialStatus;
  balance: number;
}

export interface OrderResult {
  ok: true;
  order: AccountOrderView;
  completed: false;
  creditsGranted: 0;
  checkout: { hosted: boolean; url: string | null };
  message: string;
}

export class AccountApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors;
  constructor(status: number, body: { error?: string; fields?: FieldErrors }) {
    super(body.error ?? `request failed: ${status}`);
    this.status = status;
    this.code = body.error ?? "request_failed";
    this.fields = body.fields ?? {};
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; fields?: FieldErrors };
  if (!res.ok) throw new AccountApiError(res.status, body);
  return body;
}

export const getAccount = () => call<AccountState>("/api/account");

/**
 * P2 — take the free trial. `409 trial_already_taken` is not an error to the
 * screen: it means the workspace has its trial (a second tab, a double tap), and
 * the body carries that trial so the screen can simply show it.
 */
export async function takeTrial(): Promise<TrialResult> {
  const res = await fetch("/api/account/trial", { method: "POST", credentials: "include" });
  const body = (await res.json().catch(() => ({}))) as Partial<TrialResult> & {
    error?: string;
    fields?: FieldErrors;
  };
  const taken = res.status === 409 && body.error === "trial_already_taken";
  if ((res.ok || taken) && body.trial && typeof body.balance === "number") {
    return { granted: res.ok, trial: body.trial, balance: body.balance };
  }
  throw new AccountApiError(res.status, body);
}

/** The live catalogue — the only place the wizard reads a price from. */
export const getPublishedCatalogue = () => call<PublishedPriceBook>("/api/pricing/published");

export interface ProfileInput extends Omit<AccountProfile, "org"> {
  org?: OrgDetails;
}

export const saveProfile = (input: ProfileInput) =>
  call<{ ok: true; profile: AccountProfile }>("/api/account/profile", {
    method: "PUT",
    body: JSON.stringify(input),
  });

/**
 * V6 · `#acs-billing` saves ONLY itself.
 *
 * `PATCH /api/account/profile`, not the `PUT` above: the billing screen draws
 * four fields and re-sending the whole Account screen from here would let the
 * payment step fail on a validation error belonging to a screen three steps
 * back — on a phone, where this flow actually happens, that is a dead end.
 * A 400 comes back as `invalid_billing_address` with per-field messages, which
 * `AccountApiError.fields` hands straight to the screen.
 */
export const saveBillingAddress = (billing: BillingAddress) =>
  call<{ ok: true; profile: AccountProfile; billing: AccountBillingView }>("/api/account/profile", {
    method: "PATCH",
    body: JSON.stringify({ billing }),
  });

export const placeOrder = (input: {
  planCode: string;
  currency: string;
  paymentMethod: PaymentMethod;
  /** V3-PT — units of the plan (a paid-trial pack's deck count). Defaults to 1. */
  quantity?: number;
  /** V3-PT — extra decks taken beside a seat, priced by the server. */
  extraCredits?: number;
}) =>
  call<OrderResult>("/api/account/orders", { method: "POST", body: JSON.stringify(input) });

/**
 * P2 — one order, as the receipt shows it. The provider's return lands on
 * `/app/account?order=<id>`; the server applies a payment nobody has reported
 * yet before answering (`reconcileIntent`), so this is the paid state when the
 * customer has paid.
 */
export const getOrder = (id: string) =>
  call<AccountOrderView>(`/api/account/orders/${encodeURIComponent(id)}`);

/**
 * P2 — send the customer to the provider's hosted page. Only an `https:` URL
 * the SERVER returned is followed; anything else is left to the receipt's own
 * "Continue to secure payment" link, which shows the URL it would open.
 * A function of its own so a test can observe the navigation jsdom cannot make.
 */
export function openCheckout(url: string): boolean {
  if (!/^https:\/\//i.test(url)) return false;
  window.location.assign(url);
  return true;
}

export const orderDocumentUrl = (id: string) =>
  `/api/account/orders/${encodeURIComponent(id)}/document`;
