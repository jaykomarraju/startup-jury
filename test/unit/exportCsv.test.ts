import { describe, it, expect } from "vitest";
import { toCsv, csvFilename, deckRows } from "../../src/client/exportCsv";
import type { DeckView } from "../../src/client/types";

// Session 8 — the deck-table CSV export (the Export button was inert until now).
// Pure functions only; `downloadCsv` is the DOM half and isn't exercised here.

describe("toCsv", () => {
  it("emits a BOM, CRLF rows and the header first", () => {
    const csv = toCsv(["A", "B"], [[1, 2]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿A,B\r\n1,2\r\n");
  });

  it("quotes fields containing a comma, a quote or a newline", () => {
    const csv = toCsv(["X"], [["a,b"], ['say "hi"'], ["line1\nline2"]]);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it("leaves null and undefined as empty cells rather than the words", () => {
    expect(toCsv(["X", "Y"], [[null, undefined]])).toBe("﻿X,Y\r\n,\r\n");
  });

  it("neutralises spreadsheet formula injection in attacker-supplied text", () => {
    // A founder picks their own company name, and Excel executes a cell that
    // opens with = + - or @. The tab prefix defuses it without hiding the text.
    const csv = toCsv(["Startup"], [["=HYPERLINK(\"http://evil\",\"click\")"]]);
    expect(csv).toContain('"\t=HYPERLINK');
    expect(csv).not.toMatch(/\r\n=HYPERLINK/);

    for (const lead of ["+1", "-1+2", "@SUM(A1)"]) {
      expect(toCsv(["X"], [[lead]])).toContain(`\t${lead}`);
    }
    // A plain negative number is still fine to read back as a number.
    expect(toCsv(["X"], [[-3]])).toContain("\t-3");
  });
});

describe("csvFilename", () => {
  it("slugs the screen name and stamps the day", () => {
    const d = new Date("2026-08-12T09:30:00Z");
    expect(csvFilename("All decks", d)).toBe("all-decks-2026-08-12.csv");
    expect(csvFilename("Assoc. Pipeline", d)).toBe("assoc-pipeline-2026-08-12.csv");
  });

  it("falls back rather than producing a nameless file", () => {
    expect(csvFilename("···", new Date("2026-08-12T00:00:00Z"))).toBe("decks-2026-08-12.csv");
  });
});

describe("deckRows", () => {
  const deck: DeckView = {
    id: "d1",
    name: "GreenGrid Energy",
    founder: "Meera Sharma",
    founderEmail: "meera@greengrid.example",
    founderPhone: "+91 98200 11111",
    sector: "ClimateTech",
    stage: "Seed",
    city: "Pune",
    programName: "Climate Cohort",
    cohortName: "Cohort 6",
    status: "Shortlisted",
    aiScore: 8.7,
    decisionScore: 8.1,
    signal: "strong",
    assignedToName: "Rajesh Kumar",
    missingFields: ["founderPhone"],
    intakeFlag: "returning",
    contentVersion: 2,
  };

  it("exports what the table shows, in column order", () => {
    const [row] = deckRows([deck]);
    expect(row).toEqual([
      "GreenGrid Energy",
      "Meera Sharma",
      "meera@greengrid.example",
      "+91 98200 11111",
      "ClimateTech",
      "Seed",
      "Pune",
      "Climate Cohort",
      "Cohort 6",
      "Shortlisted",
      8.7,
      8.1,
      "strong",
      "Rajesh Kumar",
      "founderPhone",
      "returning",
      2,
    ]);
  });

  it("survives a sparsely-populated deck", () => {
    const [row] = deckRows([{ id: "d2", name: "Thin" } as DeckView]);
    expect(row[0]).toBe("Thin");
    expect(toCsv(["a"], [row])).not.toContain("undefined");
  });
});
