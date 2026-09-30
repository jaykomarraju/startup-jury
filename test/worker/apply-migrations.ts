import { applyD1Migrations, env } from "cloudflare:test";

// Applied to each test's isolated D1 snapshot before any test runs.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// F-FOUL — and the objects behind the keys 0081 just wrote.
//
// `0081_seed_deck_files.sql` gives the 30 seeded decks that carry evaluation
// data an `r2_key`; `scripts/seed-deck-assets.mjs` puts the PDFs behind those
// keys, and it cannot reach this pool's isolated bucket. Without this the two
// halves of that change come apart HERE and nowhere else: the deck-file guard
// checks the object and not just the column, so every seeded deck would be
// refused for assignment and scoring by a suite whose fixtures are otherwise
// correct.
//
// Read back off the rows the migration just wrote rather than restating the id
// list, so this cannot drift from 0081.
const seeded = (
  await env.DB.prepare("SELECT r2_key FROM decks WHERE r2_key IS NOT NULL").all<{ r2_key: string }>()
).results;
for (const { r2_key } of seeded) {
  await env.DECKS.put(r2_key, new Uint8Array([37, 80, 68, 70])); // "%PDF"
}
