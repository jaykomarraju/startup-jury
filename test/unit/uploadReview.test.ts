import { describe, it, expect } from "vitest";
import {
  CREDITS_PER_DECK,
  batchCostPreview,
  composeUploadQuery,
  creditsLabel,
  creditsMeterPct,
  creditsSubline,
  intakeStatusOf,
  provisionalDeckName,
  resultsSummary,
  stagedDeckIssues,
} from "../../src/shared/uploadReview";
import {
  EXTRACTED_INTAKE_FIELDS,
  INTAKE_RESULTS_LABELS,
  MAX_DECK_PDF_BYTES,
  mergeIntakeDetails,
  missingIntakeFields,
  resolveIntakeSector,
} from "../../src/shared/intake";
import { expandZip } from "../../src/client/routes/upload/zip";

/**
 * W7-B — the Upload screen's pure rules.
 *
 * Two of them are the session's rulings and are tested as such:
 *   • the batch preview counts CREDITS and never money (§8 Q1 / Q40);
 *   • sector comes from the workspace, is never extracted, and never marks a
 *     deck Incomplete (F0223 / F0227).
 */

const MONEY = /₹|\$|€|£|rs\.?\s?\d|inr|usd|rupee|per[- ]deck|\/\s*deck/i;

describe("the batch cost preview — credits, never money", () => {
  it("counts one credit per deck", () => {
    expect(CREDITS_PER_DECK).toBe(1);
    const p = batchCostPreview(3, 10);
    expect(p).toEqual({ decks: 3, credits: 3, balance: 10, balanceAfter: 7, shortfall: 0, affordable: true });
  });

  it("reports a shortfall instead of a negative balance", () => {
    expect(batchCostPreview(5, 2)).toMatchObject({ credits: 5, balanceAfter: 0, shortfall: 3, affordable: false });
  });

  it("never blocks on an unknown balance — the upload route decides", () => {
    expect(batchCostPreview(4, null)).toEqual({
      decks: 4,
      credits: 4,
      balance: null,
      balanceAfter: null,
      shortfall: 0,
      affordable: null,
    });
  });

  it("has no field and no label that is a price", () => {
    const p = batchCostPreview(12, 40);
    for (const key of Object.keys(p)) expect(key).not.toMatch(/price|amount|rate|currency|minor|inr/i);
    for (const n of [0, 1, 2, 999]) expect(creditsLabel(n)).not.toMatch(MONEY);
    expect(creditsLabel(1)).toBe("1 credit");
    expect(creditsLabel(3)).toBe("3 credits");
  });
});

describe("the credits bar", () => {
  it("reads the trial count it is given and never invents one", () => {
    expect(creditsSubline({ trialDecks: 3, planLabel: "Standard" })).toBe("3 free trial credits · Standard plan");
    expect(creditsSubline({ trialDecks: 1, planLabel: null })).toBe("1 free trial credit");
    expect(creditsSubline({ trialDecks: 7, planLabel: "Pro" })).toBe("7 free trial credits · Pro plan");
    expect(creditsSubline({ trialDecks: 0, planLabel: "Pro" })).toBe("Pro plan");
    expect(creditsSubline({ trialDecks: null, planLabel: null })).toBeNull();
  });

  it("meters the balance against the most the workspace is known to have had", () => {
    expect(creditsMeterPct({ balance: 3, trialDecks: 3 })).toBe(100);
    expect(creditsMeterPct({ balance: 25, purchased: 100, trialDecks: 3 })).toBe(25);
    // A balance above every known grant fills the bar rather than overflowing it.
    expect(creditsMeterPct({ balance: 40, purchased: 10 })).toBe(100);
    expect(creditsMeterPct({ balance: 0, trialDecks: 3 })).toBe(0);
    expect(creditsMeterPct({ balance: null })).toBe(0);
  });
});

describe("sector, from the workspace", () => {
  const sectors = ["FinTech", "CleanTech", "AgriTech"];

  it("keeps the operator's pick, spelled the taxonomy's way", () => {
    expect(resolveIntakeSector({ supplied: "fintech", programSector: "CleanTech", sectors })).toBe("FinTech");
  });

  it("keeps free text outside the taxonomy as typed", () => {
    expect(resolveIntakeSector({ supplied: "  SpaceTech ", sectors })).toBe("SpaceTech");
  });

  it("falls back to the programme's sector, then to a workspace with one sector", () => {
    expect(resolveIntakeSector({ supplied: "", programSector: "cleantech", sectors })).toBe("CleanTech");
    expect(resolveIntakeSector({ supplied: null, programSector: null, sectors: ["HealthTech"] })).toBe("HealthTech");
  });

  it("resolves to nothing rather than guessing between several sectors", () => {
    expect(resolveIntakeSector({ sectors })).toBeNull();
    expect(resolveIntakeSector({})).toBeNull();
  });

  it("is never taken from the extraction — an extracted sector cannot fill or overwrite it", () => {
    expect(mergeIntakeDetails({ sector: "CleanTech" }, { sector: "Climate" }).sector).toBe("CleanTech");
    expect(mergeIntakeDetails({}, { sector: "Climate" }).sector).toBeNull();
  });

  it("never marks a deck Incomplete", () => {
    expect(EXTRACTED_INTAKE_FIELDS).not.toContain("sector");
    const complete = {
      founder: "Meera Sharma",
      founderEmail: "meera@nimbus.com",
      founderPhone: "9845012345",
      city: "Pune",
    };
    expect(missingIntakeFields({ ...complete, sector: null })).toEqual([]);
    expect(missingIntakeFields({})).not.toContain("sector");
  });
});

