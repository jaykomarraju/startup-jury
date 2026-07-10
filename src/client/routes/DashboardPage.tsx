import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import {
  KpiTile,
  Card,
  Button,
  DeckRow,
  EvaluationDrawer,
} from "../components";
import type { DeckView } from "../types";
import type { ParamScoreView } from "../components";
import type { Edition } from "../../shared/roles";

// Placeholder data — mirrors the mockups. Replaced by the decks API in Phase 3.
const DECKS: Record<Edition, DeckView[]> = {
  incubator: [
    { id: "1", name: "FinStack", sector: "FinTech", stage: "Seed", city: "Hyderabad", founder: "Ananya Reddy", aiScore: 7.2, signal: "moderate", status: "AI Evaluated" },
    { id: "2", name: "InsureFlow", sector: "Insurtech", stage: "Series A", city: "Bengaluru", founder: "Rahul Verma", aiScore: 8.6, signal: "strong", status: "Shortlisted" },
    { id: "3", name: "CreditBridge", sector: "Lending", stage: "Pre-seed", city: "Pune", founder: "Kavya Nair", aiScore: 6.1, signal: "moderate", status: "Assigned" },
    { id: "4", name: "PayRoute", sector: "Payments", stage: "Idea", city: "Delhi", founder: "—", signal: "flagged", status: "Incomplete" },
    { id: "5", name: "GreenRoute", sector: "Climatetech", stage: "Pre-seed", city: "Hyderabad", founder: "Sneha Iyer", aiScore: 9.1, signal: "strong", status: "AI Evaluated" },
  ],
  vc: [
    { id: "1", name: "FinStack", sector: "B2B FinTech", city: "Hyderabad", aiScore: 7.2, signal: "moderate", status: "AI Evaluated" },
    { id: "2", name: "InsureFlow", sector: "Insurtech", city: "Bengaluru", aiScore: 8.3, signal: "strong", status: "Onboard ready" },
    { id: "3", name: "CreditBridge", sector: "Lending", city: "Pune", aiScore: 6.4, signal: "moderate", status: "In Diligence" },
    { id: "4", name: "PayRoute", sector: "Payments", city: "Delhi", aiScore: 4.1, signal: "weak", status: "Incomplete" },
    { id: "5", name: "WealthOS", sector: "Wealthtech", city: "Mumbai", aiScore: 7.8, signal: "moderate", status: "IC ready" },
  ],
};

const KPIS: Record<Edition, { label: string; value: number; sublabel: string; progress: number }[]> = {
  incubator: [
    { label: "Uploaded", value: 24, sublabel: "+3 since yesterday", progress: 100 },
    { label: "Pending", value: 9, sublabel: "Awaiting evaluation", progress: 38 },
    { label: "Incomplete", value: 4, sublabel: "Missing slides", progress: 17 },
    { label: "AI Evaluated", value: 11, sublabel: "46% of uploaded", progress: 46 },
    { label: "Assigned", value: 8, sublabel: "33% of uploaded", progress: 33 },
    { label: "Shortlisted", value: 5, sublabel: "63% shortlist rate", progress: 63 },
  ],
  vc: [
    { label: "Uploaded", value: 24, sublabel: "+3 this week", progress: 100 },
    { label: "Incomplete", value: 4, sublabel: "Missing materials", progress: 17 },
    { label: "AI Evaluated", value: 20, sublabel: "83% of uploaded", progress: 83 },
    { label: "In Diligence", value: 8, sublabel: "Active diligence", progress: 33 },
    { label: "IC Ready", value: 5, sublabel: "Queued for committee", progress: 21 },
    { label: "Onboard Ready", value: 3, sublabel: "Cleared to onboard", progress: 13 },
  ],
};

const SAMPLE_SCORES: ParamScoreView[] = [
  { label: "Problem & Market Clarity", weight: 8, value: 8 },
  { label: "Traction & Validation", weight: 10, value: 7 },
  { label: "Team & Execution", weight: 10, value: 9 },
  { label: "Business Model", weight: 8, value: 6 },
  { label: "Climate Impact", weight: 10, value: 8 },
];

const PIPELINE_PROGRESS = [
  { label: "Pending", count: 9, pct: 38, color: "var(--color-signal-moderate)" },
  { label: "Incomplete", count: 4, pct: 17, color: "var(--color-signal-flagged)" },
  { label: "AI Evaluated", count: 11, pct: 46, color: "var(--color-signal-strong)" },
  { label: "Assigned", count: 8, pct: 33, color: "var(--color-navy)" },
  { label: "Shortlisted", count: 5, pct: 21, color: "var(--color-deepgreen)" },
];

export function DashboardPage() {
  const { user } = useAuth();
  const [selected, setSelected] = useState<DeckView | null>(null);
  if (!user) return null;

  const edition = user.edition;
  const decks = DECKS[edition];
  const kpis = KPIS[edition];

  return (
    <div className="flex flex-col gap-5 p-5 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-fg">All decks</h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              {decks.length} submissions · Updated 2 min ago
            </p>
          </div>
          <Button variant="secondary" size="sm">Export</Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {kpis.map((k, i) => (
            <KpiTile key={k.label} {...k} active={i === 0} />
          ))}
        </div>

        <Card flush className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left">
            <thead>
              <tr className="text-fg-muted">
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Startup</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                  {edition === "incubator" ? "Founder" : "Sector"}
                </th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">City</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">AI score</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Signal</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {decks.map((deck) => (
                <DeckRow key={deck.id} deck={deck} onClick={setSelected} />
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
        <Card>
          <div className="u-label">Pipeline progress</div>
          <div className="mt-3 flex flex-col gap-2.5">
            {PIPELINE_PROGRESS.map((p) => (
              <div key={p.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-fg">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                    {p.label}
                  </span>
                  <span className="text-fg-muted">
                    {p.count} · {p.pct}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: p.color }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="u-label">Cohort rating thresholds</div>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            <li className="flex justify-between"><span className="text-fg">Best</span><span className="font-mono text-fg-muted">≥ 7.0</span></li>
            <li className="flex justify-between"><span className="text-fg">Mediocre</span><span className="font-mono text-fg-muted">5.0 – 6.9</span></li>
            <li className="flex justify-between"><span className="text-fg">Poor</span><span className="font-mono text-fg-muted">&lt; 5.0</span></li>
          </ul>
        </Card>
      </aside>

      {selected && (
        <EvaluationDrawer
          open
          onClose={() => setSelected(null)}
          deck={selected}
          verdict={selected.signal === "strong" ? "Shortlist" : "Review"}
          scores={SAMPLE_SCORES}
          extraction={[
            { label: "Cover", heading: selected.name, text: `${selected.sector ?? ""} · ${selected.city ?? ""}` },
            { label: "Problem", text: "Placeholder extraction — live AI extraction arrives in Phase 3." },
            { label: "Traction", text: "Placeholder metrics and validation summary." },
          ]}
        />
      )}
    </div>
  );
}
