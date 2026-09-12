import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Armchair, Building2, CircleCheck, Info, RotateCcw } from "lucide-react";
import { Card, Button } from "../../components";
import { useAdminSave } from "./saveContext";
import {
  fundReconcileNote,
  fundUtilisation,
  seatNote,
  seatRowState,
  seatlessNote,
  type FundRowView,
  type SeatRowView,
} from "../../../shared/signupConfig";

/**
 * Admin console → Sign-up, fourth section — **the one slot the two editions do
 * not share**:
 *
 *   • incubator → **Seat capacity** (`admin/s-suseat.html`): a cohort's seat
 *     count, how many are filled, utilisation with the prototype's bar (olive,
 *     red over capacity), and the seatless queue.
 *   • VC → **Fund Deployment** (`admin/s-sufund.html`): allotted / deployed /
 *     unutilised per programme in ₹ Cr, utilisation, and the ±0.5 Cr
 *     reconciliation line.
 *
 * Both live in this file because they are the same slot (`secs[11]`) and share
 * the table, the inline-edit draft and the bar. `registry.tsx` maps `suseat`
 * and `sufund` to the two exports.
 *
 * **Seats here are the COHORT's** — how many startups a batch can take (plan
 * §8 Q50). The purchased user-seat entitlement lives in Credits & billing and
 * nothing here reads it.
 *
 * Neither table gates anything. Over capacity is a warning, because
 * `s-suseat.html` says in as many words that sign-up is never blocked by seats;
 * a fund that does not reconcile is a warning, because an admin with one true
 * figure and one still being chased needs to save the true one.
 */

// ── Shared chrome ────────────────────────────────────────────────────────────

function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
      <span style={{ color: "var(--ac-olive, #4A6644)" }}>{icon}</span>
      {children}
    </div>
  );
}

const numClass =
  "h-8 w-[82px] rounded-[7px] border border-line bg-surface px-2 text-item text-fg tabular-nums";

/** The prototype's `.sc-cell` / `.fd-cell`: a percentage and a 70 px mini-bar. */
function UtilisationCell({
  pct,
  over,
  testId,
}: {
  pct: number;
  over?: boolean;
  testId: string;
}) {
  const colour = over ? "var(--signal-flagged, #C0392B)" : "var(--ac-olive, #4A6644)";
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-[38px] shrink-0 text-right text-[11.5px] font-semibold tabular-nums"
        style={{ color: colour }}
        data-testid={`${testId}-pct`}
      >
        {pct}%
      </span>
      <div className="h-[7px] w-[70px] overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          data-testid={`${testId}-bar`}
          style={{ width: `${Math.min(pct, 100)}%`, background: colour }}
        />
      </div>
    </div>
  );
}

function NoteLine({
  tone,
  text,
  testId,
}: {
  tone: "warn" | "info" | "ok";
  text: string;
  testId: string;
}) {
  const Icon = tone === "warn" ? AlertTriangle : tone === "ok" ? CircleCheck : Info;
  const colour =
    tone === "warn"
      ? "var(--signal-flagged, #C0392B)"
      : tone === "ok"
        ? "var(--positive, #16A34A)"
        : "var(--fg-muted)";
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-fg-muted" data-testid={testId}>
      <Icon className="mt-[1px] h-3.5 w-3.5 shrink-0" style={{ color: colour }} />
      <span>{text}</span>
    </p>
  );
}

async function send(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const code = String(payload.error ?? `HTTP ${r.status}`);
    throw new Error(
      code === "invalid_seats"
        ? "Seat counts must be whole numbers, zero or more."
        : code === "invalid_fund"
          ? "Fund figures must be ₹ Cr amounts, zero or more."
          : code.replace(/_/g, " "),
    );
  }
  return payload;
}

