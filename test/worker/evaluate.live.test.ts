import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  callAnthropic,
  buildTool,
  buildSystemPrompt,
  buildUserPrompt,
  parseEvaluation,
  computeResult,
  type ParameterRow,
  type AnchorRow,
} from "../../src/server/ai/evaluate";

// Live smoke test — hits the real Anthropic API. Skipped unless BOTH
// LIVE_ANTHROPIC=1 and ANTHROPIC_API_KEY are set in the shell:
//   LIVE_ANTHROPIC=1 ANTHROPIC_API_KEY=sk-... npm test
// (vitest.worker.config forwards those into LIVE_ANTHROPIC / LIVE_ANTHROPIC_KEY
// bindings — a separate name so the app's ANTHROPIC_API_KEY stays unset in tests.)
const LIVE = env.LIVE_ANTHROPIC === "1" && !!env.LIVE_ANTHROPIC_KEY;

/** Build a minimal, valid single-page PDF with a line of text (self-contained). */
function makeMinimalPdf(text: string): string {
  const enc = new TextEncoder();
  const stream = `BT /F1 16 Tf 72 720 Td (${text.replace(/([()\\])/g, "\\$1")}) Tj ET`;
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${enc.encode(stream).length}>>\nstream\n${stream}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(enc.encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = enc.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`;

  const bytes = enc.encode(pdf);
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw);
}

const PARAMS: ParameterRow[] = [
  { id: "p1", key: "problem", name: "Problem & Market Clarity", weight: 8 },
  { id: "p2", key: "traction", name: "Traction & Validation", weight: 10 },
  { id: "p3", key: "team", name: "Team & Execution", weight: 10 },
];
const ANCHORS: AnchorRow[] = [
  { band: "strong", min_score: 8, max_score: 10, label: "Strong" },
  { band: "moderate", min_score: 5, max_score: 7, label: "Moderate" },
  { band: "weak", min_score: 2, max_score: 4, label: "Weak" },
  { band: "absent", min_score: 0, max_score: 1, label: "Absent" },
];

describe.skipIf(!LIVE)("live Anthropic evaluation", () => {
  it("returns structured scores for every parameter and applies the gate", async () => {
    const pdfBase64 = makeMinimalPdf(
      "Acme AI. Problem: manual invoicing wastes time. Traction: 200 paying customers, $50k MRR. Team: ex-Stripe founders.",
    );
    const raw = await callAnthropic({
      apiKey: env.LIVE_ANTHROPIC_KEY,
      model: env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      system: buildSystemPrompt(null),
      userText: buildUserPrompt(PARAMS, ANCHORS),
      tool: buildTool(PARAMS),
      pdfBase64,
    });

    const parsed = parseEvaluation(raw, PARAMS);
    expect(parsed.scores.length).toBe(PARAMS.length);
    const result = computeResult(parsed, PARAMS, "incubator");
    expect(result.weightedTotal).toBeGreaterThan(0);
    expect(["ai_evaluated", "rejected", "incomplete"]).toContain(result.status);
  }, 60_000);
});
