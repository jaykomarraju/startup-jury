import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeftRight,
  Building2,
  Coins,
  Eye,
  Gift,
  Globe,
  Info,
  Layers,
  Plus,
  ReceiptText,
  RotateCcw,
  Rocket,
  User,
} from "lucide-react";
import { Card, Button } from "../../components";
import { useAdminSave } from "./saveContext";
import {
  activeCurrencies,
  applyCopyTokens,
  deriveAmounts,
  formatMinor,
  fxRateFor,
  groupOf,
  listedPlans,
  normalisePriceBook,
  plansInGroup,
  PERIOD_SUFFIX,
  PLAN_GROUPS,
  priceBooksEqual,
  taxBreakdown,
  validatePriceBook,
  type CurrencyRow,
  type PlanGroupId,
  type PriceBook,
  type PricePlanRow,
  type PublishedPriceBook,
} from "../../../shared/priceBook";

/**
 * Admin console → Organisation → **Price configuration** (`admin/s-pc.html`).
 *
 * The prototype's section is a 235-byte iframe around a 37 KB document base64'd
 * into the admin script as `PC_B64`: a currency bar, an FX panel, four price
 * catalogues, a tax card, and a topbar carrying *Preview pricing page* and
 * *Publish changes* over a "Saved 5 Jun 2026, 9:02 am" stamp. This is that
 * document, less its own super-admin chrome — the console shell already
 * supplies a rail, a title bar and the global Save.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 * **Per-deck pricing** (§8 Q1, ruled by the user 2026-09-11). The prototype's
 * pack and enterprise tables carry a derived "₹X per deck" column and a saving
 * percentage computed against a per-deck base rate — the same base rate it
 * states three incompatible ways. The ruling retires all of it: plans, packs
 * and tiers carry stated prices. So those two columns are absent rather than
 * reinterpreted, and `perDeckArtefacts()` makes re-introducing one a 400.
 *
 * **A "Live" FX fetch.** The prototype's per-rate Live button alerts "connect
 * to Open Exchange Rates … in production". §1.3 keeps a vendor call off the
 * critical path, so rates are editable data and the panel says where they come
 * from instead of implying a feed.
 *
 * ── Draft, preview, publish ─────────────────────────────────────────────────
 * Editing writes a DRAFT; nothing a customer sees moves until Publish freezes a
 * version. Preview shows the draft beside the live catalogue for exactly that
 * reason, and Publish stays disabled until the draft is saved and valid.
 *
 * Everything the four catalogues render — titles, badges, card copy, SKU names —
 * comes from the server, not from this file. That is what makes §8 Q1's two
 * surviving ambiguities (which pay-as-you-go ladder, which enterprise
 * vocabulary) a data change: this component names no pack size and no tier.
 */

interface EditorPayload {
  draft: PriceBook;
  published: PublishedPriceBook | null;
  dirty: boolean;
  errors: string[];
  lastSavedAt: string | null;
  versions: { version: number; status: string; publishedAt: string; note: string | null }[];
  previousVersion: number | null;
}

// ── Small shared pieces ──────────────────────────────────────────────────────

const GROUP_ICONS: Record<string, ReactNode> = {
  gift: <Gift className="h-[15px] w-[15px]" />,
  user: <User className="h-[15px] w-[15px]" />,
  stack: <Layers className="h-[15px] w-[15px]" />,
  building: <Building2 className="h-[15px] w-[15px]" />,
  coin: <Coins className="h-[15px] w-[15px]" />,
};

/** The prototype's `.tog-sm` — a 28×16 pill, olive when on. */
function Toggle({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="relative h-4 w-7 shrink-0 rounded-full transition-colors"
      style={{ background: checked ? "var(--ac-olive, #4A6644)" : "var(--color-line, #D4D0C8)" }}
    >
      <span
        className="absolute top-[2px] h-3 w-3 rounded-full bg-white shadow-sm transition-[left]"
        style={{ left: checked ? 14 : 2 }}
      />
    </button>
  );
}

/**
 * A numeric field that lets a half-typed value stay half-typed. The committed
 * value is the source of truth; the text is only resynced when it no longer
 * parses to that value, so "0." survives long enough to become "0.012".
 */
