import { describe, it, expect } from "vitest";
import {
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_BADGES,
  FUND_RECONCILE_TOLERANCE,
  LEGAL_DOCUMENT_TRANSITIONS,
  canTransitionDocument,
  fundReconcileDelta,
  fundReconcileNote,
  fundReconciles,
  fundUtilisation,
  rollUpDocumentsStatus,
  seatNote,
  seatRowState,
  seatUtilisation,
  seatlessNote,
  seatsRemaining,
  verifiableCount,
  type DocumentItem,
  type DocumentStatus,
  type FundRow,
} from "../../src/shared/signupConfig";

/**
 * W5-A — the pure half of Sign-up configuration.
 *
 * Four things this suite holds:
 *
 *  1. The document lifecycle is a CLOSED state machine — every legal move is
 *     legal and every other pair of states is not, asserted exhaustively over
 *     all 4 × 4 pairs rather than on a hand-picked few.
 *  2. The utilisation arithmetic the seat table renders, including the two
 *     cases a naive `filled / capacity` gets wrong: zero capacity, and over
 *     capacity.
 *  3. The fund-deployment percentages and the ±0.5 Cr reconciliation, including
 *     the unset-figure case that must NOT read as a balanced fund.
 *  4. The two notes each section draws, word for word from the prototype.
 */

// ── 1. The lifecycle ─────────────────────────────────────────────────────────

const LEGAL: [DocumentStatus, DocumentStatus][] = [
  ["not_requested", "awaiting"],
  ["awaiting", "submitted"],
  ["awaiting", "not_requested"],
  ["submitted", "verified"],
  ["submitted", "awaiting"],
];

describe("the document lifecycle", () => {
  it("walks not_requested → awaiting → submitted → verified", () => {
    expect(DOCUMENT_STATUSES).toEqual(["not_requested", "awaiting", "submitted", "verified"]);
    expect(canTransitionDocument("not_requested", "awaiting")).toBe(true);
    expect(canTransitionDocument("awaiting", "submitted")).toBe(true);
    expect(canTransitionDocument("submitted", "verified")).toBe(true);
  });

  it("refuses every pair that is not one of the five legal moves", () => {
    const legal = new Set(LEGAL.map(([a, b]) => `${a}>${b}`));
    for (const from of DOCUMENT_STATUSES) {
      for (const to of DOCUMENT_STATUSES) {
        expect(
          canTransitionDocument(from, to),
          `${from} → ${to} should be ${legal.has(`${from}>${to}`)}`,
        ).toBe(legal.has(`${from}>${to}`));
      }
    }
  });

  it("refuses every skip, so nothing is verified without having been submitted", () => {
    expect(canTransitionDocument("not_requested", "submitted")).toBe(false);
    expect(canTransitionDocument("not_requested", "verified")).toBe(false);
    expect(canTransitionDocument("awaiting", "verified")).toBe(false);
  });

  it("treats verified as terminal and a no-op as no transition at all", () => {
    expect(LEGAL_DOCUMENT_TRANSITIONS.verified).toEqual([]);
    for (const s of DOCUMENT_STATUSES) expect(canTransitionDocument(s, s)).toBe(false);
  });

  it("draws exactly the prototype's four badges", () => {
    expect(Object.keys(DOCUMENT_STATUS_BADGES)).toEqual([...DOCUMENT_STATUSES]);
    expect(DOCUMENT_STATUS_BADGES.not_requested).toEqual({
      label: "Not requested",
      fg: "#9A9488",
      bg: "#EEEDE7",
    });
    expect(DOCUMENT_STATUS_BADGES.awaiting).toEqual({
      label: "Awaiting",
      fg: "#8A5B06",
      bg: "#FBF0DA",
    });
    expect(DOCUMENT_STATUS_BADGES.submitted).toEqual({
      label: "Submitted",
      fg: "#185FA5",
      bg: "#E6F1FB",
    });
    expect(DOCUMENT_STATUS_BADGES.verified).toEqual({
      label: "Verified",
      fg: "#047857",
      bg: "#E7F3EC",
    });
  });
});

// ── The roll-up the Sign up Pipeline column reads ────────────────────────────

const item = (status: DocumentStatus, mandatory = true, waived = false): DocumentItem => ({
  status,
  mandatory,
  waived,
});

