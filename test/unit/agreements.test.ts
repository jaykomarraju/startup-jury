import { describe, it, expect } from "vitest";
import {
  canEditSigningMethod,
  countersignRefusal,
  DEFAULT_SIGNING_METHOD,
  describeCountersignRefusal,
  describeMergeFieldError,
  describeSigningMethod,
  flowActorLabel,
  flowActors,
  isPickable,
  libraryBlurb,
  nextVersionLabel,
  programmeNoun,
  signatoriesBlurb,
  signingMethodLockReason,
  substituteMergeFields,
  templateSummary,
  UNFILLED_BLANK,
  validateFlow,
  validateMergeFields,
  type MergeField,
  type SignatoryPool,
} from "../../src/shared/agreements";

/**
 * W5-B — the pure half of the Agreements library, the Authorised signatories
 * pool and the signing method (`src/shared/agreements.ts`).
 *
 * The merge-field substitution is the piece that most needs pinning: the two
 * cases that are NOT the happy path are the ones a `String.replace` at a call
 * site would get wrong, and they are the reason the function exists.
 */

// ── Merge-field substitution ─────────────────────────────────────────────────

const FIELDS: MergeField[] = [
  { key: "startup", label: "Startup legal name", sample: "NeuraLeaf AI Pvt Ltd" },
  { key: "founder", label: "Founder name", sample: "Ananya Menon" },
  { key: "equity", label: "Equity consideration", sample: "4%" },
];

describe("substituteMergeFields", () => {
  it("substitutes every declared field that has a value", () => {
    const res = substituteMergeFields(
      "This agreement is between {{startup}} and its founder {{founder}}.",
      FIELDS,
      { startup: "NeuraLeaf AI Pvt Ltd", founder: "Ananya Menon" },
    );
    expect(res.text).toBe(
      "This agreement is between NeuraLeaf AI Pvt Ltd and its founder Ananya Menon.",
    );
    expect(res.filled).toEqual(["startup", "founder"]);
    expect(res.missing).toEqual([]);
    expect(res.unknown).toEqual([]);
    expect(res.ignored).toEqual([]);
  });

  it("renders a DECLARED field with no value as a visible blank, and reports it", () => {
    // The case that matters: an empty string must not silently vanish, or the
    // document reads as complete with a term missing from it.
    const res = substituteMergeFields(
      "Equity consideration: {{equity}} of the fully diluted cap table.",
      FIELDS,
      { equity: "" },
    );
    expect(res.text).toBe(
      `Equity consideration: ${UNFILLED_BLANK} of the fully diluted cap table.`,
    );
    expect(res.missing).toEqual(["equity"]);
    expect(res.filled).toEqual([]);
    expect(res.text).not.toContain("{{equity}}");
  });

  it("treats whitespace-only and absent values as the same unfilled blank", () => {
    const absent = substituteMergeFields("{{equity}}", FIELDS, {});
    const blank = substituteMergeFields("{{equity}}", FIELDS, { equity: "   " });
    const nulled = substituteMergeFields("{{equity}}", FIELDS, { equity: null });
    for (const res of [absent, blank, nulled]) {
      expect(res.text).toBe(UNFILLED_BLANK);
      expect(res.missing).toEqual(["equity"]);
    }
  });

  it("leaves a placeholder the template never DECLARED verbatim, and reports it", () => {
    // An undeclared placeholder is a blank nobody approved. It cannot be
    // filled, so it must stay visible rather than be blanked or dropped.
    const res = substituteMergeFields(
      "Valuation cap: {{cap}} · Startup: {{startup}}",
      FIELDS,
      { startup: "NeuraLeaf AI Pvt Ltd", cap: "₹12 Cr" },
    );
    expect(res.text).toBe("Valuation cap: {{cap}} · Startup: NeuraLeaf AI Pvt Ltd");
    expect(res.unknown).toEqual(["cap"]);
    expect(res.ignored).toEqual(["cap"]);
    expect(res.filled).toEqual(["startup"]);
  });

  it("never writes a value whose key is not declared, even if the text has no placeholders", () => {
    const res = substituteMergeFields("A flat document with no blanks.", FIELDS, {
      cap: "₹12 Cr",
      disc: "20%",
    });
    expect(res.text).toBe("A flat document with no blanks.");
    expect(res.ignored).toEqual(["cap", "disc"]);
    expect(res.filled).toEqual([]);
  });

  it("handles a placeholder used twice, and reports the key once", () => {
    const res = substituteMergeFields("{{startup}} — {{startup}}", FIELDS, {
      startup: "Aether Systems",
    });
    expect(res.text).toBe("Aether Systems — Aether Systems");
    expect(res.filled).toEqual(["startup"]);
  });

  it("tolerates spacing inside the braces", () => {
    const res = substituteMergeFields("{{  founder }}", FIELDS, { founder: "Ananya" });
    expect(res.text).toBe("Ananya");
    expect(res.filled).toEqual(["founder"]);
  });

  it("leaves text with no placeholders untouched", () => {
    const res = substituteMergeFields("No braces here at all.", FIELDS, {});
    expect(res.text).toBe("No braces here at all.");
    expect(res.missing).toEqual([]);
    expect(res.unknown).toEqual([]);
  });
});

