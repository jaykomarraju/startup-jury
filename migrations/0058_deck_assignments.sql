-- W7-E · migration 0058 — the allotted number (Wave 7 is 0054–0059, one per session).
--
-- Assign → Confirm assignment (`AISJ_IC_SuserV15/_scripts.js` asConfirm / renderAs4).
--
-- The prototype assigns every selected deck to every selected member — "N decks ×
-- M jury members = nE evaluations" — so several evaluators score the same deck.
-- The schema could not say that: `decks.assigned_to` holds ONE user. §8 Q38
-- (`W3-B`) named this exact change and addressed it to whichever wave owns
-- Assign.
--
--   `deck_assignments`   one row per (deck, evaluator). Carries what the summary
--                        card promises: who assigned it, when, the deadline
--                        ("7 days from assignment date", F0210), the optional
--                        "Instructions to evaluators" (F0257) and whether the
--                        evaluator was emailed (F0256).
--   `users.evaluation_capacity`
--                        the denominator of panel 3's load bar (F0258). NULL
--                        means the role's default in `src/shared/assignment.ts`.
--
-- `decks.assigned_to` is KEPT, as the deck's FIRST assignee. Every existing reader
-- (All decks, the stage screens, the reminder sweep's old shape, blind scoring)
-- keeps its meaning; the join table is the authority on who may score.

CREATE TABLE IF NOT EXISTS deck_assignments (
  deck_id       TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  evaluator_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  assigned_at   TEXT NOT NULL,
  due_at        TEXT,
  note          TEXT,
  notified      INTEGER NOT NULL DEFAULT 0 CHECK (notified IN (0, 1)),
  PRIMARY KEY (deck_id, evaluator_id)
);

CREATE INDEX IF NOT EXISTS idx_deck_assignments_evaluator ON deck_assignments (evaluator_id);

-- Backfill every existing single assignee, dated from its latest assign_jury event
-- (falling back to the deck's own timestamp), with the default 7-day deadline.
INSERT OR IGNORE INTO deck_assignments (deck_id, evaluator_id, assigned_by, assigned_at, due_at)
SELECT
  d.id,
  d.assigned_to,
  (SELECT pe.actor_id FROM pipeline_events pe
     WHERE pe.deck_id = d.id AND pe.action = 'assign_jury'
     ORDER BY pe.created_at DESC LIMIT 1),
  COALESCE(
    (SELECT MAX(pe.created_at) FROM pipeline_events pe
       WHERE pe.deck_id = d.id AND pe.action = 'assign_jury'),
    d.updated_at
  ),
  strftime('%Y-%m-%dT%H:%M:%fZ',
    COALESCE(
      (SELECT MAX(pe.created_at) FROM pipeline_events pe
         WHERE pe.deck_id = d.id AND pe.action = 'assign_jury'),
      d.updated_at
    ),
    '+7 days')
FROM decks d
JOIN users u ON u.id = d.assigned_to;

ALTER TABLE users ADD COLUMN evaluation_capacity INTEGER CHECK (evaluation_capacity IS NULL OR evaluation_capacity > 0);
