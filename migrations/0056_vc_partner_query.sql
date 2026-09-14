-- W7-C · migration 0056 — the VC partner reaches the Query screen.
--
-- F0218 / F0286 / F0288. `0029` seeded `role_permissions` by derivation from
-- `nav.ts`, and `VC_NAV` withheld Query from the partner, so the partner's
-- `query` cell was seeded 0. Three things say it should be 1:
--
--   • the Partner prototype's own sidebar carries `si-query`
--     (AISJ_VC_Partner_V1 — only the IC member omits it);
--   • the VC admin console's `permDefaults['Partner']` includes `query`;
--   • the written spec maps Partner / Principal ↔ Program Manager, and the
--     incubator programme manager has held Query since Phase 1.
--
-- STILL A GATE, NOT A GRANT (§8 Q8): paired with `partner` added to the VC
-- `query` nav item, to `POST /api/decks/:id/queries` and to
-- `GET /api/questions/draft/:deckId`. `0029`'s INSERT is ON CONFLICT DO NOTHING,
-- so this is an UPDATE — a workspace that already ran 0029 must change too.

UPDATE role_permissions SET granted = 1, updated_at = datetime('now')
 WHERE edition = 'vc' AND role = 'partner' AND task_id = 'query';
