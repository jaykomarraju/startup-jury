/**
 * W4-D — Admin console → Organisation → **Price configuration** (`admin/s-pc.html`).
 *
 * The section is a 235-byte iframe in the prototype; the real ~37 KB document is
 * base64 in the admin script as `PC_B64`, and it calls itself the master price
 * table: *"changes here update the public pricing page and all in-app plan
 * displays."* This router is that table's whole persistence surface — the
 * draft, the publish, and the one read a live screen makes.
 *
 * ── Draft, published, reversible ─────────────────────────────────────────────
 * `0033`'s five tables are the DRAFT. `pricing_versions` (0047) holds published
 * snapshots, one row per version, each row a complete `PriceBook`. Three
 * properties follow, and each has a test:
 *
 *   • **A draft edit is invisible to a reader until it is published.** Readers
 *     read `GET /published`, which only ever reads a `pricing_versions` row.
 *   • **A half-published catalogue is impossible.** Publishing is one INSERT of
 *     one document, inside a batch with the demotion of its predecessor; if
 *     anything fails, the batch rolls back and the previous version is still
 *     the published one. There is no window in which half a price list is live.
 *   • **A publish is reversible.** Nothing is deleted: `POST /rollback`
 *     republishes the most recent superseded document as a new version.
 *
 * ── §8 Q1 ────────────────────────────────────────────────────────────────────
 * RULED 2026-09-11: no per-deck pricing. Nothing here derives a per-deck rate
 * or a saving against one, and `validatePriceBook()` → `perDeckArtefacts()`
 * REFUSES to save or publish a catalogue whose copy re-introduces either. The
 * two ambiguities the ruling left open (which pay-as-you-go ladder is current,
 * which enterprise vocabulary) are answered by rows in `price_plans` and
 * `price_groups`, so switching either is a data change: this file never names a
 * pack size, a tier or a currency.
 *
 * ── AuthZ ────────────────────────────────────────────────────────────────────
 * Editing is `requireTask("adminconsole", "admin")` — the same gate every other
 * console surface carries, so revoking an administrator's `adminconsole` cell
 * closes the console AND its API in one place (§8 Q16). Reading the published
 * catalogue is open to any authenticated non-mentor, because a plan tile, the
 * Buy credits screen and the pricing page all need it; that read carries no
 * draft and no version history.
 *
 * FX rates are editable data. There is no rates provider and no network call —
 * the prototype's per-currency "Live" button is exactly the vendor call §1.3
 * keeps off the critical path, so every rate is `source='manual'`.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, Env } from "../types";
import { requireAuth, requireTask, denyMentor } from "../auth/middleware";
import { recordAudit } from "../audit/log";
import {
  BASE_CURRENCY,
  deriveAmounts,
  normalisePriceBook,
  priceBooksEqual,
  validatePriceBook,
  type BillingPeriod,
  type CurrencyRow,
  type PlanGroupId,
  type PriceBook,
  type PriceGroupRow,
  type PricePlanRow,
  type PublishedPriceBook,
} from "../../shared/priceBook";

const pricing = new Hono<AppEnv>();
pricing.use("*", requireAuth);

// ── Reading the draft ────────────────────────────────────────────────────────

interface CurrencyDbRow {
  code: string;
  symbol: string;
  flag: string;
  active: number;
  sort_order: number;
}
interface FxDbRow {
  currency: string;
  rate: number;
  source: string;
  updated_at: string;
}
interface GroupDbRow {
  plan_group: string;
  title: string;
  badge: string | null;
  icon: string;
  card_name: string;
  card_sub: string | null;
  card_tag: string | null;
  footnote: string | null;
  sort_order: number;
}
interface PlanDbRow {
  id: string;
  plan_group: string;
  code: string;
  name: string;
  badge: string | null;
  tagline: string | null;
  features: string | null;
  units: number | null;
  period: string | null;
  active: number;
  sort_order: number;
}
interface AmountDbRow {
  plan_id: string;
  currency: string;
  amount_minor: number;
  overridden: number;
}
interface SettingsDbRow {
  gst_rate_pct: number;
  gst_registration: string | null;
  prices_include_gst: number;
  show_international_tax_notice: number;
  free_trial_decks: number;
  free_trial_expiry_days: number;
  show_free_trial: number;
}

/** The whole draft, in one round of reads. */
export async function loadDraft(env: Env): Promise<PriceBook> {
  const [currencies, fx, groups, plans, amounts, settings] = await Promise.all([
    env.DB.prepare("SELECT code, symbol, flag, active, sort_order FROM currencies ORDER BY sort_order")
      .all<CurrencyDbRow>()
      .then((r) => r.results),
    env.DB.prepare("SELECT currency, rate, source, updated_at FROM fx_rates ORDER BY currency")
      .all<FxDbRow>()
      .then((r) => r.results),
    env.DB.prepare(
      "SELECT plan_group, title, badge, icon, card_name, card_sub, card_tag, footnote, sort_order " +
        "FROM price_groups ORDER BY sort_order",
    )
      .all<GroupDbRow>()
      .then((r) => r.results),
    env.DB.prepare(
      "SELECT id, plan_group, code, name, badge, tagline, features, units, period, active, sort_order " +
        "FROM price_plans ORDER BY sort_order",
    )
      .all<PlanDbRow>()
      .then((r) => r.results),
    env.DB.prepare(
      "SELECT plan_id, currency, amount_minor, overridden FROM price_amounts ORDER BY plan_id, currency",
    )
      .all<AmountDbRow>()
      .then((r) => r.results),
    env.DB.prepare(
      "SELECT gst_rate_pct, gst_registration, prices_include_gst, show_international_tax_notice, " +
        "free_trial_decks, free_trial_expiry_days, show_free_trial FROM pricing_settings WHERE id = 1",
    ).first<SettingsDbRow>(),
  ]);

  const planRows: PricePlanRow[] = plans.map((p) => {
    const mine = amounts.filter((a) => a.plan_id === p.id);
    const book: Record<string, number> = {};
    const overrides: string[] = [];
    for (const a of mine) {
      book[a.currency] = a.amount_minor;
      if (a.overridden === 1) overrides.push(a.currency);
    }
    return {
      id: p.id,
      group: p.plan_group as PlanGroupId,
      code: p.code,
      name: p.name,
      badge: p.badge,
      tagline: p.tagline,
      features: p.features,
      units: p.units,
      period: (p.period as BillingPeriod | null) ?? null,
      active: p.active === 1,
      sortOrder: p.sort_order,
      amounts: book,
      overrides,
    };
  });

  return normalisePriceBook({
    baseCurrency: BASE_CURRENCY,
    currencies: currencies.map((c) => ({
      code: c.code,
      symbol: c.symbol,
      flag: c.flag,
      active: c.active === 1,
      sortOrder: c.sort_order,
    })),
    fx: fx.map((f) => ({
      currency: f.currency,
      rate: f.rate,
      // `source` is always 'manual' after 0047; the type says so, and a stale
      // 'live' row would be a lie about where the number came from.
      source: "manual",
      updatedAt: f.updated_at,
    })),
    groups: groups.map(
      (g): PriceGroupRow => ({
        group: g.plan_group as PlanGroupId,
        title: g.title,
        badge: g.badge,
        icon: g.icon,
        cardName: g.card_name,
        cardSub: g.card_sub,
        cardTag: g.card_tag,
        footnote: g.footnote,
        sortOrder: g.sort_order,
      }),
    ),
    plans: planRows,
    tax: {
      gstRatePct: settings?.gst_rate_pct ?? 18,
      gstRegistration: settings?.gst_registration ?? null,
      pricesIncludeGst: settings?.prices_include_gst === 1,
      showInternationalTaxNotice: settings?.show_international_tax_notice !== 0,
    },
    trial: {
      decks: settings?.free_trial_decks ?? 3,
      expiryDays: settings?.free_trial_expiry_days ?? 0,
      showOnPricingPage: settings?.show_free_trial !== 0,
    },
  });
}

