/**
 * JURYbuddy — the Help screen (V3 item 15), ported from `Help_JURYbuddy.HTM`.
 *
 * The spec ships as a floating corner widget on a stand-in page. Here it is the
 * `help` nav item's SCREEN instead, for two reasons: the spec's own copy calls it
 * one (*"Under Support, Help can take you to search bar"*), and a fixed launcher
 * on every route would change how every other role's screens render, which this
 * wave's constraints forbid. Everything inside the panel is reproduced — the four
 * views, the matcher, the clip player, the feedback row.
 *
 * ── Two behaviours that look like bugs and are the spec's ────────────────────
 *  · A no-match query still offers a "closest" entry even at score 0, where the
 *    sort is a no-op and it returns the first FAQ. The copy above it hedges
 *    ("Here's what might help instead"), so this is intentional. See `search.ts`.
 *  · "Back" from an answer returns to the RESULTS for the query you came from,
 *    not to the home view — `originQuery` carries it.
 *
 * ── One bug the spec warns about, and how React avoids it ───────────────────
 * The spec rebuilt only `#jb-results` per keystroke, never the `<input>`, after
 * an earlier version reset the caret to 0 on every character ("it read as typing
 * backwards"). The same hazard exists here: the input must stay MOUNTED across
 * the home/results/no-match views. It does — those three are one render with a
 * swapped results region, and only `answer`/`all` replace the whole body.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card } from "../../components";
import { HELP_CLIPS, HELP_FAQS, HELP_POPULAR_COUNT, helpSections, type HelpFaq } from "./faqs";
import { closestMatch, topMatches } from "./search";

/** Which of the spec's four views is showing. `query` is the search behind it. */
type View =
  | { mode: "search"; query: string }
  | { mode: "all" }
  | { mode: "answer"; id: string; originQuery: string };

/** `.jb-label` — the small uppercase eyebrow above each list. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="u-label mt-4 first:mt-0">{children}</div>;
}

/**
 * `.jb-row` — one question in any list. Highlighted as the best match.
 *
 * `text-fg-2`, not `text-fg-muted`: the spec sets `.jb-row{color:var(--text-2)}`
 * and `--fg-muted` is this app's alias for `--text-3`, the LIGHTER of the two
 * (index.css:74-76). The questions are the screen's primary content, so one step
 * too light is both a parity miss and a readability one. Same for the answer body.
 */
function QuestionRow({
  faq,
  best,
  onOpen,
}: {
  faq: HelpFaq;
  best?: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(faq.id)}
      className={`mt-2 w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
        best
          ? "bg-warn-lt font-medium text-warn"
          : "bg-surface-2 text-fg-2 hover:bg-warn-lt hover:text-warn"
      }`}
    >
      {faq.question}
    </button>
  );
}

/**
 * The clip player. `preload="none"` matters: without it every answer opened
 * would pull ~150 KB from R2 whether or not anyone pressed Watch.
 *
 * `failed` is the graceful path for the case that is TRUE TODAY — the clips are
 * uploaded to R2 by hand and `GET /api/help/clips/:clipId` 404s until they are,
 * so a missing video must never read as a broken screen.
 */
