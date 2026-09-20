import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useBranding } from "../../theme/useBranding";
import { INTAKE_FIELD_LABELS, missingIntakeFields } from "../../../shared/intake";
import { CREDITS_PER_DECK, MAX_DECK_SIZE_LABEL, creditsLabel } from "../../../shared/uploadReview";
import type { SingleDetails, UploadMethod } from "./types";

/**
 * The upload wizard (`#up-wizard`, `panel-upload.html:131-248`, F0224): the
 * brand line, the Org type → Configure → Select → Upload stepper, the credits
 * bar, the five credits-flow chips and the three radio-accordion methods.
 *
 * Presentational: `UploadPage` owns every piece of state, so the review screen
 * and the wizard stay two views of one staged list.
 */

export const STAGES = ["Pre-seed", "Seed", "Series A", "Series B+"];

export const FLOW_CHIPS = ["Credits required", "Cost preview", "You approve", "Credits deducted", "AI evaluates"];

export const CRM_PROVIDERS = ["Salesforce", "HubSpot", "Pipedrive", "Other API"];

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface CohortGroup {
  label: string;
  options: ChoiceOption[];
}

export interface WizardProps {
  creditsBar: ReactNode;
  method: UploadMethod;
  onMethod: (m: UploadMethod) => void;

  singleFile: { name: string; size: number } | null;
  onSingleFiles: (files: File[]) => void;
  details: SingleDetails;
  onDetails: (patch: Partial<SingleDetails>) => void;

  sector: string;
  sectorOptions: ChoiceOption[];
  onSector: (v: string) => void;
  cohort: string;
  cohortGroups: CohortGroup[];
  onCohort: (v: string) => void;

  bulkFiles: { name: string; size: number }[];
  onBulkFiles: (files: File[]) => void;
  bulkNotes: string[];
  bulkBusy: boolean;

  crm: ReactNode;

  uploadedCount: number;
  notice: string | null;
  onViewDetails: () => void;
  onReview: () => void;
  /**
   * V3 item 8 renames the forward button "Evaluate & Go to Dashboard →" for the
   * incubator superuser. Optional, so every other role — and the VC edition,
   * which was not rescoped — keeps "Go to dashboard →" unchanged.
   */
  forwardLabel?: string;
}

