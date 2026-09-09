/**
 * The `role_permissions` seed (migration 0029) is a literal in
 * `src/shared/types.ts` — it has to be, because `nav.ts` will import that module
 * once W3-A wires the runtime engine, and a cycle would be worse than a
 * duplicated fact.
 *
 * This file is the guard on that duplication. It re-derives the matrix from the
 * two things that actually decide what a role can do today — the nav manifest
 * and the pipeline transition tables — and fails if the literal has drifted.
 * When W3-A or a later wave legitimately changes a role's reach, this test goes
 * red and the seed has to be updated in the same commit.
 */
import { describe, it, expect } from "vitest";
import { NAV_BY_EDITION, canSeeNav } from "../../src/shared/nav";
import { getPipeline } from "../../src/pipeline";
import { ROLES_BY_EDITION, type Edition, type Role } from "../../src/shared/roles";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_ROLES,
  PERMISSION_TASKS,
  permissionTasksFor,
} from "../../src/shared/types";

const EDITIONS: Edition[] = ["incubator", "vc"];

/**
 * Roles that can reach at least one of `slugs` in the shipped nav manifest.
 * A slug that exists in only one edition (`jassigned` is the incubator jury's
 * own evaluation surface) simply contributes nothing to the other.
 */
function rolesForNav(edition: Edition, slugs: readonly string[]): Set<Role> {
  const out = new Set<Role>();
  let matched = 0;
  for (const slug of slugs) {
    const item = NAV_BY_EDITION[edition].find((i) => i.id === slug);
    if (!item) continue;
    matched++;
    for (const role of PERMISSION_ROLES[edition]) {
      if (canSeeNav(role, item)) out.add(role);
    }
  }
  expect(matched, `${edition}: none of ${slugs.join(",")} is a nav slug`).toBeGreaterThan(0);
  return out;
}

/** Roles that may perform at least one of `actions` from any stage. */
function rolesForActions(edition: Edition, actions: readonly string[]): Set<Role> {
  const out = new Set<Role>();
  for (const t of getPipeline(edition).transitions) {
    if (!actions.includes(t.action)) continue;
    for (const role of t.roles) {
      if ((PERMISSION_ROLES[edition] as readonly Role[]).includes(role)) out.add(role);
    }
  }
  expect(out.size, `${edition}: no transition matched ${actions.join(",")}`).toBeGreaterThan(0);
  return out;
}

describe("permission task vocabulary", () => {
  it("is the prototype's 21 × 5 incubator and 24 × 6 investor grid", () => {
    expect(permissionTasksFor("incubator")).toHaveLength(21);
    expect(permissionTasksFor("vc")).toHaveLength(24);
    expect(PERMISSION_ROLES.incubator).toHaveLength(5);
    expect(PERMISSION_ROLES.vc).toHaveLength(6);
  });

  it("uses unique task ids and lists every task in at least one edition", () => {
    const ids = PERMISSION_TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PERMISSION_TASKS.every((t) => t.editions.length > 0)).toBe(true);
  });

  it("names a source for every task, and slugs/actions only where they apply", () => {
    for (const task of PERMISSION_TASKS) {
      if (task.source === "nav") expect(task.navSlugs?.length, task.id).toBeGreaterThan(0);
      if (task.source === "action") expect(task.actions?.length, task.id).toBeGreaterThan(0);
      if (task.source === "none" || task.source === "route") {
        expect(task.navSlugs, task.id).toBeUndefined();
      }
    }
  });

  it("covers only roles that exist in their edition, and never founder or mentor", () => {
    for (const edition of EDITIONS) {
      for (const role of PERMISSION_ROLES[edition]) {
        expect(ROLES_BY_EDITION[edition], `${edition}/${role}`).toContain(role);
      }
      expect(PERMISSION_ROLES[edition]).not.toContain("founder" as Role);
    }
  });
});

describe("DEFAULT_ROLE_PERMISSIONS reproduces today's matrix", () => {
  it("has exactly one entry per task in each edition", () => {
    for (const edition of EDITIONS) {
      const tasks = permissionTasksFor(edition).map((t) => t.id).sort();
      expect(Object.keys(DEFAULT_ROLE_PERMISSIONS[edition]).sort()).toEqual(tasks);
    }
  });

  it("matches the nav manifest for every nav-backed task", () => {
    for (const edition of EDITIONS) {
      for (const task of permissionTasksFor(edition)) {
        if (task.source !== "nav") continue;
        const derived = [...rolesForNav(edition, task.navSlugs!)].sort();
        const seeded = [...DEFAULT_ROLE_PERMISSIONS[edition][task.id]].sort();
        expect(seeded, `${edition}/${task.id}`).toEqual(derived);
      }
    }
  });

  it("matches the pipeline transition table for every action-backed task", () => {
    for (const edition of EDITIONS) {
      for (const task of permissionTasksFor(edition)) {
        if (task.source !== "action") continue;
        const derived = [...rolesForActions(edition, task.actions!)].sort();
        const seeded = [...DEFAULT_ROLE_PERMISSIONS[edition][task.id]].sort();
        expect(seeded, `${edition}/${task.id}`).toEqual(derived);
      }
    }
  });

  it("grants the superuser every task — it holds the bypass everywhere else", () => {
    for (const edition of EDITIONS) {
      for (const task of permissionTasksFor(edition)) {
        expect(DEFAULT_ROLE_PERMISSIONS[edition][task.id], `${edition}/${task.id}`).toContain("superuser");
      }
    }
  });

  it("never grants a task to a role outside its edition", () => {
    for (const edition of EDITIONS) {
      for (const [taskId, roles] of Object.entries(DEFAULT_ROLE_PERMISSIONS[edition])) {
        for (const role of roles) {
          expect(PERMISSION_ROLES[edition], `${edition}/${taskId}/${role}`).toContain(role);
        }
      }
    }
  });

  it("keeps admin-console access to admin and superuser in both editions", () => {
    for (const edition of EDITIONS) {
      expect([...DEFAULT_ROLE_PERMISSIONS[edition].adminconsole].sort()).toEqual(["admin", "superuser"]);
    }
  });
});
