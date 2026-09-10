-- W2-B · migration 0039 (the number reserved for this session).
--
-- ⚠️ THIS DROPS A TABLE. `rubric_anchors` (0001, seeded at 0002) is the global
-- FOUR-band scale — 0–1 Absent / 2–4 Weak / 5–7 Moderate / 8–10 Strong. It is
-- the §1.5 defect: the specs (§7) and `parameter_rubric_bands` (0027) carry
-- FIVE bands with different cut-points, so the same score was labelled two
-- different ways depending on which read it. After this migration the only
-- band table in the application is `RUBRIC_BANDS` in `src/shared/types.ts`,
-- with the per-parameter anchor TEXT in `parameter_rubric_bands`.
--
-- Nothing reads `rubric_anchors` any more: its two call sites
-- (`src/server/ai/evaluate.ts`, `src/server/routes/pipeline.ts`) were the
-- §9 hand-off from W1-B and both moved to `parameter_rubric_bands` in this
-- same commit. No foreign key references it.

-- ── 1. Re-derive `decks.signal` onto the five-band scale ───────────────────
--
-- `signal` persists what `signalTag()` returns, so its vocabulary changed with
-- it: `absent` → `insufficient`, and 9–10 is now its own `exceptional` band.
-- The cut-points moved too (Strong was ≥8, is now ≥7; Weak was ≥2, is now ≥3),
-- so a stored value re-derived from `ai_score` is the only way seeded demo
-- decks agree with the label the UI computes for the same number. This is
-- exactly what `rescoreEdition()` would write on the next weight change.
--
-- `flagged` is NOT a band — it means the extraction found missing slides — so
-- it is preserved, as is NULL (never evaluated).
UPDATE decks
SET signal = CASE
    WHEN ai_score >= 9 THEN 'exceptional'
    WHEN ai_score >= 7 THEN 'strong'
    WHEN ai_score >= 5 THEN 'moderate'
    WHEN ai_score >= 3 THEN 'weak'
    ELSE 'insufficient'
  END
WHERE signal IS NOT NULL
  AND signal <> 'flagged'
  AND ai_score IS NOT NULL;

-- A deck labelled without a score (or left on the retired label) still has to
-- carry a value the client can render — `SIGNAL_STYLES` has no `absent` key.
UPDATE decks SET signal = 'insufficient' WHERE signal = 'absent';

-- ── 2. Retire the four-band table ──────────────────────────────────────────
DROP TABLE IF EXISTS rubric_anchors;
