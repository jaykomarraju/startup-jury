import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { getCallPrompts, type CallPrompt } from "../api";

/**
 * The intro call's AI questions (W7-E) — Admin console → Scoring framework →
 * "Intro call AI question prompts enabled: AI generates tailored questions for
 * jury to use during startup calls" (`admin/s-fw.html`, F0110).
 *
 * `GET /api/calls/:id/prompts` has returned these since Wave 2 and no screen
 * called it. Each prompt carries three fields — the area it probes, the question
 * to ask, and why the AI raised it — and the block renders all three.
 *
 * When the admin has the toggle OFF the route answers `enabled: false`, and this
 * renders NOTHING: no heading, no empty state, no placeholder. An unexplained
 * blank on the call screen is exactly what the flag exists to avoid. It also
 * renders nothing until the answer arrives and nothing if the request fails, so
 * the call screen never flashes a block it may have to take away.
 *
 * Placement is one line in whichever screen owns the call detail:
 *   <IntroCallQuestions callId={call.id} />
 */
export function IntroCallQuestions({ callId, className }: { callId: string; className?: string }) {
  const [state, setState] = useState<{ callId: string; enabled: boolean; prompts: CallPrompt[] } | null>(null);

  useEffect(() => {
    let live = true;
    getCallPrompts(callId)
      .then((r) => live && setState({ callId, enabled: r.enabled, prompts: r.prompts }))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [callId]);

  // A stale answer for a previous call must not render under the new one.
  if (!state || state.callId !== callId || !state.enabled) return null;

  return (
    <section
      aria-label="AI question prompts"
      data-testid="intro-call-questions"
      className={`rounded-[10px] border border-stone-dk bg-surface ${className ?? ""}`}
    >
      <header className="flex items-center gap-2.5 border-b border-stone px-3.5 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-olive-lt text-olive-dk">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-semibold text-fg">AI question prompts</h3>
          <p className="text-[10.5px] text-fg-muted">Tailored questions for the jury to use during this call</p>
        </div>
        <span className="ml-auto text-[10px] font-medium text-fg-muted">
          {state.prompts.length} question{state.prompts.length === 1 ? "" : "s"}
        </span>
      </header>
      {state.prompts.length === 0 ? (
        <p className="px-3.5 py-3 text-[11.5px] text-fg-muted">
          No gaps to probe — the deck's evaluation raised no weak areas or missing information.
        </p>
      ) : (
        <ol className="divide-y divide-stone">
          {state.prompts.map((p, i) => (
            <li key={`${p.topic}-${i}`} className="px-3.5 py-2.5">
              <div className="text-[9.5px] font-semibold uppercase tracking-[.06em] text-olive-dk">{p.topic}</div>
              <p className="mt-0.5 text-[12px] font-medium leading-snug text-fg">{p.question}</p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-fg-muted">
                <span className="font-medium">Why:</span> {p.because}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
