/**
 * P2 (23-Oct tracker, row 7 — "Buy Credits should align with 'My account plans
 * & prices'") — the ONE catalogue every purchase surface prices from.
 *
 * ── THE CONTRADICTION, MEASURED ─────────────────────────────────────────────
 * Two surfaces sold credits and they read two different tables:
 *
 *   • My account / Buy credits (`AccountOverlay`, `/api/account`) priced from
 *     the PUBLISHED book — the one row of `pricing_versions` with
 *     `status = 'published'` — through `quoteOrder`.
 *   • Admin console → Credits & billing → "Buy more credits" (`/api/billing`)
 *     priced from `price_plans` × `price_amounts`: the DRAFT tables Price
 *     configuration saves into BEFORE anyone publishes. Every draft edit reached
 *     that panel's prices instantly, and `account.ts`'s own header already said
 *     why that is wrong: "a draft edit an administrator has not published must
 *     not be what a customer is charged".
 *
 * They also sold different THINGS. The incubator wizard is V3-PT's seat flow
 * (seats, enterprise seat plans, the paid trial), which `isSeatCatalogueRow`
 * selects; the console sold the pre-V3 10/50/100 packs that wizard never shows.
 * So the same administrator saw two price lists for one product.
 *
 * Both now read `publishedBook` below and select with `sellablePlans` in
 * `src/shared/priceBook.ts` — the same predicate the wizard draws with — and both
 * price an order with `quoteOrder`. A catalogue change is one publish, seen
 * everywhere at once.
 *
 * **DELIBERATELY UNSCOPED.** `pricing_versions` is one of §3's eight
 * PLATFORM-GLOBAL tables: one catalogue serves the whole product, and
 * `pricing_versions_one_published` enforces exactly one live book. The leak §2
 * A6 named was the WRITE gate (closed by `pricing-owner.test.ts`), not the
 * absence of a tenant key here. Moved from `routes/account.ts`, where it was
 * private and `routes/billing.ts` could not reach it.
 */
import type { Env } from "../types";
import type { Edition } from "../../shared/roles";
import {
  listedPlans,
  periodOf,
  sellablePlans,
  type PriceBook,
  type PublishedPriceBook,
} from "../../shared/priceBook";
import { publishablePlans, type PublishedPlan } from "../../shared/plans";

/** The live catalogue, or null when nothing has ever been published. */
export async function publishedBook(env: Env): Promise<PublishedPriceBook | null> {
  const row = await env.DB.prepare(
    "SELECT version, document, published_at FROM pricing_versions WHERE status = 'published'",
  ).first<{ version: number; document: string; published_at: string }>();
  if (!row) return null;
  const book = JSON.parse(row.document) as PriceBook;
  return { ...book, version: row.version, publishedAt: row.published_at };
}

/**
 * The console's `CreditsBillingView.plans`, resolved into one currency, in
 * catalogue order.
 *
 * **Incubator: exactly what the wizard sells** (`sellablePlans`), which is the
 * tracker row. **VC: every listed plan, as before** — the panel there read every
 * active draft row, seat SKUs included, and VC is out of scope (client,
 * 2026-10-01: "must keep working untouched"). Narrowing it to the VC wizard's
 * list would be the same rule and a visible change to a product nobody asked to
 * change, so the VC list moves from the draft tables to the published book and
 * no further. Measured: `buy-credits-alignment.test.ts` run against the
 * pre-P2 route shows the VC panel listing the nine `seat_*` rows.
 *
 * A plan with no price in `currency` is omitted rather than shown at zero — the
 * same rule `readCatalogue` applied to `price_amounts`, and the wizard's
 * `not_priced_in_currency`. The free trial is omitted too: it is taken, not
 * bought (`routes/account.ts`, `POST /trial`).
 *
 * `publishablePlans` still runs over the result although `validatePriceBook`
 * refuses to PUBLISH a per-deck figure: version 1 (`0047`) was seeded straight
 * into `pricing_versions` without passing through that check, and a stale
 * tagline is cheaper to strip twice than to explain once.
 */
export function publishedPlansFor(
  book: PublishedPriceBook,
  edition: Edition,
  currency: string,
): PublishedPlan[] {
  const rows =
    edition === "incubator"
      ? sellablePlans(book, edition)
      : listedPlans(book).filter((p) => p.group !== "free_trial");
  return publishablePlans(
    rows
      .filter((p) => (p.amounts[currency] ?? 0) > 0)
      .map((p) => ({
      code: p.code,
      group: p.group,
      name: p.name,
      badge: p.badge,
      tagline: p.tagline,
      features: p.features,
      units: p.units,
      period: periodOf(p),
      currency,
      amountMinor: p.amounts[currency] ?? 0,
    })),
  );
}
