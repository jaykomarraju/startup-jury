#!/usr/bin/env node
// F-FOUL — put a PDF behind every key migration 0081 sets.
//
//   node scripts/seed-deck-assets.mjs            # local (.wrangler/state), the e2e path
//   node scripts/seed-deck-assets.mjs --remote   # the deployed bucket, one-off
//
// WHY THIS EXISTS AT ALL. Migration 0081 sets `r2_key` on the 30 seeded decks
// that carry evaluation data, and SQL cannot write to R2. A key with nothing
// behind it is WORSE than NULL: `GET /api/decks/:id/file` already answers
// `no_pdf` for a dangling key, so the UI looks identical — but a guard written
// as `r2_key IS NOT NULL` would start PASSING, defeated by the very fix meant to
// satisfy it. So the migration and this script are two halves of one change, and
// neither is correct alone. Run the migration first, then this.
//
// THE ID LIST IS DUPLICATED HERE ON PURPOSE, and the duplication is CHECKED ON
// EVERY RUN. A .sql file cannot import a module, and deriving the list from the
// database instead would make this script's correctness depend on the very rows
// it exists to make coherent. So `assertMatchesMigration` below parses 0081's
// own id list and refuses to run on any difference — the check lives here rather
// than in the worker test suite because that suite runs inside workerd with no
// filesystem, and because THIS is the process that would otherwise silently
// upload the wrong set.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** The 30 seeded decks that carry evaluation data — 0081's id list, exactly. */
export const SEEDED_DECK_IDS = [
  // incubator (12)
  "inc_deck_agrofresh",
  "inc_deck_creditbri",
  "inc_deck_edulift",
  "inc_deck_finstack",
  "inc_deck_greengrid",
  "inc_deck_greenroute",
  "inc_deck_insureflow",
  "inc_deck_medixir",
  "inc_deck_meera_signup",
  "inc_deck_solarc",
  "inc_deck_taxpilot",
  "inc_deck_wealthosi",
  // VC (18)
  "vc_deck_agrichain",
  "vc_deck_agrichainvc",
  "vc_deck_b2bsaas",
  "vc_deck_climacore",
  "vc_deck_creditbridge",
  "vc_deck_cybervault",
  "vc_deck_dockflow",
  "vc_deck_finstackvc",
  "vc_deck_freshcart",
  "vc_deck_gridzero",
  "vc_deck_insureflowvc",
  "vc_deck_learnloop",
  "vc_deck_medgrid",
  "vc_deck_paywise",
  "vc_deck_petpal",
  "vc_deck_quantiq",
  "vc_deck_solarnest",
  "vc_deck_wealthos",
];

/**
 * The four seeded decks that must KEEP `r2_key` NULL, and why. Exported so the
 * guard test can assert the script never touches them.
 */
export const DELIBERATELY_FILELESS = {
  inc_deck_payroute: "incomplete — a deck whose intake failed is supposed to be thin",
  inc_deck_meera_incomplete: "incomplete — same",
  vc_deck_northbeam: "incomplete — same",
  inc_deck_pitchloop: "the deliberate AI-failure fixture; its purpose is to have nothing to read",
};

const BUCKET = "startup-jury-decks";
const PERSIST = ".wrangler/state/v3/r2";
const SAMPLE = "docs/demo-assets/gridbloom-sample-deck.pdf";
const MIGRATION = "migrations/0081_seed_deck_files.sql";
const SELF = "scripts/seed-deck-assets.mjs";

/**
 * Refuse to run if this file's id list and 0081's have drifted apart.
 *
 * Either direction is a bug worth stopping for: an id here and not there
 * uploads an object nothing points at, and an id there and not here sets a key
 * with nothing behind it — which is the WORSE failure, because
 * `r2_key IS NOT NULL` starts passing while `GET /api/decks/:id/file` still
 * answers `no_pdf`.
 *
 * Reads 0081's quoted `inc_deck_*` / `vc_deck_*` literals. Its `LIKE 'inc_deck_%'`
 * patterns do not match the pattern (the `%` is not a word character) and its
 * prose names the four fileless fixtures without quotes, so only the UPDATE's
 * id list is picked up.
 */
