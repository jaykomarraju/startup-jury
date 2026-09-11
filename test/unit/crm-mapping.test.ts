import { describe, it, expect } from "vitest";
import {
  APP_FIELDS,
  APP_FIELD_LABELS,
  CRM_PROVIDERS,
  CRM_PROVIDER_LABELS,
  MAX_CRM_FIELD_LENGTH,
  describeMappingError,
  isCrmDirection,
  isCrmProvider,
  isCrmSchedule,
  validateMappings,
} from "../../src/shared/crm";
import { REQUIRED_INTAKE_FIELDS } from "../../src/shared/intake";

/**
 * W3-D — the CRM field-mapping rules. Pure, so they live at the node tier and
 * are the same rules the console pre-validates with and the route enforces.
 */

const ok = (m: unknown) => validateMappings(m);

describe("the mappable field lists", () => {
  it("lets an inbound mapping fill every required intake column", () => {
    for (const f of REQUIRED_INTAKE_FIELDS) expect(APP_FIELDS.inbound).toContain(f);
    expect(APP_FIELDS.inbound).toContain("companyName");
  });

  it("keeps evaluation output outbound-only — a CRM cannot dictate our score", () => {
    expect(APP_FIELDS.outbound).toContain("aiScore");
    expect(APP_FIELDS.inbound).not.toContain("aiScore");
    expect(APP_FIELDS.inbound).not.toContain("compositeScore");
  });

  it("labels every mappable field, in both directions", () => {
    for (const f of [...APP_FIELDS.inbound, ...APP_FIELDS.outbound]) {
      expect(APP_FIELD_LABELS[f], f).toBeTruthy();
    }
  });

  it("names the prototype's four providers, in its row order", () => {
    expect([...CRM_PROVIDERS]).toEqual(["salesforce", "hubspot", "pipedrive", "custom"]);
    expect(CRM_PROVIDERS.map((p) => CRM_PROVIDER_LABELS[p])).toEqual([
      "Salesforce",
      "HubSpot",
      "Pipedrive",
      "Custom API",
    ]);
  });
});

describe("validateMappings", () => {
  it("accepts a well-formed set and normalises whitespace", () => {
    const r = ok([
      { crmField: "  Account.Name  ", appField: "companyName", direction: "inbound" },
      { crmField: "AI_Score__c", appField: "aiScore", direction: "outbound" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.mappings[0].crmField).toBe("Account.Name");
    expect(r.mappings).toHaveLength(2);
  });

  it("defaults an omitted direction to inbound", () => {
    const r = ok([{ crmField: "Contact.Email", appField: "founderEmail" }]);
    expect(r.ok).toBe(true);
    expect(r.mappings[0].direction).toBe("inbound");
  });

  it("accepts an empty set — a connection may map nothing yet", () => {
    expect(ok([]).ok).toBe(true);
  });

  it("refuses a non-array", () => {
    expect(ok(null).error).toBe("not_an_array");
    expect(ok("Account.Name").error).toBe("not_an_array");
    expect(ok({ crmField: "x" }).error).toBe("not_an_array");
  });

  it("refuses a blank or over-long CRM field, and reports which row", () => {
    expect(ok([{ crmField: "  ", appField: "companyName" }]).error).toBe("missing_crm_field");
    const long = "A".repeat(MAX_CRM_FIELD_LENGTH + 1);
    const r = ok([
      { crmField: "Account.Name", appField: "companyName" },
      { crmField: long, appField: "founder" },
    ]);
    expect(r.error).toBe("crm_field_too_long");
    expect(r.index).toBe(1);
  });

  it("refuses a CRM field that is not an identifier path", () => {
    // These end up inside a provider field list; escaping is not the answer.
    for (const bad of ["Name'; DROP TABLE", "Account Name", "1Account", "a..b", "a.", "a-b"]) {
      expect(ok([{ crmField: bad, appField: "companyName" }]).error, bad).toBe(
        "invalid_crm_field",
      );
    }
    for (const good of ["Account.Name", "AI_Score__c", "properties.dealstage", "Name"]) {
      expect(ok([{ crmField: good, appField: "companyName" }]).ok, good).toBe(true);
    }
  });

  it("refuses an app field the product does not have, or that is wrong for the direction", () => {
    expect(ok([{ crmField: "X", appField: "unicornScore" }]).error).toBe("unknown_app_field");
    expect(ok([{ crmField: "X", appField: "" }]).error).toBe("unknown_app_field");
    expect(
      ok([{ crmField: "AI_Score__c", appField: "aiScore", direction: "inbound" }]).error,
    ).toBe("unknown_app_field");
    expect(
      ok([{ crmField: "Account.Name", appField: "companyName", direction: "outbound" }]).error,
    ).toBe("unknown_app_field");
  });

  it("refuses a direction that is neither inbound nor outbound", () => {
    expect(ok([{ crmField: "X", appField: "companyName", direction: "sideways" }]).error).toBe(
      "invalid_direction",
    );
  });

  it("refuses duplicates — two CRM fields into one app field is ambiguous", () => {
    const r = ok([
      { crmField: "Contact.Email", appField: "founderEmail" },
      { crmField: "Lead.Email", appField: "founderEmail" },
    ]);
    expect(r.error).toBe("duplicate_app_field");
    expect(r.index).toBe(1);
  });

  it("refuses the same CRM field twice in a direction, case-insensitively", () => {
    expect(
      ok([
        { crmField: "AI_Score__c", appField: "aiScore", direction: "outbound" },
        { crmField: "ai_score__c", appField: "compositeScore", direction: "outbound" },
      ]).error,
    ).toBe("duplicate_crm_field");
  });

  it("allows one CRM field in both directions — a round-trip field is legitimate", () => {
    expect(
      ok([
        { crmField: "Account.Name", appField: "companyName", direction: "inbound" },
        { crmField: "Account.Name", appField: "status", direction: "outbound" },
      ]).ok,
    ).toBe(true);
  });

  it("caps the set size", () => {
    const many = Array.from({ length: 41 }, (_, i) => ({
      crmField: `F${i}`,
      appField: "companyName",
    }));
    expect(ok(many).error).toBe("too_many");
  });

  it("describes every failure in words an admin can act on", () => {
    const cases: unknown[] = [
      null,
      [{ crmField: "", appField: "companyName" }],
      [{ crmField: "bad name", appField: "companyName" }],
      [{ crmField: "X", appField: "nope" }],
      [{ crmField: "X", appField: "companyName", direction: "sideways" }],
      [
        { crmField: "A.B", appField: "founder" },
        { crmField: "C.D", appField: "founder" },
      ],
    ];
    for (const c of cases) {
      const r = validateMappings(c);
      expect(r.ok).toBe(false);
      const msg = describeMappingError(r);
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toContain("undefined");
    }
  });
});

describe("the enum guards", () => {
  it("accept the shipped values and nothing else", () => {
    expect(isCrmProvider("salesforce")).toBe(true);
    expect(isCrmProvider("zoho")).toBe(false);
    expect(isCrmProvider(7)).toBe(false);
    expect(isCrmDirection("both")).toBe(true);
    expect(isCrmDirection("sideways")).toBe(false);
    expect(isCrmSchedule("weekly")).toBe(true);
    expect(isCrmSchedule("fortnightly")).toBe(false);
  });
});
