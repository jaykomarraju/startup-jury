/**
 * W6-B — the account wizard's screens, presentational only. State and the API
 * live in `AccountOverlay.tsx`; everything here renders props.
 *
 * Class names follow the prototype's `ac-*` rules (`_rest.html:350-557`) value
 * for value, written as Tailwind utilities on the app's tokens so both themes
 * work. `--navy` is `--text` in the light palette, so the prototype's navy
 * headings use `text-fg`, which also follows the dark theme.
 */
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleCheck,
  CreditCard,
  Crown,
  Download,
  FileText,
  Gift,
  Info,
  Landmark,
  Lock,
  Mail,
  Smartphone,
  TrendingUp,
  Upload,
  Wallet,
} from "lucide-react";
import {
  applyCopyTokens,
  extraCreditRateMinor,
  formatMinor,
  seatPeriodsFor,
  seatPlanFor,
  seatTiers,
  PAID_TRIAL_CODE,
  type PriceGroupRow,
  type PricePlanRow,
  type PublishedPriceBook,
} from "../../../shared/priceBook";
import {
  PLAN_LABELS,
  validateBillingAddress,
  type BillingAddress,
  type BillingLocale,
  type Plan,
} from "../../../shared/plans";
import {
  ANNUAL_SEAT_MONTHS,
  BILLING_COUNTRIES,
  BUSINESS_TYPES,
  COUNTRIES,
  DIAL_CODES,
  EMPLOYEE_BANDS,
  EXTRA_CREDIT_PACKS,
  FREE_TRIAL_DECKS,
  PAYMENT_METHODS,
  SEAT_PERIOD_VIEWS,
  SEAT_STORAGE_GB,
  TEAM_ROLES,
  TEAM_SEAT_TIERS,
  seatPeriodWord,
  billingCycleLine,
  featureBullets,
  orderStatusLabel,
  periodLabel,
  symbolFor,
  teamInitials,
  teamSeatLabel,
  teamSeatTier,
  teamSeatsFull,
  type AccountOrderView,
  type AccountType,
  type AnnualCart,
  type AnnualCartQuote,
  type FieldErrors,
  type OrderQuote,
  type OrgKind,
  type PaymentMethod,
  type StepView,
  type SuperUserNomination,
  type TeamInvite,
  type TeamSeatTierId,
} from "../../../shared/accountOrder";

// ── Primitives ───────────────────────────────────────────────────────────────

const INPUT =
  "w-full rounded-[10px] border border-stone-dk bg-surface px-[15px] py-[13px] text-[14px] text-fg " +
  "placeholder:text-fg-muted focus:border-gold focus:shadow-[0_0_0_3px_var(--gold-lt)] focus:outline-none";

const BTN =
  "inline-flex items-center gap-2 rounded-[10px] border px-[22px] py-3 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
export const BTN_GO = `${BTN} border-fg bg-surface text-fg hover:bg-ink hover:text-white`;
export const BTN_GHOST = `${BTN} border-stone-dk bg-surface text-fg-2 hover:border-fg-muted hover:text-fg`;
/** `.ac-btn-amber` — v3's trial buttons, beside but not instead of Continue. */
export const BTN_AMBER = `${BTN} border-gold bg-gold-lt text-gold-dk hover:border-gold-dk`;
const BTN_FULL = "w-full justify-center py-[15px]";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-stone bg-surface px-8 py-[30px] shadow-[0_1px_3px_rgba(26,30,46,.04)] max-[680px]:px-[18px] max-[680px]:py-[22px] ${className}`}
    >
      {children}
    </div>
  );
}

function Heading({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <>
      <h1 className="text-[23px] font-bold leading-[1.2] text-fg">{title}</h1>
      {sub && <div className="mt-[5px] text-[13.5px] text-fg-muted">{sub}</div>}
    </>
  );
}

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mt-5 ${className}`}>
      <label htmlFor={htmlFor} className="mb-[7px] block text-[12.5px] font-semibold text-fg">
        {label}
      </label>
      {children}
      {hint && !error && (
        <div className="mt-[7px] flex items-center gap-1.5 text-[11.5px] text-fg-muted">
          <Info className="h-[13px] w-[13px]" aria-hidden="true" />
          {hint}
        </div>
      )}
      {error && (
        <div role="alert" className="mt-[7px] text-[11.5px] text-signal-flagged">
          {error}
        </div>
      )}
    </div>
  );
}

const Optional = () => <span className="font-normal text-fg-muted">(optional for individuals)</span>;

function Row2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 max-[680px]:grid-cols-1">{children}</div>;
}

function Foot({ children, end = false }: { children: ReactNode; end?: boolean }) {
  return (
    <div className={`mt-[26px] flex items-center gap-3 ${end ? "justify-end" : "justify-between"}`}>
      {children}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={BTN_GHOST} onClick={onClick}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
    </button>
  );
}