describe("rollUpDocumentsStatus", () => {
  it("is pending while nothing has moved past awaiting", () => {
    expect(rollUpDocumentsStatus([])).toBe("pending");
    expect(rollUpDocumentsStatus([item("not_requested"), item("awaiting")])).toBe("pending");
  });

  it("is partial once anything is submitted, verified or waived", () => {
    expect(rollUpDocumentsStatus([item("submitted"), item("awaiting")])).toBe("partial");
    expect(rollUpDocumentsStatus([item("verified"), item("awaiting")])).toBe("partial");
    expect(
      rollUpDocumentsStatus([item("awaiting"), item("awaiting", true, true)]),
    ).toBe("partial");
  });

  it("is complete when every mandatory item is verified, optional ones or not", () => {
    expect(rollUpDocumentsStatus([item("verified"), item("verified")])).toBe("complete");
    // An optional item still at not_requested never holds the roll-up back.
    expect(
      rollUpDocumentsStatus([item("verified"), item("not_requested", false)]),
    ).toBe("complete");
  });

  it("does not report complete while one mandatory item is outstanding", () => {
    expect(rollUpDocumentsStatus([item("verified"), item("submitted")])).toBe("partial");
  });

  it("counts a waived mandatory item as settled rather than outstanding", () => {
    expect(
      rollUpDocumentsStatus([item("verified"), item("awaiting", true, true)]),
    ).toBe("complete");
  });

  it("reports a set of optional items complete only once every one is settled", () => {
    expect(rollUpDocumentsStatus([item("not_requested", false)])).toBe("pending");
    expect(rollUpDocumentsStatus([item("verified", false)])).toBe("complete");
    expect(
      rollUpDocumentsStatus([item("verified", false), item("awaiting", false)]),
    ).toBe("partial");
  });
});

describe("verifiableCount", () => {
  it("counts only the submitted, unwaived items a bulk verify could advance", () => {
    expect(
      verifiableCount([
        item("submitted"),
        item("submitted", false),
        item("awaiting"),
        item("verified"),
        item("submitted", true, true),
      ]),
    ).toBe(2);
  });

  it("is zero when nothing has been submitted, which is what disables the button", () => {
    expect(verifiableCount([item("awaiting"), item("not_requested")])).toBe(0);
  });
});

// ── 2. Seat utilisation ──────────────────────────────────────────────────────

describe("seat utilisation", () => {
  it("matches the prototype's three seeded rows — 20/18, 15/9, 12/12", () => {
    expect(seatUtilisation(20, 18)).toBe(90);
    expect(seatUtilisation(15, 9)).toBe(60);
    expect(seatUtilisation(12, 12)).toBe(100);
  });

  it("rounds like `scPct`, to the nearest whole percent", () => {
    expect(seatUtilisation(3, 1)).toBe(33);
    expect(seatUtilisation(3, 2)).toBe(67);
    expect(seatUtilisation(7, 1)).toBe(14);
  });

  it("reads zero capacity as 0 %, not as a division by zero", () => {
    expect(seatUtilisation(0, 0)).toBe(0);
    expect(Number.isFinite(seatUtilisation(0, 5))).toBe(true);
    expect(seatUtilisation(0, 5)).toBe(0);
  });

  it("reports over capacity as over 100 %, and flags the row", () => {
    expect(seatRowState({ name: "x", capacity: 10, filled: 13 })).toEqual({ pct: 130, over: true });
    expect(seatRowState({ name: "x", capacity: 12, filled: 12 })).toEqual({ pct: 100, over: false });
  });

  it("never reports negative seats remaining", () => {
    expect(seatsRemaining({ name: "x", capacity: 20, filled: 18 })).toBe(2);
    expect(seatsRemaining({ name: "x", capacity: 10, filled: 13 })).toBe(0);
  });
});

describe("seatNote", () => {
  it("is the info line while every cohort is within capacity", () => {
    const note = seatNote([{ name: "Accelerator · Cohort 8", capacity: 20, filled: 18 }]);
    expect(note).toEqual({
      tone: "info",
      text: "Startups that complete sign-up without a seat are flagged seatless in the pipeline for allocation.",
    });
  });

  it("names every over-capacity cohort, and still says sign-up proceeds", () => {
    const note = seatNote([
      { name: "Accelerator · Cohort 8", capacity: 20, filled: 22 },
      { name: "Climate Track · 2026", capacity: 15, filled: 9 },
      { name: "DeepTech · Cohort 3", capacity: 12, filled: 14 },
    ]);
    expect(note.tone).toBe("warn");
    expect(note.text).toBe(
      "Over capacity: Accelerator · Cohort 8 (22/20), DeepTech · Cohort 3 (14/12). " +
        "Sign-up still proceeds, but these push past the cohort seat count.",
    );
  });
});

