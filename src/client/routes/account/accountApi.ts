/**
 * W6-B — the account wizard's calls. Kept beside the screen rather than in
 * `src/client/api.ts` (a file every wave touches) so this session owns every
 * line it depends on.
 */
import type { PublishedPriceBook } from "../../../shared/priceBook";
import type {
  AccountOrderView,
  AccountProfile,
  FieldErrors,
  OrgDetails,
  PaymentMethod,
} from "../../../shared/accountOrder";

export interface AccountState {
  profile: AccountProfile;
  saved: boolean;
  orders: AccountOrderView[];
  paymentConfigured: boolean;
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

export const placeOrder = (input: { planCode: string; currency: string; paymentMethod: PaymentMethod }) =>
  call<OrderResult>("/api/account/orders", { method: "POST", body: JSON.stringify(input) });

export const orderDocumentUrl = (id: string) =>
  `/api/account/orders/${encodeURIComponent(id)}/document`;
