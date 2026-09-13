import { AccountOverlay } from "./account/AccountOverlay";

/**
 * Buy credits — the prototype's `openBuyCredits()` (`_scripts.js:3068-3072`):
 * the My account overlay, opened straight at the Plan step on the credit packs.
 *
 * W6-B deleted what used to live here: a hardcoded pack ladder (20 / 35 / 50
 * credits with per-deck rates and "Save N%" flags) and a button that granted
 * credits instantly with no payment. The ladder contradicted the published
 * catalogue (§8 Q51 — it sells whatever `price_plans` holds, 10 / 50 / 100
 * today), the per-deck rates were retired by §8 Q1, and a purchase now RECORDS
 * an intent and never reports money that was not taken (§1.3). Every figure
 * on this screen is read from `GET /api/pricing/published`.
 */
export function BuyCreditsPage() {
  return <AccountOverlay entry="buy-credits" />;
}
