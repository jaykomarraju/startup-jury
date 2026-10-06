#!/usr/bin/env node
/**
 * Create Global Carbon Warriors' team, and the four hub programmes they run.
 *
 *   node scripts/provision-gcw-team.mjs --local     # dry-run target: local D1
 *   node scripts/provision-gcw-team.mjs --remote    # production
 *
 * WHY A SCRIPT AND NOT `POST /api/users`
 * --------------------------------------
 * That route takes its workspace from the ACTOR (`routes/users.ts:302`,
 * `scopeOf(c.var.user)`), so only a signed-in `t_gcw` administrator can create a
 * `t_gcw` user — and both of GCW's existing administrators have never signed in.
 * Signing in as one of them to bootstrap the rest would stamp an
 * `invite_accepted_at` they did not earn, which is the same guard this project
 * already declined to defeat when `transfer-ownership` refused with
 * `409 invite_pending`. So the first cohort of accounts is seated the way the
 * workspace itself was, by `scripts/provision-gcw.sql`'s precedent.
 *
 * It writes the SAME columns `POST /api/users` writes (`users.ts:492-496`):
 * id, tenant_id, edition, name, email, password_hash, role, initials, active,
 * user_type, title, invite_sent_at, must_change_password. `approval_state` takes
 * its `0106` default of 'approved', so these accounts are live immediately rather
 * than queued behind an approval nobody is waiting to give.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * No audit row and no invite notification. Both need an authenticated actor and a
 * request context; inventing an actor id for them would put a lie in the audit
 * trail, which is worse than an absence the header explains. The invite mail is a
 * no-op anyway until the sending domain is onboarded.
 *
 * PASSWORDS
 * ---------
 * Distinct per person, 16 characters from a 32-symbol alphabet with no
 * 0/O/1/I/L — **80 bits**, and readable aloud over a phone. Deliberately NOT the
 * product's own `tempPassword()` (`users.ts:111`), which is `aisj-` + 6 hex
 * characters, about 24 bits: fine for a mail nobody can intercept, not fine for a
 * company's administrators handed over by hand. Every account carries
 * `must_change_password = 1`, so each person is landed on the change screen.
 *
 * The hash is re-derived and compared before anything is written, so a wrong
 * format cannot ship silently.
 *
 * IDEMPOTENT
 * ----------
 * Inserts are `ON CONFLICT DO NOTHING` keyed on (tenant_id, email). A second run
 * creates nothing and — this is the part that matters — **resets nobody's
 * password**. Accounts that already exist are reported as skipped, with no
 * credential printed for them, because the operator no longer knows it.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
// Explicit, because eslint does not put the Node globals in scope for `.mjs` here.
import { Buffer } from "node:buffer";

const TENANT = "t_gcw";
const EDITION = "incubator";
const DOMAIN = "globalcarbonwarriors.com";

const remote = process.argv.includes("--remote");
const local = process.argv.includes("--local");
if (remote === local) {
  console.error("Pass exactly one of --local or --remote.");
  process.exit(1);
}

/**
 * The team, verbatim from the customer, with one correction stated out loud:
 * Sameer's address was given as `@globalcarbonwarrirors.com` ("warri-ror-s"). That
 * domain is not theirs, so mail to it would bounce and he could never self-register
 * or reset a password. Corrected here, and flagged to the customer rather than
 * silently fixed.
 *
 * All four hub managers are `program_manager`. The hub is an ORGANISING structure —
 * its own programme, cohort, shortlist floor, owner and dashboard filter — and not
 * a permission boundary: `routes/decks.ts:559` is
 * `ASSIGNEE_SCOPED_ROLES = ["jury"]`, so every staff role reads the whole
 * workspace. The customer was told this and accepted it.
 */
