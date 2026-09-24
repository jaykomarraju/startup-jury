import { describe, it, expect } from "vitest";
import {
  navForUser,
  navLabel,
  navIcon,
  canAccessNav,
  isInSidebar,
  reachableNav,
  landingNavId,
  navItemById,
  NAV_BY_EDITION,
  type NavItem,
} from "../../src/shared/nav";
import {
  INCUBATOR_ROLES,
  VC_ROLES,
  canSeeEvaluatorScores,
  evaluationRank,
  type Role,
  type Edition,
} from "../../src/shared/roles";
import { getPipeline } from "../../src/pipeline";

const ids = (items: NavItem[]) => items.map((i) => i.id);

describe("nav manifest", () => {
  it("superuser sees the full shared set (no portal or role-exclusive items)", () => {
    for (const edition of ["incubator", "vc"] as Edition[]) {
      const full = NAV_BY_EDITION[edition]
        .filter((i) => !i.portal && !i.exclusive)
        .map((i) => i.id);
      // REACHABILITY is still the full superset — V3-NAV's `hiddenFor` takes an
      // item out of the sidebar, never away from the role.
      expect(ids(reachableNav(edition, "superuser"))).toEqual(full);
      // The SIDEBAR is that set minus `hiddenFor`, and it is a strict subset
      // only where the V3 prototype actually removed an item.
      const hidden = NAV_BY_EDITION[edition]
        .filter((i) => i.hiddenFor?.includes("superuser"))
        .map((i) => i.id);
      expect(new Set(ids(navForUser(edition, "superuser")))).toEqual(
        new Set(full.filter((id) => !hidden.includes(id))),
      );
    }
    // Superuser does not inherit a jury member's personalized reports.
    const su = ids(navForUser("incubator", "superuser"));
    expect(su).not.toContain("repscores");
    expect(su).not.toContain("jassigned");
    // Includes the Settings "Set up" wizard (Session 2) and the Session 4
    // admin/account/billing screens.
    expect(su).toContain("setup");
    expect(su).toContain("admin");
    expect(su).toContain("account");
    expect(su).toContain("billing");
    // Session 7 added the internal issue log.
    expect(su).toContain("issues");
    // V3 item 15 added JURYbuddy.
    expect(su).toContain("help");
    // 25 on main; V3 item 10 removes the standalone Evaluate item (see below)
    // and item 15 adds Help, so the two cancel back to 25.
    expect(su).toHaveLength(25);
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
    // R1-DASH — the incubator STAFF roles now read "Dashboard" (item 10a); the
    // base label survives for the jury and for every VC role.
    expect(navLabel("admin", item)).toBe("Dashboard");
    expect(navLabel("analyst", navItemById("vc", "alldecks")!)).toBe("All decks");
    expect(navLabel("jury", navItemById("incubator", "jurypipeline")!)).toBe("Evaluated");
    expect(navLabel("ic_member", navItemById("vc", "curation")!)).toBe("Invest ready");
  });

  it("canAccessNav mirrors REACHABILITY, not the sidebar, and rejects unknown slugs", () => {
    for (const edition of ["incubator", "vc"] as Edition[]) {
      const roles = edition === "incubator" ? INCUBATOR_ROLES : VC_ROLES;
      for (const role of roles) {
        const reachable = new Set(ids(reachableNav(edition, role)));
        const sidebar = new Set(ids(navForUser(edition, role)));
        for (const item of NAV_BY_EDITION[edition]) {
          // The route guard follows reachability...
          expect(canAccessNav(edition, role, item.id)).toBe(reachable.has(item.id));
          // ...and the sidebar can only ever be narrower, never wider.
          if (sidebar.has(item.id)) expect(reachable.has(item.id)).toBe(true);
          // The two agree on everything that is not explicitly hidden.
          if (!item.hiddenFor?.includes(role)) {
            expect(sidebar.has(item.id)).toBe(reachable.has(item.id));
          }
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
    expect(pa).toContain("incuration");
    expect(pa).not.toContain("jurypipeline");
    // Aug-2026 issue 26/28: Prog Manager Pipeline is the PM's surface, and
    // "For Sign up" was deleted from the product.
    expect(pa).not.toContain("pmpipeline");
    expect(pa).not.toContain("forsignup");
    expect(pa).not.toContain("coreparams");

    const pm = new Set(ids(navForUser("incubator", "program_manager")));
    expect(pm).toContain("upload");
    expect(pm).toContain("assign");
    // PM is the decision maker (Session 4): oversees the jury pipeline + decides
    // the intro call. Still not the executor's sign-up task.
    expect(pm).toContain("jurypipeline");
    expect(pm).toContain("introcalls");
    expect(pm).toContain("setup");
    expect(pm).toContain("pmpipeline");
    expect(pm).not.toContain("forsignup");
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

  // ── Evaluation hierarchy (Aug-2026 issue 21) ────────────────────────────────
  it("lets an evaluator see at or below their own rank, never above", () => {
    // Incubator ladder: program associate → jury → program manager.
    expect(canSeeEvaluatorScores("incubator", "program_associate", "jury")).toBe(false);
    expect(canSeeEvaluatorScores("incubator", "program_associate", "program_manager")).toBe(false);
    expect(canSeeEvaluatorScores("incubator", "jury", "program_associate")).toBe(true);
    expect(canSeeEvaluatorScores("incubator", "jury", "program_manager")).toBe(false);
    expect(canSeeEvaluatorScores("incubator", "program_manager", "jury")).toBe(true);
    // Your own level is always visible.
    expect(canSeeEvaluatorScores("incubator", "jury", "jury")).toBe(true);
    // Admin / superuser oversee the whole workspace.
    expect(canSeeEvaluatorScores("incubator", "admin", "program_manager")).toBe(true);
    expect(canSeeEvaluatorScores("incubator", "superuser", "program_manager")).toBe(true);
    // A founder has no rank and sees no evaluator.
    expect(canSeeEvaluatorScores("incubator", "founder", "program_associate")).toBe(false);
  });

  // ── V3 — the reshared incubator superuser prototype (V3-NAV) ───────────────
  //
  // Every literal below is copied from `AISJ_SuperuserV3/_sidebar.html`, not
  // imported from nav.ts, so renaming an item in the manifest fails here.
  //
  // The four other incubator prototypes were NOT reshared, so their sidebars
  // must still render exactly as they did on `main`. Those lists are pinned
  // verbatim for the same reason: they are the regression test for this change.

  it("draws the incubator superuser sidebar exactly as AISJ_SuperuserV3 does", () => {
    // `si-*` order from the prototype's Workflows + Evaluation groups, with the
    // prototype's own `forsignup` mapped to the app's `pmpipeline` slug and the
    // two recorded parity extras (`billing`, `issues`) in their app positions.
    expect(ids(navForUser("incubator", "superuser"))).toEqual([
      "alldecks",
      "upload",
      "query",
      // no "evaluate" — V3 deletes the standalone item (item 10)
      "assign",
      "jurypipeline",
      "introcalls", // V3 swaps these two...
      "pmpipeline", // ...`forsignup` in the prototype
      "incuration",
      "curation",
      "archive",
      "cohortsummary",
      "evaluatorscores",
      "scoredrift",
      "funnel",
      "coreparams",
      "myparams",
      "setup",
      "account",
      "admin",
      "billing",
      "contactadmin",
      "contactteam",
      "help", // V3 item 15 — first in Support, per the spec's own routing copy
      "support",
      "issues",
    ]);
  });

  it("renames All decks for every incubator STAFF role, and Upload for V3-UP's two (items 8, 18, 10a)", () => {
    const alldecks = navItemById("incubator", "alldecks")!;
    const upload = navItemById("incubator", "upload")!;

    // ── Item 10a · the other half of `isV3Dash` ─────────────────────────────
    // R1-DASH widens the V3 Dashboard to the admin, programme manager and
    // programme associate, so their sidebar has to be renamed WITH it: the
    // screen's own `homeTitle` renders "Dashboard" for all four now, and a
    // sidebar reading "All decks" over that H1 is the outcome §6 Q-B rules out.
    for (const role of ["superuser", "admin", "program_manager", "program_associate"] as Role[]) {
      expect(navLabel(role, alldecks), role).toBe("Dashboard");
      expect(navIcon(role, alldecks), role).toBe("LayoutDashboard");
    }

    // ── The jury is the control, and it is the whole control ────────────────
    // They keep the v15 screen (plan §5 item 1 — `isJury` shadows `isV3Dash`,
    // so widening to them would be dead code AND would delete a screen that
    // already matches their prototype). Their sidebar must say so.
    expect(navLabel("jury", alldecks)).toBe("My Pipeline");
    expect(navIcon("jury", alldecks)).toBe("Layers");
    // The base label/icon are still the base — this is an override, not a rename.
    expect(alldecks.label).toBe("All decks");
    expect(alldecks.icon).toBe("Layers");

    // ── Item 8 · Upload & Evaluate ─────────────────────────────────────────
    // R1 makes this line on R2-UPEVAL's behalf (`nav.ts` has one owner this
    // wave), for V3-UP's two EXTEND roles only.
    for (const role of ["superuser", "admin", "program_associate"] as Role[]) {
      expect(navLabel(role, upload), role).toBe("Upload & Evaluate");
    }
    // The programme manager is NOT renamed: their own prototype draws a
    // different multi-select Evaluate, so which screen they get is open as Q-P.
    // This assertion flips when the client answers it — not before.
    expect(navLabel("program_manager", upload)).toBe("Upload");

    // The VC edition was not rescoped at all, by either item.
    for (const role of ["superuser", "admin", "partner", "analyst"] as Role[]) {
      expect(navLabel(role, navItemById("vc", "alldecks")!), role).toBe("All decks");
      expect(navIcon(role, navItemById("vc", "alldecks")!), role).toBe("Layers");
      expect(navLabel(role, navItemById("vc", "upload")!), role).toBe("Upload");
    }
  });

  it("hides Evaluate from the superuser sidebar but KEEPS the route (item 10)", () => {
    expect(ids(navForUser("incubator", "superuser"))).not.toContain("evaluate");
    // The screen is still reachable — V3-UP reaches it from Upload (§4 Q6).
    expect(canAccessNav("incubator", "superuser", "evaluate")).toBe(true);
    expect(ids(reachableNav("incubator", "superuser"))).toContain("evaluate");

    const evaluate = navItemById("incubator", "evaluate")!;
    expect(isInSidebar("superuser", evaluate)).toBe(false);
    // Nobody else is affected, in either edition.
    for (const role of ["admin", "program_manager", "program_associate"] as Role[]) {
      expect(isInSidebar(role, evaluate)).toBe(true);
      expect(ids(navForUser("incubator", role))).toContain("evaluate");
    }
    expect(ids(navForUser("vc", "superuser"))).toContain("evaluate");
  });

  it("moves Intro calls above Prog manager pipeline for the superuser ONLY (§4 Q11)", () => {
    const order = (role: Role) => {
      const list = ids(navForUser("incubator", role));
      return [list.indexOf("introcalls"), list.indexOf("pmpipeline")];
    };
    const [suIntro, suPm] = order("superuser");
    expect(suIntro).toBeGreaterThanOrEqual(0);
    expect(suIntro).toBeLessThan(suPm); // V3: … jurypipeline · introcalls · forsignup …

    // admin and program_manager are the other two roles that see both items;
    // they keep the V6/V5 prototypes' order.
    for (const role of ["admin", "program_manager"] as Role[]) {
      const [intro, pm] = order(role);
      expect(pm).toBeGreaterThanOrEqual(0);
      expect(pm).toBeLessThan(intro);
    }
  });

  it("moves ONLY the two labels R1-DASH renames; every other sidebar entry is byte-identical to main", () => {
    // Pinned from `main` (commit 6785fb5) — `id:label` in draw order.
    //
    // R1-DASH edits exactly four cells of this table and nothing else:
    //   admin             · alldecks → Dashboard · upload → Upload & Evaluate
    //   program_manager   · alldecks → Dashboard            (upload: Q-P)
    //   program_associate · alldecks → Dashboard · upload → Upload & Evaluate
    //   jury              · UNTOUCHED — it keeps the v15 screen
    // Every other entry, and every role's item COUNT, is `main`'s. That is the
    // guarantee the wave runs under: a widening must not quietly re-scope a
    // sidebar, and a diff on this table is the whole statement of what moved.
    const PINNED: Record<string, string[]> = {
      admin: [
        "alldecks:Dashboard", "upload:Upload & Evaluate", "query:Query", "evaluate:Evaluate",
        "assign:Assign", "jurypipeline:Jury Pipeline", "pmpipeline:Prog manager pipeline",
        "introcalls:Intro calls", "incuration:Sign up Pipeline", "curation:Onboard ready",
        "archive:Archive", "cohortsummary:Cohort summary", "evaluatorscores:Evaluator scores",
        "scoredrift:Score drift", "funnel:Pipeline funnel", "coreparams:Core Parameters",
        "myparams:My Parameters", "setup:Set up", "account:My account", "admin:Admin console",
        "billing:Buy credits", "contactadmin:Contact Admin", "contactteam:Contact team",
        "help:Help", "support:Tickets", "issues:Issue log",
      ],
      program_manager: [
        "alldecks:Dashboard", "upload:Upload", "query:Query", "evaluate:Evaluate",
        "assign:Assign", "jurypipeline:Jury Pipeline", "pmpipeline:Prog manager pipeline",
        "introcalls:Intro calls", "incuration:Sign up Pipeline", "curation:Onboard ready",
        "archive:Archive", "cohortsummary:Cohort summary", "evaluatorscores:Evaluator scores",
        "scoredrift:Score drift", "funnel:Pipeline funnel", "myparams:My Parameters",
        "setup:Set up", "account:My account", "contactadmin:Contact Admin",
        "contactteam:Contact team", "help:Help", "issues:Issue log",
      ],
      program_associate: [
        "alldecks:Dashboard", "upload:Upload & Evaluate", "query:Query", "evaluate:Evaluate",
        "assign:Assign", "introcalls:Intro calls", "incuration:Sign up Pipeline",
        "curation:Onboard ready", "archive:Archive", "cohortsummary:Cohort summary",
        "evaluatorscores:Evaluator scores", "scoredrift:Score drift", "funnel:Pipeline funnel",
        "myparams:My Parameters", "setup:Set up", "account:My account",
        "contactadmin:Contact Admin", "contactteam:Contact team", "help:Help",
        "issues:Issue log",
      ],
      jury: [
        "alldecks:My Pipeline", "jassigned:Assigned", "jurypipeline:Evaluated",
        "introcalls:My Intro calls", "archive:My Archive",
        "repdecks:My decks summary", "repscores:My Scores", "repdrift:My scores drift",
        "myparams:My Parameters", "account:My account", "contactadmin:Contact Admin",
        "contactteam:Contact team", "help:Help", "issues:Issue log",
      ],
    };
    for (const [role, expected] of Object.entries(PINNED)) {
      const got = navForUser("incubator", role as Role).map((i) => `${i.id}:${navLabel(role as Role, i)}`);
      expect(got, `incubator/${role} sidebar changed`).toEqual(expected);
    }
  });

  it("keeps every VC sidebar the size it was — the VC edition was not rescoped", () => {
    // VC was untouched by V3; these counts are `main`'s.
    const SIZES: Record<string, number> = {
      superuser: 32, admin: 32, partner: 25, ic_member: 19, associate: 19, analyst: 13,
    };
    for (const [role, n] of Object.entries(SIZES)) {
      expect(navForUser("vc", role as Role), `vc/${role}`).toHaveLength(n);
    }
    expect(NAV_BY_EDITION.vc.some((i) => i.hiddenFor || i.iconOverrides)).toBe(false);
  });

  it("the order override is position-preserving and cannot change the landing slug", () => {
    // Every role's first sidebar item is unchanged, so `landingNavId` is safe.
    expect(landingNavId("incubator", "superuser")).toBe("alldecks");
    // And the override only ever permutes — never adds, drops or duplicates.
    for (const edition of ["incubator", "vc"] as Edition[]) {
      const roles = edition === "incubator" ? INCUBATOR_ROLES : VC_ROLES;
      for (const role of [...roles, "superuser" as Role]) {
        const sidebar = ids(navForUser(edition, role));
        const expected = ids(NAV_BY_EDITION[edition].filter((i) => isInSidebar(role, i)));
        expect(new Set(sidebar), `${edition}/${role}`).toEqual(new Set(expected));
        expect(sidebar).toHaveLength(expected.length);
        expect(new Set(sidebar).size).toBe(sidebar.length);
      }
    }
  });

  it("applies the same rule along the VC ladder", () => {
    expect(evaluationRank("vc", "analyst")).toBeLessThan(evaluationRank("vc", "associate"));
    expect(evaluationRank("vc", "associate")).toBeLessThan(evaluationRank("vc", "partner"));
    expect(evaluationRank("vc", "partner")).toBeLessThan(evaluationRank("vc", "ic_member"));
    expect(canSeeEvaluatorScores("vc", "analyst", "partner")).toBe(false);
    expect(canSeeEvaluatorScores("vc", "ic_member", "partner")).toBe(true);
  });
});
