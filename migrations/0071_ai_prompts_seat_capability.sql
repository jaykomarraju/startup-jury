-- V3-AW · migration 0071 — the allotted number (the V3 wave is 0066-0074).
--
-- Item 11 (an AI prompt per evaluation area) and item 12 (Seat
-- configurability), both from section `s-wt` of the v3 superuser prototype's
-- BASE64 admin console. Neither is greppable in `AISJ_SuperuserV3.HTM`; decode
-- it first with `docs/prototype/tools/decode-embedded.py`.
--
-- ── What was actually missing ───────────────────────────────────────────────
--
-- Not the prompts. `parameters.prompt` has existed since `0013`, `0027` wrote a
-- real extraction prompt into all 26 core rows and all 18 additional ones, and
-- `src/server/ai/evaluate.ts` renders every one of them into the rubric it
-- sends the model. Item 11 asks for the EDITOR — a prompt button on each of the
-- 13 area rows — over content that was already there.
--
-- What the editor needs and the schema does not have is a **default**. The v3
-- screen offers `Restore default` on every row and `Restore all core AI
-- prompts` / `Restore all additional-parameter prompts` at the foot of each
-- block, and a restore is meaningless without a copy of the shipped text that
-- an edit cannot reach. That is this column, and it is the whole of item 11's
-- storage:

ALTER TABLE parameters ADD COLUMN prompt_default TEXT;

-- The shipped default is the prompt the org is evaluating against RIGHT NOW.
--
-- This runs before any writer of `prompt_default` exists, so for an untouched
-- row that is `0027`'s text and for an edited one it is the org's own. Adopting
-- the current value is the only migration-safe reading — the originally shipped
-- string is not recoverable from a row that has been edited — and it is also
-- the kind one: `Restore default` returns an org to the prompt it had before
-- this release, never to a surprise.
--
-- It is deliberately NOT the prototype's own `CORE_PROMPTS`. Those thirteen are
-- recorded verbatim in `src/shared/aiPrompts.ts` as `PROTOTYPE_CORE_PROMPTS`
-- and are NOT applied: they are section headings with a shared boilerplate
-- tail, where `0027`'s are extraction instructions, and adopting them would
-- change what the model is asked on every incubator deck on the strength of a
-- prototype's placeholder copy. §4 Q62 asks the client; the switch is one line.
UPDATE parameters SET prompt_default = prompt;

-- ── Item 12 · Seat configurability (prototype `CFG_CAP` + `cfgTog`) ─────────
--
-- Six toggles per edition: {core, addl} x {standard, pro, premium}, captioned
-- "Control which parameter sets each seat tier can configure". The prototype
-- holds them in a `var` that resets on reload; this is the store.
--
-- The seeded values ARE the ladder `planAllowsCore` / `planAllowsAdditional`
-- have had hard-coded since `src/shared/plans.ts` was written, which is also
-- the footnote the prototype prints — "Standard - none / Pro - core only /
-- Premium - core + additional". So an org that never opens the grid behaves
-- exactly as it does today, and `test/worker/prompts.test.ts` asserts that
-- equivalence rather than assuming it.
CREATE TABLE IF NOT EXISTS seat_capabilities (
  edition    TEXT NOT NULL CHECK (edition IN ('incubator', 'vc')),
  param_set  TEXT NOT NULL CHECK (param_set IN ('core', 'addl')),
  tier       TEXT NOT NULL CHECK (tier IN ('standard', 'pro', 'premium')),
  allowed    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (edition, param_set, tier)
);

INSERT OR IGNORE INTO seat_capabilities (edition, param_set, tier, allowed) VALUES
  ('incubator', 'core', 'standard', 0),
  ('incubator', 'core', 'pro',      1),
  ('incubator', 'core', 'premium',  1),
  ('incubator', 'addl', 'standard', 0),
  ('incubator', 'addl', 'pro',      0),
  ('incubator', 'addl', 'premium',  1),
  ('vc',        'core', 'standard', 0),
  ('vc',        'core', 'pro',      1),
  ('vc',        'core', 'premium',  1),
  ('vc',        'addl', 'standard', 0),
  ('vc',        'addl', 'pro',      0),
  ('vc',        'addl', 'premium',  1);
