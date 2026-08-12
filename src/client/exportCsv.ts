// CSV export for the deck tables (All decks + every stage screen).
//
// Session 8. The Export control had been a live-looking button with no handler
// since Phase 2; this gives it the obvious behaviour — download what is
// currently on screen, after the toolbar filters, in the order shown.
//
// Deliberately client-side: the rows are already loaded, so there is no reason
// to round-trip, and no new endpoint means no new authZ surface. Whatever the
// caller can see is exactly what they can export.

import type { DeckView } from "./types";

/**
 * RFC 4180 field escaping. A field is quoted when it contains a comma, a quote,
 * or any newline; embedded quotes are doubled.
 *
 * The leading-character guard is a spreadsheet-injection defence: Excel and
 * Sheets execute a cell that opens with = + - or @, and deck names, founder
 * names and sectors are attacker-influenced (a founder chooses their own
 * company name). Prefixing a tab neutralises the formula while still displaying
 * the original text.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `\t${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // CRLF + a UTF-8 BOM: without the BOM Excel mis-reads the accented characters
  // and the ₹ sign in these tables as Latin-1.
  const BOM = "﻿";
  return `${BOM}${[headers, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n")}\r\n`;
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const DECK_HEADERS = [
  "Startup",
  "Founder",
  "Email",
  "Phone",
  "Sector",
  "Stage",
  "City",
  "Program",
  "Cohort",
  "Status",
  "AI score",
  "Decision score",
  "Signal",
  "Assigned to",
  "Missing fields",
  "Intake flag",
  "Version",
];

export function deckRows(decks: DeckView[]): unknown[][] {
  return decks.map((d) => [
    d.name,
    d.founder,
    d.founderEmail ?? d.email,
    d.founderPhone,
    d.sector,
    d.stage,
    d.city,
    d.programName,
    d.cohortName,
    d.status,
    d.aiScore,
    d.decisionScore,
    d.signal,
    d.assignedToName,
    d.missingFields?.join(" · "),
    d.intakeFlag,
    d.contentVersion,
  ]);
}

/** `all-decks-2026-08-12.csv` — the screen name plus the day it was taken. */
export function csvFilename(label: string, today = new Date()): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "decks";
  return `${slug}-${today.toISOString().slice(0, 10)}.csv`;
}

/** Export a deck table exactly as displayed. */
export function exportDecks(label: string, decks: DeckView[]): void {
  downloadCsv(csvFilename(label), toCsv(DECK_HEADERS, deckRows(decks)));
}
