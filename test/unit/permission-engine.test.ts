/**
 * W3-A — the runtime permission engine (`src/shared/permissions.ts`).
 *
 * Two things are being proved here, and the second is the one that matters:
 *
 *   1. `can()` resolves in the documented order (mentor → outside-the-matrix →
 *      not-a-cell → override → seed).
 *   2. **The engine is invisible on the default seed.** Every gate in the
 *      application is `existing rule AND can(task)`, so if the seed were even
 *      one cell narrower than the rule it ANDs with, a role would silently lose
 *      a screen or a route the moment W3-A landed. `roles-are-unchanged` and
 *      `require-task call sites` below assert that for the nav manifest and for
 *      every `requireTask(...)` in `src/server/**` respectively — the second by
 *      reading the source, so a future call site cannot skip the check.
 */
import { describe, it, expect } from "vitest";
import {
  can,
  defaultGrant,
  grantedTasks,
  isMatrixRole,
  isMatrixTask,
  lookupFromGranted,
  overrideKey,
  overridesFromRows,
  permissionLookup,
} from "../../src/shared/permissions";
import { NAV_BY_EDITION, canSeeNav, navForUser } from "../../src/shared/nav";
import { PERMISSION_ROLES, permissionTasksFor, type RolePermissionRow } from "../../src/shared/types";
import { ROLES_BY_EDITION, type Edition, type Role } from "../../src/shared/roles";

const EDITIONS: Edition[] = ["incubator", "vc"];

function override(edition: Edition, role: Role | string, taskId: string, granted: boolean) {
  return overridesFromRows([
    { edition, role: role as Role, task_id: taskId, granted: granted ? 1 : 0, updated_at: "", updated_by: null },
  ] satisfies RolePermissionRow[]);
}

describe("can() — resolution order", () => {
  it("reads the seeded default when there is no override", () => {
    expect(can("incubator", "admin", "adminconsole")).toBe(true);
    expect(can("incubator", "jury", "adminconsole")).toBe(false);
    expect(can("vc", "ic_member", "icpipeline")).toBe(true);
    expect(can("vc", "analyst", "icpipeline")).toBe(false);
  });

  it("lets a persisted row override the default in both directions", () => {
    expect(can("incubator", "admin", "adminconsole", override("incubator", "admin", "adminconsole", false))).toBe(false);
    expect(can("incubator", "jury", "adminconsole", override("incubator", "jury", "adminconsole", true))).toBe(true);
    // …and the default is untouched for every other cell.
    const off = override("incubator", "admin", "adminconsole", false);
    expect(can("incubator", "admin", "upload", off)).toBe(true);
    expect(can("incubator", "program_manager", "adminconsole", off)).toBe(false);
  });

  it("scopes an override to its own edition and role", () => {
    const off = override("incubator", "admin", "upload", false);
    expect(can("incubator", "admin", "upload", off)).toBe(false);
    expect(can("vc", "admin", "upload", off)).toBe(true);
    expect(can("incubator", "program_manager", "upload", off)).toBe(true);
  });

  it("never grants the mentor user-type anything, override or not (§1.2)", () => {
    for (const edition of EDITIONS) {
      for (const task of permissionTasksFor(edition)) {
        expect(can(edition, "mentor", task.id), `${edition}/${task.id}`).toBe(false);
        // Even an administrator ticking the cell cannot bring it back.
        expect(can(edition, "mentor", task.id, override(edition, "mentor", task.id, true))).toBe(false);
      }
    }
  });

  it("leaves the founder outside the matrix — isolation is not an admin toggle", () => {
    expect(isMatrixRole("incubator", "founder")).toBe(false);
    for (const task of permissionTasksFor("incubator")) {
      expect(can("incubator", "founder", task.id), task.id).toBe(true);
      // Not "granted": simply not gated here. A false row cannot change it,
      // because founder access is decided by the rule the permission ANDs with.
      expect(can("incubator", "founder", task.id, override("incubator", "founder", task.id, false))).toBe(true);
    }
  });

  it("is not a gate for a task the edition's grid does not name", () => {
    expect(isMatrixTask("incubator", "icpipeline")).toBe(false); // VC-only
    expect(isMatrixTask("vc", "signuppipeline")).toBe(false); // incubator-only
    // A shared route must not 403 in the edition that has no such cell.
    expect(can("incubator", "program_associate", "icpipeline")).toBe(true);
    expect(can("vc", "partner", "signuppipeline")).toBe(true);
    expect(can("incubator", "jury", "not_a_task_at_all")).toBe(true);
  });

  it("keys overrides across all three columns", () => {
    expect(overrideKey("vc", "partner", "icpipeline")).toBe("vc/partner/icpipeline");
    expect(defaultGrant("vc", "partner", "icpipeline")).toBe(true);
    expect(defaultGrant("vc", "analyst", "icpipeline")).toBe(false);
  });
});

describe("grantedTasks() / lookupFromGranted() — the client round trip", () => {
  it("survives the trip through /api/auth/me for every role", () => {
    for (const edition of EDITIONS) {
      for (const role of ROLES_BY_EDITION[edition]) {
        const direct = permissionLookup(edition, role);
        const roundTripped = lookupFromGranted(edition, role, grantedTasks(edition, role));
        for (const task of permissionTasksFor(edition)) {
          expect(roundTripped(task.id), `${edition}/${role}/${task.id}`).toBe(direct(task.id));
        }
      }
    }
  });

  it("gives non-matrix roles an empty list that still gates nothing", () => {
    expect(grantedTasks("incubator", "founder")).toEqual([]);
    const founder = lookupFromGranted("incubator", "founder", []);
    expect(founder("upload")).toBe(true);
    const mentor = lookupFromGranted("incubator", "mentor", []);
    expect(mentor("upload")).toBe(false);
  });
});

