-- W9-E · migration 0065 — the allotted number (Wave 9 is 0061–0065, one per session).
--
-- Two things the VC call screens draw that the schema could not hold.
--
--   `call_schedulers`   Intro calls' "Assign scheduler" column (`panel-introcalls`,
--                       `ncAssign`: role → user → Assign, then "<user> · <role>"
--                       with Change). §8 Q102, decided with the user 2026-09-13:
--                       the assignee may schedule, reschedule, cancel and invite
--                       for THAT deck's call of THAT kind — even when their role
--                       is not a scheduler — and nothing else. Keyed on (deck,
--                       kind), not on a call, because the delegation is made
--                       before any call exists ("who books this one?"). Only a
--                       scheduler role may set or change it.
--
--   `call_outcomes`     Alignment call's Renegotiate / Hold (`AL_OUTCOMES`, F0558).
--                       Neither is a transition in `src/pipeline/vc.ts`; the deal
--                       stays at the stage and the decision is recorded here. An
--                       outcome that IS a transition (Sponsor to IC, Issue term
--                       sheet…) is never stored: it is read back from the
--                       `pipeline_events` row the transition wrote.

CREATE TABLE IF NOT EXISTS call_schedulers (
  deck_id      TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  assigned_at  TEXT NOT NULL,
  PRIMARY KEY (deck_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_call_schedulers_user ON call_schedulers (user_id);

CREATE TABLE IF NOT EXISTS call_outcomes (
  deck_id  TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  outcome  TEXT NOT NULL,
  set_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  set_at   TEXT NOT NULL,
  PRIMARY KEY (deck_id, kind)
);
