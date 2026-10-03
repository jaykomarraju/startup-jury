-- 0102 — auto-clarification is OFF unless an admin turns it on.
--
-- **The client's instruction, 2026-10-02, verbatim:** "it should [not]
-- automatically send the query either. it should just say incomplete. the
-- operator will choose whether they want to send to query or not."
--
-- ── WHY HE ASKED, AND WHY IT IS NOT MERELY A PREFERENCE ─────────────────────
-- `auto_clarification` has shipped ON since `0026` because the prototype's
-- `s-fw` panel draws it on. Measured against production on 1-Oct: every one of
-- the eleven decks the tester had uploaded carried a `queries` row — including
-- the five whose contact details were complete, and six whose were not and to
-- whom no letter could therefore be addressed at all.
--
-- The damage is not the letter. It is that `routes/decks.ts:429` sets
-- `queried = (query_count > 0)` — ANY query row, whatever its delivery status —
-- and `screeningStatus` latches a queried deck into the `queried` SINK, whose
-- action whitelist is empty. So the Dashboard read "Incomplete, Queried" on
-- decks nobody had queried, every row action was greyed out, and the one
-- distinction the status vocabulary exists to draw — "Incomplete contact
-- details" against "Incomplete deck" — was invisible underneath it.
--
-- ── WHAT THIS DOES, AND WHAT IT DOES NOT ───────────────────────────────────
-- The FEATURE stays. "Auto-trigger clarification questions" is still in the
-- Scoring framework section and an admin may switch it on for their workspace;
-- `src/server/config/autoQuery.ts` is unchanged by this file and still refuses
-- to write to a founder it cannot reach. What changes is the default, for new
-- workspaces and for the ones that exist.
--
-- It does NOT delete the rows already written. Those are a data decision with a
-- human behind it, not a migration's business: `email_status` claims 'sent' on
-- every one of them, and a migration that quietly deleted something marked sent
-- would be the wrong shape of help. `scripts/clear-auto-queries.sql` is the
-- companion, run deliberately.
--
-- SQLite cannot ALTER a column default, so the default moves by rebuilding
-- nothing: `0090` already owns this table's shape, and a DEFAULT only applies to
-- an INSERT that omits the column. Every INSERT in the application names it
-- (`routes/config.ts`'s upsert binds all sixteen), so the default is reached
-- only by a hand-written row — which is why the column default is left alone and
-- the SETTING is what moves here. `src/shared/scoring.ts`'s
-- `DEFAULT_SCORING_SETTINGS.autoClarification` is the value the application
-- actually falls back to, and it is `false` as of this commit.

-- 1. Every existing workspace stops auto-sending.
UPDATE org_scoring_settings SET auto_clarification = 0, updated_at = datetime('now');

-- 2. And it took. Asserted rather than assumed, because this is the whole file:
--    a silent no-op here looks identical to success, and the symptom it fixes
--    (a deck latched to a sink nobody put it in) only shows up a day later on
--    somebody else's screen.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0102.auto_clarification_off_everywhere',
       CASE WHEN (SELECT count(*) FROM org_scoring_settings WHERE auto_clarification <> 0) = 0
            THEN 'ok'
            ELSE 'FAIL: ' || (SELECT count(*) FROM org_scoring_settings WHERE auto_clarification <> 0)
              || ' workspace(s) still auto-send clarification queries' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