// ── Merge-field validation ───────────────────────────────────────────────────

describe("validateMergeFields", () => {
  it("normalises a good set — trims, lower-cases keys, nulls a blank sample", () => {
    const check = validateMergeFields([
      { key: " Startup ", label: " Startup legal name ", sample: "  " },
    ]);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.fields).toEqual([
        { key: "startup", label: "Startup legal name", sample: null },
      ]);
    }
  });

  it("refuses a duplicate key — each key maps to one placeholder", () => {
    const check = validateMergeFields([
      { key: "startup", label: "Name", sample: null },
      { key: "STARTUP", label: "Also name", sample: null },
    ]);
    expect(check.ok).toBe(false);
    expect(describeMergeFieldError(check)).toContain("used by two merge fields");
  });

  it("refuses a key that could not be a placeholder", () => {
    for (const key of ["1startup", "start up", "start-up", "Startup!"]) {
      const check = validateMergeFields([{ key, label: "x", sample: null }]);
      expect(check.ok, key).toBe(false);
    }
  });

  it("refuses an empty key and an empty label", () => {
    expect(validateMergeFields([{ key: "", label: "Name", sample: null }]).ok).toBe(false);
    expect(validateMergeFields([{ key: "startup", label: "  ", sample: null }]).ok).toBe(false);
  });

  it("accepts an empty set — a template may declare no blanks", () => {
    expect(validateMergeFields([]).ok).toBe(true);
  });
});

// ── The signing workflow ─────────────────────────────────────────────────────

