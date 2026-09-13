import { useEffect, useState } from "react";
// Same self-hosted worker DeckPdfViewer uses (CSP: `worker-src blob:` + 'self').
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * pdf.js over a file that is still only in the browser — the review list's
 * "N slides" badge and the preview pane's first slides, before anything is
 * uploaded. Imported dynamically so it never loads in a test run.
 */
async function openPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
}

/** The page count, or null when pdf.js cannot read the file. */
export async function countPdfPages(file: File): Promise<number | null> {
  try {
    const doc = await openPdf(file);
    const n = doc.numPages;
    void doc.destroy();
    return n;
  } catch {
    return null;
  }
}

const PREVIEW_PAGES = 3;

/** The first slides of a staged deck, rendered in the preview pane. */
export function StagedSlides({ file }: { file: File }) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setFailed(false);
    (async () => {
      try {
        const doc = await openPdf(file);
        const out: string[] = [];
        for (let i = 1; i <= Math.min(PREVIEW_PAGES, doc.numPages); i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no 2d context");
          await page.render({ canvasContext: ctx, viewport }).promise;
          out.push(canvas.toDataURL("image/png"));
        }
        void doc.destroy();
        if (!cancelled) setPages(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (failed) {
    return <p className="text-[11.5px] text-fg-muted">This file could not be previewed.</p>;
  }
  if (!pages) {
    return <p className="text-[11.5px] text-fg-muted">Rendering the first slides…</p>;
  }
  return (
    <div className="flex flex-col gap-2.5">
      {pages.map((src, i) => (
        <div key={src.slice(-32) + i} className="rounded-[9px] border border-stone-dk bg-surface px-4 py-3.5">
          <div className="mb-2 text-[8.5px] font-semibold uppercase tracking-[0.08em] text-fg-muted">Slide {i + 1}</div>
          <img src={src} alt={`Slide ${i + 1}`} className="w-full rounded border border-stone" />
        </div>
      ))}
    </div>
  );
}
