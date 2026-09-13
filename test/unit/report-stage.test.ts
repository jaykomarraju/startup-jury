import { describe, it, expect } from "vitest";
import {
  parseReportStage,
  reportLayout,
  reportStageForScreen,
  type ReportLayout,
} from "../../src/shared/reportStage";

// W7-D — incubator spec §8.4, the rule on its own. The worker test proves the
// route applies it; this proves the rule is the spec's.

const shape = (l: ReportLayout) => l.sections.map((s) => `${s.role}:${s.mode}`);

describe("the originating screen decides the stage", () => {
  it("maps Assign, the jury's Assigned and Intro calls; everything else is the default", () => {
    expect(reportStageForScreen("assign")).toBe("assign");
    expect(reportStageForScreen("jassigned")).toBe("assign");
    expect(reportStageForScreen("introcalls")).toBe("intro");
    for (const other of ["evaluate", "jurypipeline", "pmpipeline", "incuration", "curation", "alldecks", undefined, null, ""]) {
      expect(reportStageForScreen(other)).toBe("default");
    }
  });

  it("parses only the two stages §13 names", () => {
    expect(parseReportStage("assign")).toBe("assign");
    expect(parseReportStage("intro")).toBe("intro");
    for (const junk of ["ASSIGN", "signup", "", undefined, 3, null]) {
      expect(parseReportStage(junk)).toBe("default");
    }
  });
});

describe("incubator — staff viewers", () => {
  it("Assign → Program associate + Program manager, and no jury section", () => {
    expect(shape(reportLayout("incubator", "assign", "program_manager"))).toEqual([
      "program_associate:read_only",
      "program_manager:editable",
    ]);
    expect(shape(reportLayout("incubator", "assign", "program_associate"))).toEqual([
      "program_associate:editable",
      "program_manager:read_only",
    ]);
  });

  it("Intro calls → PA + PM + Jury, the jury section read-only 'completed'", () => {
    const l = reportLayout("incubator", "intro", "program_manager");
    expect(shape(l)).toEqual(["program_associate:read_only", "program_manager:editable", "jury:completed"]);
    expect(l.stageAware).toBe(true);
  });

  it("any other stage is single-role — the viewer's own lens", () => {
    expect(shape(reportLayout("incubator", "default", "program_associate"))).toEqual(["program_associate:editable"]);
    expect(shape(reportLayout("incubator", "default", "program_manager"))).toEqual(["program_manager:editable"]);
  });

  it("an overseer owns no role, so the default keeps every role as reference and never edits", () => {
    for (const role of ["admin", "superuser"] as const) {
      const l = reportLayout("incubator", "default", role);
      expect(shape(l)).toEqual(["program_associate:read_only", "program_manager:read_only", "jury:read_only"]);
      expect(shape(reportLayout("incubator", "assign", role))).toEqual([
        "program_associate:read_only",
        "program_manager:read_only",
      ]);
      expect(shape(reportLayout("incubator", "intro", role))).toEqual([
        "program_associate:read_only",
        "program_manager:read_only",
        "jury:completed",
      ]);
    }
  });
});

describe("incubator — the Jury file", () => {
  it("Assigned adds a Program associate reference section; the jury's own stay editable", () => {
    expect(shape(reportLayout("incubator", "assign", "jury"))).toEqual(["program_associate:read_only", "jury:editable"]);
  });

  it("Intro calls adds PA + PM reference sections; the jury's own stay editable", () => {
    expect(shape(reportLayout("incubator", "intro", "jury"))).toEqual([
      "program_associate:read_only",
      "program_manager:read_only",
      "jury:editable",
    ]);
  });

  it("elsewhere the jury sees only its own three", () => {
    expect(shape(reportLayout("incubator", "default", "jury"))).toEqual(["jury:editable"]);
  });

  it("the two stages a juror can open the report from genuinely differ", () => {
    expect(shape(reportLayout("incubator", "assign", "jury"))).not.toEqual(
      shape(reportLayout("incubator", "intro", "jury")),
    );
  });
});

describe("VC is not stage-aware yet, and says so", () => {
  it("keeps every owning role with the viewer's own editable, whatever the stage", () => {
    for (const stage of ["assign", "intro", "default"] as const) {
      const l = reportLayout("vc", stage, "partner");
      expect(l.stageAware).toBe(false);
      expect(shape(l)).toEqual(["associate:read_only", "partner:editable", "ic_member:read_only"]);
    }
  });
});
