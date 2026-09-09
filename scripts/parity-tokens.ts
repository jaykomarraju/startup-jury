/**
 * `npm run parity:tokens` — does the application's colour token surface carry
 * the prototype's palette?
 *
 * All eleven prototypes declare an identical 27-token `:root` block, and every
 * one of those 27 is used somewhere in the prototype CSS/markup (`--olive-md` is
 * the sparsest at 20 uses; `--text-3` the densest at 5,797) — so the whole block
 * is in scope, not a subset. The check asserts that
 * `src/client/index.css` declares each of them, at the exact value, in its
 * LIGHT scope (dark-theme overrides are a separate concern and are skipped).
 *
 * ── Naming ───────────────────────────────────────────────────────────────────
 * The prototype's own token name is the primary name the application is
 * expected to use: `--olive`, `--gold-dk`, `--stone`, and so on. Naming the
 * tokens after the visual contract is what makes every later audit a two-file
 * diff instead of an archaeology exercise.
 *
 * Where this application already ships a well-named token that unambiguously IS
 * the same colour role, that name is accepted as an alias — `--color-amber` is
 * the prototype's `--gold` (same value today), `--color-info` is its `--blue`.
 * A token passes if the primary OR any alias is declared at the right value, so
 * `W1-A` may keep an existing name rather than churn every call site.
 *
 * ── The headline finding ─────────────────────────────────────────────────────
 * The prototype's primary hue family is OLIVE (`--olive #6B8454`), and the
 * application has no olive token at all — it paints every one of those states
 * amber. That is the single largest visual divergence in the audit, and it is
 * `W1-A`'s to close.
 *
 * See scripts/parity-lib.ts for the expected-gap / exit-code contract.
 */
import { PROTOTYPES, read, repoRoot, requireSplit, settle, strictMode } from "./parity-lib";
import { join } from "node:path";

// ── Prototype side ───────────────────────────────────────────────────────────

/** Pull the first `:root{…}` declaration block out of a prototype stylesheet. */
function protoRoot(css: string): Map<string, string> {
  const m = /:root\s*\{([^}]*)\}/.exec(css);
  if (!m) throw new Error("no :root block in prototype stylesheet");
  const out = new Map<string, string>();
  for (const decl of m[1].split(";")) {
    const kv = /^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/.exec(decl);
    if (kv) out.set(kv[1], kv[2]);
  }
  return out;
}

/**
 * Read the palette from all eleven prototypes and assert they agree. If a
 * prototype ever diverges the palette stops being a single contract, and the
 * harness must say so rather than quietly picking one.
 */
function prototypePalette(dir: string): Map<string, string> {
  let canon: Map<string, string> | null = null;
  let canonName = "";
  for (const p of PROTOTYPES) {
    const tokens = protoRoot(read(join(dir, p.dir, "_style.css")));
    if (!canon) {
      canon = tokens;
      canonName = p.dir;
      continue;
    }
    const keys = new Set([...canon.keys(), ...tokens.keys()]);
    for (const k of keys) {
      if (norm(canon.get(k) ?? "") !== norm(tokens.get(k) ?? "")) {
        console.error(
          `\n  parity:tokens: the prototypes no longer agree on ${k} — ` +
            `${canonName} says ${canon.get(k) ?? "(absent)"}, ` +
            `${p.dir} says ${tokens.get(k) ?? "(absent)"}.\n` +
            `  The palette is only a contract while all eleven match. Resolve this first.\n`,
        );
        process.exit(2);
      }
    }
  }
  return canon!;
}

// ── Application side ─────────────────────────────────────────────────────────

/**
 * Every custom property `src/client/index.css` declares in a LIGHT scope, with
 * the selector it was declared under (for the report).
 *
 * A brace-depth scan rather than a CSS parser: this file has `@import`,
 * `@theme`, `@theme inline`, `@custom-variant` and `@layer` in it, and a real
 * parser would be a dependency the harness does not need. Dark scopes are
 * skipped — any block whose selector chain mentions `dark`.
 */
