-- W7-D · migration 0057 (Wave 7's allotment is 0054–0059).
--
-- The incubator Evaluate screen's per-deck status select
-- (`AISJ_IC_SuserV15` panel-evaluate, `EV_STATUS_OPTS`):
--   Shortlist · Hold · Need more info · Reject · Evaluated
--
-- The prototype keeps it in `deckStatus`, commented "per-deck recommendation
-- shown in the Evaluate list" — an evaluator's RECOMMENDATION, not a pipeline
-- move. Shortlist and Reject as decisions are still the workbench's buttons and
-- `performAction`'s transitions; choosing "Shortlist" here moves nothing. That
-- is deliberate: a select is too easy to change by accident to carry an
-- irreversible stage transition, and "Hold" / "Need more info" have no stage to
-- move to at all.
--
-- One row per evaluator per deck; choosing again replaces it. The VC IC member's
-- equivalent (Invest / Hold / Need more info / Pass) already has a store —
-- `ic_votes` (0001) — and is not this table.

CREATE TABLE IF NOT EXISTS evaluation_recommendations (
  deck_id    TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('shortlist', 'hold', 'need_more_info', 'reject', 'evaluated')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (deck_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_recommendations_user ON evaluation_recommendations (user_id);