const TEAM = [
  { name: "Chandrasekhar Padmasola", local: "chandrasekhar", role: "admin",             title: "Chief Carbon Warrior" },
  { name: "Sameer D'Souza",          local: "sameer",        role: "program_manager",   title: "Program Manager — Mumbai Hub" },
  { name: "Sarthak Bhasin",          local: "sarthak",       role: "program_manager",   title: "Program Manager — Delhi Hub" },
  { name: "Shashank Naik",           local: "shashank",      role: "program_manager",   title: "Program Manager — Bengaluru Hub" },
  { name: "Praveen Parthasarathy",   local: "praveen",       role: "program_manager",   title: "Program Manager — Chennai Hub" },
  { name: "Jayesh B",                local: "info",          role: "program_associate", title: "Program Associate — All Programs" },
];

/** One programme per hub, each owned by its manager. */
const HUBS = [
  { id: "pg_gcw_mumbai",    name: "Mumbai Hub Program",    owner: "sameer",   order: 1 },
  { id: "pg_gcw_delhi",     name: "Delhi Hub Program",     owner: "sarthak",  order: 2 },
  { id: "pg_gcw_bengaluru", name: "Bengaluru Hub Program", owner: "shashank", order: 3 },
  { id: "pg_gcw_chennai",   name: "Chennai Hub Program",   owner: "praveen",  order: 4 },
];

// ── credentials ──────────────────────────────────────────────────────────────

