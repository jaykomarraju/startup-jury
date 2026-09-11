import { describe, it, expect } from "vitest";
import {
  AUDIT_BADGES,
  AUDIT_RETENTION_CHOICES,
  auditQueryString,
  auditTimeLabel,
  isAuditCategory,
  isValidRetention,
  MIN_AUDIT_RETENTION_DAYS,
  PROTOTYPE_AUDIT_CATEGORIES,
  retentionLabel,
  shortActorName,
} from "../../src/shared/audit";

/**
 * W3-C — the pure half of the audit log: the badge vocabulary, the actor
 * abbreviation and the `.log-t` time rule, all of which are read straight off
 * the prototype (`admin/s-al.html` + `admin/_style.css:120-129`) and must stay
 * read off it.
 */

describe("category badges", () => {
  it("carries the prototype's four labels and its two hex pairs", () => {
    expect(PROTOTYPE_AUDIT_CATEGORIES).toEqual(["config", "score", "team", "billing"]);
    expect(AUDIT_BADGES.config).toEqual({ label: "Config", bg: "#FAEEDA", fg: "#633806" });
    expect(AUDIT_BADGES.score).toEqual({ label: "Score", bg: "#E6F1FB", fg: "#0C447C" });
    expect(AUDIT_BADGES.team).toEqual({ label: "Team", bg: "#E0F2EC", fg: "#085041" });
    // `.lb-b` is the one the prototype expressed as tokens, so it themes.
    expect(AUDIT_BADGES.billing.bg).toBe("var(--color-olive-lt)");
  });

  it("gives the two categories 0030 added a badge too, so no row renders bare", () => {
    expect(AUDIT_BADGES.pipeline.label).toBe("Pipeline");
    expect(AUDIT_BADGES.security.label).toBe("Security");
  });

  it("rejects anything outside the six", () => {
    expect(isAuditCategory("config")).toBe(true);
    expect(isAuditCategory("gossip")).toBe(false);
    expect(isAuditCategory(null)).toBe(false);
  });
});

describe("shortActorName — the `.log-u` form", () => {
  it("abbreviates to the prototype's 'Nisha K.'", () => {
    expect(shortActorName("Nisha Kapoor")).toBe("Nisha K.");
    expect(shortActorName("rajesh  kumar")).toBe("rajesh K.");
  });

  it("leaves a single name and an existing abbreviation alone", () => {
    expect(shortActorName("Priya")).toBe("Priya");
    expect(shortActorName("Priya S.")).toBe("Priya S.");
    expect(shortActorName("Priya S")).toBe("Priya S.");
  });

  it("falls back to AI for a machine actor", () => {
    expect(shortActorName(null)).toBe("AI");
    expect(shortActorName("   ")).toBe("AI");
  });
});

describe("auditTimeLabel — relative, then absolute", () => {
  const now = new Date(2026, 5, 4, 14, 0, 0); // 4 Jun 2026, local

  const local = (y: number, m: number, d: number, h = 0, min = 0) =>
    new Date(y, m, d, h, min).toISOString();

  it("renders today as a lowercase clock time", () => {
    expect(auditTimeLabel(local(2026, 5, 4, 11, 42), now)).toBe("11:42 am");
    expect(auditTimeLabel(local(2026, 5, 4, 13, 5), now)).toBe("1:05 pm");
    expect(auditTimeLabel(local(2026, 5, 4, 0, 30), now)).toBe("12:30 am");
    expect(auditTimeLabel(local(2026, 5, 4, 12, 0), now)).toBe("12:00 pm");
  });

  it("renders yesterday as the word, as the prototype's seed does", () => {
    expect(auditTimeLabel(local(2026, 5, 3, 16, 20), now)).toBe("Yesterday");
  });

  it("renders anything older as day + month", () => {
    expect(auditTimeLabel(local(2026, 5, 2, 15, 30), now)).toBe("2 Jun");
    expect(auditTimeLabel(local(2026, 0, 9, 9, 0), now)).toBe("9 Jan");
  });

  it("adds the year once the date leaves the current one", () => {
    expect(auditTimeLabel(local(2025, 5, 3, 9, 0), now)).toBe("3 Jun 25");
  });

  it("survives a value it cannot parse rather than rendering Invalid Date", () => {
    expect(auditTimeLabel("not-a-date", now)).toBe("not-a-date");
  });
});

describe("retention", () => {
  it("offers 'keep everything' first — the shipped default", () => {
    expect(AUDIT_RETENTION_CHOICES[0]).toBe(null);
    expect(retentionLabel(null)).toBe("Keep everything");
    expect(retentionLabel(365)).toBe("1 year");
    expect(retentionLabel(90)).toBe("3 months");
    expect(retentionLabel(45)).toBe("45 days");
  });

  it("floors a window at 30 days and refuses anything shorter or fractional", () => {
    expect(isValidRetention(null)).toBe(true);
    expect(isValidRetention(MIN_AUDIT_RETENTION_DAYS)).toBe(true);
    expect(isValidRetention(29)).toBe(false);
    expect(isValidRetention(0)).toBe(false);
    expect(isValidRetention(-1)).toBe(false);
    expect(isValidRetention(30.5)).toBe(false);
    expect(isValidRetention("90")).toBe(false);
  });
});

describe("auditQueryString", () => {
  it("repeats `category` so several can be filtered at once", () => {
    expect(auditQueryString({ categories: ["config", "team"] })).toBe(
      "category=config&category=team",
    );
  });

  it("omits every empty field", () => {
    expect(auditQueryString({})).toBe("");
    expect(auditQueryString({ q: "", actorId: "" })).toBe("");
  });

  it("carries the filter surface F0059 says the section needs", () => {
    const qs = new URLSearchParams(
      auditQueryString({ actorId: "u1", from: "2026-06-01", to: "2026-06-04", q: "threshold", limit: 50, cursor: "c" }),
    );
    expect(qs.get("actorId")).toBe("u1");
    expect(qs.get("from")).toBe("2026-06-01");
    expect(qs.get("to")).toBe("2026-06-04");
    expect(qs.get("q")).toBe("threshold");
    expect(qs.get("limit")).toBe("50");
    expect(qs.get("cursor")).toBe("c");
  });
});