// ── Reading published versions ───────────────────────────────────────────────

interface VersionDbRow {
  version: number;
  status: string;
  document: string;
  published_at: string;
  published_by: string | null;
  note: string | null;
}

export interface VersionSummary {
  version: number;
  status: string;
  publishedAt: string;
  publishedBy: string | null;
  note: string | null;
}

async function livePublished(env: Env): Promise<PublishedPriceBook | null> {
  const row = await env.DB.prepare(
    "SELECT version, status, document, published_at, published_by, note FROM pricing_versions " +
      "WHERE status = 'published'",
  ).first<VersionDbRow>();
  if (!row) return null;
  return hydrate(row);
}

/**
 * A version row → a published book. The document is a complete catalogue by
 * construction (nothing writes a fragment), so a parse failure is corruption
 * and must be loud rather than served as a half price list.
 */
function hydrate(row: VersionDbRow): PublishedPriceBook {
  const book = JSON.parse(row.document) as PriceBook;
  return { ...book, version: row.version, publishedAt: row.published_at };
}

async function versionList(env: Env): Promise<VersionSummary[]> {
  const rows = await env.DB.prepare(
    "SELECT version, status, published_at, published_by, note FROM pricing_versions " +
      "ORDER BY version DESC LIMIT 20",
  ).all<Omit<VersionDbRow, "document">>();
  return rows.results.map((r) => ({
    version: r.version,
    status: r.status,
    publishedAt: r.published_at,
    publishedBy: r.published_by,
    note: r.note,
  }));
}