function ClipPlayer({ clipId, durationSec }: { clipId: string; durationSec: number }) {
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <p className="mt-4 text-xs text-fg-muted">
        The {durationSec}s clip for this answer isn&apos;t available yet.
      </p>
    );
  }
  return (
    <div className="mt-4">
      {!shown && (
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => setShown(true)}>
            Watch ({durationSec}s)
          </Button>
          <span className="text-xs text-fg-muted">See it on screen</span>
        </div>
      )}
      {shown && (
        // No caption track: the spec's clips are silent screen recordings, and
        // the answer text above the player is their transcript.
        <video
          data-testid="help-clip"
          className="w-full rounded-lg bg-black"
          controls
          muted
          autoPlay
          preload="none"
          src={`/api/help/clips/${clipId}`}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

/** `Was this helpful?` + `Rate it` — the spec's two "hook point" controls.
 *
 *  LOCAL ONLY. The spec leaves both as comments ("send … to your analytics
 *  endpoint") and persisting them needs a table this session may not add (no
 *  migration). The selection is kept visible so a click is acknowledged rather
 *  than silently dropped; §12 records that nothing is stored and where it goes. */
function FeedbackRow({ faqId }: { faqId: string }) {
  const [helpful, setHelpful] = useState<"yes" | "no" | null>(null);
  const [rating, setRating] = useState(0);

  return (
    // `key` resets both controls when the reader moves to another answer —
    // without it the previous answer's rating would appear pre-filled.
    <div key={faqId} className="mt-5 border-t border-line pt-4">
      <div className="flex items-center gap-2.5">
        <span className="text-xs text-fg-muted">Was this helpful?</span>
        {(["yes", "no"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={helpful === v}
            onClick={() => setHelpful(v)}
            className={`rounded-full border px-3.5 py-1 text-xs font-medium capitalize transition-colors ${
              helpful === v
                ? "border-warn bg-warn-lt text-warn"
                : "border-line text-fg-muted hover:bg-surface-2"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-xs text-fg-muted">Rate it</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`Rate ${n} out of 5`}
              // The Yes/No pair above reports its state with `aria-pressed`;
              // the stars reported theirs only as a text colour, so neither a
              // screen reader nor a test could read the rating back.
              aria-pressed={n <= rating}
              onClick={() => setRating(n)}
              className={`text-base leading-none ${n <= rating ? "text-warn" : "text-line"}`}
            >
              ★
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The spec's no-match footer. "Browse all FAQs" works; "Raise a support ticket"
 * is a STUB — the spec stubs it too (`alert('Would open the support ticket
 * flow.')`), and the destination it implies does not exist: the FAQ answer says
 * an individual's ticket "comes to our support team", which is §12.1's item 12,
 * blocked for want of any ai.STARTUPJURY principal inside the product.
 *
 * Rather than a dead button, this offers the path that DOES work today — Contact
 * Admin, which every internal role has — and says plainly why it is not Tickets.
 */
function NoMatchFooter({ onBrowseAll }: { onBrowseAll: () => void }) {
  const [explained, setExplained] = useState(false);
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Button variant="primary" onClick={onBrowseAll}>
        Browse all FAQs
      </Button>
      <Button variant="secondary" onClick={() => setExplained(true)}>
        Raise a support ticket
      </Button>
      {explained && (
        <p className="text-xs text-fg-muted">
          Support ticketing to ai.STARTUPJURY isn&apos;t connected yet. In the meantime,{" "}
          <Link to="/app/contactadmin" className="font-medium text-accent underline">
            Contact Admin
          </Link>{" "}
          reaches your own workspace administrators.
        </p>
      )}
    </div>
  );
}

export function HelpPage() {
  const [view, setView] = useState<View>({ mode: "search", query: "" });
  const faqs = HELP_FAQS;

  const query = view.mode === "search" ? view.query : "";
  const matches = useMemo(() => (query.trim() ? topMatches(query, faqs) : []), [query, faqs]);

  const openAnswer = (id: string) =>
    setView({ mode: "answer", id, originQuery: view.mode === "search" ? view.query : "" });

  // ── Answer view ────────────────────────────────────────────────────────────
  if (view.mode === "answer") {
    const faq = faqs.find((f) => f.id === view.id);
    if (!faq) return <HelpFrame>{null}</HelpFrame>;
    const clip = HELP_CLIPS[faq.clipId];
    return (
      <HelpFrame>
        <Card>
          <button
            type="button"
            className="text-xs text-fg-muted hover:text-fg"
            onClick={() => setView({ mode: "search", query: view.originQuery })}
          >
            ← {view.originQuery ? "Back to results" : "Back"}
          </button>
          <h2 className="mt-3 text-base font-semibold text-fg">{faq.question}</h2>
          <p className="mt-2.5 whitespace-pre-line text-sm leading-relaxed text-fg-2">
            {faq.answer}
          </p>
          {clip && <ClipPlayer clipId={faq.clipId} durationSec={clip.durationSec} />}
          <FeedbackRow faqId={faq.id} />
        </Card>
      </HelpFrame>
    );
  }

  // ── Browse-all view ────────────────────────────────────────────────────────
  if (view.mode === "all") {
    return (
      <HelpFrame>
        <Card>
          <button
            type="button"
            className="text-xs text-fg-muted hover:text-fg"
            onClick={() => setView({ mode: "search", query: "" })}
          >
            ← Back
          </button>
          <div className="mt-2">
            {helpSections(faqs).map((section) => (
              <div key={section}>
                <Eyebrow>{section}</Eyebrow>
                {faqs
                  .filter((f) => f.section === section)
                  .map((f) => (
                    <QuestionRow key={f.id} faq={f} onOpen={openAnswer} />
                  ))}
              </div>
            ))}
          </div>
        </Card>
      </HelpFrame>
    );
  }

  // ── Search view: home (empty query), results, or no-match ──────────────────
  const searching = query.trim().length > 0;
  const closest = searching && matches.length === 0 ? closestMatch(query, faqs) : undefined;

  return (
    <HelpFrame>
      <Card>
        <input
          className="sj-input"
          type="search"
          aria-label="Search the FAQs"
          placeholder="Ask a question…"
          autoComplete="off"
          value={view.query}
          onChange={(e) => setView({ mode: "search", query: e.target.value })}
        />

        {!searching && (
          <div data-testid="help-popular">
            <Eyebrow>Popular right now</Eyebrow>
            {faqs.slice(0, HELP_POPULAR_COUNT).map((f) => (
              <QuestionRow key={f.id} faq={f} onOpen={openAnswer} />
            ))}
          </div>
        )}

        {searching && matches.length > 0 && (
          <div data-testid="help-results">
            <Eyebrow>
              {matches.length} match{matches.length === 1 ? "" : "es"}
            </Eyebrow>
            {matches.map((m, i) => (
              <QuestionRow key={m.faq.id} faq={m.faq} best={i === 0} onOpen={openAnswer} />
            ))}
          </div>
        )}

        {searching && matches.length === 0 && (
          <div data-testid="help-nomatch" className="mt-4">
            {/* `.jb-nomatch-title` / `.jb-nomatch-sub` — two centred lines, not the
                app's dashed EmptyState card. The card is for a screen with
                nothing on it; here the suggestion and the two actions directly
                below ARE the content, and boxing the message off from them
                pushed them down and broke the reading order. */}
            <div className="text-center text-sm font-semibold text-fg">No exact match found</div>
            <div className="mt-1 text-center text-xs text-fg-muted">
              {closest ? "Here's what might help instead:" : "Try a different phrase."}
            </div>
            {closest && <QuestionRow faq={closest} onOpen={openAnswer} />}
            <NoMatchFooter onBrowseAll={() => setView({ mode: "all" })} />
          </div>
        )}
      </Card>

      {!searching && (
        <Button variant="secondary" onClick={() => setView({ mode: "all" })}>
          Browse all {faqs.length} FAQs
        </Button>
      )}
    </HelpFrame>
  );
}

/** Shared page chrome, so every view keeps the same heading and width. */
function HelpFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Help</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Search the FAQs, or browse them by topic. Most answers come with a short clip.
        </p>
      </div>
      <div className="flex max-w-2xl flex-col items-start gap-3">{children}</div>
    </div>
  );
}
