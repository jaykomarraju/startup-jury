-- W6-C · migration 0052 (Wave 6 allotment: Wx-PWD 0050, W6-A 0051, W6-C 0052 —
-- this session owns 0052 and only 0052).
--
-- The PURCHASED seat: how many staff members an organisation may have, per plan
-- tier (F0111). Not to be confused with `cohorts.seat_capacity` (`0036`), which
-- counts places for STARTUPS in a batch and is untouched here.
--
-- `billing_subscriptions.seats` (`0046`) already records how many seats were
-- bought, and the Credits & billing tile prints it. It is READ, not redefined:
-- this migration adds the two things that let it be enforced and sold.
--
--   users.plan_tier  which tier's seat a member holds. The prototype assigns a
--                    plan per person everywhere it draws a team (the owner's
--                    plan toggle, the add-member Plan select, the roster's Plan
--                    column), so one workspace can hold a Standard juror and a
--                    Premium owner. The vocabulary is `org_settings.plan`'s own.
--
--   seat_grants      the per-tier breakdown of capacity, as a ledger. A tier's
--                    capacity is SUM(quantity) over its GRANTED rows. A purchase
--                    writes one row per tier it bought, linked to the payment
--                    intent that recorded it, in the same batch that adds the
--                    same quantity to `billing_subscriptions.seats`, so the two
--                    agree by construction. A checkout still with a provider
--                    writes its rows as 'pending' - they count for nothing until
--                    a provider confirms them. There is no card, PAN, CVV or
--                    expiry column here or anywhere (plan §1.2).
--
-- Capacity is enforced when a member is CREATED - refused with
-- `seat_limit_reached`, never admitted and reconciled later. Nothing here is a
-- trigger: an existing workspace may already hold more members than seats, and
-- a trigger would turn that history into an error on unrelated writes.

ALTER TABLE users ADD COLUMN plan_tier TEXT NOT NULL DEFAULT 'standard'
  CHECK (plan_tier IN ('standard', 'pro', 'premium'));

-- Backfill from the prototype's own seeded team (`AISJ_IC_SuserV15` _scripts.js
-- `members` / `owner` / `suSetSuper`): the account owner holds a Premium seat,
-- managers and associates Pro, and jury, IC members and analysts Standard.
-- Rule-based rather than id-based, so it means the same thing on a deployed
-- database as on the seed.
UPDATE users SET plan_tier = 'premium' WHERE role = 'superuser';
UPDATE users SET plan_tier = 'pro'
  WHERE role IN ('admin', 'program_manager', 'program_associate', 'partner', 'associate');

CREATE TABLE IF NOT EXISTS seat_grants (
  id         TEXT PRIMARY KEY,
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  tier       TEXT NOT NULL CHECK (tier IN ('standard', 'pro', 'premium')),
  -- Signed, so an adjustment can take seats away. Never zero.
  quantity   INTEGER NOT NULL CHECK (quantity <> 0),
  reason     TEXT NOT NULL CHECK (reason IN ('plan', 'purchase', 'adjustment')),
  -- 'granted' counts toward capacity. 'pending' is a purchase whose checkout is
  -- still with a payment provider. 'void' is one that provider declined.
  status     TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'pending', 'void')),
  intent_id  TEXT REFERENCES billing_payment_intents (id) ON DELETE SET NULL,
  actor_id   TEXT REFERENCES users (id) ON DELETE SET NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seat_grants_capacity ON seat_grants (edition, tier, status);

-- The seats a workspace already has. `billing_subscriptions.seats` is the total
-- it bought. It is split across tiers so that the members who exist today are
-- covered highest tier first - the owner's Premium seat, then Pro, then
-- Standard gets whatever remains. The split never grants a seat the total does
-- not contain: a workspace with more members than seats (the seeded VC
-- workspace has six members and five seats) is reported as over, not topped up.
INSERT INTO seat_grants (id, edition, tier, quantity, reason, note)
WITH held AS (
  SELECT edition,
         SUM(CASE WHEN plan_tier = 'premium' THEN 1 ELSE 0 END) AS premium,
         SUM(CASE WHEN plan_tier = 'pro' THEN 1 ELSE 0 END)     AS pro
    FROM users
   WHERE user_type = 'staff' AND role NOT IN ('founder', 'mentor') AND deleted_at IS NULL
   GROUP BY edition
),
split AS (
  SELECT b.edition, b.seats,
         MIN(b.seats, COALESCE(h.premium, 0)) AS premium,
         MIN(b.seats - MIN(b.seats, COALESCE(h.premium, 0)), COALESCE(h.pro, 0)) AS pro
    FROM billing_subscriptions b LEFT JOIN held h ON h.edition = b.edition
),
tier_rows AS (
  SELECT edition, 'premium' AS tier, premium AS quantity FROM split
  UNION ALL SELECT edition, 'pro', pro FROM split
  UNION ALL SELECT edition, 'standard', seats - premium - pro FROM split
)
SELECT 'sg_plan_' || edition || '_' || tier, edition, tier, quantity, 'plan',
       'Seats included in the plan when purchased seats began to be enforced'
  FROM tier_rows
 WHERE quantity > 0
ON CONFLICT (id) DO NOTHING;
