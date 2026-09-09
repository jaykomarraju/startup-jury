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

-- Demo capacities in the prototype's proportions — one near-full cohort, one
-- comfortable, one exactly at capacity (which is what makes the `seatless`
-- path reachable on the seed).
UPDATE cohorts SET seat_capacity = 20, seats_filled = 18 WHERE name = 'Cohort 5';
UPDATE cohorts SET seat_capacity = 15, seats_filled =  9 WHERE name = 'Cohort 6';
UPDATE cohorts SET seat_capacity = 12, seats_filled = 12 WHERE name NOT IN ('Cohort 5', 'Cohort 6');

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
