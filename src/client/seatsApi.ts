// W6-C — typed calls for `/api/seats` (the Set up wizard's Team step and its
// Buy additional seats sub-flow). Kept beside `api.ts` rather than in it: that
// file is shared by every lane, and this one is the seat lane's alone.
import { ApiError } from "./api";
import type { SeatQuantities, SeatPurchaseResult, SeatsView, SeatTier } from "../shared/seats";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

export function getSeats(): Promise<SeatsView> {
  return call<SeatsView>("/api/seats");
}

export interface AddSeatMemberInput {
  email: string;
  role: string;
  tier: SeatTier;
  /** The VC edition's "Designation" — stored as the member's organisational title. */
  title?: string;
}

export interface AddSeatMemberResult {
  ok: true;
  user: { id: string; email: string; tier: SeatTier };
  /** Present only when the invite could not actually be emailed. */
  tempPassword?: string;
  invite: { delivered: boolean; status: string };
  seats: SeatsView;
}

export function addSeatMember(input: AddSeatMemberInput): Promise<AddSeatMemberResult> {
  return call<AddSeatMemberResult>("/api/seats/members", { method: "POST", body: JSON.stringify(input) });
}

export function setMemberTier(id: string, tier: SeatTier): Promise<{ ok: true; seats: SeatsView }> {
  return call(`/api/seats/members/${encodeURIComponent(id)}/tier`, {
    method: "PUT",
    body: JSON.stringify({ tier }),
  });
}

export function purchaseSeats(quantities: SeatQuantities): Promise<SeatPurchaseResult> {
  return call<SeatPurchaseResult>("/api/seats/purchase", {
    method: "POST",
    body: JSON.stringify({ quantities }),
  });
}
