import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, FileText, ExternalLink, Loader2 } from "lucide-react";
// Vite resolves this to a same-origin asset URL at build time (CSP-safe: the
// pdf.js worker is self-hosted, never a CDN).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type Status = "loading" | "ready" | "nopdf" | "error";

interface DeckPdfViewerProps {
  /** Deck whose R2 PDF is streamed from GET /api/decks/:id/file. */
  deckId: string;
  className?: string;
}

/**
 * In-app pitch-deck viewer. Streams the deck's PDF from the auth'd R2 endpoint,
 * renders each page to an image with pdf.js, and shows them as a slide strip:
 * click any slide to enlarge (lightbox) and page through with prev/next. Falls
 * back gracefully when there's no stored PDF (seed / pending) or on a load error.
 *
 * pdf.js is imported dynamically so it never loads in non-browser test runs.
 */
export function DeckPdfViewer({ deckId, className }: DeckPdfViewerProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [pages, setPages] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setPages([]);
    setLightbox(null);

    (async () => {
      try {
        const res = await fetch(`/api/decks/${deckId}/file`);
        if (res.status === 404) {
          if (!cancelled) setStatus("nopdf");
          return;
        }
        if (!res.ok) throw new Error(`file ${res.status}`);
        const buf = await res.arrayBuffer();

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const doc = await pdfjs.getDocument({ data: buf }).promise;

        const rendered: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1.4 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no 2d context");
          await page.render({ canvasContext: ctx, viewport }).promise;
          rendered.push(canvas.toDataURL("image/png"));
        }
        if (cancelled) return;
        setPages(rendered);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deckId]);

  // Keyboard paging inside the lightbox.
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") setLightbox((i) => (i === null ? i : Math.min(pages.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setLightbox((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, pages.length]);

  const fileUrl = `/api/decks/${deckId}/file`;

  return (
    <div className={`rounded-lg border border-line bg-surface-2 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />
          <span className="u-label">Pitch deck</span>
          {status === "ready" && (
            <span className="text-xs text-fg-muted">· {pages.length} slide{pages.length === 1 ? "" : "s"}</span>
          )}
        </div>
        {(status === "ready" || status === "error") && (
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Open PDF <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="p-3">
        {status === "loading" && (
          <div className="flex h-28 items-center justify-center gap-2 text-sm text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading slides…
          </div>
        )}

        {status === "nopdf" && (
          <div className="flex h-28 flex-col items-center justify-center gap-1 text-center">
            <FileText className="h-5 w-5 text-fg-muted" aria-hidden="true" />
            <div className="text-sm font-medium text-fg">No PDF stored for this deck</div>
            <div className="text-xs text-fg-muted">Upload a deck to view its slides here.</div>
          </div>
        )}

        {status === "error" && (
          <div className="flex h-28 flex-col items-center justify-center gap-1 text-center">
            <div className="text-sm font-medium text-fg">Couldn’t render the slides</div>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
              Open the PDF in a new tab
            </a>
          </div>
        )}

        {status === "ready" && (
          <div
            ref={stripRef}
            className="flex gap-3 overflow-x-auto pb-1"
            aria-label="Deck slides"
          >
            {pages.map((src, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setLightbox(i)}
                title="Click to enlarge"
                className="group relative shrink-0 overflow-hidden rounded-md border border-line bg-surface transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <img src={src} alt={`Slide ${i + 1}`} className="h-40 w-auto" />
                <span className="absolute bottom-1 left-1 rounded bg-navy/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {lightbox !== null && pages[lightbox] && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-navy/70 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label={`Slide ${lightbox + 1} of ${pages.length}`}
          onClick={() => setLightbox(null)}
        >
          <div className="flex items-center justify-between px-5 py-3 text-white" onClick={(e) => e.stopPropagation()}>
            <span className="font-mono text-sm">
              Slide {lightbox + 1} / {pages.length}
            </span>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Close"
              className="rounded-lg p-1.5 hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center gap-3 overflow-auto px-4 pb-5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightbox((i) => (i === null ? i : Math.max(0, i - 1)))}
              disabled={lightbox === 0}
              aria-label="Previous slide"
              className="shrink-0 rounded-full bg-white/10 p-2 text-white enabled:hover:bg-white/20 disabled:opacity-30"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <img
              src={pages[lightbox]}
              alt={`Slide ${lightbox + 1}`}
              className="max-h-full max-w-full rounded-md bg-white shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setLightbox((i) => (i === null ? i : Math.min(pages.length - 1, i + 1)))}
              disabled={lightbox === pages.length - 1}
              aria-label="Next slide"
              className="shrink-0 rounded-full bg-white/10 p-2 text-white enabled:hover:bg-white/20 disabled:opacity-30"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