function appTokens(css: string): Map<string, { value: string; scope: string }> {
  const out = new Map<string, { value: string; scope: string }>();
  const stack: string[] = [];
  let buf = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      stack.push(buf.replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/\s+/g, " "));
      buf = "";
      continue;
    }
    if (ch === "}") {
      flush(buf, stack, out);
      stack.pop();
      buf = "";
      continue;
    }
    if (ch === ";") {
      flush(buf, stack, out);
      buf = "";
      continue;
    }
    buf += ch;
  }
  return out;
}

function flush(
  decl: string,
  stack: string[],
  out: Map<string, { value: string; scope: string }>,
): void {
  const kv = /(--[\w-]+)\s*:\s*(.+?)\s*$/.exec(decl.replace(/\/\*[\s\S]*?\*\//g, "").trim());
  if (!kv) return;
  const scope = stack.join(" > ");
  if (/dark/i.test(scope)) return; // dark-theme override — out of scope here
  // `@theme inline` re-exports semantic vars as Tailwind colours
  // (`--color-fg: var(--fg)`); the value lives at the original declaration.
  if (kv[2].startsWith("var(")) return;
  out.set(kv[1], { value: kv[2], scope: stack[stack.length - 1] || ":root" });
}

// ── Mapping ──────────────────────────────────────────────────────────────────

/**
 * Application names accepted in place of the prototype's own name. Only listed
 * where the role is unambiguous — a token with no entry here must be declared
 * under the prototype's own name.
 */
const ALIASES: Record<string, string[]> = {
  "--gold": ["--color-amber", "--accent"],
  "--gold-lt": ["--sidebar-active"],
  "--navy": ["--color-navy"],
  "--offwht": ["--color-offwhite", "--bg"],
  "--text": ["--fg"],
  "--text-3": ["--fg-muted", "--color-mute"],
  "--stone-dk": ["--color-divider", "--line"],
  "--blue": ["--color-info"],
  "--green": ["--color-signal-strong", "--positive"],
  "--amber": ["--color-signal-weak"],
  "--red": ["--color-signal-flagged"],
  "--surface": ["--color-surface"],
};

/** Lowercase, expand `#abc` → `#aabbcc`, so `#fff` and `#FFFFFF` compare equal. */
function norm(v: string): string {
  const s = v.trim().toLowerCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : s;
}

// ── The Wave 0 baseline ──────────────────────────────────────────────────────

/**
 * The tokens that do NOT match. Empty since `W1-A`: `src/client/index.css` now
 * declares the prototype's whole 27-token `:root` block verbatim, so the
 * default run and `--strict` are the same thing and any regression fails.
 *
 * If a future session needs to park a gap here, it must carry a reason and an
 * owning session, and must be deleted in the same commit that closes it.
 */
const EXPECTED_GAPS: ReadonlyMap<string, string> = new Map([]);

// ── Run ──────────────────────────────────────────────────────────────────────

const dir = requireSplit();
const palette = prototypePalette(dir);
const app = appTokens(read(join(repoRoot(), "src/client/index.css")));

const found = new Map<string, string>();
for (const [token, want] of palette) {
  const candidates = [token, ...(ALIASES[token] ?? [])];
  const hit = candidates.find((c) => app.has(c) && norm(app.get(c)!.value) === norm(want));
  if (hit) continue;
  const declared = candidates
    .filter((c) => app.has(c))
    .map((c) => `${c}=${app.get(c)!.value} (in ${app.get(c)!.scope})`)
    .join(", ");
  found.set(
    token,
    `want ${want}; app has ${declared || `none of ${candidates.join(" / ")}`}`,
  );
}

// Any baseline key that is not a real prototype token is a bookkeeping error in
// this file, not a finding — say so rather than letting it read as "FIXED".
const bogus = [...EXPECTED_GAPS.keys()].filter((k) => !palette.has(k));
if (bogus.length > 0) {
  console.error(
    `\n  parity:tokens: EXPECTED_GAPS names ${bogus.join(", ")}, which the prototype ` +
      `:root does not declare. Fix scripts/parity-tokens.ts.\n`,
  );
  process.exit(2);
}

settle({
  name: "parity:tokens",
  found,
  expected: EXPECTED_GAPS,
  strict: strictMode(),
  total: palette.size,
});