/** No 0/O/1/I/L: every symbol survives being read aloud. 32 symbols = 5 bits each. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function password() {
  const pick = () =>
    Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
  return [pick(), pick(), pick(), pick()].join("-"); // 16 symbols ≈ 80 bits
}

/** `src/server/auth/password.ts`: pbkdf2$100000$<saltB64>$<hashB64>, SHA-256, 32-byte key. */
const ITERATIONS = 100_000;
function hash(pw, salt = crypto.randomBytes(16)) {
  const key = crypto.pbkdf2Sync(pw, salt, ITERATIONS, 32, "sha256");
  return `pbkdf2$${ITERATIONS}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Re-derive and compare. A hash that does not round-trip never reaches the database. */
function verify(pw, stored) {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || Number(iter) !== ITERATIONS) return false;
  const again = crypto.pbkdf2Sync(pw, Buffer.from(saltB64, "base64"), Number(iter), 32, "sha256");
  return crypto.timingSafeEqual(again, Buffer.from(hashB64, "base64"));
}

/** `initialsFrom(name)` as the roster renders it. */
function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "startup-jury-db", remote ? "--remote" : "--local", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const start = out.indexOf("[");
  return JSON.parse(out.slice(start));
}

// ── 1. who is already there ──────────────────────────────────────────────────

const existing = new Set(
  (d1(`SELECT email FROM users WHERE tenant_id = ${q(TENANT)}`)[0]?.results ?? []).map((r) =>
    String(r.email).toLowerCase(),
  ),
);

const created = [];
const skipped = [];

for (const person of TEAM) {
  const email = `${person.local}@${DOMAIN}`.trim().toLowerCase();
  if (existing.has(email)) {
    skipped.push({ ...person, email });
    continue;
  }
  const pw = password();
  const stored = hash(pw);
  if (!verify(pw, stored)) throw new Error(`hash did not round-trip for ${email} — refusing to write`);
  created.push({ ...person, email, pw, stored, id: `usr_${crypto.randomUUID().slice(0, 8)}` });
}

// ── 2. write them ────────────────────────────────────────────────────────────

for (const u of created) {
  d1(
    `INSERT INTO users (id, tenant_id, edition, name, email, password_hash, role, initials, active, user_type, title, invite_sent_at, must_change_password) ` +
      `VALUES (${q(u.id)}, ${q(TENANT)}, ${q(EDITION)}, ${q(u.name)}, ${q(u.email)}, ${q(u.stored)}, ${q(u.role)}, ${q(initials(u.name))}, 1, 'staff', ${q(u.title)}, datetime('now'), 1) ` +
      `ON CONFLICT (tenant_id, email) DO NOTHING`,
  );
}

// ── 3. the four hubs, each owned by its manager ──────────────────────────────

// MATCHED BY NAME, NOT BY ID, and this cost a cleanup in production.
//
// The first version keyed on an id this script invents (`pg_gcw_mumbai`), with
// `ON CONFLICT (id) DO NOTHING`. That is only idempotent against ITSELF. The
// customer had meanwhile created their four hubs by hand in the console, where
// they got generated ids (`prog_f5698574`, …), so the conflict never fired and the
// run produced a SECOND "Mumbai Hub Program" beside theirs — four duplicates, one
// of which shadowed a programme already holding 28 of their decks.
//
// A programme is identified by its NAME in that workspace, because that is what
// the customer sees and types. Theirs always wins: it may already have cohorts,
// decks or documents hanging off it, and this script has no business guessing
// otherwise.
for (const hub of HUBS) {
  const found = d1(
    `SELECT id FROM programs WHERE tenant_id = ${q(TENANT)} AND name = ${q(hub.name)} ORDER BY created_at LIMIT 1`,
  )[0]?.results?.[0]?.id;

  const id = found ?? hub.id;
  if (!found) {
    d1(
      `INSERT INTO programs (id, tenant_id, edition, sector, name, active, sort_order, shortlist_min) ` +
        `VALUES (${q(id)}, ${q(TENANT)}, ${q(EDITION)}, 'Climatetech', ${q(hub.name)}, 1, ${hub.order}, 7.0)`,
    );
  }

  // A programme with no cohort has nowhere for an upload to land.
  d1(
    `INSERT INTO cohorts (id, program_id, name, active, sort_order) ` +
      `SELECT ${q("ch_" + id)}, ${q(id)}, 'Cohort 1', 1, 1 ` +
      `WHERE NOT EXISTS (SELECT 1 FROM cohorts c WHERE c.program_id = ${q(id)})`,
  );

  // Owner keyed on the address, so it lands whether the manager was created by this
  // run or already existed. `sector` is filled only if it is missing — intake
  // auto-resolves through it (`src/shared/intake.ts:230-237`).
  d1(
    `UPDATE programs SET owner_id = (SELECT id FROM users WHERE tenant_id = ${q(TENANT)} AND email = ${q(hub.owner + "@" + DOMAIN)}), ` +
      `sector = COALESCE(NULLIF(sector, ''), 'Climatetech') ` +
      `WHERE id = ${q(id)} AND tenant_id = ${q(TENANT)}`,
  );
}

// ── 4. report ────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  ${remote ? "PRODUCTION" : "LOCAL"} · ${TENANT} / ${EDITION}\n`);
if (created.length) {
  console.log("  CREATED — hand these over, each person is prompted to change it on first sign-in\n");
  console.log(`  ${pad("EMAIL", 40)}${pad("NAME", 26)}${pad("ROLE", 20)}PASSWORD`);
  console.log(`  ${"-".repeat(40 + 26 + 20 + 19)}`);
  for (const u of created) console.log(`  ${pad(u.email, 40)}${pad(u.name, 26)}${pad(u.role, 20)}${u.pw}`);
}
if (skipped.length) {
  console.log(`\n  ALREADY EXISTED — untouched, password unchanged and not known to this script`);
  for (const u of skipped) console.log(`    ${u.email}`);
}

const roster = d1(
  `SELECT email, role, title, active FROM users WHERE tenant_id = ${q(TENANT)} AND deleted_at IS NULL ORDER BY role, email`,
)[0].results;
console.log(`\n  ROSTER NOW (${roster.length})`);
for (const r of roster) console.log(`    ${pad(r.email, 40)}${pad(r.role, 20)}${r.title ?? ""}`);

const progs = d1(
  `SELECT p.name, COALESCE(u.email, '(unowned)') AS owner FROM programs p LEFT JOIN users u ON u.id = p.owner_id ` +
    `WHERE p.tenant_id = ${q(TENANT)} ORDER BY p.sort_order`,
)[0].results;
console.log(`\n  PROGRAMMES (${progs.length})`);
for (const p of progs) console.log(`    ${pad(p.name, 28)}owner: ${p.owner}`);
console.log();
