-- Session 7 — three concerns in one migration:
--
--   1. **Call scheduling / ICS.** `calls` existed since 0001 but was write-only:
--      two INSERTs from transition side effects, zero readers, and
--      `scheduled_at` was never populated. It now carries everything a
--      VCALENDAR/VEVENT needs (title, duration, location, UID, SEQUENCE,
--      status, organizer) plus a `call_participants` child table so the
--      organizer can invite the team AND the founder at any email domain
--      (FINISH-PLAN §8: ICS is the final scheduling verdict).
--
--   2. **Internal issue log.** Reuses the existing `tickets` table with an
--      internal `category` so the team logs testing issues in one place
--      instead of a second tracker.
--
--   3. **AI evaluation health (§9 "stuck at pending" bug).** `decks` gains the
--      columns needed to tell "in progress" from "failed", to cap re-drives,
--      and to refund the credit exactly once on a terminal failure.

-- ── 1. Call scheduling ───────────────────────────────────────────────────────

ALTER TABLE calls ADD COLUMN title            TEXT;
ALTER TABLE calls ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE calls ADD COLUMN location         TEXT;
-- Stable iCalendar UID: reissuing the same call must UPDATE the attendee's
-- calendar entry, not create a second one.
ALTER TABLE calls ADD COLUMN ics_uid          TEXT;
-- Bumped on every reschedule/cancel so calendar clients apply the change.
ALTER TABLE calls ADD COLUMN ics_sequence     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calls ADD COLUMN status           TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE calls ADD COLUMN organizer_id     TEXT REFERENCES users (id);
ALTER TABLE calls ADD COLUMN updated_at       TEXT;

CREATE INDEX idx_calls_deck ON calls (deck_id);

-- Backfill the UID for the rows created by the pre-Session-7 transition side
-- effects so they can be scheduled without a special case.
UPDATE calls SET ics_uid = id || '@startup-jury' WHERE ics_uid IS NULL;