function NumberField({
  value,
  onCommit,
  width = 90,
  step,
  label,
  testId,
  disabled,
}: {
  value: number;
  onCommit: (v: number) => void;
  width?: number;
  step?: string;
  label: string;
  testId?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);
  return (
    <input
      type="number"
      step={step}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      value={text}
      style={{ width }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) onCommit(n);
      }}
      className="rounded-md border border-line bg-surface px-2 py-1 text-right font-mono text-[13px] text-fg outline-none focus:border-gold disabled:bg-surface-2 disabled:text-fg-muted"
    />
  );
}

function SectionHeader({
  icon,
  title,
  badge,
}: {
  icon: ReactNode;
  title: string;
  badge: string | null;
}) {
  return (
    <div className="mt-1 mb-2 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-[13px] font-bold tracking-tight text-fg">
        <span style={{ color: "var(--ac-olive, #4A6644)" }}>{icon}</span>
        {title}
      </h3>
      {badge ? (
        <span className="rounded-[5px] bg-surface-2 px-2 py-[2px] text-[10px] font-semibold text-fg-muted">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function CardHead({
  icon,
  name,
  sub,
  tag,
}: {
  icon: ReactNode;
  name: string;
  sub: string | null;
  tag: string | null;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line bg-surface-2 px-4 py-3">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px]"
        style={{ background: "var(--color-surface, #fff)", color: "var(--ac-olive, #4A6644)" }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-fg">{name}</div>
        {sub ? <div className="mt-px text-[11px] text-fg-muted">{sub}</div> : null}
      </div>
      {tag ? (
        <span className="ml-auto shrink-0 rounded-[5px] bg-surface px-2 py-[2px] text-[10px] font-bold text-fg-2">
          {tag}
        </span>
      ) : null}
    </div>
  );
}

function Footnote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 border-t border-line bg-surface-2 px-4 py-2 text-[10.5px] text-fg-muted">
      <Info className="h-3 w-3 shrink-0" />
      {children}
    </div>
  );
}

const TH = "px-3.5 py-2 text-left text-[9px] font-bold uppercase tracking-[.07em] text-fg-muted";
const TD = "px-3.5 py-2.5 align-middle text-[12.5px]";

// ── The section ──────────────────────────────────────────────────────────────

export function PriceConfigurationSection() {
  const [payload, setPayload] = useState<EditorPayload | null>(null);
  const [book, setBook] = useState<PriceBook | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [addingCurrency, setAddingCurrency] = useState(false);

  /**
   * `force` is the difference between "fetch the editor" and "throw away what
   * is on screen". Only a save, a publish or a rollback may replace the book
   * being edited; a plain load must not, because React runs mount effects twice
   * in development and the second response would land on top of whatever had
   * been typed in between — silently losing an edit.
   */
  const editing = useRef<PriceBook | null>(null);
  const load = useCallback(async (force = false) => {
    const res = await fetch("/api/pricing");
    if (!res.ok) {
      setError("The price configuration could not be loaded.");
      return;
    }
    const body = (await res.json()) as EditorPayload;
    setPayload(body);
    if (force || editing.current === null) {
      editing.current = body.draft;
      setBook(body.draft);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Every edit re-derives the converted prices, so an FX change moves every
   * price that has not been typed over — the prototype's `recalc()`, done once
   * and in one place instead of per input.
   */
  const edit = useCallback((fn: (b: PriceBook) => PriceBook) => {
    setBook((current) => {
      if (!current) return current;
      const next = fn(current);
      const derived = normalisePriceBook({
        ...next,
        plans: next.plans.map((p) => ({ ...p, amounts: deriveAmounts(next, p) })),
      });
      editing.current = derived;
      return derived;
    });
    setNotice(null);
  }, []);

  const dirty = useMemo(
    () => (book && payload ? !priceBooksEqual(book, payload.draft) : false),
    [book, payload],
  );
  const errors = useMemo(() => (book ? validatePriceBook(book) : []), [book]);

  const save = useCallback(async () => {
    if (!book) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pricing/draft", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currencies: book.currencies.map((c) => ({
            code: c.code,
            active: c.active,
            symbol: c.symbol,
            flag: c.flag,
          })),
          fx: book.fx.map((f) => ({ currency: f.currency, rate: f.rate })),
          plans: book.plans.map((p) => ({
            id: p.id,
            active: p.active,
            amounts: p.amounts,
            overrides: p.overrides,
          })),
          tax: book.tax,
          trial: book.trial,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { errors?: string[] };
        setError(body.errors?.join(" ") ?? "The draft could not be saved.");
        return;
      }
      await load(true);
      setNotice("Draft saved. Publish when you are ready for it to go live.");
    } finally {
      setSaving(false);
    }
  }, [book, load]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/pricing/publish", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { errors?: string[] };
        setError(body.errors?.join(" ") ?? "The catalogue could not be published.");
        return;
      }
      const body = (await res.json()) as { published: PublishedPriceBook };
      await load(true);
      setNotice(`Published as version ${body.published.version}. It is live now.`);
    } finally {
      setPublishing(false);
    }
  }, [load]);

  const rollback = useCallback(async () => {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/pricing/rollback", { method: "POST" });
      if (!res.ok) {
        setError("There is no previous version to go back to.");
        return;
      }
      const body = (await res.json()) as { restoredFrom: number };
      await load();
      setNotice(`Version ${body.restoredFrom} is live again. Your draft is untouched.`);
    } finally {
      setPublishing(false);
    }
  }, [load]);

  // A draft that cannot be saved should not offer a Save: the server would
  // refuse it, and the error list above already says what to fix.
  useAdminSave({
    dirty: dirty && errors.length === 0,
    saving,
    onSave: save,
    hint: errors.length > 0 ? errors[0] : dirty ? undefined : "No unsaved price changes.",
  });

  if (!book || !payload) {
    return (
      <div className="flex flex-col gap-4">
        <Heading />
        <p className="text-[12.5px] text-fg-muted">Loading…</p>
      </div>
    );
  }

  const shown = activeCurrencies(book);
  const canPublish = !dirty && errors.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <Heading />

      {/* The prototype's topbar actions. The console shell owns Save; Preview
          and Publish belong to this section and live at the top of its body. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] text-fg-muted" data-testid="pc-last-saved">
          {payload.lastSavedAt ? `Saved ${formatStamp(payload.lastSavedAt)}` : "Never saved"}
        </span>
        <span className="text-[10.5px] text-fg-muted" data-testid="pc-live-version">
          {payload.published
            ? `Live: version ${payload.published.version}`
            : "Nothing published yet"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {payload.previousVersion !== null ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={rollback}
              disabled={publishing}
              data-testid="pc-rollback"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Revert to version {payload.previousVersion}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowPreview((v) => !v)}
            data-testid="pc-preview-toggle"
          >
            <Eye className="h-3.5 w-3.5" />
            Preview pricing page
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={publish}
            disabled={!canPublish || publishing}
            title={
              dirty
                ? "Save your changes before publishing them."
                : errors.length > 0
                  ? errors[0]
                  : undefined
            }
            data-testid="pc-publish"
          >
            <Rocket className="h-3.5 w-3.5" />
            Publish changes
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-[rgba(220,38,38,.4)] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#9A3412]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-fg-2"
          data-testid="pc-notice"
        >
          {notice}
        </p>
      ) : null}
      {errors.length > 0 ? (
        <ul className="rounded-lg border border-[rgba(232,160,32,.45)] bg-[#FDF6EB] px-3 py-2 text-[12px] text-[#633806]">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      {showPreview ? (
        <PricingPreview draft={book} published={payload.published} dirty={dirty || payload.dirty} />
      ) : null}

      {/* ── Active currencies ── */}
      <Card className="flex flex-wrap items-center gap-3 p-3.5">
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.06em] text-fg-muted">
          <Globe className="h-3.5 w-3.5" />
          Active currencies
        </span>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {book.currencies.map((c) => (
            <button
              key={c.code}
              type="button"
              role="switch"
              aria-checked={c.active}
              data-testid={`pc-currency-${c.code}`}
              onClick={() =>
                edit((b) => ({
                  ...b,
                  currencies: b.currencies.map((x) =>
                    x.code === c.code ? { ...x, active: !x.active } : x,
                  ),
                }))
              }
              disabled={c.code === book.baseCurrency}
              className="flex items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-70"
              style={
                c.active
                  ? {
                      borderColor: "var(--color-gold-dk, #BA7517)",
                      background: "var(--color-gold-lt, #FDF6EB)",
                      color: "var(--color-gold-dk, #633806)",
                    }
                  : { borderColor: "var(--color-line, #D4D0C8)", color: "var(--color-fg-2, #4A4840)" }
              }
            >
              <span>{c.flag}</span>
              {c.code}
            </button>
          ))}
          {addingCurrency ? (
            <AddCurrency
              existing={book.currencies}
              onCancel={() => setAddingCurrency(false)}
              onAdd={(row, rate) => {
                edit((b) => ({
                  ...b,
                  currencies: [...b.currencies, row],
                  fx: [
                    ...b.fx,
                    {
                      currency: row.code,
                      rate,
                      source: "manual" as const,
                      updatedAt: new Date().toISOString(),
                    },
                  ],
                }));
                setAddingCurrency(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingCurrency(true)}
              data-testid="pc-add-currency"
              className="flex items-center gap-1.5 rounded-full border-[1.5px] border-dashed px-3 py-1 text-[11.5px] font-medium"
              style={{ borderColor: "rgba(186,119,23,.4)", color: "var(--color-gold-dk, #BA7517)" }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add currency
            </button>
          )}
        </div>
      </Card>

      {/* ── Exchange rates ── */}
      <Card className="p-3.5">
        <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.06em] text-fg-muted">
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Exchange rates — base currency {book.baseCurrency}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((c) => {
            const base = c.code === book.baseCurrency;
            const rate = fxRateFor(book, c.code);
            return (
              <div key={c.code} className="flex items-center gap-2 rounded-[7px] bg-surface-2 p-2.5">
                <span className="text-[18px] leading-none">{c.flag}</span>
                <div>
                  <div className="text-[11px] font-bold text-fg">{c.code}</div>
                  <div className="mt-px text-[10px] text-fg-muted">
                    {base ? "Base currency" : `1 ${book.baseCurrency} =`}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <NumberField
                    label={`${c.code} exchange rate`}
                    testId={`pc-fx-${c.code}`}
                    width={84}
                    step="0.00001"
                    disabled={base}
                    value={base ? 1 : (rate ?? 0)}
                    onCommit={(v) =>
                      edit((b) => ({
                        ...b,
                        fx: b.fx.some((f) => f.currency === c.code)
                          ? b.fx.map((f) => (f.currency === c.code ? { ...f, rate: v } : f))
                          : [
                              ...b.fx,
                              {
                                currency: c.code,
                                rate: v,
                                source: "manual" as const,
                                updatedAt: new Date().toISOString(),
                              },
                            ],
                      }))
                    }
                  />
                  {base ? null : (
                    <span className="rounded-[4px] bg-surface px-1.5 py-px text-[9px] font-bold text-fg-muted">
                      Manual
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[10.5px] text-fg-muted">
          <Info className="mt-px h-3 w-3 shrink-0" />
          Converted prices are calculated from the {book.baseCurrency} base; type over any converted
          price to fix it, and use ↺ to put it back on the rate. Rates are entered here — this
          product makes no call to a rates provider.
        </p>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[11.5px] leading-relaxed text-fg-2">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" style={{ color: "var(--ac-olive, #4A6644)" }} />
        <span>
          These are the <strong>master prices</strong> — publishing updates the public pricing page
          and every in-app plan display. {book.baseCurrency} is the base currency. GST (
          {book.tax.gstRatePct}%){" "}
          {book.tax.pricesIncludeGst ? "is included in" : "is added at checkout for"}{" "}
          {book.baseCurrency} billing.
        </span>
      </div>

      {/* ── The four catalogues ── */}
      {PLAN_GROUPS.map((id) =>
        id === "free_trial" ? (
          <FreeTrial key={id} book={book} edit={edit} />
        ) : (
          <Catalogue key={id} group={id} book={book} edit={edit} currencies={shown} />
        ),
      )}

      {/* ── Tax ── */}
      <TaxCard book={book} edit={edit} />
    </div>
  );
}

function Heading() {
  return (
    <div>
      <h2 className="text-base font-semibold tracking-tight text-fg">Price configuration</h2>
      <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
        The master price book behind every plan, pack and enterprise tier — currencies, exchange
        rates and tax. Changes are a draft until you publish them.
      </p>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "5 Jun 2026, 9:02 am" — the prototype's own `.last-saved` stamp.
 *
 * Formatted from the stored parts rather than through `Date`: D1 writes
 * `datetime('now')` in UTC, and running that through the reader's timezone made
 * the seeded 9:02 am read as 4:02 am on this machine. A save stamp is a wall
 * clock, and shifting it by the reader's offset only ever misleads.
 */
function formatStamp(stamp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(stamp);
  if (!m) return stamp;
  const [, year, month, day, hh, mm] = m;
  const hour24 = Number(hh);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}, ${hour12}:${mm} ${hour24 < 12 ? "am" : "pm"}`;
}

// ── Add currency ─────────────────────────────────────────────────────────────

/**
 * The prototype draws a dashed "Add currency" chip whose handler does nothing.
 * A currency is a code, a symbol and a rate — without the rate the column would
 * publish as zero, so it is asked for here rather than refused later.
 */
function AddCurrency({
  existing,
  onAdd,
  onCancel,
}: {
  existing: CurrencyRow[];
  onAdd: (row: CurrencyRow, rate: number) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [symbol, setSymbol] = useState("");
  const [rate, setRate] = useState("");
  const clash = existing.some((c) => c.code === code.toUpperCase());
  const valid = /^[A-Za-z]{3}$/.test(code) && !clash && Number(rate) > 0;
  return (
    <span className="flex items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-line px-2 py-1">
      <input
        aria-label="New currency code"
        data-testid="pc-new-currency-code"
        value={code}
        maxLength={3}
        placeholder="AED"
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        className="w-12 bg-transparent text-[12px] uppercase outline-none"
      />
      <input
        aria-label="New currency symbol"
        data-testid="pc-new-currency-symbol"
        value={symbol}
        maxLength={4}
        placeholder="د.إ"
        onChange={(e) => setSymbol(e.target.value)}
        className="w-10 bg-transparent text-[12px] outline-none"
      />
      <input
        aria-label="New currency rate"
        data-testid="pc-new-currency-rate"
        value={rate}
        placeholder="0.044"
        onChange={(e) => setRate(e.target.value)}
        className="w-16 bg-transparent text-right font-mono text-[12px] outline-none"
      />
      <Button
        size="sm"
        variant="primary"
        disabled={!valid}
        data-testid="pc-new-currency-add"
        onClick={() =>
          onAdd(
            {
              code: code.toUpperCase(),
              symbol: symbol || code.toUpperCase(),
              flag: "🏳",
              active: true,
              sortOrder: existing.length + 1,
            },
            Number(rate),
          )
        }
      >
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </span>
  );
}

// ── Free trial ───────────────────────────────────────────────────────────────

function FreeTrial({
  book,
  edit,
}: {
  book: PriceBook;
  edit: (fn: (b: PriceBook) => PriceBook) => void;
}) {
  const group = groupOf(book, "free_trial");
  if (!group) return null;
  return (
    <section>
      <SectionHeader
        icon={GROUP_ICONS[group.icon] ?? GROUP_ICONS.coin}
        title={group.title}
        badge={group.badge}
      />
      <Card flush className="overflow-hidden">
        <CardHead
          icon={GROUP_ICONS[group.icon] ?? GROUP_ICONS.coin}
          name={group.cardName}
          sub={group.cardSub}
          tag={group.cardTag}
        />
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface-2">
              <th className={TH}>Setting</th>
              <th className={TH}>Value</th>
              <th className={TH}>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <td className={TD}>
                <div className="font-medium text-fg">Free deck limit</div>
                <div className="mt-px text-[10.5px] text-fg-muted">
                  Number of free evaluations per new account
                </div>
              </td>
              <td className={TD}>
                <NumberField
                  label="Free deck limit"
                  testId="pc-trial-decks"
                  width={70}
                  value={book.trial.decks}
                  onCommit={(v) =>
                    edit((b) => ({ ...b, trial: { ...b.trial, decks: Math.trunc(v) } }))
                  }
                />
              </td>
              <td className={`${TD} text-[11px] text-fg-muted`}>Applies to all plans at signup</td>
            </tr>
            <tr className="border-b border-line">
              <td className={TD}>
                <div className="font-medium text-fg">Free trial expiry</div>
                <div className="mt-px text-[10.5px] text-fg-muted">
                  Days before free trial expires (0 = never)
                </div>
              </td>
              <td className={TD}>
                <NumberField
                  label="Free trial expiry"
                  testId="pc-trial-expiry"
                  width={70}
                  value={book.trial.expiryDays}
                  onCommit={(v) =>
                    edit((b) => ({ ...b, trial: { ...b.trial, expiryDays: Math.trunc(v) } }))
                  }
                />
              </td>
              <td className={`${TD} text-[11px] text-fg-muted`}>0 = credits never expire</td>
            </tr>
            <tr>
              <td className={TD}>
                <div className="font-medium text-fg">Show free trial on pricing page</div>
              </td>
              <td className={TD}>
                <Toggle
                  label="Show free trial on pricing page"
                  testId="pc-trial-visible"
                  checked={book.trial.showOnPricingPage}
                  onChange={(v) =>
                    edit((b) => ({ ...b, trial: { ...b.trial, showOnPricingPage: v } }))
                  }
                />
              </td>
              <td className={`${TD} text-[11px] text-fg-muted`}>Displayed as first option</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </section>
  );
}

// ── A price catalogue ────────────────────────────────────────────────────────

function Catalogue({
  group,
  book,
  edit,
  currencies,
}: {
  group: PlanGroupId;
  book: PriceBook;
  edit: (fn: (b: PriceBook) => PriceBook) => void;
  currencies: CurrencyRow[];
}) {
  const meta = groupOf(book, group);
  const plans = plansInGroup(book, group);
  if (!meta || plans.length === 0) return null;

  const setAmount = (plan: PricePlanRow, currency: string, major: number) =>
    edit((b) => ({
      ...b,
      plans: b.plans.map((p) =>
        p.id === plan.id
          ? {
              ...p,
              amounts: { ...p.amounts, [currency]: Math.round(major * 100) },
              // Typing in a converted column is what an override IS.
              overrides:
                currency === b.baseCurrency || p.overrides.includes(currency)
                  ? p.overrides
                  : [...p.overrides, currency],
            }
          : p,
      ),
    }));

  const clearOverride = (plan: PricePlanRow, currency: string) =>
    edit((b) => ({
      ...b,
      plans: b.plans.map((p) =>
        p.id === plan.id ? { ...p, overrides: p.overrides.filter((c) => c !== currency) } : p,
      ),
    }));

  const suffix = plans[0].period ? PERIOD_SUFFIX[plans[0].period] : "";

  return (
    <section>
      <SectionHeader
        icon={GROUP_ICONS[meta.icon] ?? GROUP_ICONS.coin}
        title={meta.title}
        badge={meta.badge}
      />
      <Card flush className="overflow-hidden">
        <CardHead
          icon={GROUP_ICONS[meta.icon] ?? GROUP_ICONS.coin}
          name={meta.cardName}
          sub={meta.cardSub}
          tag={meta.cardTag}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th className={`${TH} min-w-[200px]`}>{groupColumnLabel(group)}</th>
                {currencies.map((c) => (
                  <th key={c.code} className={`${TH} min-w-[110px] text-right`}>
                    {c.flag} {c.code}
                    {suffix}
                  </th>
                ))}
                <th className={`${TH} text-center`}>Active</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b border-line last:border-0">
                  <td className={TD}>
                    <div className="flex items-center gap-1.5 font-medium text-fg">
                      {plan.name}
                      {plan.badge ? (
                        <span className="rounded-[4px] bg-surface-2 px-1.5 py-px text-[9px] font-bold text-fg-2">
                          {plan.badge}
                        </span>
                      ) : null}
                    </div>
                    {plan.features || plan.tagline ? (
                      <div className="mt-px text-[10.5px] text-fg-muted">
                        {plan.features ?? plan.tagline}
                      </div>
                    ) : null}
                  </td>
                  {currencies.map((c) => {
                    const overridden =
                      c.code !== book.baseCurrency && plan.overrides.includes(c.code);
                    return (
                      <td key={c.code} className={TD}>
                        <div className="flex items-center justify-end gap-1">
                          <span className="min-w-4 shrink-0 text-right text-[12px] font-semibold text-fg-muted">
                            {c.symbol}
                          </span>
                          <NumberField
                            label={`${plan.name} price in ${c.code}`}
                            testId={`pc-amount-${plan.code}-${c.code}`}
                            value={(plan.amounts[c.code] ?? 0) / 100}
                            onCommit={(v) => setAmount(plan, c.code, v)}
                          />
                          {overridden ? (
                            <button
                              type="button"
                              title={`Recalculate ${c.code} from the exchange rate`}
                              aria-label={`Recalculate ${plan.name} in ${c.code} from the exchange rate`}
                              data-testid={`pc-reset-${plan.code}-${c.code}`}
                              onClick={() => clearOverride(plan, c.code)}
                              className="text-fg-muted hover:text-fg"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          ) : (
                            <span className="w-3" />
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className={`${TD} text-center`}>
                    <div className="flex justify-center">
                      <Toggle
                        label={`${plan.name} active`}
                        testId={`pc-active-${plan.code}`}
                        checked={plan.active}
                        onChange={(v) =>
                          edit((b) => ({
                            ...b,
                            plans: b.plans.map((p) =>
                              p.id === plan.id ? { ...p, active: v } : p,
                            ),
                          }))
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {meta.footnote ? <Footnote>{applyCopyTokens(meta.footnote, book.tax)}</Footnote> : null}
      </Card>
    </section>
  );
}

/** The first column's header. Data-driven groups, one word each. */
function groupColumnLabel(group: PlanGroupId): string {
  if (group === "subscription") return "Plan";
  if (group === "credit_pack") return "Pack";
  return "Tier";
}

// ── Tax ──────────────────────────────────────────────────────────────────────

function TaxCard({
  book,
  edit,
}: {
  book: PriceBook;
  edit: (fn: (b: PriceBook) => PriceBook) => void;
}) {
  return (
    <section>
      <SectionHeader
        icon={<ReceiptText className="h-[15px] w-[15px]" />}
        title="Tax configuration"
        badge={null}
      />
      <Card flush className="overflow-hidden">
        <table className="w-full border-collapse">
          <tbody>
            <tr className="border-b border-line">
              <td className={TD}>
                <div className="font-medium text-fg">GST rate ({book.baseCurrency} billing)</div>
                <div className="mt-px text-[10.5px] text-fg-muted">
                  Applied at checkout for all Indian customers
                </div>
              </td>
              <td className={TD}>
                <div className="flex items-center gap-1.5">
                  <NumberField
                    label="GST rate"
                    testId="pc-gst-rate"
                    width={70}
                    step="0.5"
                    value={book.tax.gstRatePct}
                    onCommit={(v) => edit((b) => ({ ...b, tax: { ...b.tax, gstRatePct: v } }))}
                  />
                  <span className="text-[10px] text-fg-muted">%</span>
                </div>
              </td>
              <td className={`${TD} text-[11px] text-fg-muted`}>
                GST registration:{" "}
                <input
                  aria-label="GST registration"
                  data-testid="pc-gstin"
                  value={book.tax.gstRegistration ?? ""}
                  onChange={(e) =>
                    edit((b) => ({
                      ...b,
                      tax: { ...b.tax, gstRegistration: e.target.value || null },
                    }))
                  }
                  className="w-40 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-gold"
                />
              </td>
            </tr>
            <tr className="border-b border-line">
              <td className={TD}>
                <div className="font-medium text-fg">Show prices inclusive of GST</div>
                <div className="mt-px text-[10.5px] text-fg-muted">
                  Display GST-inclusive prices on public pricing page
                </div>
              </td>
              <td className={TD}>
                <Toggle
                  label="Show prices inclusive of GST"
                  testId="pc-gst-inclusive"
                  checked={book.tax.pricesIncludeGst}
                  onChange={(v) => edit((b) => ({ ...b, tax: { ...b.tax, pricesIncludeGst: v } }))}
                />
              </td>
              <td className={`${TD} text-[11px] text-fg-muted`}>
                Default: exclusive (GST added at checkout)
              </td>
            </tr>
            <tr>
              <td className={TD}>
                <div className="font-medium text-fg">
                  Apply local tax for international currencies
                </div>
                <div className="mt-px text-[10.5px] text-fg-muted">
                  Show an “excl. local taxes” notice on international pricing
                </div>
              </td>
              <td className={TD}>
                <Toggle
                  label="Apply local tax for international currencies"
                  testId="pc-intl-tax"
                  checked={book.tax.showInternationalTaxNotice}
                  onChange={(v) =>
                    edit((b) => ({ ...b, tax: { ...b.tax, showInternationalTaxNotice: v } }))
                  }
                />
              </td>
              <td className={`${TD} text-[11px] text-fg-muted`}>
                Customers responsible for local VAT/GST
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </section>
  );
}

// ── Preview ──────────────────────────────────────────────────────────────────

/**
 * "Preview pricing page" — the customer-facing catalogue, drawn twice: from the
 * DRAFT (what publishing would make live) and from the published version (what
 * a customer sees right now). Side by side, because the whole point of a draft
 * is that those two can differ.
 */
function PricingPreview({
  draft,
  published,
  dirty,
}: {
  draft: PriceBook;
  published: PublishedPriceBook | null;
  dirty: boolean;
}) {
  return (
    <Card className="p-3.5" data-testid="pc-preview">
      <div className="mb-2 flex items-center gap-2">
        <Eye className="h-3.5 w-3.5" style={{ color: "var(--ac-olive, #4A6644)" }} />
        <h3 className="text-[13px] font-bold text-fg">Pricing page preview</h3>
        {dirty ? (
          <span
            className="rounded-[5px] px-2 py-[2px] text-[10px] font-bold"
            style={{ background: "var(--color-gold-lt, #FDF6EB)", color: "#633806" }}
            data-testid="pc-preview-dirty"
          >
            Draft differs from what is live
          </span>
        ) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <PreviewColumn
          heading="Draft — not yet published"
          book={draft}
          testId="pc-preview-draft"
        />
        {published ? (
          <PreviewColumn
            heading={`Live — version ${published.version}`}
            book={published}
            testId="pc-preview-live"
          />
        ) : (
          <div className="rounded-lg border border-dashed border-line p-3 text-[12px] text-fg-muted">
            Nothing is published yet, so customers see no catalogue.
          </div>
        )}
      </div>
    </Card>
  );
}

function PreviewColumn({
  heading,
  book,
  testId,
}: {
  heading: string;
  book: PriceBook;
  testId: string;
}) {
  const base = book.currencies.find((c) => c.code === book.baseCurrency);
  const symbol = base?.symbol ?? "₹";
  return (
    <div className="rounded-lg border border-line p-3" data-testid={testId}>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-fg-muted">
        {heading}
      </div>
      <ul className="flex flex-col gap-1.5">
        {listedPlans(book).map((plan) => {
          const amount = plan.amounts[book.baseCurrency] ?? 0;
          const tax = taxBreakdown(amount, book.baseCurrency, book.tax, book.baseCurrency);
          return (
            <li
              key={plan.id}
              className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5 text-[12px] last:border-0"
              data-testid={`${testId}-${plan.code}`}
            >
              <span className="text-fg">{plan.name}</span>
              <span className="shrink-0 font-mono text-fg-2">
                {formatMinor(amount, symbol)}
                {plan.period ? PERIOD_SUFFIX[plan.period] : ""}
                {tax.taxed && tax.taxMinor > 0 ? (
                  <span className="ml-1 text-[10.5px] text-fg-muted">
                    {book.tax.pricesIncludeGst ? "incl." : "+"} {formatMinor(tax.taxMinor, symbol)}{" "}
                    GST
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {book.tax.showInternationalTaxNotice ? (
        <p className="mt-2 text-[10.5px] text-fg-muted">
          International pricing is shown exclusive of local taxes.
        </p>
      ) : null}
    </div>
  );
}