describe("seatlessNote", () => {
  it("pluralises the ICAdmin callout and has an all-clear", () => {
    expect(seatlessNote(0)).toBe("Every completed sign-up holds a cohort seat.");
    expect(seatlessNote(1)).toBe("1 signed record still needs a seat.");
    expect(seatlessNote(2)).toBe("2 signed records still need a seat.");
  });
});

// ── 3. Fund deployment ───────────────────────────────────────────────────────

const fund = (allotted: number | null, deployed: number | null, unutilised: number | null): FundRow => ({
  name: "Seed Fund II",
  allotted,
  deployed,
  unutilised,
});

describe("fundUtilisation", () => {
  it("matches the prototype's three seeded rows — 300/182, 500/410, 150/40", () => {
    expect(fundUtilisation({ allotted: 300, deployed: 182 })).toBe(61);
    expect(fundUtilisation({ allotted: 500, deployed: 410 })).toBe(82);
    expect(fundUtilisation({ allotted: 150, deployed: 40 })).toBe(27);
  });

  it("matches the seeded Fund II — 210 allotted, 92 deployed", () => {
    expect(fundUtilisation({ allotted: 210, deployed: 92 })).toBe(44);
  });

  it("reads an unset or zero allotment as 0 %", () => {
    expect(fundUtilisation({ allotted: null, deployed: 92 })).toBe(0);
    expect(fundUtilisation({ allotted: 0, deployed: 0 })).toBe(0);
  });

  it("reports a fund deployed past its allotment above 100 %", () => {
    expect(fundUtilisation({ allotted: 100, deployed: 120 })).toBe(120);
  });
});

describe("the ±0.5 Cr reconciliation", () => {
  it("uses the prototype's tolerance", () => {
    expect(FUND_RECONCILE_TOLERANCE).toBe(0.5);
  });

  it("reconciles the prototype's three rows exactly", () => {
    expect(fundReconciles(fund(300, 182, 118))).toBe(true);
    expect(fundReconciles(fund(500, 410, 90))).toBe(true);
    expect(fundReconciles(fund(150, 40, 110))).toBe(true);
  });

  it("accepts a drift inside the tolerance and refuses one outside it", () => {
    expect(fundReconciles(fund(300, 182, 118.5))).toBe(true);
    expect(fundReconciles(fund(300, 182, 117.5))).toBe(true);
    expect(fundReconciles(fund(300, 182, 118.6))).toBe(false);
    expect(fundReconcileDelta(fund(300, 182, 120))).toBe(2);
    expect(fundReconcileDelta(fund(300, 182, 110))).toBe(-8);
  });

  it("has nothing to reconcile when a figure is unset — and does not call that balanced", () => {
    expect(fundReconcileDelta(fund(null, null, null))).toBeNull();
    expect(fundReconcileDelta(fund(300, 182, null))).toBeNull();
    // No delta means no warning: an uncommitted fund is not a broken one.
    expect(fundReconciles(fund(300, 182, null))).toBe(true);
    expect(fundReconcileNote([fund(300, 182, null)]).tone).toBe("ok");
  });

  it("writes the prototype's two note lines, naming each offending program", () => {
    expect(fundReconcileNote([fund(300, 182, 118)])).toEqual({
      tone: "ok",
      text: "Deployed + unutilised reconciles with allotted for every program.",
    });
    const bad = fundReconcileNote([
      { name: "Seed Fund II", allotted: 300, deployed: 182, unutilised: 130 },
      { name: "Growth Fund I", allotted: 500, deployed: 410, unutilised: 90 },
      { name: "Opportunities Fund", allotted: 150, deployed: 40, unutilised: 100 },
    ]);
    expect(bad.tone).toBe("warn");
    expect(bad.text).toBe(
      "Deployed + unutilised doesn't match allotted for: Seed Fund II (+12 Cr), " +
        "Opportunities Fund (-10 Cr). Adjust so they reconcile.",
    );
  });

  it("trims the float noise a ₹ Cr sum leaves behind", () => {
    // 0.1 + 0.2 - 0.0 is 0.30000000000000004 in IEEE 754; the note must not
    // quote that at an admin.
    const note = fundReconcileNote([{ name: "F", allotted: 0, deployed: 0.1, unutilised: 0.2 }]);
    expect(note.tone).toBe("ok"); // inside ±0.5
    const over = fundReconcileNote([{ name: "F", allotted: 1, deployed: 1.1, unutilised: 0.6 }]);
    expect(over.text).toContain("(+0.7 Cr)");
  });
});