async function lastSavedAt(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT updated_at FROM pricing_draft_meta WHERE id = 1",
  ).first<{ updated_at: string }>();
  return row?.updated_at ?? null;
}

// ── GET /api/pricing/published — the live catalogue ──────────────────────────

/**
 * What every price-reading screen calls, `W4-C`'s Credits & billing and Buy
 * credits included. It returns a published version and nothing else: no draft,
 * no history, no editor state. 404 while nothing has ever been published — the
 * seed publishes version 1, so that is a corrupted install, not a normal state.
 */
pricing.get("/published", denyMentor, async (c) => {
  const published = await livePublished(c.env);
  if (!published) return c.json({ error: "not_published" }, 404);
  return c.json(published);
});

// Everything below edits the catalogue: admin + superuser, AND the console's own
// task permission.
pricing.use("*", requireTask("adminconsole", "admin"));

// ── GET /api/pricing — the editor's whole payload ────────────────────────────

pricing.get("/", async (c) => {
  const [draft, published, versions, savedAt] = await Promise.all([
    loadDraft(c.env),
    livePublished(c.env),
    versionList(c.env),
    lastSavedAt(c.env),
  ]);
  const previous = versions.find((v) => v.status === "superseded") ?? null;
  return c.json({
    draft,
    published,
    // The draft differs from what is live — the prototype's "Publish changes"
    // is only meaningful when this is true.
    dirty: published ? !priceBooksEqual(draft, stripVersion(published)) : true,
    errors: validatePriceBook(draft),
    lastSavedAt: savedAt,
    versions,
    previousVersion: previous ? previous.version : null,
  });
});

/** A published book read back as a plain catalogue, for comparing with a draft. */
function stripVersion(published: PublishedPriceBook): PriceBook {
  return {
    baseCurrency: published.baseCurrency,
    currencies: published.currencies,
    fx: published.fx,
    groups: published.groups,
    plans: published.plans,
    tax: published.tax,
    trial: published.trial,
  };
}

// ── PUT /api/pricing/draft ───────────────────────────────────────────────────

