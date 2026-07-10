import { describe, it, expect } from "vitest";
import {
  navForUser,
  navLabel,
  canAccessNav,
  landingNavId,
  navItemById,
  NAV_BY_EDITION,
  type NavItem,
} from "../../src/shared/nav";
import { INCUBATOR_ROLES, VC_ROLES, type Role, type Edition } from "../../src/shared/roles";
import { getPipeline } from "../../src/pipeline";

const ids = (items: NavItem[]) => items.map((i) => i.id);

describe("nav manifest", () => {
  it("superuser sees the full shared set (no portal or role-exclusive items)", () => {
    for (const edition of ["incubator", "vc"] as Edition[]) {
      const full = NAV_BY_EDITION[edition]
        .filter((i) => !i.portal && !i.exclusive)
        .map((i) => i.id);
      expect(ids(navForUser(edition, "superuser"))).toEqual(full);
    }
    // Superuser does not inherit a jury member's personalized reports.
    const su = ids(navForUser("incubator", "superuser"));
    expect(su).not.toContain("repscores");
    expect(su).not.toContain("jassigned");
    expect(su).toHaveLength(20);
  });

  it("founder sees only the founder portal; internal roles never see portal items", () => {
    const founderNav = navForUser("incubator", "founder");
    expect(founderNav.length).toBeGreaterThan(0);
    expect(founderNav.every((i) => i.portal === "founder")).toBe(true);

    for (const role of INCUBATOR_ROLES.filter((r) => r !== "founder")) {
      expect(navForUser("incubator", role).some((i) => i.portal)).toBe(false);
    }
  });

  it("applies per-role label overrides (jury sees personalized labels)", () => {
    const item = navItemById("incubator", "alldecks")!;
    expect(navLabel("jury", item)).toBe("My Pipeline");
    expect(navLabel("admin", item)).toBe("All decks");
    expect(navLabel("jury", navItemById("incubator", "jurypipeline")!)).toBe("Evaluated");
    expect(navLabel("ic_member", navItemById("vc", "curation")!)).toBe("Invest ready");
  });

  it("canAccessNav agrees with navForUser and rejects unknown/forbidden slugs", () => {
    for (const edition of ["incubator", "vc"] as Edition[]) {
      const roles = edition === "incubator" ? INCUBATOR_ROLES : VC_ROLES;
      for (const role of roles) {
        const visible = new Set(ids(navForUser(edition, role)));
        for (const item of NAV_BY_EDITION[edition]) {
          expect(canAccessNav(edition, role, item.id)).toBe(visible.has(item.id));
        }
      }
    }
    expect(canAccessNav("incubator", "admin", "does-not-exist")).toBe(false);
  });

  it("landingNavId returns the first visible item", () => {
    expect(landingNavId("incubator", "admin")).toBe("alldecks");
    expect(landingNavId("incubator", "founder")).toBe("founder-home");
    expect(landingNavId("vc", "ic_member")).toBe("alldecks");
  });

  // ── Permission-matrix trimming (incubator role×stage matrix) ────────────────
  it("trims incubator nav per the permission matrix", () => {
    const jury = new Set(ids(navForUser("incubator", "jury")));
    expect(jury).toContain("jurypipeline");
    expect(jury).toContain("jassigned");
    expect(jury).not.toContain("upload");
    expect(jury).not.toContain("assign");
    expect(jury).not.toContain("coreparams");

    const pa = new Set(ids(navForUser("incubator", "program_associate")));
    expect(pa).toContain("assign");
    expect(pa).toContain("introcalls");
    expect(pa).toContain("forsignup");
    expect(pa).not.toContain("jurypipeline");
    expect(pa).not.toContain("coreparams");

    const pm = new Set(ids(navForUser("incubator", "program_manager")));
    expect(pm).toContain("upload");
    expect(pm).toContain("assign");
    expect(pm).not.toContain("forsignup");
    expect(pm).not.toContain("jurypipeline");
  });

  // ── VC trimming (pipeline role-gating + IC member mockup) ────────────────────
  it("trims vc nav per role", () => {
    const analyst = new Set(ids(navForUser("vc", "analyst")));
    expect(analyst).toContain("upload");
    expect(analyst).toContain("evaluate");
    expect(analyst).toContain("scoring");
    expect(analyst).not.toContain("investmentdd");
    expect(analyst).not.toContain("legaldd");
    expect(analyst).not.toContain("icpipeline");

    const ic = new Set(ids(navForUser("vc", "ic_member")));
    expect(ic).toContain("icpipeline");
    expect(ic).toContain("investmentdd");
    expect(ic).not.toContain("upload");
    expect(ic).not.toContain("legaldd");

    const associate = new Set(ids(navForUser("vc", "associate")));
    expect(associate).toContain("jurypipeline");
    expect(associate).not.toContain("partnercall");
  });

  // ── Consistency with the pipeline state machine ─────────────────────────────
  it("every role that can act in the pipeline has the deck overview nav", () => {
    for (const edition of ["incubator", "vc"] as Edition[]) {
      const actingRoles = new Set<Role>();
      for (const t of getPipeline(edition).transitions) {
        for (const r of t.roles) actingRoles.add(r);
      }
      for (const role of actingRoles) {
        if (role === "founder") continue; // founder uses the isolated portal
        const nav = new Set(ids(navForUser(edition, role)));
        expect(nav.has("alldecks")).toBe(true);
      }
    }
  });
});
