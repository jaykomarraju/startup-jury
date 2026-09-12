-- W4-A · migration 0044 — the user lifecycle the Admin console's Team & roles
-- and User access sections need (F0064 / F0065 / F0075 / F0124).
--
-- `0041` already gave the roster half of an invite lifecycle: `invite_accepted_at`
-- is stamped on a new account's FIRST successful sign-in, so "pending" is
-- already expressible as `invite_accepted_at IS NULL`. What was missing is
-- everything either side of it — when the invite was last SENT (so Resend has
-- something to report), how a member is REMOVED, and whether the credential a
-- user holds is still the temporary one an administrator issued.
--
-- FOUR COLUMNS, and the reason each one is a column rather than a convention:
--
--   • `invite_sent_at`      — stamped on create and on every resend. Without it
--                             "Resend" is a button with no observable effect and
--                             the roster cannot say when the invite last went out.
--
--   • `deleted_at`          — SOFT delete. `users.id` is a foreign key on decks,
--                             evaluations, calls, notifications and the audit
--                             trail; a hard DELETE would either fail or silently
--                             strand rows that name the person. Every roster read
--                             filters `deleted_at IS NULL`, and the delete route
--                             also clears `active`, so a removed member can no
--                             longer sign in (`POST /api/auth/login` refuses an
--                             inactive user) without losing the history that
--                             names them.
--
--   • `deleted_email`       — the address a removed member held. `users.email` is
--                             UNIQUE, so a soft-deleted row would otherwise hold
--                             its address hostage and an administrator could never
--                             re-invite someone they had removed (or cancel a
--                             mistyped invite and re-send it to the right person).
--                             The delete route moves the address here and parks a
--                             collision-proof tombstone in `email`, so the real
--                             address survives for the audit trail and the seat is
--                             genuinely freed.
--
--   • `must_change_password`— set whenever the system ISSUES a credential (create,
--                             resend, admin reset) and cleared when the user
--                             changes it themselves. F0075 found the console
--                             promising a first-sign-in password change that did
--                             not exist anywhere; `PUT /api/users/me/password`
--                             makes the change real and this column is what the
--                             User access section reads to say, truthfully,
--                             whether a temporary credential is still in play.
--                             Backfilled to 0: every account that exists today
--                             predates the flag and must not be told to change
--                             anything.
--
-- Nothing here is a permission. The three user VERBS this session adds
-- (activate / deactivate / delete) are gated by `role_permissions` rows that
-- `0029` already seeded — see §8 Q27.

ALTER TABLE users ADD COLUMN invite_sent_at TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE users ADD COLUMN deleted_email TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- Existing accounts: the invite went out when the row was created, and whatever
-- password they hold is theirs.
UPDATE users SET invite_sent_at = created_at WHERE invite_sent_at IS NULL;

-- Every roster read is "this edition's live members", so index the pair.
CREATE INDEX IF NOT EXISTS idx_users_live ON users (edition, deleted_at);