interface DraftPayload {
  currencies?: { code: string; active: boolean; symbol?: string; flag?: string }[];
  fx?: { currency: string; rate: number }[];
  plans?: { id: string; active?: boolean; amounts?: Record<string, number>; overrides?: string[] }[];
  tax?: Partial<PriceBook["tax"]>;
  trial?: Partial<PriceBook["trial"]>;
}

/**
 * Merge a submission onto the stored draft.
 *
 * The editor changes prices, rates, activation and tax — never a plan's name,
 * units, period or copy. Those are catalogue SHAPE: they are what §8 Q1's two
 * surviving ambiguities turn on, and the ruling's condition is that switching
 * either is a data change. Letting the editor rewrite them would make the shape
 * mutable from the browser and the ambiguity unanswerable; a migration is the
 * right place to change a SKU.
 */
function merge(draft: PriceBook, payload: DraftPayload): PriceBook {
  const currencies: CurrencyRow[] = draft.currencies.map((c) => ({ ...c }));
  for (const submitted of payload.currencies ?? []) {
    const code = String(submitted.code ?? "").toUpperCase();
    const existing = currencies.find((c) => c.code === code);
    if (existing) {
      existing.active = submitted.active === true;
      if (submitted.symbol) existing.symbol = submitted.symbol;
      if (submitted.flag) existing.flag = submitted.flag;
      continue;
    }
    // "Add currency" — the prototype's dashed chip, which its own script leaves
    // inert. A new currency needs its own symbol; the flag is decorative.
    currencies.push({
      code,
      symbol: submitted.symbol?.slice(0, 4) || code,
      flag: submitted.flag?.slice(0, 8) || "🏳",
      active: submitted.active === true,
      sortOrder: currencies.length + 1,
    });
  }

  const fx = draft.fx.map((f) => ({ ...f }));
  for (const submitted of payload.fx ?? []) {
    const code = String(submitted.currency ?? "").toUpperCase();
    if (code === draft.baseCurrency) continue; // the base's rate is 1, always
    const rate = Number(submitted.rate);
    const existing = fx.find((f) => f.currency === code);
    if (existing) existing.rate = rate;
    else fx.push({ currency: code, rate, source: "manual", updatedAt: new Date().toISOString() });
  }

  const plans = draft.plans.map((plan) => {
    const submitted = (payload.plans ?? []).find((p) => p.id === plan.id);
    if (!submitted) return { ...plan };
    const amounts = { ...plan.amounts };
    for (const [currency, value] of Object.entries(submitted.amounts ?? {})) {
      amounts[currency.toUpperCase()] = Math.trunc(Number(value));
    }
    return {
      ...plan,
      active: submitted.active === undefined ? plan.active : submitted.active === true,
      amounts,
      overrides: submitted.overrides
        ? [...new Set(submitted.overrides.map((s) => s.toUpperCase()))]
        : plan.overrides,
    };
  });

  const merged: PriceBook = {
    ...draft,
    currencies,
    fx,
    plans,
    tax: { ...draft.tax, ...payload.tax },
    trial: { ...draft.trial, ...payload.trial },
  };

  // Re-derive every non-overridden amount so a rate edit actually moves prices,
  // and keep the free-trial plan's unit count equal to the configured limit —
  // two places showing the same number is two places to disagree.
  merged.plans = merged.plans.map((plan) => ({
    ...plan,
    amounts: deriveAmounts(merged, plan),
    units: plan.group === "free_trial" ? merged.trial.decks : plan.units,
  }));
  return normalisePriceBook(merged);
}

