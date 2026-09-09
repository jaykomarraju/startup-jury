import { Card } from "../../components";
import type { AdminSection } from "./sections";

/**
 * A console section that has its shell but not yet its body. It renders the
 * prototype's own heading and sub-line, then NAMES what will fill it and which
 * session lands it — so Waves 2–5 have an unambiguous slot, and so an admin
 * opening the console today is told what the section is for rather than
 * finding an empty pane.
 */
export function SectionPlaceholder({ section }: { section: AdminSection }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">{section.heading}</h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">{section.subtitle}</p>
      </div>

      <Card>
        <div className="u-label flex items-center gap-2">
          Not built yet
          <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] tracking-normal text-fg-muted">
            {section.placeholder.owner}
          </span>
        </div>
        <p className="mt-2 text-[13px] text-fg-muted">
          This section is part of the console shell; its contents land in{" "}
          <span className="font-medium text-fg">{section.placeholder.owner}</span>. It will contain:
        </p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[13px] text-fg-muted">
          {section.placeholder.contents.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
