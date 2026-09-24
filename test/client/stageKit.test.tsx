import { describe, it, expect } from "vitest";
import { dayDelta } from "../../src/client/routes/StageKit";

/**
 * `dayDelta` — the Evaluated table's `+/- Days` column (R7-JURY).
 *
 * Its own docstring promises a CALENDAR-day comparison, "so a submission at
 * 09:00 on the due date is On time, not -1d early". It shipped using
 * `Math.round` on each timestamp, which snaps to the NEAREST UTC midnight
 * instead — a different function that happens to agree whenever both instants
 * sit near midnight. Both R7 verifiers found it independently, and the test
 * that existed could not: its fixture was exactly day-aligned (12:00Z against
 * 12:00Z), where rounding and flooring give the same answer.
 *
 * These cases are deliberately NOT day-aligned, because that is the only shape
 * that tells the two implementations apart.
 */
describe("dayDelta — calendar days, not nearest midnight", () => {
  it("counts the day a submission falls in, however late in the day it is", () => {
    // 22 hours late. Under `Math.round` the deadline rounds FORWARD to the 11th
    // and the submission rounds BACK to it, giving 0 — "On time" for a deck
    // submitted almost a day after its deadline. This is the regression.
    expect(dayDelta("2026-06-10T13:00:00Z", "2026-06-11T11:00:00Z")).toBe(1);
  });

  it("keeps a same-day submission at zero, whatever the hour", () => {
    // The docstring's own example, and the other direction of the same bug.
    expect(dayDelta("2026-06-10T00:00:00Z", "2026-06-10T09:00:00Z")).toBe(0);
    expect(dayDelta("2026-06-10T23:30:00Z", "2026-06-10T00:30:00Z")).toBe(0);
  });

  it("counts whole days early as negative", () => {
    expect(dayDelta("2026-06-10T12:00:00Z", "2026-06-07T12:00:00Z")).toBe(-3);
    // Early, and not day-aligned: the 8th is one calendar day before the 9th.
    expect(dayDelta("2026-06-09T02:00:00Z", "2026-06-08T22:00:00Z")).toBe(-1);
  });

  it("has no delta without both timestamps, and none for unparseable ones", () => {
    expect(dayDelta(undefined, "2026-06-10T12:00:00Z")).toBeNull();
    expect(dayDelta("2026-06-10T12:00:00Z", undefined)).toBeNull();
    expect(dayDelta(null, null)).toBeNull();
    expect(dayDelta("not a date", "2026-06-10T12:00:00Z")).toBeNull();
  });
});