function assertMatchesMigration() {
  const sql = readFileSync(MIGRATION, "utf8");
  const inMigration = new Set(
    [...sql.matchAll(/'((?:inc|vc)_deck_[a-z0-9_]+)'/g)].map((m) => m[1]),
  );
  const here = new Set(SEEDED_DECK_IDS);
  const onlyInMigration = [...inMigration].filter((id) => !here.has(id));
  const onlyHere = [...here].filter((id) => !inMigration.has(id));
  if (onlyInMigration.length || onlyHere.length) {
    throw new Error(
      `${MIGRATION} and ${SELF} name different decks.\n` +
        (onlyInMigration.length ? `  only in the migration: ${onlyInMigration.join(", ")}\n` : "") +
        (onlyHere.length ? `  only in this script:   ${onlyHere.join(", ")}\n` : "") +
        "  Both lists must be identical — see the header of either file.",
    );
  }
  const overlap = SEEDED_DECK_IDS.filter((id) => Object.hasOwn(DELIBERATELY_FILELESS, id));
  if (overlap.length) {
    throw new Error(`These fixtures must stay fileless and must not be seeded: ${overlap.join(", ")}`);
  }
}

/** `versionKey(id, 1)` — src/server/decks/versions.ts. Version 1 takes no suffix. */
export function seedDeckKey(deckId) {
  return `decks/${deckId}.pdf`;
}

/**
 * Resolve miniflare THROUGH WRANGLER's own dependency tree rather than importing
 * it by name.
 *
 * miniflare is not a declared dependency of this project — it arrives under
 * wrangler, and `@cloudflare/vite-plugin` (which serves the e2e dev server) uses
 * that same copy. Resolving it this way guarantees we write the local R2 store in
 * the exact format the dev server will read, and it cannot be broken by npm
 * hoisting a second version next to a declared one. Returns null if the layout
 * ever changes, and the caller falls back to the CLI.
 */
async function loadMiniflare() {
  try {
    const require = createRequire(import.meta.url);
    const fromWrangler = createRequire(require.resolve("wrangler"));
    const { Miniflare } = await import(pathToFileURL(fromWrangler.resolve("miniflare")).href);
    return Miniflare;
  } catch {
    return null;
  }
}

/** Local: one miniflare instance, 30 puts, well under a second. */
async function putLocalInProcess(Miniflare, body) {
  const mf = new Miniflare({
    modules: true,
    script: "export default {};",
    r2Buckets: { DECKS: BUCKET },
    r2Persist: PERSIST,
  });
  try {
    const bucket = await mf.getR2Bucket("DECKS");
    for (const id of SEEDED_DECK_IDS) {
      await bucket.put(seedDeckKey(id), body, {
        httpMetadata: { contentType: "application/pdf" },
      });
    }
  } finally {
    await mf.dispose();
  }
}

/**
 * The fallback, and the only way to reach the deployed bucket: one
 * `wrangler r2 object put` per deck. Correct but ~1s per object, which is why it
 * is not the local path — `e2e:serve` runs the local one on every start.
 */
function putViaCli(where) {
  for (const id of SEEDED_DECK_IDS) {
    execFileSync(
      "npx",
      [
        "wrangler",
        "r2",
        "object",
        "put",
        `${BUCKET}/${seedDeckKey(id)}`,
        `--file=${SAMPLE}`,
        "--content-type=application/pdf",
        where,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  }
}

async function main() {
  const remote = process.argv.includes("--remote");
  assertMatchesMigration();
  const body = readFileSync(SAMPLE);

  if (remote) {
    // A deployed bucket cannot be reached in-process. This is a one-off after a
    // deploy, not part of the gate — and it must run AFTER 0081 is applied
    // remotely, or the keys it fills in are keys nothing points at.
    console.log(`Uploading ${SEEDED_DECK_IDS.length} seed deck objects to the DEPLOYED ${BUCKET}…`);
    putViaCli("--remote");
  } else {
    const Miniflare = await loadMiniflare();
    if (Miniflare) {
      await putLocalInProcess(Miniflare, body);
    } else {
      console.warn("miniflare not resolvable through wrangler — falling back to the CLI (slow).");
      putViaCli("--local");
    }
  }

  console.log(
    `Seeded ${SEEDED_DECK_IDS.length} deck objects (${remote ? "remote" : PERSIST}); ` +
      `${Object.keys(DELIBERATELY_FILELESS).length} fixtures deliberately left without one.`,
  );
}

// Importable for the guard test (which reads the id list), executable for the gate.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
