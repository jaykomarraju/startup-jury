/**
 * `npm run parity:nav` — can every role reach every screen its prototype
 * sidebar offers it?
 *
 * For each of the eleven role prototypes, the check parses `_sidebar.html`,
 * resolves each item to an application route slug, and asks `navForUser()` /
 * `canSeeNav()` in `src/shared/nav.ts` whether that role can actually get
 * there. Four things can be wrong:
 *
 *   missing-route  the slug does not exist in the application at all
 *   role-gap       the slug exists but this role cannot see it
 *   label          reachable, but the sidebar text differs
 *   extra          the application shows this role an item the prototype does not
 *
 * ── Three items do not call showPanel() ──────────────────────────────────────
 * `Set up`, `My account` and `Admin console` call `openSetup()`, `openAccount()`
 * and `openAdmin()` — they are overlays, not panels. Any survey that enumerates
 * `panel-*` ids misses them, which is how this application came to ship without
 * an admin console at all (plan_parity.md §3). They are parsed here like any
 * other sidebar item, because to a user they are sidebar items.
 *
 * ── role-gap is not automatically a defect ───────────────────────────────────
 * Several prototypes ship an UNTRIMMED sidebar: `AISJ_VC_Analyst_V1` offers an
 * analyst Legal DD, Partner call and Term sheet Pipeline. That contradicts the
 * role matrix in the written spec, which `npm run roles` holds at 526/526.
 * Under the precedence rule in plan_parity.md §1.1 the spec outranks the
 * prototype, so those are recorded as deliberate, with the reason spelled out
 * per entry — they are not work items. `missing-route` entries always are.
 *
 * See scripts/parity-lib.ts for the expected-gap / exit-code contract.
 */
import { PROTOTYPES, read, requireSplit, settle, strictMode } from "./parity-lib";
import { canSeeNav, navForUser, navItemById, navLabel } from "../src/shared/nav";
import type { Edition, Role } from "../src/shared/roles";
import { join } from "node:path";

// ── Prototype side ───────────────────────────────────────────────────────────

interface SidebarItem {
  /** The prototype's own id, minus the `si-` prefix. */
  id: string;
  label: string;
  /** `showPanel` for ordinary screens, or the overlay opener it calls instead. */
  opens: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function text(html: string): string {
  return html
    // Drop the count badge — `<span class="bx bx-b">24</span>` is a number, not
    // part of the label. Sidebar badges are W1-A's to build.
    .replace(/<span class="bx[^"]*"[^>]*>[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}

function sidebarItems(html: string): SidebarItem[] {
  const out: SidebarItem[] = [];
  const re = /<div class="si"[^>]*\bid="si-([\w-]+)"[^>]*\bonclick="([^"]*)"[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const opens = /^(\w+)\s*\(/.exec(m[2].trim())?.[1] ?? m[2].trim();
    out.push({ id: m[1], label: text(m[3]), opens });
  }
  return out;
}

// ── Mapping ──────────────────────────────────────────────────────────────────

/**
 * Prototype sidebar id → application route slug, where they differ. Everything
 * else maps to itself.
 */
const SLUGS: Record<string, string> = {
  // The prototype calls the Program Manager's decision screen "forsignup"; the
  // application named it for what it is when issue 26 added it (Aug-2026).
  forsignup: "pmpipeline",
  settings: "setup",
  myaccount: "account",
};

const slugFor = (id: string) => SLUGS[id] ?? id;

// ── The Wave 0 baseline ──────────────────────────────────────────────────────

/** Expand one shared reason across a group of keys. */
function gap(reason: string, ...keys: string[]): [string, string][] {
  return keys.map((k) => [k, reason]);
}

/**
 * Every divergence that exists today, keyed `<edition>/<role> · <kind> <slug>`.
 * A session that closes one deletes its line here in the same commit, or this
 * check fails with "FIXED — claim it".
 *
 * Read the reason prefix as ownership:
 *   W3-A        a real gap. `W3-A` owns `src/shared/nav.ts` for the programme,
 *               so every nav gap is its to close or to record as decided.
 *   W6-B        belongs with the purchase wizard, not with nav.
 *   Q4          unsettled — see plan_parity.md §8.
 *   DELIBERATE  the application is right and the prototype is not (§1.1), or the
 *               item postdates the prototype. Not work; do not "fix" these.
 *
 * The headline: there are ZERO `missing-route` entries. Every screen the eleven
 * sidebars offer exists in `navForUser`. The whole divergence is role trimming,
 * label casing and post-prototype additions.
 */
