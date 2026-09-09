-- W1-B · migration 12 of 13 (0025 – 0037).
--
-- Admin console → Sign-up → **Seat capacity** (`admin/s-suseat.html`), and its
-- VC counterpart **Fund Deployment** (`admin/s-sufund.html`).
--
-- Seats belong to a cohort, not a programme: the prototype's rows read
-- "Accelerator · Cohort 8", "Climate Track · 2026" — a programme and the batch
-- within it. So `seat_capacity` / `seats_filled` are columns on `cohorts`.
--
-- The VC edition has no seats; its section is Fund Deployment, which reads the
-- fund columns 0011 already put on `programs` (fund_size / fund_allocated /
-- capital_deployed). Nothing new is needed for it — recorded here so W5-A does
-- not go looking.
--
-- The `seatless` flag itself lives on `signups` (0034), because it is a
-- property of one startup finishing sign-up without a seat, not of the cohort:
-- "Sign-up is never blocked by seats — startups that complete without one are
-- flagged seatless so the team can allocate a seat and founder access from the
-- pipeline."

ALTER TABLE cohorts ADD COLUMN seat_capacity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cohorts ADD COLUMN seats_filled  INTEGER NOT NULL DEFAULT 0;

-- The prototype's three demo rows — 20/18, 15/9 and 12/12 — laid onto the
-- cohorts this workspace actually has, in a stable order. Cohort names repeat
-- across programmes, so the assignment is by (program, name) rather than by
-- name alone. The third row is deliberately AT capacity: that is what makes the
-- `seatless` path reachable on the seed. A workspace with more than three
-- cohorts cycles through the same three figures rather than leaving any at 0.
WITH ordered AS (
  SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.program_id, c.name) - 1 AS rn
  FROM cohorts c
),
seeded AS (
  SELECT id,
         CASE rn % 3 WHEN 0 THEN 20 WHEN 1 THEN 15 ELSE 12 END AS cap,
         CASE rn % 3 WHEN 0 THEN 18 WHEN 1 THEN  9 ELSE 12 END AS filled
  FROM ordered
)
UPDATE cohorts SET
  seat_capacity = (SELECT cap    FROM seeded WHERE seeded.id = cohorts.id),
  seats_filled  = (SELECT filled FROM seeded WHERE seeded.id = cohorts.id)
WHERE EXISTS (SELECT 1 FROM seeded WHERE seeded.id = cohorts.id);

-- Any completed sign-up in a cohort with no free seat is seatless. On today's
-- seed no sign-up has reached 'completed', so this writes nothing — it is here
-- so the rule is stated once, in the same place as the columns it reads.
UPDATE signups SET seatless = 1
WHERE status IN ('completed', 'onboarded')
  AND seat_allocated_at IS NULL
  AND EXISTS (
    SELECT 1 FROM decks d JOIN cohorts c ON c.id = d.cohort_id
    WHERE d.id = signups.deck_id AND c.seats_filled >= c.seat_capacity
  );