describe("validateFlow", () => {
  it("accepts the prototype's own three-step chain", () => {
    const check = validateFlow([
      { actor: "program_associate", action: "fill_blanks" },
      { actor: "founder", action: "sign_first" },
      { actor: "superuser", action: "countersign" },
    ]);
    expect(check.ok).toBe(true);
  });

  it("refuses a countersign that comes before the signature it counters", () => {
    const check = validateFlow([
      { actor: "superuser", action: "countersign" },
      { actor: "founder", action: "sign_first" },
    ]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("countersign_before_signature");
  });

  it("refuses a countersign with no signature at all", () => {
    const check = validateFlow([
      { actor: "program_associate", action: "fill_blanks" },
      { actor: "superuser", action: "countersign" },
    ]);
    expect(check.ok).toBe(false);
  });

  it("refuses two countersign steps — one column records one countersignature", () => {
    const check = validateFlow([
      { actor: "founder", action: "sign_first" },
      { actor: "superuser", action: "countersign" },
      { actor: "program_manager", action: "countersign" },
    ]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("two_countersigns");
  });

  it("refuses an empty chain", () => {
    expect(validateFlow([]).ok).toBe(false);
  });

  it("allows a chain with no countersign at all — not every template needs one", () => {
    expect(
      validateFlow([
        { actor: "program_associate", action: "fill_blanks" },
        { actor: "founder", action: "sign_first" },
      ]).ok,
    ).toBe(true);
  });
});

describe("flow actors", () => {
  it("offers the edition's staff roles plus the founder, founder last", () => {
    expect(flowActors("incubator")).toEqual([
      "superuser",
      "admin",
      "program_manager",
      "program_associate",
      "jury",
      "founder",
    ]);
    expect(flowActors("vc")).toEqual([
      "superuser",
      "admin",
      "partner",
      "ic_member",
      "associate",
      "analyst",
      "founder",
    ]);
  });

  it("labels the founder step 'Startup founder' and the VC superuser 'Managing Partner'", () => {
    expect(flowActorLabel("incubator", "founder")).toBe("Startup founder");
    expect(flowActorLabel("vc", "superuser")).toBe("Managing Partner");
    expect(flowActorLabel("incubator", "program_manager")).toBe("Program Manager");
  });
});

// ── Lifecycle ────────────────────────────────────────────────────────────────

describe("template lifecycle", () => {
  it("bumps the version label exactly as `suVersion` does", () => {
    expect(nextVersionLabel("v3")).toBe("v4");
    expect(nextVersionLabel("v1")).toBe("v2");
    expect(nextVersionLabel("2026.1")).toBe("v20262");
    expect(nextVersionLabel("draft")).toBe("v2");
    expect(nextVersionLabel(null)).toBe("v2");
  });

  it("makes only an Active template pickable — retired stays for audit", () => {
    expect(isPickable({ status: "active" })).toBe(true);
    expect(isPickable({ status: "draft" })).toBe(false);
    expect(isPickable({ status: "retired" })).toBe(false);
  });

  it("renders the list's summary line, pluralising a single merge field", () => {
    expect(
      templateSummary({
        fileName: "incubation-agreement-v3.docx",
        version: "v3",
        fields: FIELDS,
        programNames: ["Fintech Accelerator"],
      }),
    ).toBe("incubation-agreement-v3.docx · v3 · 3 merge fields · Fintech Accelerator");
    expect(
      templateSummary({
        fileName: null,
        version: "v1",
        fields: [FIELDS[0]],
        programNames: [],
      }),
    ).toBe("(no file yet) · v1 · 1 merge field · unmapped");
  });
});

// ── The signing method ───────────────────────────────────────────────────────

describe("the signing method", () => {
  it("defaults to the prototype's object, both fallbacks on", () => {
    expect(DEFAULT_SIGNING_METHOD).toEqual({
      provider: "SignDesk",
      sigType: "standard",
      inApp: true,
      wetInk: true,
    });
  });

  it("is editable only while the sign-up is at setup and unsigned", () => {
    expect(canEditSigningMethod({ status: "initiated", founderSignedAt: null })).toBe(true);
    expect(
      canEditSigningMethod({ status: "initiated", founderSignedAt: "2026-09-12T10:00:00Z" }),
    ).toBe(false);
    for (const status of ["progress", "completed", "onboarded", "archived"] as const) {
      expect(canEditSigningMethod({ status, founderSignedAt: null }), status).toBe(false);
    }
  });

  it("says why it is locked, in the prototype's own words", () => {
    expect(signingMethodLockReason({ status: "initiated", founderSignedAt: null })).toBeNull();
    expect(
      signingMethodLockReason({ status: "progress", founderSignedAt: "2026-09-12T10:00:00Z" }),
    ).toBe("Signing method locked — founder has signed");
    expect(signingMethodLockReason({ status: "completed", founderSignedAt: null })).toBe(
      "Signing method locked",
    );
  });

  it("renders the locked card's one-liner", () => {
    expect(
      describeSigningMethod({
        provider: "SignDesk",
        sigType: "standard",
        inApp: true,
        wetInk: true,
      }),
    ).toBe("SignDesk · Standard e-signature · fallback: in-app, print/scan");
    expect(
      describeSigningMethod({
        provider: "Adobe",
        sigType: "certificate",
        inApp: false,
        wetInk: false,
      }),
    ).toBe("Adobe Sign · Certificate-based");
    expect(
      describeSigningMethod({
        provider: "eMudhra",
        sigType: "certificate",
        inApp: false,
        wetInk: true,
      }),
    ).toBe("eMudhra · Certificate-based · fallback: print/scan");
  });
});

// ── The countersign gate ─────────────────────────────────────────────────────

const POOL: SignatoryPool = {
  roles: [
    { role: "superuser", label: "Super User", enabled: true },
    { role: "program_manager", label: "Program Manager", enabled: true },
    { role: "program_associate", label: "Program Associate", enabled: false },
  ],
  users: [
    {
      userId: "inc_pm",
      name: "Raj Kumar",
      role: "program_manager",
      roleLabel: "Program Manager",
      enabled: true,
    },
    {
      userId: "inc_admin",
      name: "Nisha Kapoor",
      role: "admin",
      roleLabel: "Admin",
      enabled: false,
    },
  ],
};

describe("countersignRefusal", () => {
  it("refuses when nothing is assigned — the prototype's own sentence", () => {
    const reason = countersignRefusal(
      POOL,
      { role: null, userId: null },
      { id: "inc_superuser", role: "superuser" },
    );
    expect(reason).toBe("no_signatory");
    expect(describeCountersignRefusal(reason!)).toBe(
      "Assign an authorised signatory to countersign.",
    );
  });

  it("admits the role that is assigned, when that role is granted", () => {
    expect(
      countersignRefusal(
        POOL,
        { role: "superuser", userId: null },
        { id: "inc_superuser", role: "superuser" },
      ),
    ).toBeNull();
  });

  it("refuses a different role than the one assigned", () => {
    expect(
      countersignRefusal(
        POOL,
        { role: "superuser", userId: null },
        { id: "inc_pm", role: "program_manager" },
      ),
    ).toBe("not_the_signatory");
  });

  it("admits the named individual who is assigned", () => {
    expect(
      countersignRefusal(POOL, { role: null, userId: "inc_pm" }, { id: "inc_pm", role: "program_manager" }),
    ).toBeNull();
  });

  it("refuses anyone but the named individual — including their own role peers", () => {
    expect(
      countersignRefusal(
        POOL,
        { role: null, userId: "inc_pm" },
        { id: "another_pm", role: "program_manager" },
      ),
    ).toBe("not_the_signatory");
  });

  it("refuses an assignment whose grant has since been revoked", () => {
    // The admin is assigned but switched OFF in the console — the whole point
    // of the pool being a gate rather than a label.
    expect(
      countersignRefusal(
        POOL,
        { role: null, userId: "inc_admin" },
        { id: "inc_admin", role: "admin" },
      ),
    ).toBe("not_authorised");
    expect(
      countersignRefusal(
        POOL,
        { role: "program_associate", userId: null },
        { id: "inc_pa", role: "program_associate" },
      ),
    ).toBe("not_authorised");
  });

  it("refuses a role assignment that names a role not in the pool at all", () => {
    expect(
      countersignRefusal(POOL, { role: "jury", userId: null }, { id: "inc_jury", role: "jury" }),
    ).toBe("not_authorised");
  });
});

// ── Edition wording ──────────────────────────────────────────────────────────

describe("edition wording", () => {
  it("maps templates to programmes in the incubator and funds in the VC build", () => {
    expect(programmeNoun("incubator")).toEqual({
      plural: "programs",
      card: "Programs / cohorts",
    });
    expect(programmeNoun("vc")).toEqual({ plural: "funds", card: "Funds" });
    expect(libraryBlurb("incubator")).toContain("map it to programs and stages");
    expect(libraryBlurb("vc")).toContain("map it to funds and stages");
    expect(libraryBlurb("incubator")).toContain("Retired templates stay for audit");
  });

  it("says organisation in the incubator and firm in the VC build", () => {
    expect(signatoriesBlurb("incubator")).toContain("on the organisation's behalf");
    expect(signatoriesBlurb("vc")).toContain("on the firm's behalf");
    for (const edition of ["incubator", "vc"] as const) {
      expect(signatoriesBlurb(edition)).toContain(
        "Only those enabled here appear in the sign-up countersign picker.",
      );
    }
  });
});