describe("staging and results", () => {
  it("catches what the upload route would refuse, before anything is spent", () => {
    expect(stagedDeckIssues({ name: "deck.pdf", size: 1000, type: "application/pdf" })).toEqual([]);
    expect(stagedDeckIssues({ name: "DECK.PDF", size: 1000 })).toEqual([]);
    expect(stagedDeckIssues({ name: "deck.pptx", size: 1000 })).toEqual(["not_pdf"]);
    expect(stagedDeckIssues({ name: "deck.pdf", size: MAX_DECK_PDF_BYTES + 1 })).toEqual(["too_large"]);
  });

  it("names a staged deck from its file until the AI reads the real name", () => {
    expect(provisionalDeckName("decks/GreenGrid Energy.pdf")).toBe("GreenGrid Energy");
    expect(provisionalDeckName(".pdf")).toBe("Untitled deck");
  });

  it("derives Complete / Incomplete from the extracted details, and waits while the AI reads", () => {
    expect(intakeStatusOf({ statusId: "pending_ai" })).toBe("awaiting");
    expect(intakeStatusOf({})).toBe("awaiting");
    expect(intakeStatusOf({ statusId: "ai_evaluated", missingFields: [] })).toBe("complete");
    expect(intakeStatusOf({ statusId: "incomplete", missingFields: ["city"] })).toBe("incomplete");
    expect(resultsSummary(["complete", "incomplete", "awaiting"])).toMatch(
      /^3 decks uploaded\..*1 deck marked Incomplete — details missing\. 1 still being read by the AI\.$/,
    );
    expect(resultsSummary(["complete"])).toMatch(/All details captured\.$/);
  });

  it("labels the results table the way the prototype does", () => {
    expect(Object.values(INTAKE_RESULTS_LABELS)).toEqual(["Founder name", "Email ID", "Phone number", "City", "Sector"]);
  });

  it("writes one bullet per flagged area into the founder query", () => {
    const letter = composeUploadQuery("PayRoute", [
      { area: "Traction & Validation", signal: "absent" },
      { area: "Market Size", signal: "weak" },
    ]);
    expect(letter).toContain("Thank you for submitting PayRoute.");
    expect(letter).toContain("• Traction & Validation (absent)");
    expect(letter).toContain("• Market Size (weak signal)");
    expect(letter).not.toMatch(MONEY);
  });
});

// ── ZIP intake, in the browser ───────────────────────────────────────────────

interface Entry {
  name: string;
  data: Uint8Array;
  method?: 0 | 8;
  encrypted?: boolean;
}

const text = (v: string) => new TextEncoder().encode(v);

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A minimal, valid ZIP (no data descriptors) — enough to exercise the reader. */
async function buildZip(entries: Entry[]): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 0;
    const body = method === 8 ? await deflateRaw(e.data) : e.data;
    const name = text(e.name);
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(6, e.encrypted ? 1 : 0, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    parts.push(local, name, body);
    const central = new Uint8Array(46);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, e.encrypted ? 1 : 0, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cdLength = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdLength, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...centrals, eocd].map((u) => u as BlobPart)).arrayBuffer();
}

describe("expanding a ZIP of pitch decks", () => {
  const pdfText = "%PDF-1.4\n" + "slide ".repeat(400);
  const pdf = text(pdfText);

  it("reads stored and deflated PDFs, and leaves out everything else", async () => {
    const out = await expandZip(
      await buildZip([
        { name: "decks/FinStack.pdf", data: pdf, method: 8 },
        { name: "WealthOS.PDF", data: pdf, method: 0 },
        { name: "notes.txt", data: text("hi") },
        { name: "__MACOSX/decks/._FinStack.pdf", data: text("x") },
        { name: "decks/", data: new Uint8Array(0) },
      ]),
      MAX_DECK_PDF_BYTES,
    );
    expect(out.errors).toEqual([]);
    expect(out.skipped).toEqual(["notes.txt"]);
    expect(out.decks.map((d) => d.name)).toEqual(["FinStack.pdf", "WealthOS.PDF"]);
    expect(await out.decks[0].file!.text()).toBe(pdfText);
    expect(out.decks[0].file!.type).toBe("application/pdf");
  });

  it("never inflates an oversized entry, and refuses encrypted ones", async () => {
    const out = await expandZip(
      await buildZip([
        { name: "big.pdf", data: pdf, method: 8 },
        { name: "secret.pdf", data: pdf, encrypted: true },
      ]),
      100,
    );
    expect(out.decks).toEqual([{ name: "big.pdf", size: pdf.length, file: null }]);
    expect(out.errors).toEqual(["secret.pdf is encrypted and was not read."]);
  });

  it("says so when the file is not an archive at all", async () => {
    const out = await expandZip(text("not a zip at all, just text").buffer as ArrayBuffer, 1000);
    expect(out.decks).toEqual([]);
    expect(out.errors[0]).toMatch(/not a readable ZIP/);
  });
});