/** Every statement a draft write needs, as one batch. */
function draftStatements(env: Env, book: PriceBook, actor: string) {
  const stmts = [
    env.DB.prepare("UPDATE pricing_draft_meta SET updated_at = datetime('now'), updated_by = ? WHERE id = 1").bind(
      actor,
    ),
    env.DB.prepare(
      "UPDATE pricing_settings SET gst_rate_pct = ?, gst_registration = ?, prices_include_gst = ?, " +
        "show_international_tax_notice = ?, free_trial_decks = ?, free_trial_expiry_days = ?, " +
        "show_free_trial = ?, updated_at = datetime('now') WHERE id = 1",
    ).bind(
      book.tax.gstRatePct,
      book.tax.gstRegistration,
      book.tax.pricesIncludeGst ? 1 : 0,
      book.tax.showInternationalTaxNotice ? 1 : 0,
      book.trial.decks,
      book.trial.expiryDays,
      book.trial.showOnPricingPage ? 1 : 0,
    ),
  ];

  for (const currency of book.currencies) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO currencies (code, symbol, flag, active, sort_order) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (code) DO UPDATE SET symbol = excluded.symbol, flag = excluded.flag, " +
          "active = excluded.active, sort_order = excluded.sort_order",
      ).bind(
        currency.code,
        currency.symbol,
        currency.flag,
        currency.active ? 1 : 0,
        currency.sortOrder,
      ),
    );
  }

  for (const fx of book.fx) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO fx_rates (currency, base_currency, rate, source, updated_at) " +
          "VALUES (?, ?, ?, 'manual', datetime('now')) ON CONFLICT (currency) DO UPDATE SET " +
          "rate = excluded.rate, source = 'manual', updated_at = datetime('now')",
      ).bind(fx.currency, book.baseCurrency, fx.rate),
    );
  }

  for (const plan of book.plans) {
    stmts.push(
      env.DB.prepare("UPDATE price_plans SET active = ?, units = ? WHERE id = ?").bind(
        plan.active ? 1 : 0,
        plan.units,
        plan.id,
      ),
    );
    for (const [currency, amount] of Object.entries(plan.amounts)) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO price_amounts (id, plan_id, currency, amount_minor, overridden) " +
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT (plan_id, currency) DO UPDATE SET " +
            "amount_minor = excluded.amount_minor, overridden = excluded.overridden",
        ).bind(
          `pa_${plan.code}_${currency.toLowerCase()}`,
          plan.id,
          currency,
          amount,
          plan.overrides.includes(currency) ? 1 : 0,
        ),
      );
    }
  }
  return stmts;
}

pricing.put("/draft", async (c) => {
  const payload = (await c.req.json().catch(() => ({}))) as DraftPayload;
  const current = await loadDraft(c.env);
  const next = merge(current, payload);

  const errors = validatePriceBook(next);
  if (errors.length > 0) return c.json({ error: "invalid_price_book", errors }, 400);

  await c.env.DB.batch(draftStatements(c.env, next, c.var.user.id));
  await recordAudit(c, {
    category: "config",
    action: "price_draft_saved",
    summary: priceChangeSummary(current, next),
    detail: { before: current, after: next },
    targetType: "pricing_draft",
    targetId: "1",
  });

  const [draft, published, savedAt] = await Promise.all([
    loadDraft(c.env),
    livePublished(c.env),
    lastSavedAt(c.env),
  ]);
  return c.json({
    draft,
    dirty: published ? !priceBooksEqual(draft, stripVersion(published)) : true,
    lastSavedAt: savedAt,
  });
});

/**
 * The audit sentence, in the prototype's voice ("Updated Salesforce filter rule
 * trigger value…"). Counts what moved rather than listing fifty numbers.
 */
function priceChangeSummary(before: PriceBook, after: PriceBook): string {
  const parts: string[] = [];
  let moved = 0;
  for (const plan of after.plans) {
    const was = before.plans.find((p) => p.id === plan.id);
    if (!was) continue;
    for (const [currency, amount] of Object.entries(plan.amounts)) {
      if (was.amounts[currency] !== amount) moved += 1;
    }
    if (was.active !== plan.active) {
      parts.push(`${plan.name} switched ${plan.active ? "ON" : "OFF"}`);
    }
  }
  if (moved > 0) parts.push(`${moved} price${moved === 1 ? "" : "s"} changed`);
  for (const fx of after.fx) {
    const was = before.fx.find((f) => f.currency === fx.currency);
    if (was && was.rate !== fx.rate) parts.push(`${fx.currency} rate ${was.rate} → ${fx.rate}`);
  }
  if (before.tax.gstRatePct !== after.tax.gstRatePct) {
    parts.push(`GST rate ${before.tax.gstRatePct}% → ${after.tax.gstRatePct}%`);
  }
  const wasActive = before.currencies.filter((x) => x.active).length;
  const nowActive = after.currencies.filter((x) => x.active).length;
  if (wasActive !== nowActive) parts.push(`${nowActive} active currencies`);
  return parts.length > 0
    ? `Price configuration draft saved: ${parts.join(", ")}`
    : "Price configuration draft saved with no changes";
}

