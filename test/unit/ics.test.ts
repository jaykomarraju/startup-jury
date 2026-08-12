import { describe, it, expect } from "vitest";
import {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsDate,
  icsFilename,
} from "../../src/shared/ics";

/** Split a folded document back into logical lines (RFC 5545 unfolding). */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
}

const BASE = {
  uid: "call_abc@startup-jury",
  start: "2026-08-18T10:30:00.000Z",
  durationMinutes: 45,
  summary: "GreenRoute — intro call",
  organizer: { email: "raj.kumar@demo.startupjury.ai", name: "Raj Kumar" },
};

describe("escapeIcsText", () => {
  it("escapes the four TEXT specials", () => {
    expect(escapeIcsText("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
  });

  it("turns every newline flavour into a literal \\n", () => {
    expect(escapeIcsText("one\ntwo\r\nthree\rfour")).toBe("one\\ntwo\\nthree\\nfour");
  });

  it("escapes the backslash first so an escape isn't double-escaped", () => {
    // "\," must become "\\\," — not "\\\\," — i.e. one escaped backslash then
    // one escaped comma.
    expect(escapeIcsText("\\,")).toBe("\\\\\\,");
  });
});

describe("formatIcsDate", () => {
  it("emits UTC basic format", () => {
    expect(formatIcsDate("2026-08-18T10:30:00.000Z")).toBe("20260818T103000Z");
  });

  it("normalises a non-UTC offset to UTC", () => {
    expect(formatIcsDate("2026-08-18T16:00:00+05:30")).toBe("20260818T103000Z");
  });

  it("rejects an unparseable date rather than emitting a broken file", () => {
    expect(() => formatIcsDate("not a date")).toThrow(/invalid ics date/);
  });
});

describe("foldIcsLine", () => {
  it("leaves a short line alone", () => {
    expect(foldIcsLine("SUMMARY:hi")).toBe("SUMMARY:hi");
  });

  it("folds past 75 octets with CRLF + a single space", () => {
    const folded = foldIcsLine(`SUMMARY:${"x".repeat(200)}`);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].length).toBe(75);
    for (const part of parts.slice(1)) expect(part.startsWith(" ")).toBe(true);
    // Unfolding restores the original exactly.
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"x".repeat(200)}`);
  });

  it("never splits a multi-byte character across a fold", () => {
    // "é" is 2 octets; a run of them must not be cut mid-sequence.
    const line = `SUMMARY:${"é".repeat(80)}`;
    const folded = foldIcsLine(line);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("buildIcs", () => {
  it("produces a well-formed single-event VCALENDAR", () => {
    const lines = unfold(buildIcs(BASE));
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("CALSCALE:GREGORIAN");
    expect(lines).toContain("METHOD:REQUEST");
    expect(lines).toContain("BEGIN:VEVENT");
    expect(lines).toContain("END:VEVENT");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
    expect(lines).toContain("UID:call_abc@startup-jury");
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines).toContain("SEQUENCE:0");
  });

  it("uses CRLF line endings and a trailing CRLF (Outlook rejects bare \\n)", () => {
    const ics = buildIcs(BASE);
    expect(ics.includes("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("derives DTEND from the duration", () => {
    const lines = unfold(buildIcs(BASE));
    expect(lines).toContain("DTSTART:20260818T103000Z");
    expect(lines).toContain("DTEND:20260818T111500Z"); // +45 min
  });

  it("emits the organizer as CHAIR and each attendee with RSVP", () => {
    const lines = unfold(
      buildIcs({
        ...BASE,
        attendees: [
          { email: "founder@greenroute.example", name: "Sneha Iyer" },
          { email: "jury@demo.startupjury.ai", name: null, role: "OPT-PARTICIPANT" },
        ],
      }),
    );
    expect(lines).toContain("ORGANIZER;ROLE=CHAIR;CN=Raj Kumar:mailto:raj.kumar@demo.startupjury.ai");
    expect(lines).toContain(
      "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Sneha Iyer:mailto:founder@greenroute.example",
    );
    // No CN parameter when we don't know the name.
    expect(lines).toContain(
      "ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:jury@demo.startupjury.ai",
    );
  });

  it("accepts participants on any email domain (§8: Outlook, Gmail, anything)", () => {
    const lines = unfold(
      buildIcs({
        ...BASE,
        attendees: [{ email: "someone@gmail.com" }, { email: "other@outlook.com" }],
      }),
    );
    expect(lines.some((l) => l.endsWith("mailto:someone@gmail.com"))).toBe(true);
    expect(lines.some((l) => l.endsWith("mailto:other@outlook.com"))).toBe(true);
  });

  it("escapes TEXT values in the summary, description and location", () => {
    const lines = unfold(
      buildIcs({
        ...BASE,
        summary: "GreenRoute; intro, call",
        description: "Line one\nLine two",
        location: "Room 2, Floor 3",
      }),
    );
    expect(lines).toContain("SUMMARY:GreenRoute\\; intro\\, call");
    expect(lines).toContain("DESCRIPTION:Line one\\nLine two");
    expect(lines).toContain("LOCATION:Room 2\\, Floor 3");
  });

  it("cancels with METHOD:CANCEL + STATUS:CANCELLED and a bumped SEQUENCE", () => {
    const lines = unfold(buildIcs({ ...BASE, method: "CANCEL", sequence: 3 }));
    expect(lines).toContain("METHOD:CANCEL");
    expect(lines).toContain("STATUS:CANCELLED");
    expect(lines).toContain("SEQUENCE:3");
    // Same UID — a cancel must target the invite the attendee already has.
    expect(lines).toContain("UID:call_abc@startup-jury");
  });

  it("adds a VALARM only when a reminder was asked for", () => {
    expect(unfold(buildIcs(BASE))).not.toContain("BEGIN:VALARM");
    const withAlarm = unfold(buildIcs({ ...BASE, alarmMinutesBefore: 15 }));
    expect(withAlarm).toContain("BEGIN:VALARM");
    expect(withAlarm).toContain("TRIGGER:-PT15M");
    expect(withAlarm).toContain("END:VALARM");
  });

  it("defaults DTSTAMP to the start and honours an explicit stamp", () => {
    expect(unfold(buildIcs(BASE))).toContain("DTSTAMP:20260818T103000Z");
    expect(unfold(buildIcs({ ...BASE, stamp: "2026-08-12T09:00:00.000Z" }))).toContain(
      "DTSTAMP:20260812T090000Z",
    );
  });

  it("clamps a nonsensical duration to at least one minute", () => {
    const lines = unfold(buildIcs({ ...BASE, durationMinutes: 0 }));
    expect(lines).toContain("DTEND:20260818T103100Z");
  });

  it("folds a long summary rather than emitting an over-length line", () => {
    const ics = buildIcs({ ...BASE, summary: "A very long startup name ".repeat(8) });
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("icsFilename", () => {
  it("slugifies and appends .ics", () => {
    expect(icsFilename("GreenRoute — intro call")).toBe("greenroute-intro-call.ics");
  });

  it("falls back when there is nothing sluggable", () => {
    expect(icsFilename("///")).toBe("call.ics");
  });

  it("caps the length so the header stays sane", () => {
    expect(icsFilename("x".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});