CREATE TABLE call_participants (
  id         TEXT PRIMARY KEY,
  call_id    TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  -- NULL for an external attendee (the founder, an advisor) who has no login.
  user_id    TEXT REFERENCES users (id),
  email      TEXT NOT NULL,
  name       TEXT,
  kind       TEXT NOT NULL DEFAULT 'team' CHECK (kind IN ('organizer', 'team', 'founder')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_call_participants_call ON call_participants (call_id);
CREATE INDEX idx_call_participants_user ON call_participants (user_id);

-- ── 2. Internal issue log (reuses `tickets`) ─────────────────────────────────

-- 'support' = the customer-facing ticket queue that already existed.
-- 'issue'   = the internal testing/bug log added this session.
ALTER TABLE tickets ADD COLUMN category    TEXT NOT NULL DEFAULT 'support';
ALTER TABLE tickets ADD COLUMN severity    TEXT;
ALTER TABLE tickets ADD COLUMN area        TEXT;
ALTER TABLE tickets ADD COLUMN assignee_id TEXT REFERENCES users (id);
ALTER TABLE tickets ADD COLUMN resolution  TEXT;
ALTER TABLE tickets ADD COLUMN updated_at  TEXT;

CREATE INDEX idx_tickets_edition_category ON tickets (edition, category, status);

-- ── 3. AI evaluation health ──────────────────────────────────────────────────

-- Last failure reason (NULL = healthy). Set by the queue consumer / sweep.
ALTER TABLE decks ADD COLUMN ai_error          TEXT;
ALTER TABLE decks ADD COLUMN ai_attempts       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE decks ADD COLUMN ai_last_attempt_at TEXT;
-- Set only when the deck is given up on (dead-letter or the sweep's cap).
ALTER TABLE decks ADD COLUMN ai_failed_at      TEXT;
-- Idempotency guard: the credit for a terminally-failed evaluation is returned
-- exactly once, no matter how many sweeps or dead-letter deliveries see it.
ALTER TABLE decks ADD COLUMN ai_credit_refunded INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_decks_pending_ai ON decks (status, created_at);

-- ── Demo seed ────────────────────────────────────────────────────────────────
-- Enough live data that the Intro-call / Partner-call / Alignment-call screens
-- and the issue log are demoable without scheduling anything by hand.

INSERT INTO calls
  (id, deck_id, kind, scheduled_at, duration_minutes, title, location, remarks,
   ics_uid, ics_sequence, status, organizer_id, created_by, created_at, updated_at)
VALUES
  ('call_seed_greenroute_intro', 'inc_deck_greenroute', 'intro',
   '2026-08-18T10:30:00.000Z', 45,
   'GreenRoute — intro call', 'Google Meet · meet.google.com/aisj-demo-intro',
   'Shortlisted by the jury; PM to walk the founder through the cohort plan.',
   'call_seed_greenroute_intro@startup-jury', 0, 'scheduled', 'inc_pm', 'inc_pm',
   '2026-08-12T09:00:00.000Z', '2026-08-12T09:00:00.000Z'),
  ('call_seed_wealthos_intro', 'vc_deck_wealthos', 'intro',
   '2026-08-19T05:30:00.000Z', 30,
   'WealthOS — founder intro call', 'Zoom · zoom.us/j/aisj-demo-wealthos',
   'Associate-led intro before shortlisting to partner.',
   'call_seed_wealthos_intro@startup-jury', 0, 'scheduled', 'vc_associate', 'vc_associate',
   '2026-08-12T09:00:00.000Z', '2026-08-12T09:00:00.000Z'),
  ('call_seed_medgrid_partner', 'vc_deck_medgrid', 'partner',
   '2026-08-20T11:00:00.000Z', 60,
   'MedGrid — partner call', 'Firm office · Board room 2',
   'Partner call ahead of the IC sponsorship decision.',
   'call_seed_medgrid_partner@startup-jury', 0, 'scheduled', 'vc_partner', 'vc_partner',
   '2026-08-12T09:00:00.000Z', '2026-08-12T09:00:00.000Z'),
  ('call_seed_learnloop_alignment', 'vc_deck_learnloop', 'alignment',
   '2026-08-21T09:00:00.000Z', 60,
   'LearnLoop — alignment call', 'Google Meet · meet.google.com/aisj-demo-align',
   'Term-sheet alignment: valuation, ownership and board composition.',
   'call_seed_learnloop_alignment@startup-jury', 0, 'scheduled', 'vc_partner', 'vc_partner',
   '2026-08-12T09:00:00.000Z', '2026-08-12T09:00:00.000Z');

INSERT INTO call_participants (id, call_id, user_id, email, name, kind) VALUES
  ('cpt_seed_gr_1', 'call_seed_greenroute_intro', 'inc_pm',   'raj.kumar@demo.startupjury.ai',    'Raj Kumar',    'organizer'),
  ('cpt_seed_gr_2', 'call_seed_greenroute_intro', 'inc_jury', 'rajesh.kumar@demo.startupjury.ai', 'Rajesh Kumar', 'team'),
  ('cpt_seed_gr_3', 'call_seed_greenroute_intro', NULL,       'founder@greenroute.example',       'GreenRoute founder', 'founder'),
  ('cpt_seed_wo_1', 'call_seed_wealthos_intro', 'vc_associate', 'sunita.rao.vc@demo.startupjury.ai', 'Sunita Rao', 'organizer'),
  ('cpt_seed_wo_2', 'call_seed_wealthos_intro', 'vc_analyst',   'rhea.nair@demo.startupjury.ai',     'Rhea Nair',  'team'),
  ('cpt_seed_wo_3', 'call_seed_wealthos_intro', NULL,           'founder@wealthos.example',          'WealthOS founder', 'founder'),
  ('cpt_seed_mg_1', 'call_seed_medgrid_partner', 'vc_partner', 'ishaan.sethi@demo.startupjury.ai',  'Ishaan Sethi', 'organizer'),
  ('cpt_seed_mg_2', 'call_seed_medgrid_partner', 'vc_ic',      'rajesh.kumar.vc@demo.startupjury.ai', 'Rajesh Kumar', 'team'),
  ('cpt_seed_mg_3', 'call_seed_medgrid_partner', NULL,         'founder@medgrid.example',           'MedGrid founder', 'founder'),
  ('cpt_seed_ll_1', 'call_seed_learnloop_alignment', 'vc_partner', 'ishaan.sethi@demo.startupjury.ai', 'Ishaan Sethi', 'organizer'),
  ('cpt_seed_ll_2', 'call_seed_learnloop_alignment', 'vc_ic',      'rajesh.kumar.vc@demo.startupjury.ai', 'Rajesh Kumar', 'team'),
  ('cpt_seed_ll_3', 'call_seed_learnloop_alignment', NULL,         'founder@learnloop.example',        'LearnLoop founder', 'founder');

-- Internal issue log fixtures (category='issue' — invisible to the support queue).
INSERT INTO tickets
  (id, edition, subject, body, status, created_by, billing_routed, category, severity, area, assignee_id, created_at)
VALUES
  ('iss_seed_1', 'incubator',
   'Deck viewer shows a blank first slide on Safari',
   'Reproduced on Safari 18 with the GreenRoute deck: the first page renders blank until you click next and back.',
   'open', 'inc_pa', 0, 'issue', 'medium', 'Evaluate', 'inc_admin', '2026-08-10T06:30:00.000Z'),
  ('iss_seed_2', 'incubator',
   'Cohort filter resets after opening the report drawer',
   'Set Program = Climate Cohort, open a deck report, close it — the filter is back to All programs.',
   'open', 'inc_pm', 0, 'issue', 'low', 'All decks', NULL, '2026-08-11T04:10:00.000Z'),
  ('iss_seed_3', 'vc',
   'Bulk upload of 20 decks left two decks at Pending AI',
   'Two of twenty never left Pending AI after a bulk upload; no error was surfaced anywhere in the UI.',
   'open', 'vc_analyst', 0, 'issue', 'high', 'Upload', 'vc_admin', '2026-08-11T11:45:00.000Z');
