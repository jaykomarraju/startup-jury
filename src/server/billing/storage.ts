/**
 * V6-INVOICE — **10 GB of storage per seat**, as one number the product reads.
 *
 * `AISJ_MyAccount_V6.HTM` states the figure three times and never once as a
 * property of a plan:
 *
 *   `:2671`  "Add more seats (Standard / Pro / Premium — 10 GB storage each)"
 *   `:2674`  "1 Premium Seat (10 GB storage) — Annual · 125 Credits included"
 *   `:3271`  "'<b>'+t[1]+' seat (10 GB storage)</b>'"  ← inside a template string
 *
 * The third is the one that matters: in the prototype the allowance is *markup*,
 * interpolated into three plan rows by hand. Ported as-is that becomes the string
 * `"10 GB storage"` written into JSX in at least four screens (plan · annual ·
 * entplans · team), and the day the client raises it to 20 GB — or prices Premium
 * differently from Standard, which is the obvious next ask — the product says
 * both numbers at once on screens nobody remembers to grep.
 *
 * So the allowance is **carried with seat capacity**, not with copy.
 * `src/shared/seats.ts` is where a purchased seat is modelled (`SeatTier`,
 * `TierCounts`, `seatSummary`), and this module is the storage dimension of that
 * same model: a per-tier table, a sum over a tier count, and the two labels a
 * screen needs. No screen has to know the number to print it.
 *
 * ── WHY THIS FILE AND NOT `src/shared/seats.ts` ─────────────────────────────
 * `seats.ts` is the right permanent home — it is shared, so the plan screens
 * could import the constant directly instead of reading it off an API response.
 * It belongs to another lane this wave, so the number lives here (server-side,
 * where the invoice needs it) and is SERVED at `GET /api/billing` →
 * `storage`. The move is the first ask in `docs/parity-requests/V6-INVOICE.md`.
 *
 * ── V6 SPECIFIES NO PER-TIER DIFFERENCE, AND THE TABLE SAYS SO OUT LOUD ─────
 * "Standard / Pro / Premium — 10 GB storage each" is three equal values, which is
 * why `STORAGE_GB_BY_TIER` is a map of three tens rather than a bare constant. A
 * bare constant would have to be *replaced* by a map the first time one tier
 * differs, and every call site with it; the map makes that a one-line data edit.
 * The equality is asserted by a test, so this cannot drift from V6 unnoticed.
 */

import { PLANS } from "../../shared/plans";
import type { SeatTier, TierCounts } from "../../shared/seats";

/**
 * The figure, once. V6 gives the same allowance to all three tiers.
 *
 * Not `Record<SeatTier, number>` by accident: `SeatTier = Plan`, so adding a
 * fourth tier to `src/shared/plans.ts` fails to compile here until its storage
 * allowance is stated. A seat whose storage nobody decided is a seat the invoice
 * cannot describe.
 */
export const STORAGE_GB_BY_TIER: Readonly<Record<SeatTier, number>> = {
  standard: 10,
  pro: 10,
  premium: 10,
};

/**
 * The per-seat allowance when every tier agrees — which V6 says they do.
 *
 * Derived from the table rather than written beside it, so the two can never
 * disagree. `null` when some future catalogue gives tiers different allowances,
 * at which point "10 GB per seat" is no longer a true sentence and a caller must
 * say which tier it means instead of printing a number that is wrong for two of
 * three.
 */
export const STORAGE_GB_PER_SEAT: number | null = (() => {
  const values = PLANS.map((tier) => STORAGE_GB_BY_TIER[tier]);
  return values.every((v) => v === values[0]) ? values[0] : null;
})();

export function storageGbFor(tier: SeatTier): number {
  return STORAGE_GB_BY_TIER[tier];
}

export interface StorageAllowance {
  /** The uniform per-seat figure, or `null` when tiers differ. */
  gbPerSeat: number | null;
  /** Seats counted, by tier, as handed in. */
  seats: number;
  /** Total GB the counted seats carry. */
  totalGb: number;
  /** "10 GB storage" — the per-seat phrase V6's plan rows print. */
  perSeatLabel: string;
  /** "30 GB storage (3 seats × 10 GB)" — the subscription-level phrase. */
  totalLabel: string;
}

const gb = (n: number): string => `${n} GB`;

/**
 * The allowance a set of seats carries.
 *
 * Takes a `TierCounts` rather than a plain seat number so that a per-tier
 * allowance — the change this module exists to absorb — needs no new signature.
 * A caller that only knows a total uses `storageAllowanceForSeats`.
 */
export function storageAllowanceOf(counts: TierCounts): StorageAllowance {
  let seats = 0;
  let totalGb = 0;
  for (const tier of PLANS) {
    const n = Math.max(0, Math.trunc(counts[tier] ?? 0));
    seats += n;
    totalGb += n * STORAGE_GB_BY_TIER[tier];
  }
  return label(seats, totalGb);
}

/**
 * The allowance for an untyped seat count — `billing_subscriptions.seats`, which
 * records how many were bought and not of which tier (`seat_grants` does that,
 * and it is the team lane's table).
 *
 * Uses the uniform figure, and reports `0` total when tiers ever differ, because
 * a total computed from an assumed tier is a number on an invoice that nobody can
 * reconcile. The labels say "per seat" in that case instead of inventing a sum.
 */
export function storageAllowanceForSeats(seats: number): StorageAllowance {
  const n = Math.max(0, Math.trunc(seats));
  const per = STORAGE_GB_PER_SEAT;
  return label(n, per === null ? 0 : n * per);
}

function label(seats: number, totalGb: number): StorageAllowance {
  const per = STORAGE_GB_PER_SEAT;
  const perSeatLabel = per === null ? "Storage varies by seat tier" : `${gb(per)} storage`;
  let totalLabel: string;
  if (per === null) {
    totalLabel = perSeatLabel;
  } else if (seats <= 0) {
    // No seats bought yet: the only true sentence is the rate, not a total of
    // nothing. The plan screens render this one before a purchase exists.
    totalLabel = `${gb(per)} storage per seat`;
  } else if (seats === 1) {
    totalLabel = `${gb(totalGb)} storage (1 seat × ${gb(per)})`;
  } else {
    totalLabel = `${gb(totalGb)} storage (${seats} seats × ${gb(per)})`;
  }
  return { gbPerSeat: per, seats, totalGb, perSeatLabel, totalLabel };
}