describe("the gate is invisible on the default seed", () => {
  it("changes no role's nav, in either edition", () => {
    for (const edition of EDITIONS) {
      for (const role of ROLES_BY_EDITION[edition]) {
        const before = navForUser(edition, role).map((i) => i.id);
        const after = navForUser(edition, role, permissionLookup(edition, role)).map((i) => i.id);
        expect(after, `${edition}/${role}`).toEqual(before);
      }
    }
  });

  it("grants every nav item's task to every role the item admits", () => {
    for (const edition of EDITIONS) {
      for (const item of NAV_BY_EDITION[edition]) {
        if (!item.task) continue;
        expect(isMatrixTask(edition, item.task), `${edition}/${item.id}→${item.task}`).toBe(true);
        for (const role of PERMISSION_ROLES[edition]) {
          if (!canSeeNav(role, item)) continue;
          expect(can(edition, role, item.task), `${edition}/${item.id}/${role}`).toBe(true);
        }
      }
    }
  });
});

describe("flipping ONE cell changes exactly one capability", () => {
  it("removes only the item that names the task", () => {
    const role: Role = "program_manager";
    const before = navForUser("incubator", role, permissionLookup("incubator", role)).map((i) => i.id);
    const off = override("incubator", role, "signuppipeline", false);
    const after = navForUser("incubator", role, permissionLookup("incubator", role, off)).map((i) => i.id);
    expect(before.filter((id) => !after.includes(id))).toEqual(["incuration"]);
    expect(after.filter((id) => !before.includes(id))).toEqual([]);
  });

  it("leaves every other role alone when one role's cell is closed", () => {
    const off = override("incubator", "program_manager", "signuppipeline", false);
    for (const role of ROLES_BY_EDITION.incubator) {
      if (role === "program_manager") continue;
      expect(
        navForUser("incubator", role, permissionLookup("incubator", role, off)).map((i) => i.id),
        role,
      ).toEqual(navForUser("incubator", role).map((i) => i.id));
    }
  });

  it("cannot GRANT a screen the role list withholds — gate, not grant (§8 Q8)", () => {
    // `jury` is not in `upload`'s roles list. Ticking the cell changes nothing:
    // the permission ANDs onto the role rule, it does not replace it.
    const on = override("incubator", "jury", "upload", true);
    expect(can("incubator", "jury", "upload", on)).toBe(true);
    expect(navForUser("incubator", "jury", permissionLookup("incubator", "jury", on)).map((i) => i.id)).not.toContain(
      "upload",
    );
  });
});

// ── The server call sites, read out of the source ───────────────────────────
//
// Every `requireTask(task, ...roles)` must be a no-op on the default seed, or
// landing this session silently 403s a role that works today. Parsing the source
// means a call site added later is checked too, without anyone remembering to.

/** Every server source, read at build time — `test/unit` has no node types. */
const SERVER_SOURCES = import.meta.glob("../../src/server/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface CallSite {
  file: string;
  task: string;
  roles: string[];
}

function parseRequireTaskCalls(): CallSite[] {
  const out: CallSite[] = [];
  for (const [file, src] of Object.entries(SERVER_SOURCES)) {
    // Resolve `...CONST` spreads against `const CONST = [...] as const` in the
    // same file — decks.ts names its role lists rather than inlining them.
    const consts = new Map<string, string[]>();
    for (const m of src.matchAll(/const (\w+_ROLES) = \[([^\]]*)\]/g)) {
      consts.set(m[1], [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1]));
    }
    for (const m of src.matchAll(/requireTask\(\s*"(\w+)"\s*,([^)]*)\)/g)) {
      const roles = [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1]);
      for (const spread of m[2].matchAll(/\.\.\.(\w+)/g)) {
        roles.push(...(consts.get(spread[1]) ?? []));
      }
      out.push({ file, task: m[1], roles });
    }
  }
  return out;
}

describe("requireTask call sites", () => {
  const calls = parseRequireTaskCalls();

  it("finds the re-pointed guards (a regex that matches nothing proves nothing)", () => {
    expect(calls.length).toBeGreaterThanOrEqual(25);
    expect(calls.every((c) => c.roles.length > 0)).toBe(true);
    // The spread forms in decks.ts must have resolved to real role lists.
    const onboarding = calls.find((c) => c.file.endsWith("decks.ts") && c.task === "onboard");
    expect(onboarding?.roles).toContain("program_manager");
  });

  it("is a no-op on the default seed for every task, role and edition", () => {
    const broken: string[] = [];
    for (const { file, task, roles } of calls) {
      for (const edition of EDITIONS) {
        for (const role of roles) {
          // Only roles that exist in this edition can reach this route here.
          if (!(ROLES_BY_EDITION[edition] as readonly string[]).includes(role)) continue;
          if (!can(edition, role, task)) broken.push(`${file}: ${edition}/${role} loses "${task}"`);
        }
        // The superuser keeps its bypass on the role list but not on the grid.
        if (!can(edition, "superuser", task)) broken.push(`${file}: ${edition}/superuser loses "${task}"`);
      }
    }
    expect(broken).toEqual([]);
  });
});
