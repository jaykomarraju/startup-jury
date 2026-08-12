import { describe, it, expect } from "vitest";
import {
  REQUIRED_INTAKE_FIELDS,
  classifyIntake,
  describeMissingFields,
  isValidEmail,
  isValidPhone,
  mergeIntakeDetails,
  missingIntakeFields,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  parseMissingFields,
  type IntakeCandidate,
} from "../../src/shared/intake";

// Session 5 — intake guardrails: the required founder/contact columns and the
// soft duplicate / returning-company classification (FINISH-PLAN §8).

describe("intake normalisation", () => {
  it("strips legal suffixes and punctuation from a company name", () => {
    expect(normalizeCompanyName("GreenGrid Energy Pvt Ltd")).toBe("greengridenergy");
    expect(normalizeCompanyName("green-grid  energy")).toBe("greengridenergy");
    expect(normalizeCompanyName("GreenGrid Technologies, Inc.")).toBe("greengrid");
    expect(normalizeCompanyName("   ")).toBeNull();
  });

  it("keys a phone number on its last 10 digits", () => {
    expect(normalizePhone("+91 98450 12345")).toBe("9845012345");
    expect(normalizePhone("098450-12345")).toBe("9845012345");
    // Too short to be a usable number.
    expect(normalizePhone("12345")).toBeNull();
  });

  it("lowercases and trims an email", () => {
    expect(normalizeEmail("  Ada@Startup.COM ")).toBe("ada@startup.com");
    expect(normalizeEmail("")).toBeNull();
  });

  it("validates emails and phones permissively but not blindly", () => {
    expect(isValidEmail("ada@startup.com")).toBe(true);
    expect(isValidEmail("ada@startup")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidPhone("+91 98450 12345")).toBe(true);
    expect(isValidPhone("n/a")).toBe(false);
  });
});

describe("required intake fields", () => {
  const full = {
    founder: "Meera Sharma",
    founderEmail: "meera@nimbus.com",
    founderPhone: "9845012345",
    city: "Bengaluru",
    sector: "HR Tech",
  };

  it("reports nothing missing on a complete submission", () => {
    expect(missingIntakeFields(full)).toEqual([]);
  });

  it("lists every absent or unusable column in canonical order", () => {
    expect(missingIntakeFields({})).toEqual([...REQUIRED_INTAKE_FIELDS]);
    expect(missingIntakeFields({ ...full, founderEmail: "nope", founderPhone: null })).toEqual([
      "founderEmail",
      "founderPhone",
    ]);
  });

  it("renders and round-trips the stored CSV", () => {
    expect(describeMissingFields(["founderPhone", "city"])).toBe("Phone, City");
    expect(parseMissingFields("founderPhone,city")).toEqual(["founderPhone", "city"]);
    // Unknown keys are dropped rather than trusted.
    expect(parseMissingFields("founderPhone,bogus")).toEqual(["founderPhone"]);
    expect(parseMissingFields(null)).toEqual([]);
  });

  it("lets the typed value win and the extraction fill the blanks", () => {
    const merged = mergeIntakeDetails(
      { founder: "Meera Sharma", city: "  " },
      { founder: "M. Sharma", founderEmail: "meera@nimbus.com", city: "Pune", sector: "HR Tech" },
    );
    expect(merged.founder).toBe("Meera Sharma"); // typed wins
    expect(merged.founderEmail).toBe("meera@nimbus.com"); // extraction fills
    expect(merged.city).toBe("Pune"); // blank never overwrites
    expect(merged.founderPhone).toBeNull();
  });
});

describe("duplicate / returning classification", () => {
  const live: IntakeCandidate = {
    id: "deck_live",
    name: "GreenGrid Energy",
    founder: "Ada Founder",
    founderEmail: "ada@greengrid.com",
    founderPhone: "9845012345",
    fundingStage: "Seed",
    statusLabel: "Jury Evaluation",
    closed: false,
    cohortId: "coh_a",
    createdAt: "2026-05-01T00:00:00Z",
  };

  it("flags a same-company, same-stage, still-live submission as a duplicate", () => {
    const { flag, matches } = classifyIntake(
      { name: "GreenGrid Energy Pvt Ltd", fundingStage: "Seed", cohortId: "coh_a" },
      [live],
    );
    expect(flag).toBe("duplicate");
    expect(matches[0].matchedOn).toEqual(["name"]);
    expect(matches[0].reason).toContain("Possible duplicate");
    expect(matches[0].reason).toContain("Jury Evaluation");
  });

  it("flags a moved funding stage as a returning company (seed → Series A)", () => {
    const { flag, matches } = classifyIntake(
      { name: "GreenGrid Energy", fundingStage: "Series A", cohortId: "coh_a" },
      [live],
    );
    expect(flag).toBe("returning");
    expect(matches[0].reason).toContain("applied before at Seed");
    expect(matches[0].reason).toContain("Series A");
  });

  it("flags a company whose earlier application already concluded as returning", () => {
    const { flag } = classifyIntake({ name: "GreenGrid Energy", fundingStage: "Seed" }, [
      { ...live, closed: true, statusLabel: "Rejected" },
    ]);
    expect(flag).toBe("returning");
  });

  it("flags a different cohort as returning even at the same stage", () => {
    const { flag } = classifyIntake(
      { name: "GreenGrid Energy", fundingStage: "Seed", cohortId: "coh_b" },
      [live],
    );
    expect(flag).toBe("returning");
  });

  it("matches on founder email or phone even when the name differs", () => {
    const byEmail = classifyIntake(
      { name: "Totally Different Co", founderEmail: "ADA@greengrid.com", fundingStage: "Seed" },
      [live],
    );
    expect(byEmail.matches[0].matchedOn).toEqual(["email"]);
    const byPhone = classifyIntake(
      { name: "Totally Different Co", founderPhone: "+91 98450 12345", fundingStage: "Seed" },
      [live],
    );
    expect(byPhone.matches[0].matchedOn).toEqual(["phone"]);
  });

  it("returns no flag for an unrelated submission, and never matches itself", () => {
    expect(classifyIntake({ name: "Nimbus HR", fundingStage: "Seed" }, [live]).flag).toBeNull();
    expect(
      classifyIntake({ name: "GreenGrid Energy", selfId: "deck_live" }, [live]).flag,
    ).toBeNull();
  });

  it("ranks the duplicate above the returning match", () => {
    const { flag, matches } = classifyIntake(
      { name: "GreenGrid Energy", fundingStage: "Seed", cohortId: "coh_a" },
      [{ ...live, id: "deck_old", closed: true, statusLabel: "Archived" }, live],
    );
    expect(flag).toBe("duplicate");
    expect(matches[0].deckId).toBe("deck_live");
    expect(matches[1].flag).toBe("returning");
  });
});
