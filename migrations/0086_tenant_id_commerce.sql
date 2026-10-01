-- 0086 — T0-SCHEMA · `tenant_id` on the commerce and integration tables (6 of 17,
--        completing the seventeen) — PLUS the two outbox tables, which §5b counts
--        as scoped-by-proxy and which measurement says cannot be.
--
-- The rationale for the one-statement `NOT NULL DEFAULT 't_default'` form is in
-- `0084_tenant_id_pipeline.sql`'s header.
--
-- These six belong to T1-COMMERCE, T1-PEOPLE and T1-ESIGN. Two notes:
--
--   · `credit_ledger` is where the tenancy gap costs real money rather than
--     privacy. `ai/health.ts:150` refunds a failed evaluation's credit to an
--     EDITION, so with two customers on one edition tenant A's failed
--     evaluation tops up a balance tenant B draws on. The column exists from
--     here; T1-DECKS binds it at the refund and T1-COMMERCE at the purchase.
--   · `billing_payment_intents` is the one to carry a tenant field into Stripe.
--     `billing/provider.ts:96` is `const ADAPTERS = {}` by design and
--     `resolvePaymentClient` returns `null` unconditionally, so no money has
--     moved yet — which is exactly why this is cheap now. §3's instruction to
--     whoever writes the adapter: the webhook's `metadata` /
--     `client_reference_id` must carry the tenant FROM THE FIRST LIVE
--     TRANSACTION, even while it is a constant. Reserving the field costs
--     nothing today and is the only part of that work that gets more expensive
--     by waiting.
--
-- `billing_invoices` is NOT here. It carries `UNIQUE (edition, number)`, a
-- table-level constraint that cannot be widened by `ALTER TABLE`, so it is
-- rebuild 9 of 11 at 0097. `crm_connections` is likewise rebuilt (0098) for
-- `UNIQUE (edition, provider)`, while its child `crm_sync_log` takes a plain
-- column here.

ALTER TABLE account_orders          ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE credit_ledger           ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE billing_payment_intents ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE seat_grants             ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE authorised_signatories  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE crm_sync_log            ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';

-- ══ THE TWO PROXY TABLES THAT HAVE NO PARENT TO BE SCOPED BY ════════════════
--
-- §5b classifies `email_outbox` and `esign_outbox` among the 33 tables "scoped by
-- proxy" — reachable through a parent that carries the key. They are not, and the
-- schema says so in its own words. Every foreign key either of them holds is
-- NULLABLE:
--
--   email_outbox.deck_id   TEXT REFERENCES decks (id) ON DELETE CASCADE   -- nullable
--   email_outbox.query_id  TEXT REFERENCES queries (id) ON DELETE SET NULL -- nullable
--   esign_outbox.signup_id    TEXT REFERENCES signups (id)     -- "Both nullable: an
--   esign_outbox.agreement_id TEXT REFERENCES agreements (id)  --  attempt may precede
--                                                              --  the agreements row"
--
-- `email_outbox.deck_id` is nullable because a `signup_invite` has no deck;
-- `esign_outbox`'s own comment at `0049` explains both of its. So a row in either
-- table can legitimately reference nothing at all, and `JOIN decks d ON
-- d.id = o.deck_id` silently DROPS those rows rather than scoping them, while a
-- LEFT JOIN scopes them to no tenant. There is no predicate over the existing
-- columns that is both correct and total. These two tables need a direct key or
-- they cannot be scoped.
--
-- That is not a theoretical gap. These are the two tables §5b measured at
-- `email_outbox` 3 `FROM` sites / 0 `JOIN`s and `esign_outbox` 2 / 0 — the purest
-- examples of its own warning — and `email_outbox` is where §2's two worst findings
-- live: B22, the only leak that LEAVES THE BUILDING ("one customer's deck event
-- emails every other customer's admins and PMs, startup name in the subject"), and
-- A8, the tenant-blind dedupe key that silently swallows the second customer's
-- month-end digest.
--
-- So the count of tables carrying a direct `tenant_id` is 30, not the 28 of §5b:
-- the 28 tenant-owned tables plus these two, promoted because the alternative is
-- that T1-PEOPLE and T1-ESIGN have nothing to scope against and no migration slot
-- to fix it with. `0100_tenant_integrity_assert.sql` asserts all 30.
--
-- The dedupe KEY STRINGS are still tenant-blind and still want fixing at the call
-- site — `monthly_usage_summary:${edition}:${month}` at `scheduled.ts:199` is
-- T1-PEOPLE's. This column is what makes that fix expressible.

ALTER TABLE email_outbox ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE esign_outbox ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
