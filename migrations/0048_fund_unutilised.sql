-- W5-A · migration 0048 (Wave 5 is allotted 0048 – 0049; 0049 is W5-B's).
--
-- Admin console → Sign-up → **Fund Deployment** (`admin/s-sufund.html`) keeps
-- THREE figures per programme, not two:
--
--     Program / fund | Allotted (₹ Cr) | Deployed (₹ Cr) | Unutilised (₹ Cr) | Utilisation
--
-- and its only validation reconciles them: `fdRecon` warns when
-- `deployed + unutilised ≠ allotted` beyond ±0.5 Cr (F0049). 0011 gave
-- `programs` three money columns — `fund_size`, `fund_allocated`,
-- `capital_deployed` — but none of them is *unutilised*, so the reconciliation
-- had no second operand (F0047). This adds it.
--
-- The mapping the section uses, settled here so nothing has to re-derive it:
--
--     Allotted    → fund_allocated     (what is allotted to this programme)
--     Deployed    → capital_deployed
--     Unutilised  → fund_unutilised    (new)
--     fund_size   → untouched: the fund's committed size, authored in Set up
--                   and summed by `loadFundTotals` in routes/analytics.ts.
--
-- Reading *allotted* as `fund_allocated` rather than as `fund_size` is what
-- keeps the section and that report agreeing about the same number; see §8 Q57.
--
-- Nullable, like the three columns beside it: the incubator edition has no
-- funds, and 0012 deliberately leaves Deep Tech Fund's figures NULL because it
-- has no committed capital yet.
ALTER TABLE programs ADD COLUMN fund_unutilised REAL;

-- Seed it so the demo workspace RECONCILES on first render, which is what makes
-- `fdRecon`'s green state reachable without an edit. 0012 sets Fund II to
-- 210 allotted / 92 deployed, so 118 is unutilised; a programme with either
-- figure missing stays NULL and is reported as "not set", never as zero.
UPDATE programs
   SET fund_unutilised = fund_allocated - capital_deployed
 WHERE fund_allocated IS NOT NULL
   AND capital_deployed IS NOT NULL
   AND fund_unutilised IS NULL;
