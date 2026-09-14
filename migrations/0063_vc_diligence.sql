-- W9-C · migration 0063 — the allotted number (Wave 9 is 0061–0065, one per session).
--
-- The VC edition's diligence-to-close record (`AISJ_VC_Superuser_V8`):
--
--   `dd_items`   one row per checklist item per deal per track. The Investment
--                DD checklist (`DD_ITEMS`, six) and the Legal DD checklist
--                (`LD_ITEMS`, seven) — each item a status, an owner, a rating
--                and a finding (`ddIt(status, owner, rating, finding)`), and a
--                label the team may rename (`dd-iname-edit`). Rows are
--                materialised by `src/server/routes/diligence.ts` the first
--                time a deal is read at a stage that carries the track, the
--                same lazy shape `deck_onboarding` and `signups` use.
--   `vc_deals`   one row per deal: what the stage screens around the two
--                checklists set — MP approval (`DD_MP`), the diligence row
--                status (`DD_ROWSTATUS`), the investment and legal leads
--                (`ddLead` / `ldLead`), the round's ask and pre-money
--                (`ICQ_FIN`), and the term sheet's status (`TS_OUTCOMES`) with
--                the Agreements-library template it was attached from
--                (`tsTplPick`). NULL mp_approval / dd_status means "not chosen
--                yet": the screen derives them from the checklist
--                (`ddInitRow`, `src/shared/diligence.ts`).
--
-- NOT the §8.3 document lifecycle. `not_requested → awaiting → submitted →
-- verified` with Verify all is `signup_documents` (0034, W5-A), and a
-- diligence work log with a rating and a finding is a different record. Plan
-- §8 Q141 records the reading.
--
-- `term_sheets` (0001) stays what `issue_term_sheet` writes: one event row with
-- the valuation / ownership captured at issue. The LIVE status is here, keyed
-- by deal, because a deal has one term sheet in motion and `term_sheets` has no
-- key that says which of its rows is current.