const EXPECTED_GAPS: ReadonlyMap<string, string> = new Map([
  // ── extra: the application shows something the prototype sidebar does not ──
  ...gap(
    "DELIBERATE — the internal issue log postdates the prototypes (shipped Session 7). Every internal role can file; triage is admin-only on the server.",
    "incubator/superuser · extra issues",
    "incubator/admin · extra issues",
    "incubator/program_manager · extra issues",
    "incubator/program_associate · extra issues",
    "incubator/jury · extra issues",
    "vc/superuser · extra issues",
    "vc/admin · extra issues",
    "vc/partner · extra issues",
    "vc/ic_member · extra issues",
    "vc/associate · extra issues",
    "vc/analyst · extra issues",
  ),
  ...gap(
    "DELIBERATE — the prototype trims My account from non-admin sidebars, but sign-out lives there and every user needs it (e2e roles.spec.ts: 'a team member sees their own account and can sign out').",
    "incubator/program_manager · extra account",
    "incubator/program_associate · extra account",
    "incubator/jury · extra account",
    "vc/partner · extra account",
    "vc/ic_member · extra account",
    "vc/associate · extra account",
    "vc/analyst · extra account",
  ),
  ...gap(
    "W6-B — the prototype buys credits inside the My account overlay, not from a sidebar item. Reconcile when the purchase wizard is built; the sidebar entry may then go.",
    "incubator/superuser · extra billing",
    "incubator/admin · extra billing",
    "vc/superuser · extra billing",
    "vc/admin · extra billing",
  ),
  ...gap(
    "SETTLED (W3-A, §8 Q4) — prototype inconsistency, not a deliberate trim. The IC Admin file is the only one of eleven that drops them, no Aug-2026 issue asked for the removal, and an admin who cannot reach Contact team loses the only route to the people they administer. Both items stay.",
    "incubator/admin · extra contactadmin",
    "incubator/admin · extra contactteam",
  ),
  ...gap(
    "DELIBERATE — the Program Associate gets Set up READ-ONLY on a Standard seat (nav.ts, e2e roles.spec.ts). The PA prototype predates that decision.",
    "incubator/program_associate · extra setup",
  ),
  ...gap(
    "DELIBERATE — §8: analysts and IC members are read-only on intro calls and see only the calls they are a participant on, hence the 'My Intro calls' override.",
    "vc/ic_member · extra introcalls",
  ),

  // ── label ──────────────────────────────────────────────────────────────────
  ...gap(
    "DELIBERATE — §8 again: the analyst's read-only scoping is what the 'My Intro calls' label says. The prototype's generic label understates it.",
    "vc/analyst · label introcalls",
  ),

  // ── role-gap: candidate REAL gaps ─────────────────────────────────────────
  ...gap(
    "W3-A — needs adjudication. The PA prototype offers both, but Aug-2026 issue 26 added pmpipeline specifically as the PM's decision surface, and jurypipeline is jury oversight.",
    "incubator/program_associate · role-gap jurypipeline",
    "incubator/program_associate · role-gap pmpipeline",
  ),
  ...gap(
    "PART-SETTLED (W3-A, §8 Q6) → the remaining half belongs to the Core Parameters lane. The AUTHORITY half is done: `configparams` (Configure 3 additional parameters) is a runtime permission, seeded per spec §10 to Super User + Client Admin + PM (incubator) / Partner (VC), enforced on the additional-param routes and read by MyParamsPage. The VISIBILITY half is blocked on the SCREEN, not on permissions: `coreparams` renders the whole admin config surface (AI prompt, branding, plan, credits), so widening it would hand four panels the prototype does not put there to every role. Split the screen to the prototype panel, then widen `roles` in nav.ts and seed the cell.",
    "incubator/program_manager · role-gap coreparams",
    "incubator/program_associate · role-gap coreparams",
    "vc/partner · role-gap coreparams",
    "vc/ic_member · role-gap coreparams",
    "vc/associate · role-gap coreparams",
    "vc/analyst · role-gap coreparams",
  ),
  ...gap(
    "DEFERRED (W3-A, §8 Q6) → the Set up lane. Same shape as coreparams and blocked the same way: the VC wizard has no read-only mode and `GET /api/config` is console-gated. There is no `setup` task in the prototype grid either, so this is a nav + screen decision, not a matrix one.",
    "vc/partner · role-gap setup",
    "vc/associate · role-gap setup",
    "vc/analyst · role-gap setup",
  ),

  // ── role-gap: the untrimmed VC sidebars ───────────────────────────────────
  // AISJ_VC_{Partner,Associate,Analyst}_V1 ship the Super User sidebar almost
  // verbatim — an analyst is offered Legal DD, Partner call and Term sheet
  // Pipeline. That contradicts the written spec's role matrix, which §1.1 ranks
  // above the prototypes and which `npm run roles` holds at 526/526. Recorded
  // as decided, not as work.
  ...gap(
    "DELIBERATE — untrimmed prototype sidebar. The spec's role matrix outranks it (§1.1) and `npm run roles` locks it at 526/526.",
    "vc/partner · role-gap assign",
    "vc/partner · role-gap jurypipeline",
    "vc/associate · role-gap partnerpipeline",
    "vc/associate · role-gap partnercall",
    "vc/associate · role-gap investmentdd",
    "vc/associate · role-gap icpipeline",
    "vc/associate · role-gap alignmentcall",
    "vc/associate · role-gap incuration",
    "vc/associate · role-gap legaldd",
    "vc/associate · role-gap curation",
    "vc/analyst · role-gap jurypipeline",
    "vc/analyst · role-gap partnerpipeline",
    "vc/analyst · role-gap partnercall",
    "vc/analyst · role-gap investmentdd",
    "vc/analyst · role-gap icpipeline",
    "vc/analyst · role-gap alignmentcall",
    "vc/analyst · role-gap incuration",
    "vc/analyst · role-gap legaldd",
    "vc/analyst · role-gap curation",
    "vc/analyst · role-gap funnel",
    "vc/analyst · role-gap capital",
    "vc/analyst · role-gap portfolio",
    "vc/analyst · role-gap diligence",
    "vc/analyst · role-gap decisions",
  ),
]);

