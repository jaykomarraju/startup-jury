/**
 * Shared plumbing for the parity harness (`npm run parity:nav`,
 * `npm run parity:tokens`).
 *
 * Both checks read the SPLIT prototypes, not the 760–1000 KB source HTMLs, so
 * they depend on `docs/prototype/tools/split-prototypes.py` having been run.
 * They are deliberately dependency-free: `node:fs` and `node:path` only, so the
 * harness cannot itself break the way the thing it measures might.
 *
 * ── The expected-gap contract ────────────────────────────────────────────────
 * Wave 0 builds these checks against an application that does NOT yet match the
 * prototypes, so a check that simply failed would be useless — every session
 * would learn to ignore it. Instead each check carries a frozen baseline of the
 * gaps that exist today. The exit rule is:
 *
 *   • an UNEXPECTED failure            → exit 1  ("you broke something")
 *   • an expected gap that now PASSES  → exit 1  ("you fixed it — claim it")
 *   • only the known gaps remain       → exit 0
 *   • `--strict`                       → known gaps fail too (drive to zero)
 *
 * The second rule is the "un-skip your part" mechanic from plan_parity.md §6
 * Wave 0: a session that closes a gap is forced to delete its baseline entry in
 * the same commit, so the baseline can never silently drift out of date.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Where `split-prototypes.py` writes, and how to override it. */
export function splitDir(): string {
  return (
    process.env.SJ_PROTO_SPLIT ??
    join(process.env.TMPDIR ?? "/tmp", "sj-prototype-split")
  );
}

/** The eleven role prototypes, and the (edition, role) each one stands for. */
export const PROTOTYPES = [
  { dir: "AISJ_IC_SuserV15", edition: "incubator", role: "superuser" },
  { dir: "AISJ_ICAdmin_V6", edition: "incubator", role: "admin" },
  { dir: "AISJ_IC_PM_V5", edition: "incubator", role: "program_manager" },
  { dir: "AISJ_IC_PA_V3", edition: "incubator", role: "program_associate" },
  { dir: "AISJ_IC_Jury_V4", edition: "incubator", role: "jury" },
  { dir: "AISJ_VC_Superuser_V8", edition: "vc", role: "superuser" },
  { dir: "AISJ_VC_Admin_V4", edition: "vc", role: "admin" },
  { dir: "AISJ_VC_Partner_V1", edition: "vc", role: "partner" },
  { dir: "AISJ_VC_IC_member_V2", edition: "vc", role: "ic_member" },
  { dir: "AISJ_VC_Associate_V1", edition: "vc", role: "associate" },
  { dir: "AISJ_VC_Analyst_V1", edition: "vc", role: "analyst" },
] as const;

/**
 * Resolve the split directory or die with the command that fixes it. Exit code
 * 2 (not 1) so "the harness could not run" is distinguishable from "the harness
 * ran and found a regression".
 */
export function requireSplit(): string {
  const dir = splitDir();
  const missing = !existsSync(dir)
    ? [dir]
    : PROTOTYPES.map((p) => join(dir, p.dir)).filter((d) => !existsSync(d));
  if (missing.length > 0) {
    console.error(
      `\n  parity harness: prototype split not found.\n` +
        `  missing: ${missing.join(", ")}\n\n` +
        `  Run this first:\n` +
        `    python3 docs/prototype/tools/split-prototypes.py\n`,
    );
    process.exit(2);
  }
  return dir;
}

/**
 * The repo root. These scripts are bundled into `node_modules/.cache/` before
 * they run (same pattern as `npm run roles`), so `import.meta.dirname` points at
 * the cache, not the source. npm always runs a script from the package root, so
 * `cwd` is the reliable answer — verified, not assumed.
 */
export function repoRoot(): string {
  const root = process.cwd();
  if (!existsSync(join(root, "package.json"))) {
    console.error(`\n  parity harness: run this from the repo root (cwd is ${root}).\n`);
    process.exit(2);
  }
  return root;
}

export function read(...parts: string[]): string {
  return readFileSync(join(...parts), "utf8");
}

// ── Reporting ────────────────────────────────────────────────────────────────

export const BOLD = "\u001b[1m";
export const DIM = "\u001b[2m";
export const RED = "\u001b[31m";
export const GREEN = "\u001b[32m";
export const YELLOW = "\u001b[33m";
export const RESET = "\u001b[0m";

export function rule(title: string): void {
  console.log(`\n${BOLD}${"═".repeat(78)}\n  ${title}\n${"═".repeat(78)}${RESET}`);
}

/**
 * The shared exit rule. `failures` are gaps found now; `expected` is the frozen
 * baseline. Both are keyed by an opaque, stable string.
 */
export function settle(opts: {
  name: string;
  found: Map<string, string>;
  expected: ReadonlyMap<string, string>;
  strict: boolean;
  total: number;
}): never {
  const { name, found, expected, strict, total } = opts;
  const unexpected = [...found].filter(([k]) => !expected.has(k));
  const fixed = [...expected.keys()].filter((k) => !found.has(k));
  const known = [...found].filter(([k]) => expected.has(k));
  const passing = total - found.size;

  rule(`${name} — ${passing}/${total} pass`);

  if (known.length > 0) {
    const verb = strict ? `${RED}FAIL (--strict)` : `${YELLOW}known gap`;
    console.log(`\n  ${verb}${RESET} — ${known.length} recorded in the Wave 0 baseline:\n`);
    for (const [k, why] of known) console.log(`    ${DIM}·${RESET} ${k}\n        ${DIM}${why}${RESET}`);
  }

  if (unexpected.length > 0) {
    console.log(`\n  ${RED}${BOLD}UNEXPECTED — ${unexpected.length} new failure(s)${RESET}`);
    console.log(`  ${DIM}Not in the baseline. Something regressed, or the prototypes moved.${RESET}\n`);
    for (const [k, why] of unexpected) console.log(`    ${RED}✗${RESET} ${k}\n        ${why}`);
  }

  if (fixed.length > 0) {
    console.log(`\n  ${GREEN}${BOLD}FIXED — ${fixed.length} baseline gap(s) now pass${RESET}`);
    console.log(
      `  ${DIM}Delete these from EXPECTED_GAPS in scripts/${name.includes("nav") ? "parity-nav.ts" : "parity-tokens.ts"} in the same commit.${RESET}\n`,
    );
    for (const k of fixed) console.log(`    ${GREEN}✓${RESET} ${k}`);
  }

  const bad = unexpected.length > 0 || fixed.length > 0 || (strict && known.length > 0);
  console.log(
    bad
      ? `\n  ${RED}${BOLD}${name}: FAIL${RESET}\n`
      : `\n  ${GREEN}${name}: ok${RESET} ${DIM}(${known.length} known gap(s); run with --strict to fail on them)${RESET}\n`,
  );
  process.exit(bad ? 1 : 0);
}

export const strictMode = (): boolean => process.argv.includes("--strict");