/** Parse a number input the way the prototype's `scNum` / `fdNum` do. */
function intOrZero(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function crOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** An input's text for a nullable ₹ Cr figure — `null` renders as empty. */
function crText(v: number | null): string {
  return v === null ? "" : String(v);
}

// ═══════════════════════════════════════════════════════════════════════════
// Seat capacity (incubator)
// ═══════════════════════════════════════════════════════════════════════════

interface SeatDraft {
  cohortId: string;
  capacity: string;
  filled: string;
}

interface SeatPayload {
  rows: SeatRowView[];
  seatless: {
    signupId: string;
    startup: string;
    status: string;
    cohortId: string | null;
    cohortName: string | null;
    programName: string | null;
  }[];
}

function seatDraftOf(rows: SeatRowView[]): SeatDraft[] {
  return rows.map((r) => ({
    cohortId: r.cohortId,
    capacity: String(r.capacity),
    filled: String(r.filled),
  }));
}

export function SeatCapacitySection() {
  const [payload, setPayload] = useState<SeatPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<SeatDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (reset: boolean) => {
    try {
      const r = await fetch("/api/signup-config/seats");
      if (!r.ok) throw new Error(String(r.status));
      const next = (await r.json()) as SeatPayload;
      setPayload(next);
      if (reset) setDraft(seatDraftOf(next.rows));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  /** The table as it stands in the draft, so the bar tracks what is typed. */
  const rows = useMemo(() => {
    if (!payload) return [];
    return payload.rows.map((r) => {
      const d = draft.find((x) => x.cohortId === r.cohortId);
      const capacity = d ? intOrZero(d.capacity) : r.capacity;
      const filled = d ? intOrZero(d.filled) : r.filled;
      const { pct, over } = seatRowState({ name: r.name, capacity, filled });
      return { ...r, capacity, filled, utilisation: pct, over };
    });
  }, [draft, payload]);

  const dirty = useMemo(() => {
    if (!payload) return false;
    return payload.rows.some((r) => {
      const d = draft.find((x) => x.cohortId === r.cohortId);
      if (!d) return false;
      return intOrZero(d.capacity) !== r.capacity || intOrZero(d.filled) !== r.filled;
    });
  }, [draft, payload]);

  const setRow = (cohortId: string, patch: Partial<SeatDraft>) => {
    setDraft((d) => d.map((x) => (x.cohortId === cohortId ? { ...x, ...patch } : x)));
    setError(null);
    setNote(null);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const r = (await send("PUT", "/api/signup-config/seats", {
        rows: draft.map((d) => ({
          cohortId: d.cohortId,
          capacity: intOrZero(d.capacity),
          filled: intOrZero(d.filled),
        })),
      })) as unknown as SeatPayload & { saved: number };
      setPayload({ rows: r.rows, seatless: r.seatless });
      setDraft(seatDraftOf(r.rows));
      setNote(
        `Seat settings saved for ${r.saved} program${r.saved === 1 ? "" : "s"} / cohort${r.saved === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the seat settings.");
    } finally {
      setSaving(false);
    }
  }, [draft]);

  useAdminSave({ dirty, saving, hint: "No seat changes to save", onSave: save });

  const allocate = useCallback(
    async (signupId: string, startup: string) => {
      setBusy(signupId);
      setError(null);
      setNote(null);
      try {
        const r = await send("POST", `/api/signup-config/signups/${signupId}/seat`);
        await load(true);
        setNote(
          `Seat allocated to ${startup} · founder access provisioned.` +
            (r.over ? " That cohort is now over capacity." : ""),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't allocate that seat.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const heading = (
    <div>
      <h2 className="text-base font-semibold tracking-tight text-fg">Seat capacity</h2>
      <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
        Set each program / cohort&rsquo;s seat count and how many are filled. Sign-up is never
        blocked by seats &mdash; startups that complete without one are flagged{" "}
        <strong className="font-semibold text-fg">seatless</strong> so the team can allocate a seat
        and founder access from the pipeline.
      </p>
    </div>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&rsquo;t load seat capacity.{" "}
            <button className="text-olive underline" onClick={() => void load(true)}>
              Retry
            </button>
          </p>
        </Card>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">Loading seat capacity&hellip;</p>
        </Card>
      </div>
    );
  }

  const capacityNote = seatNote(rows);

  return (
    <div className="flex flex-col gap-3">
      {heading}

      <Card>
        <CardTitle icon={<Armchair className="h-3.5 w-3.5" />}>Seats by program / cohort</CardTitle>
        {rows.length === 0 ? (
          <p className="py-2 text-[13px] text-fg-muted" data-testid="seat-empty">
            No cohorts yet. Create one in Set up &rarr; Programs, then set its seat count here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-item">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="u-label py-1.5 font-normal">Program / cohort</th>
                  <th className="u-label py-1.5 font-normal">Seat capacity</th>
                  <th className="u-label py-1.5 font-normal">Seats filled</th>
                  <th className="u-label py-1.5 font-normal">Utilisation</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = draft.find((x) => x.cohortId === r.cohortId);
                  return (
                    <tr
                      key={r.cohortId}
                      className="border-b border-line last:border-0"
                      data-testid={`seat-row-${r.cohortId}`}
                    >
                      <td className="py-1.5 pr-3 text-[13px] font-semibold text-fg">{r.name}</td>
                      <td className="py-1.5 pr-3">
                        <input
                          className={numClass}
                          type="number"
                          min={0}
                          aria-label={`${r.name} seat capacity`}
                          value={d?.capacity ?? String(r.capacity)}
                          onChange={(e) => setRow(r.cohortId, { capacity: e.target.value })}
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input
                          className={numClass}
                          type="number"
                          min={0}
                          aria-label={`${r.name} seats filled`}
                          value={d?.filled ?? String(r.filled)}
                          onChange={(e) => setRow(r.cohortId, { filled: e.target.value })}
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <UtilisationCell
                          pct={r.utilisation}
                          over={r.over}
                          testId={`seat-util-${r.cohortId}`}
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          aria-label={`Clear seats for ${r.name}`}
                          title="Clear this cohort's seat count. The cohort itself is managed in Set up."
                          className="text-fg-muted hover:text-signal-flagged"
                          onClick={() => setRow(r.cohortId, { capacity: "0", filled: "0" })}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <NoteLine tone={capacityNote.tone} text={capacityNote.text} testId="seat-note" />
      </Card>

      {error && (
        <p className="text-[13px] text-signal-flagged" role="alert">
          {error}
        </p>
      )}
      {note && <p className="text-[13px] text-positive">{note}</p>}

      {/* The pipeline's seatless queue — why seats are configured at all. */}
      <Card>
        <CardTitle icon={<AlertTriangle className="h-3.5 w-3.5" />}>Seatless sign-ups</CardTitle>
        <p className="text-[11.5px] text-fg-muted" data-testid="seatless-note">
          {seatlessNote(payload.seatless.length)}
        </p>
        {payload.seatless.length > 0 && (
          <ul className="mt-2">
            {payload.seatless.map((s) => (
              <li
                key={s.signupId}
                className="flex flex-wrap items-center gap-2 rounded-[10px] border py-2.5 pl-3 pr-2.5 [&+li]:mt-2"
                style={{ borderColor: "#EBC7C2", background: "#FCEBEB" }}
                data-testid={`seatless-${s.signupId}`}
              >
                <span className="min-w-0 flex-1 text-[12px] font-semibold text-signal-flagged">
                  {s.startup} &mdash; no cohort seat allocated yet
                </span>
                <span className="text-[11px] text-fg-muted">
                  {[s.programName, s.cohortName].filter(Boolean).join(" · ") || "No cohort"}
                </span>
                <Button
                  size="sm"
                  disabled={busy !== null || !s.cohortId}
                  title={s.cohortId ? undefined : "Assign this startup to a cohort first."}
                  onClick={() => void allocate(s.signupId, s.startup)}
                >
                  {busy === s.signupId ? "Allocating…" : "Allocate seat"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Fund Deployment (VC)
// ═══════════════════════════════════════════════════════════════════════════

interface FundDraft {
  programId: string;
  allotted: string;
  deployed: string;
  unutilised: string;
}

interface FundPayload {
  rows: FundRowView[];
}

function fundDraftOf(rows: FundRowView[]): FundDraft[] {
  return rows.map((r) => ({
    programId: r.programId,
    allotted: crText(r.allotted),
    deployed: crText(r.deployed),
    unutilised: crText(r.unutilised),
  }));
}

export function FundDeploymentSection() {
  const [payload, setPayload] = useState<FundPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<FundDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/signup-config/fund");
      if (!r.ok) throw new Error(String(r.status));
      const next = (await r.json()) as FundPayload;
      setPayload({ rows: next.rows });
      setDraft(fundDraftOf(next.rows));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** The table as typed, so the bar and the reconciliation line track edits. */
  const rows = useMemo(() => {
    if (!payload) return [];
    return payload.rows.map((r) => {
      const d = draft.find((x) => x.programId === r.programId);
      if (!d) return r;
      const allotted = crOrNull(d.allotted);
      const deployed = crOrNull(d.deployed);
      const unutilised = crOrNull(d.unutilised);
      const delta =
        allotted === null || deployed === null || unutilised === null
          ? null
          : Math.round((deployed + unutilised - allotted) * 100) / 100;
      return {
        ...r,
        allotted,
        deployed,
        unutilised,
        utilisation: fundUtilisation({ allotted, deployed }),
        reconcileDelta: delta,
        reconciles: delta === null || Math.abs(delta) <= 0.5,
      };
    });
  }, [draft, payload]);

  /**
   * Totalled from the rows as typed, not from the server's figures — the bars
   * and the reconciliation line already track the draft, and a footer that
   * lagged them would show a sum that matches none of the rows above it.
   */
  const totals = useMemo(() => {
    const sum = (pick: (r: (typeof rows)[number]) => number | null) =>
      Math.round(rows.reduce((n, r) => n + (pick(r) ?? 0), 0) * 100) / 100;
    const allotted = sum((r) => r.allotted);
    const deployed = sum((r) => r.deployed);
    return {
      allotted,
      deployed,
      unutilised: sum((r) => r.unutilised),
      utilisation: fundUtilisation({ allotted, deployed }),
    };
  }, [rows]);

  const dirty = useMemo(() => {
    if (!payload) return false;
    return payload.rows.some((r) => {
      const d = draft.find((x) => x.programId === r.programId);
      if (!d) return false;
      return (
        crOrNull(d.allotted) !== r.allotted ||
        crOrNull(d.deployed) !== r.deployed ||
        crOrNull(d.unutilised) !== r.unutilised
      );
    });
  }, [draft, payload]);

  const setRow = (programId: string, patch: Partial<FundDraft>) => {
    setDraft((d) => d.map((x) => (x.programId === programId ? { ...x, ...patch } : x)));
    setError(null);
    setNote(null);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const r = (await send("PUT", "/api/signup-config/fund", {
        rows: draft.map((d) => ({
          programId: d.programId,
          allotted: crOrNull(d.allotted),
          deployed: crOrNull(d.deployed),
          unutilised: crOrNull(d.unutilised),
        })),
      })) as unknown as FundPayload & { saved: number };
      setPayload({ rows: r.rows });
      setDraft(fundDraftOf(r.rows));
      setNote(
        `Fund deployment saved for ${r.saved} program${r.saved === 1 ? "" : "s"}. These figures feed the Capital Deployment & Pacing report.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the fund deployment.");
    } finally {
      setSaving(false);
    }
  }, [draft]);

  useAdminSave({ dirty, saving, hint: "No fund changes to save", onSave: save });

  const heading = (
    <div>
      <h2 className="text-base font-semibold tracking-tight text-fg">Fund Deployment</h2>
      <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
        Record, program-wise, how much of each fund is allotted, deployed, and still unutilised.
        These figures feed the Capital Deployment &amp; Pacing report.
      </p>
    </div>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&rsquo;t load fund deployment.{" "}
            <button className="text-olive underline" onClick={() => void load()}>
              Retry
            </button>
          </p>
        </Card>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">Loading fund deployment&hellip;</p>
        </Card>
      </div>
    );
  }

  const recon = fundReconcileNote(rows);

  return (
    <div className="flex flex-col gap-3">
      {heading}

      <Card>
        <CardTitle icon={<Building2 className="h-3.5 w-3.5" />}>
          Deployment by program / fund
        </CardTitle>
        {rows.length === 0 ? (
          <p className="py-2 text-[13px] text-fg-muted" data-testid="fund-empty">
            No programs yet. Create a fund in Set up &rarr; Programs, then record its deployment
            here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-item">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="u-label py-1.5 font-normal">Program / fund</th>
                  <th className="u-label py-1.5 font-normal">Allotted (₹ Cr)</th>
                  <th className="u-label py-1.5 font-normal">Deployed (₹ Cr)</th>
                  <th className="u-label py-1.5 font-normal">Unutilised (₹ Cr)</th>
                  <th className="u-label py-1.5 font-normal">Utilisation</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = draft.find((x) => x.programId === r.programId);
                  return (
                    <tr
                      key={r.programId}
                      className="border-b border-line last:border-0"
                      data-testid={`fund-row-${r.programId}`}
                    >
                      <td className="py-1.5 pr-3 text-[13px] font-semibold text-fg">{r.name}</td>
                      {(["allotted", "deployed", "unutilised"] as const).map((field) => (
                        <td key={field} className="py-1.5 pr-3">
                          <input
                            className={numClass}
                            type="number"
                            min={0}
                            step="0.1"
                            placeholder="—"
                            aria-label={`${r.name} ${field}`}
                            value={d?.[field] ?? crText(r[field])}
                            onChange={(e) => setRow(r.programId, { [field]: e.target.value })}
                          />
                        </td>
                      ))}
                      <td className="py-1.5 pr-3">
                        <UtilisationCell
                          pct={r.utilisation}
                          testId={`fund-util-${r.programId}`}
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          aria-label={`Clear fund figures for ${r.name}`}
                          title="Withdraw this program's figures. The program itself is managed in Set up."
                          className="text-fg-muted hover:text-signal-flagged"
                          onClick={() =>
                            setRow(r.programId, { allotted: "", deployed: "", unutilised: "" })
                          }
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line" data-testid="fund-totals">
                  <td className="py-1.5 pr-3 text-[12px] font-semibold text-fg">All programs</td>
                  <td className="py-1.5 pr-3 text-[12px] tabular-nums text-fg-2">
                    {totals.allotted}
                  </td>
                  <td className="py-1.5 pr-3 text-[12px] tabular-nums text-fg-2">
                    {totals.deployed}
                  </td>
                  <td className="py-1.5 pr-3 text-[12px] tabular-nums text-fg-2">
                    {totals.unutilised}
                  </td>
                  <td className="py-1.5 pr-3 text-[12px] tabular-nums text-fg-2">
                    {totals.utilisation}%
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <NoteLine tone={recon.tone} text={recon.text} testId="fund-recon" />
      </Card>

      {error && (
        <p className="text-[13px] text-signal-flagged" role="alert">
          {error}
        </p>
      )}
      {note && <p className="text-[13px] text-positive">{note}</p>}
    </div>
  );
}
