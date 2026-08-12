import { useEffect, useRef, useState } from "react";
import { Globe, ChevronDown } from "lucide-react";

/** Minimal deck shape the research query is built from. */
export interface ResearchDeck {
  name: string;
  sector?: string;
  stage?: string;
  city?: string;
}

/**
 * A juror researches a startup using their OWN external AI. This never touches
 * company API tokens — it just opens the provider's site in a new tab with a
 * prefilled query (fixed-price model; company tokens are for evaluation only).
 */
export interface ResearchProvider {
  id: string;
  label: string;
  /** Colour + glyph for the little brand chip (mirrors the prototype). */
  color: string;
  glyph: string;
  /** Builds the target URL. Providers without a query param open their app. */
  toUrl: (query: string) => string;
}

export const RESEARCH_PROVIDERS: ResearchProvider[] = [
  { id: "chatgpt", label: "ChatGPT", color: "#10A37F", glyph: "C", toUrl: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
  { id: "claude", label: "Claude", color: "#D97757", glyph: "✦", toUrl: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}` },
  { id: "perplexity", label: "Perplexity", color: "#20808D", glyph: "P", toUrl: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}` },
  { id: "gemini", label: "Gemini", color: "#4285F4", glyph: "G", toUrl: () => "https://gemini.google.com/app" },
  { id: "copilot", label: "Copilot", color: "#0A6CFF", glyph: "◆", toUrl: (q) => `https://copilot.microsoft.com/?q=${encodeURIComponent(q)}` },
];

/** The prefilled research prompt built from the deck's public fields. */
export function buildResearchQuery(deck: ResearchDeck): string {
  const facts = [deck.sector, deck.stage, deck.city ? `based in ${deck.city}` : null].filter(Boolean).join(", ");
  const subject = facts ? `${deck.name} (${facts})` : deck.name;
  return (
    `Research the startup ${subject}. Summarise its market size, traction signals, ` +
    `competitors, founding team and any funding history.`
  );
}

/** Top-right "Research" dropdown opening the juror's own external AI. */
export function ResearchMenu({ deck }: { deck: ResearchDeck }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function go(provider: ResearchProvider) {
    const url = provider.toUrl(buildResearchQuery(deck));
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-navy/90"
      >
        <Globe className="h-4 w-4" aria-hidden="true" />
        Research
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-64 rounded-lg border border-line bg-surface p-2 shadow-xl"
        >
          <div className="px-2 pb-1.5 pt-1 text-xs text-fg-muted">
            Open a research query about <span className="font-medium text-fg">{deck.name}</span> in your own AI:
          </div>
          <div className="flex flex-col">
            {RESEARCH_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                onClick={() => go(p)}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-surface-2"
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded font-semibold text-white"
                  style={{ background: p.color }}
                  aria-hidden="true"
                >
                  {p.glyph}
                </span>
                {p.label}
              </button>
            ))}
          </div>
          <div className="px-2 pb-1 pt-1.5 text-[10px] leading-tight text-fg-muted">
            Uses your own AI access — no company tokens are spent.
          </div>
        </div>
      )}
    </div>
  );
}