// ── POST /api/pricing/publish ────────────────────────────────────────────────

/**
 * Freeze the draft as the live catalogue.
 *
 * Atomic by shape, not by hope. Two statements in one batch — demote the
 * incumbent, insert the new version — and a partial unique index on
 * `status = 'published'` that makes a second live version impossible even if
 * the two ever raced. Validation runs BEFORE the batch, so a bad draft never
 * writes anything at all, and the previous version stays live. Nothing is
 * deleted, which is what makes a publish reversible.
 */
async function publishDocument(
  c: Context<AppEnv>,
  book: PriceBook,
  note: string,
): Promise<PublishedPriceBook | Response> {
  const errors = validatePriceBook(book);
  if (errors.length > 0) return c.json({ error: "invalid_price_book", errors }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE pricing_versions SET status = 'superseded' WHERE status = 'published'"),
    c.env.DB.prepare(
      "INSERT INTO pricing_versions (status, document, published_at, published_by, note) " +
        "VALUES ('published', ?, datetime('now'), ?, ?)",
    ).bind(JSON.stringify(normalisePriceBook(book)), c.var.user.id, note),
  ]);

  const published = await livePublished(c.env);
  // The insert either landed or the batch rolled back; there is no third state.
  if (!published) return c.json({ error: "publish_failed" }, 500);
  return published;
}

pricing.post("/publish", async (c) => {
  const draft = await loadDraft(c.env);
  const published = await publishDocument(c, draft, "Published from the Price configuration section");
  if (published instanceof Response) return published;

  await c.env.DB.prepare(
    "UPDATE pricing_settings SET published_at = datetime('now') WHERE id = 1",
  ).run();
  await recordAudit(c, {
    category: "billing",
    action: "price_book_published",
    summary: `Price configuration published as version ${published.version}`,
    detail: { version: published.version },
    targetType: "pricing_version",
    targetId: String(published.version),
  });
  return c.json({ published, versions: await versionList(c.env) });
});

// ── POST /api/pricing/rollback ───────────────────────────────────────────────

/**
 * Put the previous published catalogue back. It republishes the superseded
 * document as a NEW version rather than resurrecting the old row, so the
 * history stays append-only and says what happened. The draft is deliberately
 * left alone: rolling back what customers see must not silently discard what an
 * administrator was in the middle of editing.
 */
pricing.post("/rollback", async (c) => {
  const previous = await c.env.DB.prepare(
    "SELECT version, status, document, published_at, published_by, note FROM pricing_versions " +
      "WHERE status = 'superseded' ORDER BY version DESC LIMIT 1",
  ).first<VersionDbRow>();
  if (!previous) return c.json({ error: "no_previous_version" }, 409);

  const book = stripVersion(hydrate(previous));
  const published = await publishDocument(c, book, `Rolled back to version ${previous.version}`);
  if (published instanceof Response) return published;

  await recordAudit(c, {
    category: "billing",
    action: "price_book_rolled_back",
    summary: `Price configuration rolled back to version ${previous.version} (published as ${published.version})`,
    detail: { restoredFrom: previous.version, version: published.version },
    targetType: "pricing_version",
    targetId: String(published.version),
  });
  return c.json({ published, restoredFrom: previous.version, versions: await versionList(c.env) });
});

export default pricing;
