/**
 * Session 7 — iCalendar (.ics) builder. Pure, dependency-free, no Env/DB, so it
 * unit-tests at the node tier and the client can reuse the same formatting.
 *
 * FINISH-PLAN §8 settled scheduling with a single verdict: **the app generates a
 * universal `.ics` invite** for intro / partner / alignment calls. The organizer
 * picks the participants (team + founder, any email domain — Outlook, Gmail,
 * whatever) and every calendar client understands the file. There is deliberately
 * NO availability negotiation or reschedule round-trip; that was named a future
 * refinement in the meeting.
 *
 * Output targets RFC 5545:
 *  - CRLF line endings (a bare \n makes Outlook reject the file)
 *  - content lines folded at 75 octets, continued with CRLF + one space
 *  - TEXT values escape `\`, `;`, `,` and newlines
 *  - all timestamps in UTC (`...Z`), which sidesteps VTIMEZONE entirely
 */

export type IcsMethod = "REQUEST" | "CANCEL";
export type IcsStatus = "CONFIRMED" | "CANCELLED";
export type IcsPartRole = "CHAIR" | "REQ-PARTICIPANT" | "OPT-PARTICIPANT";

export interface IcsPerson {
  email: string;
  name?: string | null;
}

export interface IcsAttendee extends IcsPerson {
  /** Defaults to REQ-PARTICIPANT. The organizer is emitted separately as CHAIR. */
  role?: IcsPartRole;
}

export interface IcsEventInput {
  /** Globally unique, stable across updates to the same event. */
  uid: string;
  /** Event start — ISO-8601 string or Date. */
  start: string | Date;
  durationMinutes: number;
  summary: string;
  description?: string | null;
  location?: string | null;
  organizer: IcsPerson;
  attendees?: IcsAttendee[];
  /** Bumped on every re-issue of the same UID so clients apply the update. */
  sequence?: number;
  status?: IcsStatus;
  method?: IcsMethod;
  /** DTSTAMP — when this particular file was generated. Defaults to `start`. */
  stamp?: string | Date;
  /** Optional reminder, in minutes before the start. */
  alarmMinutesBefore?: number | null;
  /** PRODID identity. */
  prodId?: string;
}

export const ICS_PROD_ID = "-//ai.STARTUPJURY//Scheduling//EN";
export const ICS_CONTENT_TYPE = 'text/calendar; charset="utf-8"; method=REQUEST';

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** UTC date-time in iCalendar basic format: `20260815T093000Z`. */
export function formatIcsDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ics date: ${String(value)}`);
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/**
 * Fold a content line to 75 octets per RFC 5545 §3.1. Splits on octet counts (not
 * characters) but never inside a multi-byte UTF-8 sequence, so a name with an
 * accent or an emoji can't be corrupted mid-fold.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let octets = 0;
  // First line allows 75 octets; continuation lines carry a leading space, so
  // they allow 74 of their own.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > limit) {
      out.push(current);
      current = "";
      octets = 0;
      limit = 74;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

function person(prop: "ORGANIZER" | "ATTENDEE", p: IcsPerson, params: string[] = []): string {
  const all = [...params];
  if (p.name) all.push(`CN=${escapeIcsText(p.name)}`);
  const prefix = all.length ? `${prop};${all.join(";")}` : prop;
  return `${prefix}:mailto:${p.email}`;
}

/** Build a complete VCALENDAR document containing one VEVENT. */
export function buildIcs(input: IcsEventInput): string {
  const start = formatIcsDate(input.start);
  const startMs = (input.start instanceof Date ? input.start : new Date(input.start)).getTime();
  const minutes = Math.max(1, Math.round(input.durationMinutes));
  const end = formatIcsDate(new Date(startMs + minutes * 60_000));
  const method: IcsMethod = input.method ?? "REQUEST";
  const status: IcsStatus = input.status ?? (method === "CANCEL" ? "CANCELLED" : "CONFIRMED");

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${input.prodId ?? ICS_PROD_ID}`,
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${formatIcsDate(input.stamp ?? input.start)}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SEQUENCE:${Math.max(0, Math.trunc(input.sequence ?? 0))}`,
    `STATUS:${status}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ];

  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeIcsText(input.location)}`);

  lines.push(person("ORGANIZER", input.organizer, ["ROLE=CHAIR"]));
  for (const attendee of input.attendees ?? []) {
    lines.push(
      person("ATTENDEE", attendee, [
        `ROLE=${attendee.role ?? "REQ-PARTICIPANT"}`,
        "PARTSTAT=NEEDS-ACTION",
        "RSVP=TRUE",
      ]),
    );
  }

  if (input.alarmMinutesBefore && input.alarmMinutesBefore > 0) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(input.summary)}`,
      `TRIGGER:-PT${Math.round(input.alarmMinutesBefore)}M`,
      "END:VALARM",
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/** A filesystem-safe `.ics` filename derived from a call/company name. */
export function icsFilename(label: string): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "call";
  return `${slug}.ics`;
}