// ── Run ──────────────────────────────────────────────────────────────────────

const dir = requireSplit();
const found = new Map<string, string>();
let total = 0;

for (const proto of PROTOTYPES) {
  const edition = proto.edition as Edition;
  const role = proto.role as Role;
  const items = sidebarItems(read(join(dir, proto.dir, "_sidebar.html")));
  const where = `${edition}/${role}`;
  const seen = new Set<string>();

  for (const item of items) {
    total++;
    const slug = slugFor(item.id);
    seen.add(slug);
    const nav = navItemById(edition, slug);
    if (!nav) {
      found.set(`${where} · missing-route ${slug}`, `sidebar "${item.label}" (${item.opens}) — no such route in navForUser`);
      continue;
    }
    if (!canSeeNav(role, nav)) {
      found.set(`${where} · role-gap ${slug}`, `sidebar "${item.label}" exists but ${role} cannot see it`);
      continue;
    }
    const label = navLabel(role, nav);
    if (label !== item.label) {
      found.set(`${where} · label ${slug}`, `prototype "${item.label}" vs app "${label}"`);
    }
  }

  // The other direction: items the application shows that the prototype's
  // sidebar does not. Founder is excluded from the walk entirely — there is no
  // founder prototype; that portal is drawn as overlays in `_rest.html`.
  for (const nav of navForUser(edition, role)) {
    if (seen.has(nav.id)) continue;
    total++;
    found.set(`${where} · extra ${nav.id}`, `app shows "${navLabel(role, nav)}"; not in the prototype sidebar`);
  }
}

settle({ name: "parity:nav", found, expected: EXPECTED_GAPS, strict: strictMode(), total });