function ContinueButton({
  children = "Continue",
  onClick,
  busy,
  disabled,
  testId,
}: {
  children?: ReactNode;
  onClick: () => void;
  busy?: boolean;
  /** v3 disables Continue until a billing period has been chosen. */
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={BTN_GO}
      onClick={onClick}
      disabled={busy || disabled}
      data-testid={testId}
    >
      {busy ? "Saving…" : children} <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/** A selectable card (`.ac-opt`) announced as one radio in its group. */
function Option({
  selected,
  onSelect,
  title,
  body,
  icon,
  testId,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
  icon?: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={testId}
      onClick={onSelect}
      className={`flex flex-col justify-start rounded-xl border-[1.5px] px-[18px] py-4 text-left transition-colors ${
        selected ? "border-gold bg-gold-lt" : "border-stone-dk bg-surface hover:border-gold/60"
      }`}
    >
      {icon && <span className={`mb-2 block ${selected ? "text-gold-dk" : "text-olive-dk"}`}>{icon}</span>}
      <span className={`mb-1.5 block text-[15px] font-semibold ${selected ? "text-gold-dk" : "text-fg"}`}>
        {title}
      </span>
      <span className={`block text-[12px] leading-[1.55] ${selected ? "text-gold-dk" : "text-fg-2"}`}>
        {body}
      </span>
    </button>
  );
}

function Note({ children, amber = false }: { children: ReactNode; amber?: boolean }) {
  return (
    <div
      className={`mt-4 flex gap-[9px] rounded-[10px] border px-4 py-[13px] text-[12px] leading-[1.55] ${
        amber ? "border-gold bg-gold-lt text-gold-dk" : "border-stone-dk bg-offwhite text-fg-2"
      }`}
    >
      <Info className="mt-px h-[15px] w-[15px] shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

// ── Stepper ──────────────────────────────────────────────────────────────────

export function Stepper({ steps }: { steps: StepView[] }) {
  return (
    <ol
      aria-label="Progress"
      data-testid="ac-steps"
      className="mx-auto mb-[30px] mt-7 flex max-w-[580px] items-start justify-center"
    >
      {steps.map((step, i) => (
        <li key={`${step.label}-${i}`} className="contents">
          <div
            className="flex shrink-0 flex-col items-center gap-2"
            aria-current={step.state === "active" ? "step" : undefined}
            data-state={step.state}
          >
            <span
              className={`flex h-[34px] w-[34px] items-center justify-center rounded-full border-[1.5px] bg-surface text-[13px] font-medium ${
                step.state === "active"
                  ? "border-gold text-gold-dk"
                  : step.state === "done"
                    ? "border-[var(--ac-green)] text-[var(--ac-green)]"
                    : "border-stone-dk text-fg-muted"
              }`}
            >
              {i + 1}
            </span>
            <span
              className={`text-center text-[12px] leading-tight max-[680px]:max-w-[52px] max-[680px]:text-[10px] ${
                step.state === "active"
                  ? "font-semibold text-gold-dk"
                  : step.state === "done"
                    ? "font-medium text-[var(--ac-green)]"
                    : "text-fg-muted"
              }`}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className={`mx-1.5 mt-[17px] h-[1.5px] min-w-6 flex-1 max-[680px]:mx-1 max-[680px]:min-w-2 ${
                step.state === "done" ? "bg-[var(--ac-green)]" : "bg-stone-dk"
              }`}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

// ── 1. Account ───────────────────────────────────────────────────────────────

export interface AccountDraft {
  accountType: AccountType;
  workEmail: string;
  firstName: string;
  lastName: string;
  dialCode: string;
  phone: string;
  designation: string;
  organizationName: string;
}

export function AccountScreen({
  draft,
  trialDecks,
  onChange,
  errors,
  onContinue,
  busy,
  notice,
}: {
  draft: AccountDraft;
  /** 0 hides the strip — which is how the incubator superuser sees v3. */
  trialDecks: number;
  onChange: (patch: Partial<AccountDraft>) => void;
  errors: FieldErrors;
  onContinue: () => void;
  busy: boolean;
  notice?: string | null;
}) {
  return (
    <Card>
      <Heading title="Create your account" sub="Work email required to sign up" />
      {notice && <Note amber>{notice}</Note>}
      <Field
        label="Work email"
        htmlFor="ac-email"
        hint="Personal email addresses are not accepted"
        error={errors.workEmail}
      >
        <input
          id="ac-email"
          className={INPUT}
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={draft.workEmail}
          onChange={(e) => onChange({ workEmail: e.target.value })}
        />
      </Field>
      <Row2>
        <Field label="First name" htmlFor="ac-first" error={errors.firstName}>
          <input
            id="ac-first"
            className={INPUT}
            autoComplete="given-name"
            value={draft.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
          />
        </Field>
        <Field label="Last name" htmlFor="ac-last" error={errors.lastName}>
          <input
            id="ac-last"
            className={INPUT}
            autoComplete="family-name"
            value={draft.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
          />
        </Field>
      </Row2>
      <Field label="Phone number" htmlFor="ac-phone" error={errors.phone ?? errors.dialCode}>
        <div className="flex gap-2">
          <select
            aria-label="Country code"
            className={`${INPUT} max-w-[104px]`}
            value={draft.dialCode}
            onChange={(e) => onChange({ dialCode: e.target.value })}
          >
            {DIAL_CODES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <input
            id="ac-phone"
            className={`${INPUT} flex-1`}
            type="tel"
            autoComplete="tel-national"
            placeholder="98765 43210"
            value={draft.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
          />
        </div>
      </Field>
      <Row2>
        <Field
          label={
            <>
              Designation <Optional />
            </>
          }
          htmlFor="ac-desig"
          error={errors.designation}
        >
          <input
            id="ac-desig"
            className={INPUT}
            placeholder="e.g. Investment Associate"
            value={draft.designation}
            onChange={(e) => onChange({ designation: e.target.value })}
          />
        </Field>
        <Field
          label={
            <>
              Organization name <Optional />
            </>
          }
          htmlFor="ac-orgname"
          error={errors.organizationName}
        >
          <input
            id="ac-orgname"
            className={INPUT}
            autoComplete="organization"
            placeholder="e.g. Acme Ventures"
            value={draft.organizationName}
            onChange={(e) => onChange({ organizationName: e.target.value })}
          />
        </Field>
      </Row2>
      <div className="mt-5">
        <span id="ac-type-label" className="mb-[7px] block text-[12.5px] font-semibold text-fg">
          Account type
        </span>
        <div
          role="radiogroup"
          aria-labelledby="ac-type-label"
          className="mt-2.5 grid grid-cols-2 gap-3.5 max-[680px]:grid-cols-1"
        >
          <Option
            testId="ac-type-individual"
            selected={draft.accountType === "individual"}
            onSelect={() => onChange({ accountType: "individual" })}
            title="Individual"
            body="Sign up on your own and pick your role on the next screen. Upgrade your plan anytime as you grow."
          />
          <Option
            testId="ac-type-organization"
            selected={draft.accountType === "organization"}
            onSelect={() => onChange({ accountType: "organization" })}
            title="Organization"
            body="For VC firms, incubators, and accelerators. Invite your team and manage multiple users."
          />
        </div>
      </div>
      {/* v3 deleted this strip: the trial is a SCREEN of its own now, reached
          from the seat step, so advertising it here would promise it twice.
          Every other role's prototype still draws it, so it is gated, not gone. */}
      {trialDecks > 0 && (
        <div className="mt-[22px] flex items-center gap-[11px] rounded-[11px] border border-[var(--ac-green)] bg-[var(--ac-green-lt)] px-4 py-[13px] text-[var(--ac-green-dk)]">
          <Gift className="h-[19px] w-[19px] shrink-0" aria-hidden="true" />
          <div>
            <b className="text-[13px]">Free trial included</b>
            <br />
            <span className="text-[12px] opacity-90">
              Evaluate {trialDecks} pitchdeck{trialDecks === 1 ? "" : "s"} free
            </span>
          </div>
        </div>
      )}
      <Foot end>
        <ContinueButton onClick={onContinue} busy={busy} />
      </Foot>
    </Card>
  );
}

// ── 1b. Org type ─────────────────────────────────────────────────────────────

export function OrgTypeScreen({
  kind,
  onKind,
  onBack,
  onContinue,
}: {
  kind: OrgKind;
  onKind: (k: OrgKind) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <Card>
      <Heading
        title="What best describes your organisation?"
        sub="This shapes how your dashboard, workflows, and evaluation roles are configured."
      />
      <div role="radiogroup" aria-label="Organisation type" className="mt-[22px] grid grid-cols-2 gap-3.5 max-[680px]:grid-cols-1">
        <Option
          testId="ac-org-incubator"
          selected={kind === "incubator"}
          onSelect={() => onKind("incubator")}
          icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
          title="Incubator / Accelerator"
          body="Run cohort programs, assign jury and mentors, manage multiple sectors and batches."
        />
        <Option
          testId="ac-org-investor"
          selected={kind === "investor"}
          onSelect={() => onKind("investor")}
          icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
          title="Investor"
          body="VC firm or angel network — manage deal flow, analysts, IC pipeline and LP reporting."
        />
      </div>
      <Foot>
        <BackButton onClick={onBack} />
        <ContinueButton onClick={onContinue} />
      </Foot>
    </Card>
  );
}

// ── 1c. Org details ──────────────────────────────────────────────────────────

export interface OrgDraft {
  name: string;
  businessType: string;
  employees: string;
  associates: string;
  city: string;
  country: string;
  contactName: string;
  designation: string;
  dialCode: string;
  phone: string;
  email: string;
}

function Select({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <select id={id} className={INPUT} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

export function OrgDetailsScreen({
  draft,
  onChange,
  errors,
  onBack,
  onCreate,
  busy,
}: {
  draft: OrgDraft;
  onChange: (patch: Partial<OrgDraft>) => void;
  errors: FieldErrors;
  onBack: () => void;
  onCreate: () => void;
  busy: boolean;
}) {
  const set = (k: keyof OrgDraft) => (v: string) => onChange({ [k]: v });
  return (
    <Card>
      <Heading
        title="Create your account"
        sub="Tell us about your organisation so we can set up your workspace."
      />
      <Field label="Organization name" htmlFor="od-name" error={errors.name}>
        <input
          id="od-name"
          className={INPUT}
          placeholder="e.g. Acme Ventures"
          value={draft.name}
          onChange={(e) => set("name")(e.target.value)}
        />
      </Field>
      <Row2>
        <Field label="Type of business" htmlFor="od-business" error={errors.businessType}>
          <Select id="od-business" value={draft.businessType} onChange={set("businessType")} options={BUSINESS_TYPES} />
        </Field>
        <Field label="No. of employees" htmlFor="od-employees" error={errors.employees}>
          <Select id="od-employees" value={draft.employees} onChange={set("employees")} options={EMPLOYEE_BANDS} />
        </Field>
      </Row2>
      <Row2>
        <Field label="No. of associates" htmlFor="od-associates" error={errors.associates}>
          <input
            id="od-associates"
            className={INPUT}
            type="number"
            min={0}
            placeholder="e.g. 12"
            value={draft.associates}
            onChange={(e) => set("associates")(e.target.value)}
          />
        </Field>
        <Field label="City" htmlFor="od-city" error={errors.city}>
          <input
            id="od-city"
            className={INPUT}
            placeholder="e.g. Hyderabad"
            value={draft.city}
            onChange={(e) => set("city")(e.target.value)}
          />
        </Field>
      </Row2>
      <Row2>
        <Field label="Country" htmlFor="od-country" error={errors.country}>
          <Select id="od-country" value={draft.country} onChange={set("country")} options={COUNTRIES} />
        </Field>
        <Field label="Contact person name" htmlFor="od-contact" error={errors.contactName}>
          <input
            id="od-contact"
            className={INPUT}
            placeholder="e.g. Priya Sharma"
            value={draft.contactName}
            onChange={(e) => set("contactName")(e.target.value)}
          />
        </Field>
      </Row2>
      <Field label="Designation" htmlFor="od-desig" error={errors.designation}>
        <input
          id="od-desig"
          className={INPUT}
          placeholder="e.g. Managing Partner"
          value={draft.designation}
          onChange={(e) => set("designation")(e.target.value)}
        />
      </Field>
      <Field label="Phone number" htmlFor="od-phone" error={errors.phone ?? errors.dialCode}>
        <div className="flex gap-2">
          <select
            aria-label="Organisation country code"
            className={`${INPUT} max-w-[104px]`}
            value={draft.dialCode}
            onChange={(e) => set("dialCode")(e.target.value)}
          >
            {DIAL_CODES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <input
            id="od-phone"
            className={`${INPUT} flex-1`}
            type="tel"
            placeholder="98765 43210"
            value={draft.phone}
            onChange={(e) => set("phone")(e.target.value)}
          />
        </div>
      </Field>
      <Field label="Email ID" htmlFor="od-email" error={errors.email}>
        <input
          id="od-email"
          className={INPUT}
          type="email"
          placeholder="you@company.com"
          value={draft.email}
          onChange={(e) => set("email")(e.target.value)}
        />
      </Field>
      <Foot>
        <BackButton onClick={onBack} />
        <ContinueButton onClick={onCreate} busy={busy}>
          Create account
        </ContinueButton>
      </Foot>
    </Card>
  );
}

// ── 1d. V6 · `#acs-super` — nominate your super user ─────────────────────────

/**
 * V6's organisation branch gained a step between Org details and the plan: the
 * one account that "manages the team, roles and billing".
 *
 * Mobile-first, like every screen below it: the two fields are a one-column
 * `grid` at every width, because they are a name and an email and there is no
 * width at which pairing them helps. `Field` already renders a real `<label>`
 * bound by `htmlFor`, so nothing here relies on placeholder text.
 */
export function SuperUserScreen({
  draft,
  onChange,
  errors,
  onBack,
  onContinue,
  busy,
}: {
  draft: SuperUserNomination;
  onChange: (patch: Partial<SuperUserNomination>) => void;
  errors: FieldErrors;
  onBack: () => void;
  onContinue: () => void;
  busy?: boolean;
}) {
  return (
    <Card>
      <Heading
        title="Nominate your super user"
        sub={
          <>
            Your organisation needs one <b>super user</b> — the top account authority who manages the
            team, roles and billing. You can reassign this later in Team &amp; roles.
          </>
        }
      />
      <div data-testid="ac-super">
        <Field label="Super user — full name" htmlFor="su-name" error={errors.name}>
          <input
            id="su-name"
            className={INPUT}
            autoComplete="name"
            placeholder="e.g. Priya Sharma"
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>
        <Field
          label="Super user — work email"
          htmlFor="su-email"
          error={errors.email}
          hint="They'll log in with this email and set their own password."
        >
          <input
            id="su-email"
            className={INPUT}
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            value={draft.email}
            onChange={(e) => onChange({ email: e.target.value })}
          />
        </Field>
      </div>
      <Foot>
        <BackButton onClick={onBack} />
        <ContinueButton onClick={onContinue} busy={busy} testId="ac-super-continue" />
      </Foot>
    </Card>
  );
}

// ── Plans ────────────────────────────────────────────────────────────────────

function CurrencyPicker({
  book,
  currencies,
  value,
  onChange,
}: {
  book: PublishedPriceBook;
  currencies: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  if (currencies.length < 2) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span id="ac-currency-label" className="text-[12px] text-fg-muted">
        Billing currency
      </span>
      <div role="radiogroup" aria-labelledby="ac-currency-label" className="flex flex-wrap gap-1.5">
        {currencies.map((code) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={value === code}
            onClick={() => onChange(code)}
            className={`rounded-full border px-3 py-1 text-[12px] ${
              value === code ? "border-fg font-semibold text-fg" : "border-stone-dk bg-surface text-fg-2 hover:border-gold"
            }`}
          >
            {symbolFor(book, code)} {code}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * ── Two plan flows live here, and that is deliberate ────────────────────────
 *
 * Only the INCUBATOR SUPERUSER prototype was reshared on 2026-09-19. The
 * incubator admin, program-manager, program-associate and jury files and every
 * VC file still ship "Choose your plan" — the fixed-pack grid and the
 * pay-as-you-go ladder below. So V3-PT's seat flow is additive and gated, and
 * these components stay exactly as they were rather than being replaced:
 *
 *   LegacyPlanScreen / LegacyOrgPlanScreen   everyone else, unchanged
 *   SeatScreen / EnterpriseSeatScreen        incubator superuser (item 17)
 *
 * `AccountOverlay` picks between them on one boolean. Deleting the legacy pair
 * is §4 Q85 — it needs the other five prototypes reshared first.
 */
function Price({ book, plan, currency, className }: { book: PublishedPriceBook; plan: PricePlanRow; currency: string; className: string }) {
  const suffix = periodLabel(plan.period);
  return (
    <div className={className}>
      {formatMinor(plan.amounts[currency] ?? 0, symbolFor(book, currency))}
      {suffix && (
        <span className={suffix === "Annual" ? "ml-1 text-[13px] font-semibold" : "text-[12px] font-normal text-fg-muted"}>
          {suffix === "Annual" ? " Annual" : suffix}
        </span>
      )}
    </div>
  );
}

function Bullets({ items, green = true, className = "" }: { items: string[]; green?: boolean; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={`flex flex-col ${className}`}>
      {items.map((b) => (
        <li key={b} className="flex items-start gap-2 text-fg-2">
          <Check
            className={`mt-px h-[14px] w-[14px] shrink-0 ${green ? "text-[var(--ac-green)]" : "text-fg-muted"}`}
            aria-hidden="true"
          />
          {b}
        </li>
      ))}
    </ul>
  );
}

/** `.ac-plan` — a subscription or enterprise card. */
function PlanCard({
  book,
  plan,
  currency,
  selected,
  onSelect,
}: {
  book: PublishedPriceBook;
  plan: PricePlanRow;
  currency: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const bullets = featureBullets(plan);
  if (plan.group === "enterprise" && plan.units !== null) bullets.unshift(`${plan.units} Credits AI pre-score`);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`ac-plan-${plan.code}`}
      onClick={onSelect}
      className={`relative flex flex-col justify-start rounded-[13px] border-[1.5px] px-4 py-[18px] text-left transition-colors ${
        selected ? "border-gold bg-gold-lt" : "border-stone-dk bg-surface hover:border-gold/60"
      }`}
    >
      {plan.badge && (
        <span className="absolute -top-2.5 right-3.5 rounded-full bg-gold px-2.5 py-[3px] text-[10px] font-semibold text-white">
          {plan.badge}
        </span>
      )}
      <span className={`block text-[15px] font-semibold ${selected ? "text-gold-dk" : "text-fg"}`}>{plan.name}</span>
      <Price
        book={book}
        plan={plan}
        currency={currency}
        className={`mb-3.5 mt-[3px] text-[25px] font-bold ${selected ? "text-gold-dk" : "text-fg"}`}
      />
      <Bullets items={bullets} className="gap-[9px] text-[12.5px]" />
    </button>
  );
}

/** `.ac-pack` — a credit pack card. No per-deck line and no saving flag (§8 Q1). */
function PackCard({
  book,
  plan,
  currency,
  selected,
  onSelect,
}: {
  book: PublishedPriceBook;
  plan: PricePlanRow;
  currency: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const featured = plan.badge !== null;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`ac-plan-${plan.code}`}
      onClick={onSelect}
      className={`relative flex flex-col justify-start rounded-[13px] border-[1.5px] bg-surface px-[15px] py-[18px] text-left transition-colors ${
        selected
          ? "border-gold shadow-[0_0_0_3px_var(--gold-lt)]"
          : featured
            ? "border-olive-dk"
            : "border-stone-dk hover:border-gold/60"
      }`}
    >
      {plan.badge && (
        <span className="absolute -top-[11px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-olive-dk px-[11px] py-[3px] text-[9.5px] font-semibold uppercase tracking-[.06em] text-white">
          {plan.badge}
        </span>
      )}
      {plan.units !== null ? (
        <span className="block text-[26px] font-bold text-fg">
          {plan.units}
          <small className="text-[12px] font-normal text-fg-muted"> credits</small>
        </span>
      ) : (
        <span className="block text-[17px] font-bold text-fg">{plan.name}</span>
      )}
      <Price book={book} plan={plan} currency={currency} className="mt-1.5 text-[17px] font-bold text-gold-dk" />
      {featureBullets(plan).length > 0 && (
        <Bullets
          items={featureBullets(plan)}
          green={false}
          className="mt-[13px] gap-[7px] border-t border-stone pt-[13px] text-[11.5px]"
        />
      )}
    </button>
  );
}

function TaxNotes({ book, group, currency }: { book: PublishedPriceBook; group?: PriceGroupRow | undefined; currency: string }) {
  const international = currency !== book.baseCurrency;
  return (
    <>
      {group?.footnote && <Note>{applyCopyTokens(group.footnote, book.tax)}</Note>}
      {international && book.tax.showInternationalTaxNotice && (
        <Note>
          Prices in {currency} are shown exclusive of local taxes — no GST is added, and you are responsible for any
          VAT/GST due where you are billed.
        </Note>
      )}
    </>
  );
}

// ── 2. Seat & pricing (V3-PT, item 17) ───────────────────────────────────────

/**
 * v3 replaced "Choose your plan" — a segmented control over fixed packs and a
 * pay-as-you-go ladder — with a two-step **seat then period** choice:
 *
 *   #itiers    Standard · Pro · Premium, each with its privilege line
 *   #iprice    revealed once a seat is picked — Quarter · Half-year · Year
 *   #ac-extra  revealed with it — 125 / 250 / 375 / 500 extra decks
 *   footer     Back · Take a 3-deck free trial · Continue to pay
 *
 * The two footer buttons stay disabled until a PERIOD is chosen, which is what
 * `acPickTier` does (it disables both again on every tier change) and what
 * `acPickPeriod` undoes. Nothing here names a price: every figure is a row of
 * the published catalogue, which Price configuration's three cards write.
 */

/** `.ac-plan` in the tier grid — a seat, priced only once a period is chosen. */
function TierCard({
  tier,
  name,
  privilege,
  badge,
  features,
  selected,
  onSelect,
}: {
  tier: Plan;
  name: string;
  privilege: string | null;
  badge: string | null;
  features: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`ac-tier-${tier}`}
      onClick={onSelect}
      className={`relative flex flex-col justify-start rounded-[13px] border-[1.5px] px-4 py-[18px] text-left transition-colors ${
        selected ? "border-gold bg-gold-lt" : "border-stone-dk bg-surface hover:border-gold/60"
      }`}
    >
      {badge && (
        <span className="absolute -top-2.5 right-3.5 rounded-full bg-gold px-2.5 py-[3px] text-[10px] font-semibold text-white">
          {badge}
        </span>
      )}
      <span className={`block text-[15px] font-semibold ${selected ? "text-gold-dk" : "text-fg"}`}>{name}</span>
      {privilege && (
        <span className="mb-3 mt-[3px] block text-[11px] font-bold leading-[1.4] text-gold-dk">{privilege}</span>
      )}
      <Bullets items={features} className="gap-[9px] text-[12.5px]" />
    </button>
  );
}

/** `#iperiods` — the billing-period cards, priced per seat. */
function PeriodCard({
  months,
  label,
  sub,
  best,
  priceLabel,
  decks,
  selected,
  onSelect,
}: {
  months: number;
  label: string;
  sub: string;
  best?: boolean;
  priceLabel: string;
  decks: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`ac-period-${months}`}
      onClick={onSelect}
      className={`relative flex flex-col justify-start rounded-[13px] border-[1.5px] px-4 py-[18px] text-left transition-colors ${
        selected ? "border-gold bg-gold-lt" : "border-stone-dk bg-surface hover:border-gold/60"
      }`}
    >
      {best && (
        <span className="absolute -top-2.5 right-3.5 rounded-full bg-gold px-2.5 py-[3px] text-[10px] font-semibold text-white">
          Best value
        </span>
      )}
      <span className={`block text-[15px] font-semibold ${selected ? "text-gold-dk" : "text-fg"}`}>{label}</span>
      <span className={`mb-3.5 mt-[3px] block text-[25px] font-bold ${selected ? "text-gold-dk" : "text-fg"}`}>
        {priceLabel}
        <small className="text-[12px] font-normal text-fg-muted"> /seat</small>
      </span>
      <Bullets
        items={[...(decks !== null ? [`${decks} decks included`] : []), sub]}
        className="gap-[9px] text-[12.5px]"
      />
    </button>
  );
}

/**
 * `#ac-extra` / `#ac-orgextra` — "Add extra decks (optional)".
 *
 * One credit evaluates one deck. The rate is DERIVED from the annual seat price
 * (`extraCreditRate`), so an administrator who edits that price in Price
 * configuration moves this too — the prototype hard codes 23.04 / 30.72 / 40.96
 * and states in a comment that they are the annual price over 500 decks.
 */
function ExtraCredits({
  rateMinor,
  symbol,
  tierName,
  selected,
  onToggle,
  testId,
}: {
  rateMinor: number;
  symbol: string;
  tierName: string;
  selected: number;
  onToggle: (credits: number) => void;
  testId: string;
}) {
  if (rateMinor <= 0) return null;
  return (
    <div className="mt-5 border-t border-dashed border-stone-dk pt-[18px]" data-testid={testId}>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[.05em] text-fg-muted">
        Add extra decks (optional)
      </div>
      <p className="mb-2.5 text-[11px] leading-[1.5] text-fg-2">
        1 credit = 1 deck evaluation · priced at your <b>{tierName}</b> plan rate (≈
        {formatMinor(Math.round(rateMinor), symbol)}/credit). A plan is required to buy credits.
      </p>
      <div
        role="group"
        aria-label="Extra deck credits"
        className="grid grid-cols-4 gap-[9px] max-[560px]:grid-cols-2"
      >
        {EXTRA_CREDIT_PACKS.map((credits) => {
          const on = selected === credits;
          return (
            <button
              key={credits}
              type="button"
              aria-pressed={on}
              data-testid={`ac-extra-${credits}`}
              onClick={() => onToggle(on ? 0 : credits)}
              className={`rounded-[10px] border-[1.5px] bg-surface px-1.5 py-[11px] text-center transition-colors ${
                on ? "border-gold bg-gold-lt" : "border-stone-dk hover:border-gold"
              }`}
            >
              <span className="block font-mono text-[15px] font-bold text-fg">{credits}</span>
              <span className="block text-[9px] text-fg-muted">credits</span>
              <span className="mt-[5px] block font-mono text-[11px] font-bold text-gold-dk">
                {formatMinor(Math.round(rateMinor * credits), symbol)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface SeatChoice {
  tier: Plan | null;
  months: number | null;
  extraCredits: number;
}

export function SeatScreen({
  book,
  choice,
  onTier,
  onPeriod,
  onExtra,
  currencies,
  currency,
  onCurrency,
  onBack,
  onTrial,
  onContinue,
}: {
  book: PublishedPriceBook;
  choice: SeatChoice;
  onTier: (t: Plan) => void;
  onPeriod: (months: number) => void;
  onExtra: (credits: number) => void;
  currencies: string[];
  currency: string;
  onCurrency: (c: string) => void;
  onBack: () => void;
  onTrial: () => void;
  onContinue: () => void;
}) {
  const symbol = symbolFor(book, currency);
  const tiers = seatTiers(book);
  const chosen = choice.tier;
  const periods = chosen ? seatPeriodsFor(book, chosen) : [];
  const selectedPlan = chosen && choice.months ? seatPlanFor(book, chosen, choice.months) : undefined;
  const rate = chosen ? extraCreditRateMinor(book, chosen, currency) ?? 0 : 0;
  const ready = selectedPlan !== undefined;

  return (
    <Card>
      <Heading
        title="Choose your seat"
        sub="Pick a seat type — its pricing appears once selected. Billed per seat, per period."
      />
      <CurrencyPicker book={book} currencies={currencies} value={currency} onChange={onCurrency} />

      {tiers.length === 0 ? (
        <Note amber>No seat is on sale in {currency} right now. Choose another currency, or contact us.</Note>
      ) : (
        <div
          role="radiogroup"
          aria-label="Seat type"
          data-testid="ac-tiers"
          className="mt-[22px] grid grid-cols-3 gap-3.5 max-[680px]:grid-cols-1"
        >
          {tiers.map((tier) => {
            // Every period row of a tier carries the same name, privilege line
            // and features; the first one is as good as any for the card.
            const any = seatPlanFor(book, tier, seatPeriodsFor(book, tier)[0] ?? 0);
            return (
              <TierCard
                key={tier}
                tier={tier}
                name={any?.name ?? PLAN_LABELS[tier]}
                privilege={any?.tagline ?? null}
                badge={any?.badge ?? null}
                features={any ? featureBullets(any) : []}
                selected={chosen === tier}
                onSelect={() => onTier(tier)}
              />
            );
          })}
        </div>
      )}

      {chosen && (
        <div className="mt-[22px] border-t border-dashed border-stone-dk pt-5" data-testid="ac-periods">
          <div className="mb-0.5 text-[11px] font-bold uppercase tracking-[.05em] text-fg-muted">
            Billing period · per seat
          </div>
          <div
            role="radiogroup"
            aria-label="Billing period"
            className="mt-2.5 grid grid-cols-3 gap-3.5 max-[680px]:grid-cols-1"
          >
            {SEAT_PERIOD_VIEWS.filter((v) => periods.includes(v.months)).map((v) => {
              const plan = seatPlanFor(book, chosen, v.months);
              if (!plan) return null;
              return (
                <PeriodCard
                  key={v.months}
                  months={v.months}
                  label={v.label}
                  sub={v.sub}
                  best={v.best}
                  decks={plan.units}
                  priceLabel={formatMinor(plan.amounts[currency] ?? 0, symbol)}
                  selected={choice.months === v.months}
                  onSelect={() => onPeriod(v.months)}
                />
              );
            })}
          </div>
        </div>
      )}

      {chosen && (
        <ExtraCredits
          testId="ac-extra"
          rateMinor={rate}
          symbol={symbol}
          tierName={PLAN_LABELS[chosen]}
          selected={choice.extraCredits}
          onToggle={onExtra}
        />
      )}

      <TaxNotes book={book} group={undefined} currency={currency} />

      <Foot>
        <BackButton onClick={onBack} />
        <button
          type="button"
          className={BTN_AMBER}
          disabled={!ready}
          data-testid="ac-take-trial"
          onClick={onTrial}
        >
          <Gift className="h-4 w-4" aria-hidden="true" />
          Take a {FREE_TRIAL_DECKS}-deck free trial
        </button>
        <ContinueButton onClick={onContinue} disabled={!ready}>
          Continue to pay
        </ContinueButton>
      </Foot>
    </Card>
  );
}

export function EnterpriseSeatScreen({
  book,
  plans,
  planCode,
  onPlan,
  extraCredits,
  onExtra,
  currencies,
  currency,
  onCurrency,
  onBack,
  onTrial,
  onContinue,
}: {
  book: PublishedPriceBook;
  plans: PricePlanRow[];
  planCode: string | null;
  onPlan: (code: string) => void;
  extraCredits: number;
  onExtra: (credits: number) => void;
  currencies: string[];
  currency: string;
  onCurrency: (c: string) => void;
  onBack: () => void;
  onTrial: () => void;
  onContinue: () => void;
}) {
  const symbol = symbolFor(book, currency);
  const seatCounts = plans.map((p) => p.seats).filter((n): n is number => n !== null);
  // `renderOrgExtra()` prices an organisation's extra decks at the PREMIUM rate.
  const rate = extraCreditRateMinor(book, "premium", currency) ?? 0;
  return (
    <Card>
      <Heading
        title="Choose your Enterprise plan"
        sub={
          seatCounts.length > 0 ? (
            <>
              Pick the seat count for your organisation —{" "}
              {seatCounts.map((n, i) => (
                <span key={n}>
                  {i > 0 && (i === seatCounts.length - 1 ? " or " : ", ")}
                  <b>{n}</b>
                </span>
              ))}{" "}
              Premium seats, billed annually with AI pre-score credits included.
            </>
          ) : undefined
        }
      />
      <CurrencyPicker book={book} currencies={currencies} value={currency} onChange={onCurrency} />
      {plans.length === 0 ? (
        <Note amber>
          No organisation plan is on sale in {currency} right now. Choose another currency, or contact us.
        </Note>
      ) : (
        <div
          role="radiogroup"
          aria-label="Enterprise plans"
          data-testid="ac-orgplans"
          className="mt-[22px] grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))] max-[680px]:grid-cols-1"
        >
          {plans.map((plan) => {
            const seats = plan.seats ?? 0;
            const selected = plan.code === planCode;
            return (
              <button
                key={plan.code}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`ac-plan-${plan.code}`}
                onClick={() => onPlan(plan.code)}
                className={`relative flex flex-col justify-start rounded-[13px] border-[1.5px] px-4 py-[18px] text-left transition-colors ${
                  selected ? "border-gold bg-gold-lt" : "border-stone-dk bg-surface hover:border-gold/60"
                }`}
              >
                <span className={`block text-[15px] font-semibold ${selected ? "text-gold-dk" : "text-fg"}`}>
                  {plan.name}
                </span>
                <span className={`mb-3.5 mt-[3px] block text-[25px] font-bold ${selected ? "text-gold-dk" : "text-fg"}`}>
                  {formatMinor(plan.amounts[currency] ?? 0, symbol)}
                  <small className="ml-1 text-[12px] font-semibold"> Annual + GST</small>
                </span>
                <Bullets
                  items={[
                    `${seats} seats — all Premium`,
                    ...(plan.units !== null
                      ? [`${plan.units.toLocaleString("en-IN")} decks / year (${seats > 0 ? Math.round(plan.units / seats) : 0} per seat)`]
                      : []),
                    ...featureBullets(plan),
                  ]}
                  className="gap-[9px] text-[12.5px]"
                />
              </button>
            );
          })}
        </div>
      )}
      <ExtraCredits
        testId="ac-orgextra"
        rateMinor={rate}
        symbol={symbol}
        tierName={PLAN_LABELS.premium}
        selected={extraCredits}
        onToggle={onExtra}
      />
      <TaxNotes book={book} group={undefined} currency={currency} />
      <Foot>
        <BackButton onClick={onBack} />
        <button
          type="button"
          className={BTN_AMBER}
          data-testid="ac-take-trial"
          onClick={onTrial}
          disabled={planCode === null}
        >
          <Gift className="h-4 w-4" aria-hidden="true" />
          Take a {FREE_TRIAL_DECKS}-deck free trial
        </button>
        <ContinueButton onClick={onContinue} disabled={planCode === null}>
          Continue to pay
        </ContinueButton>
      </Foot>
    </Card>
  );
}

// ── 2c. The pre-V3 plan screens, for every role whose prototype still has one ─

export function LegacyPlanScreen({
  book,
  accountType,
  groups,
  activeGroup,
  onGroup,
  plansByGroup,
  planCode,
  onPlan,
  currencies,
  currency,
  onCurrency,
  onBack,
  onContinue,
}: {
  book: PublishedPriceBook;
  accountType: AccountType;
  /** The individual catalogues that have something to sell, in order. */
  groups: PriceGroupRow[];
  activeGroup: PriceGroupRow | undefined;
  onGroup: (g: PriceGroupRow) => void;
  plansByGroup: Record<string, PricePlanRow[]>;
  planCode: string | null;
  onPlan: (code: string) => void;
  currencies: string[];
  currency: string;
  onCurrency: (c: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const plans = activeGroup ? plansByGroup[activeGroup.group] ?? [] : [];
  const isPacks = activeGroup?.group === "credit_pack";
  const trial = book.trial;
  const trialChips = Math.min(trial.decks, 5);
  return (
    <Card>
      <Heading
        title="Choose your plan"
        sub={
          activeGroup
            ? `${accountType === "organization" ? "Organization" : "Individual"} · ${activeGroup.badge ?? activeGroup.title}`
            : undefined
        }
      />
      <CurrencyPicker book={book} currencies={currencies} value={currency} onChange={onCurrency} />

      {groups.length === 0 ? (
        <Note amber>Nothing is on sale in {currency} right now. Choose another currency, or contact us.</Note>
      ) : (
        <>
          {groups.length > 1 && (
            <div
              role="tablist"
              aria-label="Plan type"
              className="mt-5 flex gap-1.5 rounded-[11px] border border-stone-dk bg-stone p-[5px]"
            >
              {groups.map((g) => {
                const on = g.group === activeGroup?.group;
                return (
                  <button
                    key={g.group}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => onGroup(g)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg p-[11px] text-[13px] ${
                      on ? "bg-surface font-semibold text-fg shadow-[0_1px_2px_rgba(0,0,0,.06)]" : "text-fg-muted"
                    }`}
                  >
                    {g.title}
                  </button>
                );
              })}
            </div>
          )}

          {isPacks && trial.decks > 0 && trial.showOnPricingPage && (
            <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-[10px] border border-[var(--ac-green)] bg-[var(--ac-green-lt)] px-[15px] py-[11px]">
              <Gift className="h-[17px] w-[17px] text-[var(--ac-green-dk)]" aria-hidden="true" />
              <div className="text-[var(--ac-green-dk)]">
                <b className="text-[12.5px]">Free trial — {trial.decks} decks included</b>
                <div className="text-[11px] opacity-85">
                  Start with {trial.decks} free decks, then buy credits anytime
                </div>
              </div>
              <div className="ml-auto flex gap-1.5">
                {Array.from({ length: trialChips }, (_, i) => (
                  <span key={i} className="rounded-md border border-gold px-2 py-[3px] text-[10.5px] text-gold-dk">
                    Deck {i + 1}
                  </span>
                ))}
              </div>
            </div>
          )}

          {activeGroup && (activeGroup.cardName || activeGroup.cardSub) && (
            <Note amber={isPacks}>
              {[activeGroup.cardName, activeGroup.cardSub].filter(Boolean).join(". ")}
            </Note>
          )}

          <div
            role="radiogroup"
            aria-label={activeGroup?.title ?? "Plans"}
            className={`grid grid-cols-3 max-[680px]:grid-cols-1 ${isPacks ? "mt-[18px] gap-[13px]" : "mt-[22px] gap-3.5"}`}
          >
            {plans.map((p) =>
              isPacks ? (
                <PackCard key={p.code} book={book} plan={p} currency={currency} selected={p.code === planCode} onSelect={() => onPlan(p.code)} />
              ) : (
                <PlanCard key={p.code} book={book} plan={p} currency={currency} selected={p.code === planCode} onSelect={() => onPlan(p.code)} />
              ),
            )}
          </div>
          <TaxNotes book={book} group={activeGroup} currency={currency} />
        </>
      )}

      <Foot>
        <BackButton onClick={onBack} />
        <ContinueButton onClick={onContinue}>Continue</ContinueButton>
      </Foot>
    </Card>
  );
}

export function LegacyOrgPlanScreen({
  book,
  group,
  plans,
  planCode,
  onPlan,
  currencies,
  currency,
  onCurrency,
  onBack,
  onContinue,
}: {
  book: PublishedPriceBook;
  group: PriceGroupRow | undefined;
  plans: PricePlanRow[];
  planCode: string | null;
  onPlan: (code: string) => void;
  currencies: string[];
  currency: string;
  onCurrency: (c: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <Card>
      <Heading
        title="Choose your plan"
        sub={group ? [group.badge, group.cardSub].filter(Boolean).join(" · ") : undefined}
      />
      <CurrencyPicker book={book} currencies={currencies} value={currency} onChange={onCurrency} />
      {plans.length === 0 ? (
        <Note amber>No organisation plan is on sale in {currency} right now. Choose another currency, or contact us.</Note>
      ) : (
        <div
          role="radiogroup"
          aria-label={group?.title ?? "Organisation plans"}
          className="mt-[22px] grid grid-cols-2 gap-3.5 max-[680px]:grid-cols-1"
        >
          {plans.map((p) => (
            <PlanCard key={p.code} book={book} plan={p} currency={currency} selected={p.code === planCode} onSelect={() => onPlan(p.code)} />
          ))}
        </div>
      )}
      <TaxNotes book={book} group={group} currency={currency} />
      <Foot>
        <BackButton onClick={onBack} />
        <ContinueButton onClick={onContinue}>Continue</ContinueButton>
      </Foot>
    </Card>
  );
}


// ── 2b. The free trial, and the paid one (V3-PT) ─────────────────────────────

/**
 * `#acs-trial` — three free decks, used one at a time.
 *
 * The prototype's counter is local state that resets on every visit
 * (`renderTrial` sets `iTrialLeft = 3` unconditionally). This screen is the
 * same: nothing is spent and nothing is recorded — it is a demonstration of
 * what the trial gives you before you pay. Once all three are used it offers
 * the two ways forward the prototype offers, and no others.
 */
export function TrialScreen({
  planName,
  used,
  onUse,
  onBack,
  onPayChosen,
  onPaidTrial,
  onAnnual,
}: {
  planName: string;
  used: number;
  onUse: () => void;
  onBack: () => void;
  onPayChosen: () => void;
  onPaidTrial: () => void;
  /**
   * V6's third option in the "Trial complete" panel — `acStartAnnual()`. It is
   * the ONLY way `#acs-annual` is reached in the mockup, so without this the
   * new screen would be unreachable. Optional, so the callers that do not offer
   * an annual subscription keep V6's two-button panel.
   */
  onAnnual?: () => void;
}) {
  const left = Math.max(FREE_TRIAL_DECKS - used, 0);
  const done = left === 0;
  return (
    <Card>
      <Heading
        title={`Your ${FREE_TRIAL_DECKS}-deck free trial`}
        sub={
          <>
            Evaluate up to {FREE_TRIAL_DECKS} decks free on your <b>{planName}</b>. When your trial
            decks are used, payment unlocks for the plan you chose.
          </>
        }
      />
      <div className="px-0 pb-0.5 pt-2 text-center">
        <div
          data-testid="ac-trial-count"
          className="font-mono text-[52px] font-bold leading-none text-[var(--ac-green-dk)]"
        >
          {left}
        </div>
        <div className="text-[12px] text-fg-2">free decks remaining</div>
      </div>
      <div className="my-5 flex justify-center gap-3" data-testid="ac-trial-decks">
        {Array.from({ length: FREE_TRIAL_DECKS }, (_, i) => {
          const spent = i < used;
          return (
            <span
              key={i}
              data-used={spent ? "true" : "false"}
              aria-label={spent ? `Trial deck ${i + 1}, used` : `Trial deck ${i + 1}, unused`}
              className={`flex h-[66px] w-[52px] items-center justify-center rounded-[9px] border-2 ${
                spent
                  ? "border-solid border-olive bg-olive-lt text-olive-dk"
                  : "border-dashed border-stone-dk bg-surface text-stone-dk"
              }`}
            >
              {spent ? (
                <CircleCheck className="h-6 w-6" aria-hidden="true" />
              ) : (
                <FileText className="h-6 w-6" aria-hidden="true" />
              )}
            </span>
          );
        })}
      </div>
      {done && (
        <div className="mt-1.5 rounded-[11px] border border-gold bg-gold-lt px-4 py-3.5" data-testid="ac-trial-done">
          <div className="mb-[11px] text-center text-[12.5px] font-semibold text-gold-dk">
            Trial complete — how would you like to continue?
          </div>
          <div className="flex flex-wrap justify-center gap-2.5">
            <button type="button" className={BTN_GO} onClick={onPayChosen} data-testid="ac-pay-chosen">
              <CreditCard className="h-4 w-4" aria-hidden="true" />
              Pay for the plan chosen
            </button>
            <button type="button" className={BTN_AMBER} onClick={onPaidTrial} data-testid="ac-try-paid">
              <Gift className="h-4 w-4" aria-hidden="true" />
              Try paid trials
            </button>
            {onAnnual && (
              <button type="button" className={BTN_GO} onClick={onAnnual} data-testid="ac-try-annual">
                <Crown className="h-4 w-4" aria-hidden="true" />
                Annual subscriptions
              </button>
            )}
          </div>
        </div>
      )}
      <Foot>
        <BackButton onClick={onBack} />
        <button
          type="button"
          className={BTN_AMBER}
          onClick={onUse}
          disabled={done}
          data-testid="ac-use-trial-deck"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Use a trial deck
        </button>
      </Foot>
    </Card>
  );
}

/** `#acs-paidtrial` — 10 to 50 decks at the catalogue's paid-trial rate. */
export function PaidTrialScreen({
  book,
  currency,
  packs,
  rateMinor,
  selected,
  onSelect,
  onBack,
  onContinue,
}: {
  book: PublishedPriceBook;
  currency: string;
  packs: readonly number[];
  rateMinor: number;
  selected: number;
  onSelect: (decks: number) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const symbol = symbolFor(book, currency);
  const rate = formatMinor(rateMinor, symbol);
  // A catalogue with no paid-trial rate in this currency cannot sell one. Say
  // so: without this the packs all read zero and Continue would do nothing.
  if (rateMinor <= 0) {
    return (
      <Card>
        <Heading title="Try a paid trial" />
        <Note amber>
          A paid trial is not sold in {currency} right now. Choose another currency, or go back and
          pay for the plan you chose.
        </Note>
        <Foot>
          <BackButton onClick={onBack} />
        </Foot>
      </Card>
    );
  }
  return (
    <Card>
      <Heading
        title="Try a paid trial"
        sub={
          <>
            Not ready to commit to a full plan? Buy a small credit pack and keep evaluating — <b>{rate} per deck</b>. 1
            credit evaluates 1 deck, and credits never expire. Extend your trial before choosing a longer plan.
          </>
        }
      />
      <div
        role="radiogroup"
        aria-label="Paid trial packs"
        data-testid="ac-paid-packs"
        className="my-[18px] flex flex-wrap gap-3"
      >
        {packs.map((decks) => {
          const on = selected === decks;
          return (
            <button
              key={decks}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`ac-paid-pack-${decks}`}
              onClick={() => onSelect(decks)}
              className={`min-w-[108px] flex-1 rounded-xl border-[1.5px] bg-surface px-3 py-3.5 text-center transition-colors ${
                on ? "border-olive bg-olive-lt" : "border-stone-dk hover:border-gold"
              }`}
            >
              <span className="block font-mono text-[26px] font-bold text-fg">{decks}</span>
              <span className="block text-[10.5px] uppercase tracking-[.05em] text-fg-muted">decks</span>
              <span className="mt-1.5 block text-[14px] font-bold text-olive-dk">
                {formatMinor(rateMinor * decks, symbol)}
              </span>
              <span className="mt-0.5 block text-[10px] text-fg-muted">{rate} / deck</span>
            </button>
          );
        })}
      </div>
      <Foot>
        <BackButton onClick={onBack} />
        <ContinueButton onClick={onContinue} disabled={selected === 0}>
          Continue to payment
        </ContinueButton>
      </Foot>
    </Card>
  );
}

// ── 3b. V6 · `#acs-annual` — the annual subscription ─────────────────────────

/**
 * `.ann-step` — a −/N/+ quantity stepper.
 *
 * Mobile-first: the row it sits in is a `flex-wrap` at phone width, so the
 * stepper drops below its own label instead of squeezing it. The buttons are
 * 36 px, not V6's 30 px, because 30 px is below the 24 px minimum target with
 * no padding around it and these are the controls a customer taps on a phone
 * to add a seat. `aria-label` names the tier, so a screen reader hears
 * "Add a Premium seat", not "plus".
 */
function Stepper2({
  value,
  onChange,
  label,
  testId,
  min = 0,
}: {
  value: number;
  onChange: (next: number) => void;
  /** What is being counted, e.g. "Premium seat". */
  label: string;
  testId: string;
  min?: number;
}) {
  const btn =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] border border-stone-dk bg-surface text-[18px] leading-none text-fg " +
    "hover:border-olive hover:text-olive disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={btn}
        aria-label={`Remove a ${label}`}
        data-testid={`${testId}-minus`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span
        className="min-w-[38px] text-center font-mono text-[15px] font-bold text-fg"
        data-testid={testId}
        aria-live="polite"
        aria-label={`${value} × ${label}`}
      >
        {value}
      </span>
      <button
        type="button"
        className={btn}
        aria-label={`Add a ${label}`}
        data-testid={`${testId}-plus`}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

/** `.ann-row` — a label/sub pair with its stepper. Wraps before it overflows. */
function AnnualRow({
  title,
  sub,
  children,
}: {
  title: ReactNode;
  sub: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-[9px] flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 rounded-[10px] border border-stone-dk px-3.5 py-[11px]">
      <div className="min-w-0 basis-full min-[380px]:basis-auto">
        <b className="block text-[13px] text-fg">{title}</b>
        <span className="block text-[11px] text-fg-muted">{sub}</span>
      </div>
      {children}
    </div>
  );
}

const ANNUAL_SECTION = "mb-2 mt-4 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-muted";

/**
 * `#acs-annual` — "Your subscription starts with one Premium seat. Add more
 * seats (Standard / Pro / Premium — 10 GB storage each) and deck credit packs
 * as you need."
 *
 * Every figure is a `seat_<tier>_12` row of the published catalogue; the base
 * line is the Premium row, priced once, because the cart simply starts at
 * `premium: 1`. The running total is `annualCartQuote`, which taxes through the
 * one tax rule — this component does no arithmetic.
 *
 * **The cart can hold more than this build can order, and it says so.** A
 * single `POST /api/account/orders` carries one `planCode`, so a cart with two
 * different seat tiers has no order to place; the amber note names that and
 * Continue stays shut rather than sending one tier's code with another tier's
 * money. `quote.blocked` is the whole of that logic and it lives in
 * `accountOrder.ts` beside the order shape it is a limit of.
 */
export function AnnualSubscriptionScreen({
  book,
  currency,
  cart,
  quote,
  onSeats,
  onExtra,
  canUpgradeToEnterprise,
  onUpgradeToEnterprise,
  onEnterprisePlans,
  onBack,
  onContinue,
}: {
  book: PublishedPriceBook;
  currency: string;
  cart: AnnualCart;
  quote: AnnualCartQuote;
  onSeats: (tier: Plan, next: number) => void;
  onExtra: (credits: number) => void;
  /** V6's `#ac-ann-upgrade`, shown while the account is not an organisation. */
  canUpgradeToEnterprise: boolean;
  onUpgradeToEnterprise: () => void;
  onEnterprisePlans: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const symbol = symbolFor(book, currency);
  const money = (m: number) => formatMinor(m, symbol);
  const base = seatPlanFor(book, "premium", ANNUAL_SEAT_MONTHS);
  const baseMinor = base?.amounts[currency] ?? 0;
  const premiumRate = extraCreditRateMinor(book, "premium", currency) ?? 0;

  // No Premium annual seat priced in this currency means there is no
  // subscription to start. Say it, rather than drawing a cart that totals zero.
  if (!base || baseMinor <= 0) {
    return (
      <Card>
        <Heading title="Annual subscription" />
        <Note amber>
          An annual subscription is not sold in {currency} right now. Choose another currency, or go
          back and pick a shorter billing period.
        </Note>
        <Foot>
          <BackButton onClick={onBack} />
        </Foot>
      </Card>
    );
  }

  return (
    <Card>
      <Heading
        title="Annual subscription"
        sub={
          <>
            Your subscription starts with one Premium seat. Add more seats (Standard / Pro / Premium
            — {SEAT_STORAGE_GB} GB storage each) and deck credit packs as you need.{" "}
            <b>Set a quantity for each</b> — leave at 0 if not needed.
          </>
        }
      />

      {canUpgradeToEnterprise && (
        <div
          data-testid="ac-ann-upgrade"
          className="mt-3.5 flex flex-col gap-3 rounded-[11px] border border-gold bg-gold-lt px-[15px] py-3 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between"
        >
          <div className="text-[12.5px] leading-[1.5] text-gold-dk">
            Growing a team? Upgrade to an Enterprise account to add and manage users.
          </div>
          <button
            type="button"
            className={`${BTN_AMBER} w-full justify-center min-[560px]:w-auto min-[560px]:shrink-0`}
            onClick={onUpgradeToEnterprise}
          >
            <Building2 className="h-4 w-4" aria-hidden="true" /> Upgrade to Enterprise
          </button>
        </div>
      )}

      <div className="mb-1.5 mt-[18px] flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border-[1.5px] border-olive bg-olive-lt px-4 py-3.5 text-[13px] text-fg">
        <div className="min-w-0">
          <b className="font-bold">
            1 Premium Seat ({SEAT_STORAGE_GB} GB storage)
          </b>{" "}
          — Annual
          {base.units !== null && <> · {base.units.toLocaleString("en-IN")} Credits included</>}
        </div>
        <div className="font-mono text-[16px] font-bold text-olive-dk" data-testid="ac-ann-baseprice">
          {money(baseMinor)}
        </div>
      </div>
      <p className="my-3.5 text-[12.5px] font-semibold text-fg">
        Credits come with (equal no. of decks + reports + platform fees + ticket based support)
      </p>

      <div className={ANNUAL_SECTION}>Add seats</div>
      <div data-testid="ac-ann-seats">
        {seatTiers(book).map((tier) => {
          const plan = seatPlanFor(book, tier, ANNUAL_SEAT_MONTHS);
          const unit = plan?.amounts[currency] ?? 0;
          if (!plan || unit <= 0) return null;
          return (
            <AnnualRow
              key={tier}
              title={`${PLAN_LABELS[tier]} seat (${SEAT_STORAGE_GB} GB storage)`}
              sub={`Annual · ${money(unit)} / seat`}
            >
              <Stepper2
                value={cart.seats[tier] ?? 0}
                onChange={(next) => onSeats(tier, next)}
                label={`${PLAN_LABELS[tier]} seat`}
                testId={`ac-ann-seat-${tier}`}
              />
            </AnnualRow>
          );
        })}
      </div>

      {/* V6's "Add credit packs" rows are four fixed packs with their own
          prices. This build sells extra decks at the rate DERIVED from the
          annual seat (`extraCreditRate`), which is the one rate the server
          re-prices against, so the pack sizes come from `EXTRA_CREDIT_PACKS`
          and the money from the catalogue. V6 carries no discount anywhere, so
          nothing here claims a saving against a base rate (§8 Q1). */}
      <div className={ANNUAL_SECTION}>Add credit packs</div>
      <ExtraCredits
        testId="ac-ann-packs"
        rateMinor={premiumRate}
        symbol={symbol}
        tierName={PLAN_LABELS.premium}
        selected={cart.extraCredits}
        onToggle={onExtra}
      />

      <div
        className="mt-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-stone pt-3.5 text-[12px] text-fg-2"
        data-testid="ac-ann-total"
      >
        <span>
          Subtotal · {quote.seatsTotal} seat{quote.seatsTotal === 1 ? "" : "s"}
        </span>
        <b className="font-mono text-[20px] text-fg">{money(quote.subtotalMinor)}</b>
      </div>
      {quote.breakdown.taxed && (
        <div className="mt-1 flex justify-between text-[11.5px] text-fg-muted" data-testid="ac-ann-gst">
          <span>GST ({quote.breakdown.ratePct}%) is added at checkout</span>
          <span>{money(quote.breakdown.taxMinor)}</span>
        </div>
      )}

      {quote.blocked === "mixed_tiers" && (
        <Note amber>
          This cart mixes seat tiers, and an order carries one plan — place one tier at a time, or
          choose an Enterprise bundle below, which includes its seats.
        </Note>
      )}

      <Foot>
        <BackButton onClick={onBack} />
        <ContinueButton
          onClick={onContinue}
          disabled={quote.order === null}
          testId="ac-ann-continue"
        >
          Continue to payment
        </ContinueButton>
      </Foot>
      <div className="mt-[18px] border-t border-stone pt-3.5">
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_FULL}`}
          data-testid="ac-ann-entplans"
          onClick={onEnterprisePlans}
        >
          Enterprise Plans
        </button>
      </div>
    </Card>
  );
}

// ── 3c. V6 · `#acs-entplans` — the fixed annual bundles ──────────────────────

/**
 * "Enterprise Plans. Fixed annual bundles for larger teams — seats and credits
 * included."
 *
 * The bundles are the catalogue's `enterprise` rows — the same rows
 * `EnterpriseSeatScreen` draws for the organisation branch, reached here from
 * `#acs-annual` instead and worded as V6 words it. V6's own bundle cards carry
 * a "You save $X" pill; there is no discount anywhere else in V6 and §8 Q1
 * forbids publishing a saving derived from a base rate, so no pill is drawn.
 *
 * `quoteOrder` refuses an enterprise plan for an individual account
 * (`organization_required`), so an individual gets the upgrade route in the
 * footer instead of a Continue that the server would reject.
 */
export function EnterprisePlansScreen({
  book,
  currency,
  plans,
  planCode,
  onPlan,
  isOrganization,
  onUpgradeToEnterprise,
  onBack,
  onContinue,
}: {
  book: PublishedPriceBook;
  currency: string;
  plans: PricePlanRow[];
  planCode: string | null;
  onPlan: (code: string) => void;
  isOrganization: boolean;
  onUpgradeToEnterprise: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const symbol = symbolFor(book, currency);
  return (
    <Card>
      <Heading
        title="Enterprise Plans"
        sub="Fixed annual bundles for larger teams — seats and credits included."
      />
      <p className="mt-3.5 text-[12.5px] font-semibold text-fg">
        Credits come with (equal no. of decks + reports + platform fees + ticket/call based support)
      </p>
      {plans.length === 0 ? (
        <Note amber>
          No Enterprise bundle is on sale in {currency} right now. Choose another currency, or go
          back and build an annual subscription seat by seat.
        </Note>
      ) : (
        <div
          role="radiogroup"
          aria-label="Enterprise bundles"
          data-testid="ac-entplans"
          /* Mobile-first: one column at phone width, and `auto-fit` only once
             there is room for a 220 px card — never a fixed `min-width` that
             could push the page wider than the viewport. */
          className="mt-[18px] grid gap-3.5 min-[560px]:[grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]"
        >
          {plans.map((plan) => {
            const selected = plan.code === planCode;
            const seats = plan.seats;
            return (
              <button
                key={plan.code}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`ac-entplan-${plan.code}`}
                onClick={() => onPlan(plan.code)}
                className={`flex flex-col justify-start rounded-[13px] border-[1.5px] px-4 py-[18px] text-left transition-colors ${
                  selected ? "border-gold bg-gold-lt" : "border-stone-dk bg-surface hover:border-gold/60"
                }`}
              >
                <span className={`block text-[15px] font-semibold ${selected ? "text-gold-dk" : "text-fg"}`}>
                  {plan.name}
                </span>
                <span className={`mb-3 mt-[3px] block text-[25px] font-bold ${selected ? "text-gold-dk" : "text-fg"}`}>
                  {formatMinor(plan.amounts[currency] ?? 0, symbol)}
                  <small className="ml-1 text-[12px] font-semibold">Annual</small>
                </span>
                <Bullets
                  items={[
                    ...(seats !== null ? [`${seats} Premium seats (${SEAT_STORAGE_GB} GB storage each)`] : []),
                    ...(plan.units !== null ? [`${plan.units.toLocaleString("en-IN")} Credits`] : []),
                    "Annual billing",
                  ]}
                  className="gap-[9px] text-[12.5px]"
                />
              </button>
            );
          })}
        </div>
      )}
      {!isOrganization && plans.length > 0 && (
        <Note amber>
          Enterprise bundles are sold to organisation accounts. Add your organisation's details and
          this bundle is yours to buy.
        </Note>
      )}
      <Foot>
        <BackButton onClick={onBack} />
        {isOrganization ? (
          <ContinueButton onClick={onContinue} disabled={planCode === null} testId="ac-entplan-continue">
            Continue to pay
          </ContinueButton>
        ) : (
          <button
            type="button"
            className={BTN_AMBER}
            data-testid="ac-entplan-upgrade"
            onClick={onUpgradeToEnterprise}
          >
            <Building2 className="h-4 w-4" aria-hidden="true" /> Upgrade to Enterprise
          </button>
        )}
      </Foot>
    </Card>
  );
}

// ── 3d. V6 · `#acs-billing` — the address that decides the money ─────────────

/**
 * "Billing details … We use this to set your billing currency and generate your
 * invoice. Indian billing addresses are charged in **INR with GST**; every other
 * country is billed in **USD with no GST**."
 *
 * The screen keeps saying that, because it is the only place the customer is
 * told why their address changes their price. What it does NOT do is decide it:
 * `locale` comes from `resolveBillingLocale` in `src/shared/plans.ts`, and so
 * does the sentence under the country field (`locale.note`). The server refuses
 * an order whose currency disagrees with the saved country, so a screen that
 * answered this question for itself would produce a 400, not a difference.
 *
 * Mobile-first: one column at every width, each field a real `<label>`, the
 * footer buttons wrapping instead of shrinking. Nothing on this screen has a
 * width — it is the screen a customer is most likely to be filling on a phone.
 */
export function BillingDetailsScreen({
  draft,
  onChange,
  errors,
  locale,
  onBack,
  onContinue,
  busy,
}: {
  draft: BillingAddress;
  onChange: (patch: Partial<BillingAddress>) => void;
  errors: FieldErrors;
  /** `resolveBillingLocale(draft.country, taxSettingsOf(book.tax))`, from the caller. */
  locale: BillingLocale;
  onBack: () => void;
  onContinue: () => void;
  busy?: boolean;
}) {
  const complete = Object.keys(validateBillingAddress(draft)).length === 0;
  return (
    <Card>
      <Heading
        title="Billing details"
        sub={
          <>
            We use this to set your billing currency and generate your invoice. Indian billing
            addresses are charged in <b>INR with GST</b>; every other country is billed in{" "}
            <b>USD with no GST</b>.
          </>
        }
      />
      <div className="grid gap-0" data-testid="ac-billing">
        <Field label="Billing name" htmlFor="bill-name" error={errors.name}>
          <input
            id="bill-name"
            className={INPUT}
            autoComplete="organization"
            placeholder="Name or company to appear on the invoice"
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>
        <Field label="City" htmlFor="bill-city" error={errors.city}>
          <input
            id="bill-city"
            className={INPUT}
            autoComplete="address-level2"
            placeholder="e.g. Hyderabad"
            value={draft.city}
            onChange={(e) => onChange({ city: e.target.value })}
          />
        </Field>
        {/* V6 uses a `<datalist>`, not a `<select>`: the suggestions are a
            shortlist and a customer anywhere else must still be billable. The
            input stays free text and validation only checks it is filled. */}
        <Field
          label="Country"
          htmlFor="bill-country"
          error={errors.country}
          hint="Your country sets your currency and whether GST applies."
        >
          <input
            id="bill-country"
            className={INPUT}
            list="ac-bill-countries"
            autoComplete="country-name"
            placeholder="e.g. India"
            value={draft.country}
            onChange={(e) => onChange({ country: e.target.value })}
          />
          <datalist id="ac-bill-countries">
            {BILLING_COUNTRIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Communication address" htmlFor="bill-address" error={errors.address}>
          <textarea
            id="bill-address"
            className={INPUT}
            rows={3}
            autoComplete="street-address"
            placeholder="Street, area, postal code"
            value={draft.address}
            onChange={(e) => onChange({ address: e.target.value })}
          />
        </Field>
      </div>
      {/* `locale.note` is V6's own sentence, written once in `plans.ts` beside
          the rule that produces it. Absent until a country has been typed,
          which is exactly when V6 reveals `#bill-currency-note`. */}
      {locale.note && (
        <div data-testid="ac-billing-currency">
          <Note>
            {locale.note}
            {locale.taxed && " It is suitable for input tax credit."}
          </Note>
        </div>
      )}
      <Note>
        Your invoice is emailed to you and stays downloadable from this account. Payment itself is
        taken by Razorpay — UPI, cards, net banking or wallets — on their own secure page.
      </Note>
      <Foot>
        <BackButton onClick={onBack} />
        <ContinueButton
          onClick={onContinue}
          busy={busy}
          disabled={!complete}
          testId="ac-billing-continue"
        >
          Continue to payment
        </ContinueButton>
      </Foot>
    </Card>
  );
}

// ── 4. Payment ───────────────────────────────────────────────────────────────

const METHOD_ICONS: Record<PaymentMethod, ReactNode> = {
  upi: <Smartphone className="h-[17px] w-[17px] text-fg-2" aria-hidden="true" />,
  card: <CreditCard className="h-[17px] w-[17px] text-fg-2" aria-hidden="true" />,
  netbanking: <Landmark className="h-[17px] w-[17px] text-fg-2" aria-hidden="true" />,
  wallet: <Wallet className="h-[17px] w-[17px] text-fg-2" aria-hidden="true" />,
};

/**
 * The summary's sub-line: who is buying, and on what terms.
 *
 * v3's `renderPayment` has three branches and this has the same three: a paid
 * trial states its deck count and rate, an enterprise plan its seat count, and
 * a seat the period it is billed on.
 */
function orderSubLine(accountType: AccountType, quote: OrderQuote): string {
  const who = accountType === "organization" ? "Organization" : "Individual";
  if (isPaidTrial(quote)) return `${quote.quantity} decks`;
  if (quote.group === "enterprise") {
    return quote.plan.seats !== null
      ? `${who} · ${quote.plan.seats} Premium seats · annual`
      : `${who} · annual`;
  }
  const months = quote.plan.periodMonths;
  if (months !== null) return `${who} · per ${seatPeriodWord(months)}`;
  if (quote.group === "credit_pack") return `${who} · pay-as-you-go`;
  return `${who} · ${quote.plan.period === "year" ? "annual" : "monthly"}`;
}

/** A paid-trial order is the only one that buys MORE THAN ONE of its plan. */
function isPaidTrial(quote: OrderQuote): boolean {
  return quote.plan.code === PAID_TRIAL_CODE;
}

function planLineLabel(quote: OrderQuote): string {
  if (isPaidTrial(quote)) return `Trial credits (${quote.quantity} decks)`;
  if (quote.group === "enterprise") return "Annual plan";
  if (quote.plan.tier !== null) return `${quote.plan.name} seat`;
  if (quote.group === "credit_pack" && quote.plan.units !== null) return `${quote.plan.units} credits`;
  return "Plan";
}

/**
 * The lines v3 draws between the plan line and GST — Seats, Decks included and
 * whatever extra decks were taken. They are FACTS of the quote, not prices, so
 * they carry no money except the extras' own line.
 */
function orderDetailLines(quote: OrderQuote, money: (m: number) => string): { key: string; label: string; value: string }[] {
  if (isPaidTrial(quote)) return [];
  const out: { key: string; label: string; value: string }[] = [];
  if (quote.group === "enterprise" && quote.plan.seats !== null) {
    out.push({ key: "seats", label: "Seats", value: `${quote.plan.seats} · all Premium` });
  }
  if (quote.plan.periodMonths !== null && quote.group !== "enterprise") {
    const view = SEAT_PERIOD_VIEWS.find((v) => v.months === quote.plan.periodMonths);
    out.push({ key: "period", label: "Billing period", value: view?.label ?? seatPeriodWord(quote.plan.periodMonths) });
  }
  if (quote.plan.units !== null) {
    out.push({
      key: "decks",
      label: "Decks included",
      value: `${(quote.plan.units * quote.quantity).toLocaleString("en-IN")} decks`,
    });
  }
  if (quote.extraCredits > 0) {
    out.push({
      key: "extra",
      label:
        quote.group === "enterprise"
          ? `Extra decks (${quote.extraCredits})`
          : `Extra credits (${quote.extraCredits})`,
      value: money(quote.extraMinor),
    });
  }
  return out;
}

export function PaymentScreen({
  book,
  quote,
  accountType,
  method,
  onMethod,
  paymentConfigured,
  onPay,
  onBack,
  busy,
  error,
  billing,
}: {
  book: PublishedPriceBook;
  quote: OrderQuote;
  accountType: AccountType;
  method: PaymentMethod;
  onMethod: (m: PaymentMethod) => void;
  paymentConfigured: boolean;
  onPay: () => void;
  onBack: () => void;
  busy: boolean;
  error: string | null;
  /**
   * V6's `billToLine()` — the address `#acs-billing` captured, echoed in the
   * order summary so the customer can see which address set their currency
   * before they pay. Absent on the paths that never visit that screen.
   */
  billing?: BillingAddress | null;
}) {
  const symbol = symbolFor(book, quote.currency);
  const money = (m: number) => formatMinor(m, symbol);
  const { breakdown } = quote;
  const total = money(breakdown.totalMinor);
  return (
    <div className="mt-1.5 grid grid-cols-[1fr_296px] items-start gap-[22px] max-[680px]:grid-cols-1">
      <Card>
        <Heading title="Complete payment" sub="Choose how you'd like to pay" />
        <div role="radiogroup" aria-label="Payment method" className="mt-5">
          {PAYMENT_METHODS.map((m) => {
            const on = m.id === method;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`ac-pm-${m.id}`}
                onClick={() => onMethod(m.id)}
                className={`mb-3 flex w-full items-center gap-3 rounded-xl border px-4 py-[15px] text-left transition-colors ${
                  on ? "border-gold bg-gold-lt" : "border-stone-dk hover:border-gold/60"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`relative h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] ${
                    on ? "border-gold-dk after:absolute after:inset-[3.5px] after:rounded-full after:bg-gold-dk after:content-['']" : "border-stone-dk"
                  }`}
                />
                <span className="flex items-center gap-[9px] whitespace-nowrap text-[14px] font-semibold text-fg">
                  {METHOD_ICONS[m.id]}
                  {m.label}
                </span>
                <span className="ml-auto flex gap-1.5 max-[420px]:hidden">
                  {m.chips.map((c) => (
                    <span key={c} className="rounded-[5px] border border-stone-dk px-[7px] py-[2px] text-[10px] text-fg-2">
                      {c}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mb-3.5 mt-[18px] flex items-center gap-[7px] text-[11px] text-fg-muted">
          <Lock className="h-[14px] w-[14px] shrink-0 text-[var(--ac-green)]" aria-hidden="true" />
          Your card, UPI or bank details are entered on the payment provider's secure page — never in this application.
        </div>
        {/* V6 names the provider: "Payments secured by Razorpay". It is named,
            not integrated — `ADAPTERS` in `src/server/billing/provider.ts` is
            empty by design until pricing is final, so this line says who will
            take the payment and the button below says what happens today. No
            method row is added for it: `PaymentMethod` is persisted, and a new
            value is a schema change, not a copy change. */}
        <div className="mb-3.5 text-[11px] leading-[1.55] text-fg-muted" data-testid="ac-provider-note">
          Payments are processed by <b className="font-semibold text-fg-2">Razorpay</b> — UPI, cards,
          net banking and wallets — on their own secure page.
        </div>
        {!paymentConfigured && (
          <div className="mb-3.5 rounded-[10px] border border-gold bg-gold-lt px-4 py-[11px] text-[12px] leading-[1.55] text-gold-dk" data-testid="ac-no-provider">
            No payment provider is connected yet. Placing this order records it — nothing is charged and no
            credits are added until the payment is completed.
          </div>
        )}
        {error && (
          <div role="alert" className="mb-3.5 rounded-[10px] border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-[11px] text-[12px] text-signal-flagged">
            {error}
          </div>
        )}
        <button type="button" className={`${BTN_GO} ${BTN_FULL}`} onClick={onPay} disabled={busy} data-testid="ac-pay">
          <Lock className="h-4 w-4" aria-hidden="true" />
          {busy ? "Recording order…" : paymentConfigured ? `Pay ${total} & activate plan` : `Place order · ${total}`}
        </button>
        <div className="mt-3.5 text-center">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" /> Back to plan selection
          </button>
        </div>
      </Card>

      <aside aria-label="Order summary" data-testid="ac-order-summary" className="rounded-[14px] border border-stone bg-surface p-5">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-[.07em] text-fg-muted">Order summary</div>
        <div className="flex items-center gap-3 border-b border-stone pb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-[9px] bg-gold-lt text-gold-dk">
            <Crown className="h-[19px] w-[19px]" aria-hidden="true" />
          </span>
          <div>
            <b className="block text-[14px] text-fg">{quote.plan.name}</b>
            <div className="text-[11.5px] text-fg-muted">{orderSubLine(accountType, quote)}</div>
          </div>
        </div>
        <div className="mt-[13px] flex justify-between text-[13px] text-fg-2">
          <span>{planLineLabel(quote)}</span>
          <b className="text-fg">{money(quote.amountMinor * quote.quantity)}</b>
        </div>
        {orderDetailLines(quote, money).map((line) => (
          <div
            key={line.key}
            className="mt-[13px] flex justify-between text-[13px] text-fg-2"
            data-testid={`ac-line-${line.key}`}
          >
            <span>{line.label}</span>
            <b className="text-fg">{line.value}</b>
          </div>
        ))}
        {breakdown.taxed ? (
          <div className="mt-[13px] flex justify-between text-[13px] text-fg-2" data-testid="ac-gst-line">
            <span>GST ({breakdown.ratePct}%){breakdown.inclusive ? " incl." : ""}</span>
            <b className="text-fg">{money(breakdown.taxMinor)}</b>
          </div>
        ) : (
          <div className="mt-[13px] flex justify-between text-[13px] text-fg-2" data-testid="ac-untaxed-line">
            <span>Local taxes</span>
            <b className="text-fg">Not included</b>
          </div>
        )}
        {billing && (billing.city.trim() || billing.country.trim()) && (
          <div className="mt-[13px] flex justify-between gap-3 text-[12.5px] text-fg-muted" data-testid="ac-line-billto">
            <span>Billing to</span>
            <b className="text-right font-semibold text-fg-2">
              {[billing.city.trim(), billing.country.trim()].filter(Boolean).join(", ")}
            </b>
          </div>
        )}
        <div className="mt-[15px] flex items-baseline justify-between border-t border-stone pt-3.5">
          <span className="text-[15px] font-bold text-fg">Total</span>
          <span className="text-[19px] font-bold text-fg" data-testid="ac-total">
            {total}
          </span>
        </div>
        <div className="mt-[5px] text-right text-[10.5px] text-fg-muted">
          {breakdown.taxed ? "GST-compliant invoice provided" : "Exclusive of local taxes"}
        </div>
        {/* v3's `.free` line states what the ORDER grants, not what the free
            trial does — `renderPayment` prints "N decks available with your
            plan" and, for a paid trial, "N decks · credits never expire". */}
        {quote.unitsTotal !== null && quote.unitsTotal > 0 && (
          <div
            data-testid="ac-decks-line"
            className="mt-[15px] flex items-center gap-2 rounded-[9px] border border-[var(--ac-green)] bg-[var(--ac-green-lt)] px-[13px] py-[11px] text-[11.5px] text-[var(--ac-green-dk)]"
          >
            <CircleCheck className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
            {isPaidTrial(quote)
              ? `${quote.unitsTotal.toLocaleString("en-IN")} decks · credits never expire`
              : `${quote.unitsTotal.toLocaleString("en-IN")} decks available with your plan`}
          </div>
        )}
      </aside>
    </div>
  );
}

// ── 5. Receipt ───────────────────────────────────────────────────────────────

function successTitle(order: AccountOrderView): string {
  if (order.status === "completed") return "Payment successful";
  if (order.status === "redirected") return "Continue to payment";
  if (order.status === "failed") return "Payment could not be started";
  return "Order recorded";
}

export function ReceiptScreen({
  book,
  brand,
  order,
  documentUrl,
  onDashboard,
  onTeam,
}: {
  book: PublishedPriceBook;
  /** The workspace's written product name (W4-B branding), e.g. "ai.STARTUPJURY". */
  brand: string;
  order: AccountOrderView;
  documentUrl: string;
  onDashboard: () => void;
  /**
   * V6's `#acs-team`, which nothing in the mockup's drawn flow reaches (see
   * `TeamScreen`). The success screen's own step 2 is "Invite team members", so
   * the receipt is where this build offers it — for organisation accounts only,
   * because that is the audience V6 gives the screen to ("enterprise only").
   */
  onTeam?: () => void;
}) {
  const symbol = symbolFor(book, order.currency);
  const method = PAYMENT_METHODS.find((m) => m.id === order.paymentMethod);
  const rows: Array<{ k: string; v: ReactNode; testId?: string }> = [
    { k: "Plan", v: `${order.planName} · ${order.accountType === "organization" ? "Organization" : "Individual"}` },
    {
      k: order.status === "completed" ? "Amount paid" : "Amount due",
      testId: "ac-receipt-amount",
      v: (
        <>
          {formatMinor(order.totalMinor, symbol)} <small className="font-normal text-fg-muted">{order.taxed ? "(incl. GST)" : "(excl. local taxes)"}</small>
        </>
      ),
    },
    { k: "Reference ID", v: <span className="font-mono text-[12px]">{order.id}</span>, testId: "ac-receipt-ref" },
    { k: "Billing cycle", v: billingCycleLine(order.period, order.periodMonths) },
    { k: "Payment method", v: method ? `${method.label} · on the provider's page` : "—" },
    { k: "Status", v: orderStatusLabel(order.status), testId: "ac-receipt-status" },
  ];
  // v3 made `ac-suc-decks` dynamic: the row states what THIS ORDER grants, not
  // a constant three. An order that grants nothing metered has no row at all.
  if (order.units !== null && order.units > 0) {
    rows.splice(4, 0, {
      k: "Decks",
      testId: "ac-receipt-decks",
      v: `${order.units.toLocaleString("en-IN")} decks ready to use`,
    });
  }

  return (
    <Card className="text-center">
      <div className="mx-auto mb-[18px] mt-1.5 flex h-[74px] w-[74px] items-center justify-center rounded-full border-2 border-[var(--ac-green)] bg-[var(--ac-green-lt)] text-[var(--ac-green)]">
        <Check className="h-9 w-9" aria-hidden="true" />
      </div>
      <h1 className="text-[25px] font-bold text-fg">{successTitle(order)}</h1>
      <div className="mt-[7px] text-[13.5px] leading-[1.55] text-fg-muted">
        {order.status === "completed" ? (
          <>Your {order.planName} plan is now active.</>
        ) : (
          <>Your {order.planName} order is recorded — nothing has been charged yet.</>
        )}
        <br />
        Welcome to {brand}.
      </div>

      <dl className="my-6 rounded-xl bg-offwhite px-5 py-1.5 text-left" data-testid="ac-receipt">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center justify-between gap-4 border-b border-stone py-[13px] text-[13px] last:border-b-0">
            <dt className="text-fg-muted">{r.k}</dt>
            <dd className="text-right font-semibold text-fg" data-testid={r.testId}>
              {r.v}
            </dd>
          </div>
        ))}
      </dl>

      {order.checkoutUrl && (
        <a href={order.checkoutUrl} rel="noopener noreferrer" className={`${BTN_GO} ${BTN_FULL} mb-6`}>
          <Lock className="h-4 w-4" aria-hidden="true" /> Continue to secure payment
        </a>
      )}

      <div className="mb-3.5 text-left text-[11px] font-semibold uppercase tracking-[.07em] text-fg-muted">
        What happens next? Go to &ldquo;Set up&rdquo;:
      </div>
      {[
        <>
          <b className="text-fg">Configure your programmes</b> — add the sectors, programmes and cohorts your
          workspace runs on
        </>,
        <>
          <b className="text-fg">Invite team members</b> — add colleagues and assign their roles in{" "}
          <b className="text-fg">Admin console → Team &amp; roles</b>
        </>,
        <>
          Once done, go to <b className="text-fg">Upload</b> on the sidebar and start working on your decks
        </>,
      ].map((p, i) => (
        <div key={i} className="mb-[15px] flex items-start gap-3 text-left">
          <span className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-gold text-[11px] font-semibold text-gold-dk">
            {i + 1}
          </span>
          <p className="text-[13px] leading-[1.55] text-fg-2">{p}</p>
        </div>
      ))}

      <div className="mt-[18px] flex gap-[9px] rounded-[10px] border border-stone-dk bg-offwhite px-4 py-[13px] text-left text-[12px] leading-[1.55] text-fg-2">
        <Mail className="mt-px h-[15px] w-[15px] shrink-0 text-[var(--ac-green)]" aria-hidden="true" />
        {order.taxed
          ? "A GST-compliant tax invoice, suitable for input tax credit, is emailed to your registered address and stays downloadable here — issued once payment is confirmed. The pro-forma below records this order."
          : "Your invoice is emailed to your registered address and stays downloadable here. The pro-forma below records this order; international prices are exclusive of local taxes."}
      </div>
      <div className="mt-[22px] flex flex-col gap-[11px]">
        <button type="button" className={`${BTN_GO} ${BTN_FULL}`} onClick={onDashboard}>
          Go to dashboard <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        {onTeam && (
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_FULL}`}
            data-testid="ac-receipt-team"
            onClick={onTeam}
          >
            Add your team <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <a href={documentUrl} download className={`${BTN_GHOST} ${BTN_FULL}`} data-testid="ac-download-invoice">
          <Download className="h-4 w-4" aria-hidden="true" /> Download pro-forma invoice
        </a>
      </div>
    </Card>
  );
}

// ── 6. V6 · `#acs-team` — add your team ──────────────────────────────────────

/**
 * "Add your team. Invite colleagues and assign their roles."
 *
 * **Where this screen sits, and why that is a decision.** V6 lists `team` in
 * `SCREENS` and renders it with `renderTeam()`, but the only call that navigates
 * to it is `acRoleNext()` — and the Role screen is commented "removed from
 * flow", so nothing in the drawn mockup reaches it. Its own footer is "Skip for
 * now" / "Confirm & go to dashboard", both `acctClose()`, and V6's success
 * screen says "Invite team members — add colleagues and assign their roles from
 * the dashboard". So it is a POST-PURCHASE step, and this build reaches it from
 * the receipt for an organisation account. Recorded in `docs/parity-requests/`.
 *
 * The invites are client-side, exactly as `aetMembers` is in V6 — there is no
 * route that creates a pending member yet, which is noted in the handoff. The
 * screen therefore never claims an invitation was sent.
 *
 * Mobile-first: the add-member row is one stacked column at phone width and
 * only becomes V6's `1fr 200px auto` grid at 640 px; the member list is cards,
 * not a table, so there is nothing to scroll sideways.
 */
export function TeamScreen({
  tierId,
  onTier,
  members,
  onAdd,
  onRemove,
  onParam,
  draftEmail,
  draftRole,
  onDraftEmail,
  onDraftRole,
  error,
  onSkip,
  onConfirm,
}: {
  tierId: TeamSeatTierId;
  onTier: (id: TeamSeatTierId) => void;
  members: TeamInvite[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onParam: (index: number, slot: 0 | 1 | 2, value: string) => void;
  draftEmail: string;
  draftRole: string;
  onDraftEmail: (v: string) => void;
  onDraftRole: (v: string) => void;
  error?: string;
  onSkip: () => void;
  onConfirm: () => void;
}) {
  const tier = teamSeatTier(tierId);
  const full = teamSeatsFull(tierId, members.length);
  return (
    <Card>
      <Heading
        title="Add your team"
        sub="Invite colleagues and assign their roles. All enterprise users are on Pro — configurable parameters are available to everyone."
      />

      <div
        data-testid="ac-team-planbar"
        className="mt-[18px] flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl border border-stone-dk bg-offwhite px-4 py-3.5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-gold-lt text-gold-dk">
          <Building2 className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 basis-full min-[420px]:basis-auto">
          <b className="block text-[13.5px] text-fg">{tier.name}</b>
          <span className="block text-[11.5px] text-fg-muted">{tier.sub}</span>
        </div>
        <span
          data-testid="ac-team-seats"
          className="rounded-full border border-stone-dk bg-surface px-2.5 py-[3px] text-[11px] font-semibold text-fg-2"
        >
          {teamSeatLabel(tierId, members.length)}
        </span>
      </div>

      <div role="radiogroup" aria-label="Preview plan" className="mt-3.5 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-fg-muted">Preview plan:</span>
        {TEAM_SEAT_TIERS.map((t) => {
          const on = t.id === tierId;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`ac-team-pill-${t.id}`}
              onClick={() => onTier(t.id)}
              className={`rounded-full border px-3 py-1 text-[12px] ${
                on ? "border-fg font-semibold text-fg" : "border-stone-dk bg-surface text-fg-2 hover:border-gold"
              }`}
            >
              {t.pill}
            </button>
          );
        })}
      </div>

      <Note amber>
        All enterprise users are on Pro — every team member can set their own 3 configurable
        parameters from day one.
      </Note>

      {/* Mobile-first: stacked at phone width, V6's three-column row from 640px. */}
      <div className="mt-5 grid items-end gap-3.5 min-[640px]:[grid-template-columns:1fr_200px_auto]">
        <div>
          <label htmlFor="ac-team-email" className="mb-[7px] block text-[12.5px] font-semibold text-fg">
            Work email
          </label>
          <input
            id="ac-team-email"
            className={INPUT}
            type="email"
            placeholder="colleague@company.com"
            value={draftEmail}
            onChange={(e) => onDraftEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ac-team-role" className="mb-[7px] block text-[12.5px] font-semibold text-fg">
            Role
          </label>
          <select
            id="ac-team-role"
            className={INPUT}
            value={draftRole}
            onChange={(e) => onDraftRole(e.target.value)}
          >
            {TEAM_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className={`${BTN_GHOST} w-full justify-center min-[640px]:w-auto`}
          data-testid="ac-team-add"
          onClick={onAdd}
          disabled={full}
        >
          Add
        </button>
      </div>
      {error && (
        <div role="alert" className="mt-2.5 text-[12px] text-signal-flagged" data-testid="ac-team-error">
          {error}
        </div>
      )}
      {full && (
        <div className="mt-2.5 text-[12px] text-gold-dk" data-testid="ac-team-seatfull">
          All seats on this plan are in use. Upgrade to add more members.
        </div>
      )}

      <div className="my-5 border-t border-stone" />

      <ul className="flex flex-col gap-3" data-testid="ac-team-members">
        {members.map((m, i) => (
          <li key={`${m.email}-${i}`} className="rounded-xl border border-stone-dk px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-olive-lt font-mono text-[12px] font-bold text-olive-dk"
              >
                {teamInitials(m.email)}
              </span>
              <div className="min-w-0 flex-1 basis-full min-[420px]:basis-auto">
                <b className="block truncate text-[13px] text-fg">{m.email}</b>
                <span className="block text-[11.5px] text-fg-muted">{m.role}</span>
              </div>
              <span className="rounded-[5px] border border-gold bg-gold-lt px-[7px] py-[2px] text-[10px] font-semibold text-gold-dk">
                Pro
              </span>
              <button
                type="button"
                className={`${BTN_GHOST} px-4 py-[7px]`}
                data-testid={`ac-team-remove-${i}`}
                onClick={() => onRemove(i)}
              >
                Remove
              </button>
            </div>
            <div className="mt-3.5">
              <div className="mb-2 text-[12.5px] font-semibold text-fg">
                Their 3 configurable parameters
              </div>
              {([0, 1, 2] as const).map((slot) => (
                <div key={slot} className="mb-2.5">
                  <label
                    htmlFor={`ac-team-param-${i}-${slot}`}
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.04em] text-fg-muted"
                  >
                    Parameter {slot + 1}{" "}
                    <span className="font-normal normal-case tracking-normal">
                      — their own evaluation lens
                    </span>
                  </label>
                  <input
                    id={`ac-team-param-${i}-${slot}`}
                    className={INPUT}
                    placeholder="e.g. Founder resilience"
                    value={m.params[slot]}
                    onChange={(e) => onParam(i, slot, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {/* Nothing has been sent: there is no route that creates a pending
          member yet, so the screen states what it holds rather than implying
          an invitation went out. */}
      <Note>
        These members are held with your order. Invitations are sent from{" "}
        <b>Admin console → Team &amp; roles</b> once your subscription is active.
      </Note>

      <Foot>
        <button type="button" className={BTN_GHOST} data-testid="ac-team-skip" onClick={onSkip}>
          Skip for now
        </button>
        <ContinueButton onClick={onConfirm} testId="ac-team-confirm">
          Confirm &amp; go to dashboard
        </ContinueButton>
      </Foot>
    </Card>
  );
}