export function Wizard(props: WizardProps) {
  const { branding } = useBranding();
  return (
    <div className="flex min-h-full items-start justify-center bg-stone px-5 py-7">
      <div className="w-full max-w-[560px]">
        <div className="mb-5 text-center text-[14px] font-semibold tracking-[-0.01em] text-navy" data-testid="up-brand">
          {branding.wordmarkPrefix ? `${branding.wordmarkPrefix}.` : ""}
          <span className="text-gold-dk">{branding.wordmark}</span>
        </div>

        <Stepper />

        <div className="rounded-[14px] border border-stone-dk bg-surface px-[22px] pb-[18px] pt-[22px]">
          <h1 className="mb-1 text-[18px] font-semibold tracking-[-0.02em] text-navy">Upload your first pitchdecks</h1>
          <p className="mb-4 text-[12px] leading-[1.5] text-fg-2">
            Choose how you&rsquo;d like to bring in decks. Each deck evaluated uses one credit.
          </p>

          {props.creditsBar}

          <div className="mb-3.5 flex flex-wrap items-center gap-1" data-testid="up-flow-bar">
            {FLOW_CHIPS.map((chip, i) => (
              <span key={chip} className="contents">
                {i > 0 && <span className="shrink-0 text-[12px] text-stone-dk" aria-hidden="true">→</span>}
                <span className="whitespace-nowrap rounded-[20px] border border-stone-dk bg-surface px-[11px] py-1 text-[11px] font-medium text-fg-2">
                  {chip}
                </span>
              </span>
            ))}
          </div>

          <div role="radiogroup" aria-label="Upload method">
            <MethodCard
              id="single"
              title="Single upload"
              sub="Upload one pitchdeck at a time · PDF"
              badge={creditsLabel(CREDITS_PER_DECK)}
              open={props.method === "single"}
              onOpen={() => props.onMethod("single")}
            >
              <SingleBody {...props} />
            </MethodCard>
            <MethodCard
              id="bulk"
              title="Bulk upload"
              sub="ZIP file of decks, or several PDFs at once"
              badge="N credits"
              open={props.method === "bulk"}
              onOpen={() => props.onMethod("bulk")}
            >
              <BulkBody {...props} />
            </MethodCard>
            <MethodCard
              id="crm"
              title="Upload from CRM"
              sub="Auto-sync deals matching your filter rules"
              badge="Pro only"
              pro
              open={props.method === "crm"}
              onOpen={() => props.onMethod("crm")}
            >
              {props.crm}
            </MethodCard>
          </div>

          {props.notice && (
            <p role="status" className="mt-3 text-[11.5px] font-medium text-olive-dk">
              {props.notice}
            </p>
          )}

          <div className="mb-3.5 mt-4 h-px bg-stone-dk" />
          <div className="flex items-center justify-between">
            <Link to="/app/alldecks" className={BTN_BACK}>
              ← Back
            </Link>
            <div className="flex items-center gap-2">
              {props.uploadedCount > 0 && (
                <button type="button" className={BTN_NEXT} onClick={props.onViewDetails}>
                  View uploaded details →
                </button>
              )}
              <button type="button" className={BTN_NEXT} onClick={props.onReview}>
                {props.forwardLabel ?? "Go to dashboard →"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const BTN_BACK =
  "flex items-center gap-1.5 rounded-[9px] border-[1.5px] border-stone-dk bg-surface px-4 py-[9px] text-[13px] font-medium text-fg-2 hover:border-fg-muted";
const BTN_NEXT =
  "flex items-center gap-1.5 rounded-[9px] bg-olive-dk px-[18px] py-[9px] text-[13px] font-semibold text-white";

/** `.up-steps` — the first three steps done, Upload active. */
function Stepper() {
  const steps = ["Org type", "Configure", "Select", "Upload"];
  return (
    <ol className="mb-6 flex items-center justify-center" data-testid="up-steps" aria-label="Setup progress">
      {steps.map((label, i) => {
        const active = i === steps.length - 1;
        return (
          <li
            key={label}
            className="relative flex flex-1 flex-col items-center gap-[5px]"
            aria-current={active ? "step" : undefined}
          >
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute top-[15px] h-[1.5px] bg-olive-dk"
                style={{ left: "calc(50% + 18px)", right: "calc(-50% + 18px)" }}
              />
            )}
            <span
              className={`relative z-[1] flex h-[30px] w-[30px] items-center justify-center rounded-full border-[1.5px] bg-stone text-[11px] font-semibold ${
                active ? "border-gold-dk text-gold-dk" : "border-olive-dk text-olive-dk"
              }`}
            >
              {active ? (
                "4"
              ) : (
                <svg viewBox="0 0 14 14" fill="none" width="13" height="13" aria-hidden="true">
                  <rect x="1" y="1" width="12" height="12" rx="2" stroke="var(--olive-dk)" strokeWidth="1.4" />
                </svg>
              )}
            </span>
            <span className={`text-[11px] ${active ? "font-semibold text-gold-dk" : "text-olive-dk"}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** `.up-um` — one radio-accordion method card. */
function MethodCard({
  id,
  title,
  sub,
  badge,
  pro,
  open,
  onOpen,
  children,
}: {
  id: UploadMethod;
  title: string;
  sub: string;
  badge: string;
  pro?: boolean;
  open: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={`up-um-${id}`}
      className={`mb-2 overflow-hidden rounded-[10px] border-[1.5px] transition-colors ${open ? "border-gold-dk" : "border-stone-dk"}`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={open}
        onClick={onOpen}
        className={`flex w-full items-center gap-2.5 px-[13px] py-3 text-left ${open ? "bg-[#FDF6EB]" : "bg-surface"}`}
      >
        <span
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${open ? "border-gold-dk" : "border-stone-dk"}`}
          aria-hidden="true"
        >
          {open && <span className="h-[9px] w-[9px] rounded-full bg-gold-dk" />}
        </span>
        <span className="flex-1">
          <span className={`block text-[13px] font-semibold ${open ? "text-gold-dk" : "text-navy"}`}>{title}</span>
          <span className={`mt-px block text-[11px] ${open ? "text-gold-dk" : "text-fg-muted"}`}>{sub}</span>
        </span>
        <span
          className={`whitespace-nowrap rounded-[5px] px-2 py-[3px] text-[10px] font-semibold ${
            pro ? "bg-[#FAEEDA] text-gold-dk" : "bg-stone text-olive-dk"
          }`}
        >
          {badge}
        </span>
      </button>
      {open && <div className="border-t border-stone bg-surface px-[13px] pb-[13px] pt-[15px]">{children}</div>}
    </div>
  );
}

/** `.up-dropzone` — click to browse, or drag files onto it (F0314). */
export function Dropzone({
  multiple,
  accept,
  onFiles,
  title,
  hint,
  label,
}: {
  multiple?: boolean;
  accept: string;
  onFiles: (files: File[]) => void;
  title: ReactNode;
  hint: ReactNode;
  label: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      data-testid="up-dropzone"
      data-drag={over ? "over" : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={`mb-3 block cursor-pointer rounded-lg border-[1.5px] border-dashed px-[18px] py-[26px] text-center transition-all hover:border-gold-dk hover:bg-offwhite ${
        over ? "border-gold-dk bg-offwhite" : "border-stone-dk"
      }`}
    >
      <span className="mx-auto mb-[9px] flex h-[30px] w-[30px] items-center justify-center rounded-md border border-stone-dk bg-stone" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </span>
      <span className="mb-0.5 block text-[12px] text-fg-2">{title}</span>
      <span className="block text-[11px] font-medium text-gold-dk">{hint}</span>
      <input
        type="file"
        aria-label={label}
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-fg-2">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

const INPUT =
  "w-full rounded-[7px] border border-stone-dk bg-surface px-2.5 py-2 text-[12.5px] text-navy outline-none focus:border-gold-dk";

function ContextFields({ sector, sectorOptions, onSector, cohort, cohortGroups, onCohort }: WizardProps) {
  const [other, setOther] = useState(false);
  const known = sectorOptions.some((o) => o.value === sector);
  const showOther = other || (sector !== "" && !known);
  return (
    <>
      <Field label="Sector">
        {(id) =>
          showOther ? (
            <div className="flex gap-1.5">
              <input id={id} className={INPUT} value={sector} placeholder="Type a sector" onChange={(e) => onSector(e.target.value)} />
              <button
                type="button"
                className="shrink-0 text-[11px] text-fg-muted underline"
                onClick={() => {
                  setOther(false);
                  onSector(sectorOptions[0]?.value ?? "");
                }}
              >
                List
              </button>
            </div>
          ) : (
            <select
              id={id}
              className={INPUT}
              value={sector}
              onChange={(e) => {
                if (e.target.value === "__other") {
                  setOther(true);
                  onSector("");
                } else onSector(e.target.value);
              }}
            >
              <option value="">No sector</option>
              {sectorOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value="__other">Other…</option>
            </select>
          )
        }
      </Field>
      <Field label="Cohort">
        {(id) => (
          <select id={id} className={INPUT} value={cohort} onChange={(e) => onCohort(e.target.value)}>
            <option value="">No cohort</option>
            {cohortGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </Field>
    </>
  );
}

function SingleBody(props: WizardProps) {
  const { singleFile, onSingleFiles, details, onDetails } = props;
  const [open, setOpen] = useState(false);
  const gaps = missingIntakeFields(details);
  return (
    <>
      <Dropzone
        accept="application/pdf"
        label="Choose a pitch deck"
        onFiles={onSingleFiles}
        title={singleFile ? <strong className="font-medium text-navy">{singleFile.name}</strong> : "Drag & drop your pitchdeck here"}
        hint={singleFile ? "Click to change" : `PDF · Max ${MAX_DECK_SIZE_LABEL}`}
      />
      <div className="mb-[9px] grid grid-cols-2 gap-[9px]">
        <Field label="Startup name">
          {(id) => (
            <input id={id} className={INPUT} value={details.name} placeholder="e.g. GreenGrid Energy" onChange={(e) => onDetails({ name: e.target.value })} />
          )}
        </Field>
        <Field label="Stage">
          {(id) => (
            <select id={id} className={INPUT} value={details.stage} onChange={(e) => onDetails({ stage: e.target.value })}>
              <option value="">Auto-detect from deck</option>
              {STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="mb-[9px] grid grid-cols-2 gap-[9px]">
        <ContextFields {...props} />
      </div>

      {/* Session 5 / issue 12 — the founder columns the AI reads off the deck.
          Anything typed wins; anything neither supplies marks it Incomplete. */}
      <div className="mb-[9px] rounded-[7px] border border-stone-dk">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-2.5 py-2 text-left text-[11.5px] font-medium text-fg-2"
        >
          <span>Required founder details</span>
          <span className="text-[11px] font-normal text-fg-muted">
            {gaps.length === 0 ? "All supplied" : "Extracted from the deck — fill anything it may not state"} {open ? "▴" : "▾"}
          </span>
        </button>
        {open && (
          <div className="border-t border-stone px-2.5 pb-2.5 pt-2">
            <div className="grid grid-cols-2 gap-[9px]">
              <Field label={`${INTAKE_FIELD_LABELS.founder} *`}>
                {(id) => <input id={id} className={INPUT} value={details.founder} placeholder="e.g. Meera Sharma" onChange={(e) => onDetails({ founder: e.target.value })} />}
              </Field>
              <Field label={`${INTAKE_FIELD_LABELS.founderEmail} *`}>
                {(id) => <input id={id} type="email" className={INPUT} value={details.founderEmail} placeholder="founder@startup.com" onChange={(e) => onDetails({ founderEmail: e.target.value })} />}
              </Field>
              <Field label={`${INTAKE_FIELD_LABELS.founderPhone} *`}>
                {(id) => <input id={id} className={INPUT} value={details.founderPhone} placeholder="+91 98450 12345" onChange={(e) => onDetails({ founderPhone: e.target.value })} />}
              </Field>
              <Field label={`${INTAKE_FIELD_LABELS.city} *`}>
                {(id) => <input id={id} className={INPUT} value={details.city} placeholder="e.g. Bengaluru" onChange={(e) => onDetails({ city: e.target.value })} />}
              </Field>
            </div>
            {gaps.length > 0 && (
              <p className="mt-2 text-[11px] text-fg-muted">
                The AI will look for {gaps.map((f) => INTAKE_FIELD_LABELS[f].toLowerCase()).join(", ")} in the deck. Any
                detail it can&rsquo;t capture marks the deck Incomplete. Sector comes from your workspace, never the deck.
              </p>
            )}
          </div>
        )}
      </div>

      <CostBar label="Cost for this deck" credits={CREDITS_PER_DECK} />
    </>
  );
}

function BulkBody(props: WizardProps) {
  const { bulkFiles, onBulkFiles, bulkNotes, bulkBusy } = props;
  return (
    <>
      <Dropzone
        multiple
        accept="application/pdf,application/zip,.zip"
        label="Choose a ZIP or several pitch decks"
        onFiles={onBulkFiles}
        title={
          bulkBusy
            ? "Reading the archive…"
            : bulkFiles.length > 0
              ? <strong className="font-medium text-navy">{bulkFiles.length} deck{bulkFiles.length === 1 ? "" : "s"} ready to review</strong>
              : "Drop a ZIP containing multiple pitchdecks"
        }
        hint={`or choose several PDFs · Max ${MAX_DECK_SIZE_LABEL} each`}
      />
      {bulkNotes.length > 0 && (
        <ul className="mb-2 flex flex-col gap-0.5 text-[11px] text-signal-flagged" data-testid="up-bulk-notes">
          {bulkNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="mb-[9px] grid grid-cols-2 gap-[9px]">
        <ContextFields {...props} />
      </div>
      <p className="mb-[9px] text-[11px] leading-[1.5] text-fg-muted">
        No per-deck form on a bulk upload — the cohort and sector above are applied to every deck, and the AI reads each
        startup&rsquo;s name and the founder&rsquo;s name, email, phone and city off the deck.
      </p>
      {bulkFiles.length > 0 && <CostBar label="Cost for this batch" credits={bulkFiles.length * CREDITS_PER_DECK} />}
      <div className="mt-2 flex items-start gap-[7px] rounded-[7px] border bg-[#FDF6EB] px-[11px] py-[9px] text-[11.5px] leading-[1.5] text-gold-dk" style={{ borderColor: "rgba(186,119,23,.3)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" className="mt-px shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        A cost preview is shown before submission — you see the total credit cost and approve before any credits are
        deducted.
      </div>
    </>
  );
}

/** `.up-cost-bar` — credits only; §8 Q1 retired the per-deck rupee figure. */
export function CostBar({ label, credits }: { label: string; credits: number }) {
  return (
    <div
      data-testid="up-cost-bar"
      className="mt-0.5 flex items-center justify-between rounded-[7px] border border-[#A8DCC2] bg-olive-lt px-3 py-[9px]"
    >
      <span className="text-[12px] font-medium text-olive-dk">{label}</span>
      <span className="text-[12px] font-semibold text-olive-dk">{creditsLabel(credits)}</span>
    </div>
  );
}