CREATE TABLE IF NOT EXISTS dd_items (
  id          TEXT PRIMARY KEY,
  deck_id     TEXT NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  track       TEXT NOT NULL CHECK (track IN ('investment', 'legal')),
  sort_order  INTEGER NOT NULL,
  label       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'not_started'
                CHECK (status IN ('not_started', 'in_progress', 'done', 'flagged')),
  owner       TEXT,
  -- `DD_RATINGS` is '—' / Strong / Mixed / Concern; '—' is NULL.
  rating      TEXT CHECK (rating IS NULL OR rating IN ('strong', 'mixed', 'concern')),
  finding     TEXT,
  updated_at  TEXT,
  updated_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  UNIQUE (deck_id, track, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_dd_items_deck ON dd_items (deck_id, track, sort_order);

CREATE TABLE IF NOT EXISTS vc_deals (
  deck_id                TEXT PRIMARY KEY REFERENCES decks (id) ON DELETE CASCADE,
  ask                    TEXT,
  valuation              TEXT,
  mp_approval            TEXT CHECK (mp_approval IS NULL OR mp_approval IN ('approved', 'not_approved')),
  dd_status              TEXT CHECK (dd_status IS NULL OR dd_status IN ('yet_to_start', 'in_progress', 'completed')),
  investment_lead        TEXT,
  legal_lead             TEXT,
  term_sheet_status      TEXT CHECK (term_sheet_status IS NULL OR term_sheet_status IN ('drafted', 'issued', 'signed', 'declined')),
  term_sheet_template_id TEXT REFERENCES agreement_templates (id) ON DELETE SET NULL,
  term_sheet_file        TEXT,
  updated_at             TEXT,
  updated_by             TEXT REFERENCES users (id) ON DELETE SET NULL,
  -- A document is attached FROM a template; a file name with no template is a
  -- record nobody could have produced through the screen.
  CHECK (term_sheet_file IS NULL OR term_sheet_template_id IS NOT NULL)
);

-- ── Demo records for the seeded VC deals (0006) ─────────────────────────────
-- Guarded on the deck existing, so a database without the demo seed is untouched.

INSERT OR IGNORE INTO vc_deals (deck_id, ask, valuation, investment_lead, legal_lead, term_sheet_status, term_sheet_template_id, term_sheet_file)
SELECT v.column1, v.column2, v.column3, v.column4, v.column5, v.column6, v.column7, v.column8
FROM (VALUES
  ('vc_deck_solarnest',   '₹3.0 Cr',  '₹15 Cr',  'M. Sharma', NULL,              NULL,      NULL,         NULL),
  ('vc_deck_creditbridge','₹1.5 Cr',  '₹8 Cr',   'R. Kumar',  NULL,              NULL,      NULL,         NULL),
  ('vc_deck_dockflow',    '₹4.0 Cr',  '₹22 Cr',  'V. Nair',   NULL,              NULL,      NULL,         NULL),
  ('vc_deck_learnloop',   '₹2.0 Cr',  '₹10 Cr',  'P. Menon',  NULL,              NULL,      NULL,         NULL),
  ('vc_deck_freshcart',   '₹5.0 Cr',  '₹26 Cr',  'R. Kumar',  NULL,              'issued',  'at_vc_term', 'FreshCart_term-sheet-v3.docx'),
  ('vc_deck_cybervault',  '₹12 Cr',   '₹60 Cr',  'M. Sharma', 'Legal — A. Rao',  'signed',  'at_vc_term', 'CyberVault_term-sheet-v3.docx'),
  ('vc_deck_quantiq',     '₹22 Cr',   '₹110 Cr', 'V. Nair',   'Legal — S. Mehta','signed',  'at_vc_term', 'QuantIQ_term-sheet-v3.docx')
) AS v
WHERE EXISTS (SELECT 1 FROM decks d WHERE d.id = v.column1)
  AND (v.column7 IS NULL OR EXISTS (SELECT 1 FROM agreement_templates t WHERE t.id = v.column7));

-- Investment DD — SolarNest sits in diligence with one item flagged
-- (`ddData.InsureFlow`); every deal past IC has cleared all six (`GreenRoute`).
INSERT OR IGNORE INTO dd_items (id, deck_id, track, sort_order, label, status, owner, rating, finding)
SELECT 'ddi_' || v.column1 || '_investment_' || v.column2, v.column1, 'investment', v.column2, v.column3, v.column4, v.column5, v.column6, v.column7
FROM (VALUES
  ('vc_deck_solarnest', 1, 'Market',                  'done',        'M. Sharma', 'strong',  'Rooftop-solar TAM large and underpenetrated in tier-2 cities'),
  ('vc_deck_solarnest', 2, 'Team references',         'done',        'Analyst',   'strong',  'Founders ex-Tata Power, strong references'),
  ('vc_deck_solarnest', 3, 'Customer calls',          'done',        'Analyst',   'mixed',   '12 of 18 installers reachable; 2 churned recently'),
  ('vc_deck_solarnest', 4, 'Product / Tech review',   'in_progress', 'Advisor',   NULL,      'Inverter telemetry review scheduled this week'),
  ('vc_deck_solarnest', 5, 'Financials & metrics',    'flagged',     'M. Sharma', 'concern', 'Revenue quality: 41% from a single EPC partner'),
  ('vc_deck_solarnest', 6, 'Competitive positioning', 'not_started', NULL,        NULL,      NULL)
) AS v
WHERE EXISTS (SELECT 1 FROM decks d WHERE d.id = v.column1);

INSERT OR IGNORE INTO dd_items (id, deck_id, track, sort_order, label, status, owner, rating, finding)
SELECT 'ddi_' || d.id || '_investment_' || i.column1, d.id, 'investment', i.column1, i.column2, 'done', i.column3, i.column4, i.column5
FROM decks d
JOIN (VALUES
  (1, 'Market',                  'M. Sharma', 'strong', 'Market sized and validated against comparable rounds'),
  (2, 'Team references',         'A. Pillai', 'strong', '3 prior-employer references, all strongly positive'),
  (3, 'Customer calls',          'Analyst',   'strong', '4 of 4 reference customers confirmed the value proposition'),
  (4, 'Product / Tech review',   'Advisor',   'strong', 'Architecture reviewed, defensible data moat'),
  (5, 'Financials & metrics',    'Analyst',   'strong', 'Burn and runway in line with plan, clean metrics'),
  (6, 'Competitive positioning', 'M. Sharma', 'mixed',  'Two incumbents, but a lead on the data that matters')
) AS i
WHERE d.id IN ('vc_deck_creditbridge', 'vc_deck_dockflow', 'vc_deck_learnloop', 'vc_deck_freshcart', 'vc_deck_cybervault', 'vc_deck_quantiq');

-- Legal DD — CyberVault mid-way (`ldData.GreenRoute`), QuantIQ cleared.
INSERT OR IGNORE INTO dd_items (id, deck_id, track, sort_order, label, status, owner, rating, finding)
SELECT 'ddi_' || v.column1 || '_legal_' || v.column2, v.column1, 'legal', v.column2, v.column3, v.column4, v.column5, v.column6, v.column7
FROM (VALUES
  ('vc_deck_cybervault', 1, 'Cap table verification',          'done',        'A. Rao',  'strong', 'Cap table reconciled, no discrepancies'),
  ('vc_deck_cybervault', 2, 'IP assignment',                   'done',        'A. Rao',  'strong', 'All founder IP assigned to the company'),
  ('vc_deck_cybervault', 3, 'Contracts & customer agreements', 'done',        'Analyst', 'mixed',  '2 customer contracts up for renewal in 90 days'),
  ('vc_deck_cybervault', 4, 'Employment / ESOP',               'done',        'A. Rao',  'strong', 'ESOP pool 10%, grant docs in order'),
  ('vc_deck_cybervault', 5, 'Regulatory / compliance',         'in_progress', 'Ops',     NULL,     'CERT-In compliance confirmation pending'),
  ('vc_deck_cybervault', 6, 'Litigation checks',               'done',        'A. Rao',  'strong', 'No pending or threatened litigation'),
  ('vc_deck_cybervault', 7, 'Legal documentation (SHA / SSA)', 'in_progress', 'A. Rao',  NULL,     'SHA / SSA drafts under negotiation')
) AS v
WHERE EXISTS (SELECT 1 FROM decks d WHERE d.id = v.column1);

INSERT OR IGNORE INTO dd_items (id, deck_id, track, sort_order, label, status, owner, rating, finding)
SELECT 'ddi_' || d.id || '_legal_' || i.column1, d.id, 'legal', i.column1, i.column2, 'done', 'S. Mehta', 'strong', i.column3
FROM decks d
JOIN (VALUES
  (1, 'Cap table verification',          'Cap table clean'),
  (2, 'IP assignment',                   'All IP assigned'),
  (3, 'Contracts & customer agreements', 'Key contracts reviewed'),
  (4, 'Employment / ESOP',               'ESOP documentation in order'),
  (5, 'Regulatory / compliance',         'No open regulatory items'),
  (6, 'Litigation checks',               'No litigation found'),
  (7, 'Legal documentation (SHA / SSA)', 'SHA / SSA executed')
) AS i
WHERE d.id = 'vc_deck_quantiq';
