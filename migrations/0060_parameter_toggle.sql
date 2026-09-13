-- W8-B · migration 0060 — the allotted number (Wave 8 is 0059–0060: W8-A 0059, W8-B 0060).
--
-- My Parameters → the per-parameter enable toggle (`panel-myparams.html`
-- `.pb-toggle > .tog`, F0507 / F0527).
--
-- The prototype lets a role switch one of its three parameters OFF and keep its
-- label, description and prompt; the application's only equivalent was Remove,
-- which sets `active = 0` — and a removed parameter could never come back.
--
-- `active` is what every reader of `parameters` already filters on: the AI
-- evaluator, the workbench, the stage-aware report, re-scoring, the question
-- bank and the rubric anchors. Making `active` the TOGGLE therefore takes a
-- switched-off parameter out of scoring everywhere with no change to any of those
-- files. What is missing is a way to tell a switched-off parameter from a
-- REMOVED one, which is this column:
--
--   retired = 1   removed (DELETE /api/config/additional-params/:id). Terminal.
--                 Historical scores still reference the row.
--   retired = 0, active = 0   switched off: still one of its role's three, shown
--                 on My Parameters with its fields intact, not scored.
--   retired = 0, active = 1   on.
--
-- Every row that is inactive today was retired by a Remove (or by 0013's
-- replacement of the 0007 set), so the backfill marks all of them retired and no
-- existing row changes meaning.

ALTER TABLE parameters ADD COLUMN retired INTEGER NOT NULL DEFAULT 0;

UPDATE parameters SET retired = 1 WHERE active = 0;
