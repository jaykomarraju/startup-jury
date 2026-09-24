import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  createQuery,
  getConfigSummary,
  listDecks,
  listParameters,
  listPrograms,
  uploadBulk,
  uploadSingle,
  type ConfigSummary,
  type ProgramsResponse,
} from "../api";
import { useAuth } from "../auth/useAuth";
import { usePermissions } from "../auth/usePermissions";
import { useActiveContext } from "../activeContext";
import { getPublishedCatalogue } from "./account/accountApi";
import { canAccessNav } from "../../shared/nav";
import { PLAN_LABELS } from "../../shared/plans";
import { MAX_DECK_PDF_BYTES, resolveIntakeSector } from "../../shared/intake";
import {
  STAGED_ISSUE_LABELS,
  batchCostPreview,
  composeUploadQuery,
  creditsMeterPct,
  creditsSubline,
  provisionalDeckName,
  stagedDeckIssues,
  type FlagSignal,
} from "../../shared/uploadReview";
import { CreditsBar } from "./upload/CreditsBar";
import { CrmMethod } from "./upload/CrmMethod";
import { DeckDetails } from "./upload/DeckDetails";
import { FounderUpload } from "./upload/FounderUpload";
import { ResultsScreen } from "./upload/ResultsScreen";
import { ReviewScreen, isUploadable } from "./upload/ReviewScreen";
import { Wizard, type ChoiceOption, type CohortGroup } from "./upload/Wizard";
import { countPdfPages } from "./upload/stagedPdf";
import { isV3Up } from "./upload/v3Up";
import { expandZip, isZipFile } from "./upload/zip";
import type { IntakeContextDraft, SingleDetails, StagedDeck, UploadMethod } from "./upload/types";

type View = "wizard" | "review" | "results";

const EMPTY_DETAILS: SingleDetails = { name: "", stage: "", founder: "", founderEmail: "", founderPhone: "", city: "" };

interface Draft {
  name: string;
  size: number;
  file: File | null;
}

/** How long the results follow the AI before giving up (150 × 4 s = 10 min). */
const POLL_MS = 4000;
const POLL_LIMIT = 150;

/**
 * Upload (Evaluation → Upload) — W7-B, the prototype's three views of one batch:
 *
 *   1. **The wizard** (`#up-wizard`) — the credits bar, the credits-flow chips and
 *      the three radio-accordion methods. Choosing files stages them; nothing is
 *      stored.
 *   2. **Review uploaded decks** (`#up-review`) — tick, mark incomplete, preview,
 *      see the batch's credit cost, and approve with "Upload selected decks".
 *      Afterwards, flag an Incomplete deck's parameters and Send to Query.
 *   3. **Uploaded decks — AI-extracted details** (`#up-results`).
 *
 * Aug-2026 issue log, still honoured: 11 (credits on top), 12 (auto-recognised
 * details with a manual override — `DeckDetails`), 13 (CRM / email-triage
 * intake), 14 (the action is "Upload", not "Upload & evaluate").
 *
 * A founder reaches this route as `founder-upload` and gets `FounderUpload`,
 * which shares none of the staff surfaces (F0302).
 *
 * V3 item 8 — deliberately partial. The v3 panel diff is two hunks: the wizard's
 * forward button becomes "Evaluate & Go to Dashboard →", and `#up-results` is
 * deleted outright. The second half is not buildable as written (Q51): v3 keeps
 * — and rewrites — every line of the results table's JS (`renderUpResults`,
 * `renderResultsHead/Body`, `upSendToEvaluate`, `upEditRows`, `upArchiveRows`)
 * plus ~40 lines of new CSS (`.up-inline-results`, `.up-rt-*`, `.up-stmenu`,
 * `.up-st-sel`, `.up-edit-in`) for a card whose MARKUP is in neither file, and
 * `renderUpResults([0,3,5,7])` runs at load into a swallowed catch. Deleting our
 * review step on that would spend credits with no cost preview, so until Q5/Q51
 * is answered the label changes and the flow does not.
 *
 * These files are SHARED WITH THE VC EDITION, which was not rescoped, and with
 * the founder portal — so every v3 surface here is behind `isV3Up`.
 *
 * R2-UPEVAL widened that gate past the superuser: plan_roles_incubator §2 row
 * `11 · V3-UP` extends the lane to the incubator ADMIN and PROGRAM ASSOCIATE,
 * withholds it from the JURY (who have no `upload` nav at all), and leaves the
 * PROGRAM MANAGER on the unchanged label pending the client's answer to Q-P.
 * The roles, and that open question, live in `upload/v3Up.ts` — one edit ships
 * the PM if the client picks V3's design. No server change was needed for
 * either role: `DEFAULT_ROLE_PERMISSIONS.incubator.upload` already carries
 * both, and so does `RESCORE_ROLES` behind the Evaluate half.
 */
export function UploadPage() {
  const { user } = useAuth();
  if (user?.role === "founder") return <FounderUpload />;
  return <StaffUpload />;
}

function StaffUpload() {
  const { user } = useAuth();
  const can = usePermissions();
  const edition = user?.edition ?? "incubator";
  const role = user?.role ?? "program_associate";
  const [ctx, setCtx] = useActiveContext(edition);

  const canBuy = canAccessNav(edition, role, "billing", can);
  const canOpenConsole = canAccessNav(edition, role, "admin", can);
  const canQuery = canAccessNav(edition, role, "query", can);
  const canEdit = canAccessNav(edition, role, "upload", can);
  /** V3-UP's admitted set — `upload/v3Up.ts` owns it, and records Q-P. */
  const v3Up = isV3Up(edition, role);

  // ── Workspace data ────────────────────────────────────────────────────────
  const [programs, setPrograms] = useState<ProgramsResponse | null>(null);
  const [config, setConfig] = useState<ConfigSummary | null>(null);
  const [trialDecks, setTrialDecks] = useState<number | null>(null);
  const [purchased, setPurchased] = useState<number | null>(null);
  const [parameters, setParameters] = useState<string[]>([]);

  useEffect(() => {
    listPrograms()
      .then(setPrograms)
      .catch(() => setPrograms({ sectors: [], programs: [] }));
    getConfigSummary()
      .then(setConfig)
      .catch(() => {});
    // The trial sub-line reads the PUBLISHED catalogue — never a literal.
    getPublishedCatalogue()
      .then((book) => setTrialDecks(book.trial?.decks ?? null))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!canOpenConsole) return;
    // Lifetime purchases are a billing administrator's read (`W4-C`).
    fetch("/api/billing")
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { purchased?: number } | null) => setPurchased(typeof v?.purchased === "number" ? v.purchased : null))
      .catch(() => {});
  }, [canOpenConsole]);
  useEffect(() => {
    if (!canQuery) return;
    listParameters()
      .then((r) => setParameters(r.parameters.filter((p) => !p.informational).map((p) => p.name)))
      .catch(() => {});
  }, [canQuery]);

  // ── The operator's context: cohort (and so programme) and sector ─────────
  // Defaults are DERIVED during render from the active context, not copied into
  // state by an effect — an effect leaves a frame where the select is blank.
  const [cohortChoice, setCohortChoice] = useState<string | null>(null);
  const [sectorChoice, setSectorChoice] = useState<string | null>(null);
  const programList = programs?.programs ?? [];
  const sectors = (programs?.sectors ?? []).filter((s) => s.active).map((s) => s.name);
  const defaultCohort =
    ctx.cohortId && programList.some((p) => p.cohorts.some((c) => c.id === ctx.cohortId))
      ? `c:${ctx.cohortId}`
      : ctx.programId && programList.some((p) => p.id === ctx.programId)
        ? `p:${ctx.programId}`
        : "";
  const cohort = cohortChoice ?? defaultCohort;
  const context = contextFrom(cohort, programList);
  const program = programList.find((p) => p.id === context.programId) ?? null;
  const defaultSector = resolveIntakeSector({ programSector: program?.sector, sectors }) ?? "";
  const sector = sectorChoice ?? defaultSector;
  context.sector = sector || undefined;

  const sectorOptions: ChoiceOption[] = sectors.map((s) => ({ value: s, label: s }));
  if (defaultSector && !sectors.includes(defaultSector)) sectorOptions.unshift({ value: defaultSector, label: defaultSector });
  const cohortGroups: CohortGroup[] = programList.map((p) => ({
    label: p.name,
    options: [
      { value: `p:${p.id}`, label: `${p.name} — no cohort` },
      ...p.cohorts.map((c) => ({ value: `c:${c.id}`, label: c.name })),
    ],
  }));

  function onCohort(v: string) {
    setCohortChoice(v);
    const next = contextFrom(v, programList);
    setCtx({ programId: next.programId ?? null, cohortId: next.cohortId ?? null });
  }

  // ── Drafts, staged decks and the three views ─────────────────────────────
  const [view, setView] = useState<View>("wizard");
  const [method, setMethod] = useState<UploadMethod>("single");
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [details, setDetails] = useState<SingleDetails>(EMPTY_DETAILS);
  const [bulkDrafts, setBulkDrafts] = useState<Draft[]>([]);
  const [bulkNotes, setBulkNotes] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [staged, setStaged] = useState<StagedDeck[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const seq = useRef(0);

  const patch = (key: string, p: Partial<StagedDeck> | ((d: StagedDeck) => Partial<StagedDeck>)) =>
    setStaged((list) => list.map((d) => (d.key === key ? { ...d, ...(typeof p === "function" ? p(d) : p) } : d)));

  async function onBulkFiles(files: File[]) {
    setBulkBusy(true);
    const drafts: Draft[] = [];
    const notes: string[] = [];
    for (const f of files) {
      if (isZipFile(f)) {
        const out = await expandZip(await f.arrayBuffer(), MAX_DECK_PDF_BYTES);
        drafts.push(...out.decks);
        notes.push(...out.errors);
        if (out.skipped.length) notes.push(`${f.name}: ${out.skipped.length} file(s) that are not PDFs were left out.`);
        if (!out.decks.length && !out.errors.length) notes.push(`${f.name} contains no PDF pitch decks.`);
      } else {
        drafts.push({ name: f.name, size: f.size, file: f });
      }
    }
    setBulkDrafts((d) => [...d, ...drafts]);
    setBulkNotes(notes);
    setBulkBusy(false);
  }

  function stage(draft: Draft, source: "single" | "bulk", ctxDraft: IntakeContextDraft, typed?: SingleDetails): StagedDeck {
    seq.current += 1;
    return {
      key: `staged_${seq.current}`,
      name: typed?.name.trim() || provisionalDeckName(draft.name),
      fileName: draft.name,
      size: draft.size,
      file: draft.file,
      source,
      details: typed,
      context: { ...ctxDraft },
      slides: null,
      issues: stagedDeckIssues({ name: draft.name, size: draft.size, type: draft.file?.type }),
      checked: false,
      markedIncomplete: false,
      flags: {},
      sentToQuery: false,
    };
  }

  function goToReview() {
    const next: StagedDeck[] = [];
    if (singleFile) next.push(stage({ name: singleFile.name, size: singleFile.size, file: singleFile }, "single", context, details));
    for (const d of bulkDrafts) next.push(stage(d, "bulk", context));
    if (next.length) {
      setStaged((list) => [...list, ...next]);
      setActiveKey(next[0].key);
      for (const d of next) {
        if (d.file && d.issues.length === 0) void countPdfPages(d.file).then((n) => patch(d.key, { slides: n }));
      }
      setSingleFile(null);
      setDetails(EMPTY_DETAILS);
      setBulkDrafts([]);
      setBulkNotes([]);
    }
    setNotice(null);
    setError(null);
    setView("review");
  }

  // ── Approve → upload (the ONLY path that reaches a route that spends) ─────
  const selection = staged.filter((d) => isUploadable(d) && d.checked);
  const preview = batchCostPreview(selection.length, config?.creditsBalance ?? null);

  async function uploadSelected() {
    if (selection.length === 0 || preview.shortfall > 0) return;
    setBusy(true);
    setError(null);
    const outcomes = new Map<string, Partial<StagedDeck>>();
    let stopped: string | null = null;

    for (const d of selection.filter((s) => s.source === "single")) {
      if (stopped) break;
      const form = new FormData();
      form.set("file", d.file!, d.fileName);
      for (const [k, v] of Object.entries(d.details ?? {})) if (v.trim()) form.set(k, v.trim());
      appendContext(form, d.context);
      try {
        const res = await uploadSingle(form);
        const flag = res.result?.intakeFlag ?? res.matches?.[0]?.flag ?? undefined;
        outcomes.set(d.key, {
          deckId: res.deckId,
          checked: false,
          uploadError: undefined,
          intakeFlag: flag ?? undefined,
          intakeNote: res.result?.intakeNote ?? res.matches?.[0]?.reason ?? undefined,
          evalNote: res.evaluated
            ? undefined
            : `${res.error === "evaluation_failed" ? "Uploaded, but the AI evaluation could not be started" : "Uploaded — the AI evaluation is queued and will retry automatically"}${res.reason ? ` · ${res.reason}` : ""}. You can re-run it from All decks once the cause is cleared.`,
        });
      } catch (err) {
        const message = uploadErrorMessage(err);
        outcomes.set(d.key, { uploadError: message });
        if (err instanceof ApiError && err.code === "no_credits") stopped = message;
      }
    }

    const groups = new Map<string, StagedDeck[]>();
    for (const d of selection.filter((s) => s.source === "bulk")) {
      const k = JSON.stringify(d.context);
      groups.set(k, [...(groups.get(k) ?? []), d]);
    }
    for (const group of groups.values()) {
      if (stopped) break;
      const form = new FormData();
      for (const d of group) form.append("files", d.file!, d.fileName);
      appendContext(form, group[0].context);
      try {
        const res = await uploadBulk(form);
        const pending = [...group];
        for (const row of res.results ?? []) {
          const i = pending.findIndex((d) => d.fileName === row.file);
          if (i < 0) continue;
          const [d] = pending.splice(i, 1);
          outcomes.set(
            d.key,
            row.ok
              ? { deckId: row.deckId, checked: false, uploadError: undefined, intakeFlag: row.flag, intakeNote: row.note }
              : {
                  uploadError:
                    row.error === "pdf_too_large"
                      ? STAGED_ISSUE_LABELS.too_large
                      : row.error === "pdf_required"
                        ? STAGED_ISSUE_LABELS.not_pdf
                        : "Upload failed — try this deck again.",
                },
          );
        }
      } catch (err) {
        const message = uploadErrorMessage(err);
        for (const d of group) outcomes.set(d.key, { uploadError: message });
        if (err instanceof ApiError && err.code === "no_credits") stopped = message;
      }
    }

    setStaged((list) => list.map((d) => (outcomes.has(d.key) ? { ...d, ...outcomes.get(d.key) } : d)));
    // The balance after the batch is the server's to say.
    getConfigSummary().then(setConfig).catch(() => {});
    setBusy(false);

    const uploaded = [...outcomes.values()].filter((o) => o.deckId).length;
    const failed = outcomes.size - uploaded;
    if (failed > 0) {
      setError(
        stopped ? (
          <>
            {stopped}{" "}
            {canBuy ? (
              <Link to="/app/billing" className="font-medium underline">
                Buy credits
              </Link>
            ) : (
              "Ask an administrator to add credits."
            )}
          </>
        ) : (
          `${failed} deck${failed === 1 ? "" : "s"} could not be uploaded — see the list.`
        ),
      );
    }
    if (uploaded > 0 && failed === 0) {
      // The prototype returns to the wizard and reveals "View uploaded details".
      setNotice(`${uploaded} deck${uploaded === 1 ? "" : "s"} uploaded — the AI is reading ${uploaded === 1 ? "it" : "them"} now.`);
      setView("wizard");
    }
  }

  // ── Follow the AI on everything uploaded in this visit ────────────────────
  const awaitingIds = staged
    .filter((d) => d.deckId && (!d.deck || (d.deck.statusId === "pending_ai" && d.deck.aiState !== "failed")))
    .map((d) => d.deckId)
    .join(",");
  useEffect(() => {
    if (!awaitingIds) return;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      tries += 1;
      try {
        const { decks } = await listDecks();
        const byId = new Map(decks.map((d) => [d.id, d]));
        if (!stopped) {
          setStaged((list) => list.map((d) => (d.deckId && byId.has(d.deckId) ? { ...d, deck: byId.get(d.deckId) } : d)));
        }
      } catch {
        /* the next tick retries */
      }
      if (!stopped && tries < POLL_LIMIT) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [awaitingIds]);

  // ── Parameters needing response → Send to Query ───────────────────────────
  function onFlag(key: string, area: string) {
    patch(key, (d) => {
      const flags = { ...d.flags };
      if (area in flags) delete flags[area];
      else flags[area] = "weak";
      return { flags, sentToQuery: false };
    });
  }
  function onSignal(key: string, area: string, signal: FlagSignal) {
    patch(key, (d) => ({ flags: { ...d.flags, [area]: signal }, sentToQuery: false }));
  }
  async function onSend(key: string) {
    const d = staged.find((s) => s.key === key);
    if (!d?.deckId) return;
    const flags = Object.entries(d.flags).map(([area, signal]) => ({ area, signal }));
    if (!flags.length) return;
    setSending(key);
    setSendError(null);
    try {
      await createQuery(d.deckId, composeUploadQuery(d.deck?.name ?? d.name, flags));
      patch(key, { sentToQuery: true });
    } catch {
      setSendError("Couldn't send the query. Try again.");
    } finally {
      setSending(null);
    }
  }

  const uploaded = staged.filter((d) => d.deckId);
  const balance = config?.creditsBalance ?? null;
  const creditsBar = (
    <CreditsBar
      balance={balance}
      subline={creditsSubline({ trialDecks, planLabel: config ? PLAN_LABELS[config.plan] : null })}
      meterPct={creditsMeterPct({ balance, purchased, trialDecks })}
      canBuy={canBuy}
      canSeeBalance={canOpenConsole}
    />
  );

  if (view === "review") {
    return (
      <ReviewScreen
        staged={staged}
        activeKey={activeKey}
        onSelect={setActiveKey}
        onToggle={(key) => patch(key, (d) => ({ checked: !d.checked }))}
        onToggleAll={() => {
          const selectable = staged.filter(isUploadable);
          const next = selectable.some((d) => !d.checked);
          setStaged((list) => list.map((d) => (isUploadable(d) ? { ...d, checked: next } : d)));
        }}
        onMarkIncomplete={(key) => {
          patch(key, (d) => ({ markedIncomplete: !d.markedIncomplete, checked: false }));
          setActiveKey(key);
        }}
        onBack={() => setView("wizard")}
        onUpload={uploadSelected}
        busy={busy}
        preview={preview}
        error={error}
        canBuy={canBuy}
        parameters={parameters}
        canQuery={canQuery}
        onFlag={onFlag}
        onSignal={onSignal}
        onSend={onSend}
        sending={sending}
        sendError={sendError}
        renderDetails={(d) =>
          canEdit && d.deck ? (
            // Keyed on the stage too, so the fields refill once the AI has read the deck.
            <DeckDetails key={`${d.deck.id}:${d.deck.statusId}`} deck={d.deck} onSaved={(deck) => patch(d.key, { deck })} />
          ) : null
        }
      />
    );
  }

  if (view === "results") {
    // The sector the batch was RECORDED under, not whatever the wizard shows now.
    const recorded = [...new Set(uploaded.map((d) => d.deck?.sector ?? d.context.sector).filter(Boolean))];
    return (
      <ResultsScreen
        uploaded={uploaded}
        workspaceSector={recorded.length ? recorded.join(", ") : null}
        onBack={() => setView("review")}
        showSendToEvaluate={v3Up}
      />
    );
  }

  return (
    <Wizard
      creditsBar={creditsBar}
      method={method}
      onMethod={setMethod}
      singleFile={singleFile}
      onSingleFiles={(files) => setSingleFile(files[0] ?? null)}
      details={details}
      onDetails={(p) => setDetails((d) => ({ ...d, ...p }))}
      sector={sector}
      sectorOptions={sectorOptions}
      onSector={setSectorChoice}
      cohort={cohort}
      cohortGroups={cohortGroups}
      onCohort={onCohort}
      bulkFiles={bulkDrafts}
      onBulkFiles={(files) => void onBulkFiles(files)}
      bulkNotes={bulkNotes}
      bulkBusy={bulkBusy}
      crm={<CrmMethod canConfigure={canOpenConsole} planBelowPro={config?.plan === "standard"} canBuy={canBuy} />}
      uploadedCount={uploaded.length}
      notice={notice}
      onViewDetails={() => setView("results")}
      onReview={goToReview}
      forwardLabel={v3Up ? "Evaluate & Go to Dashboard →" : undefined}
    />
  );
}

/** `"c:<cohortId>"` / `"p:<programId>"` / `""` → the ids it stands for. */
function contextFrom(value: string, programs: ProgramsResponse["programs"]): IntakeContextDraft {
  if (value.startsWith("c:")) {
    const cohortId = value.slice(2);
    const program = programs.find((p) => p.cohorts.some((c) => c.id === cohortId));
    return program ? { programId: program.id, cohortId } : {};
  }
  if (value.startsWith("p:")) return { programId: value.slice(2) };
  return {};
}

function appendContext(form: FormData, context: IntakeContextDraft) {
  if (context.programId) form.set("programId", context.programId);
  if (context.cohortId) form.set("cohortId", context.cohortId);
  if (context.sector) form.set("sector", context.sector);
}

/** F0306 — say what the server said, not "Upload failed". */
function uploadErrorMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === "no_credits") return "Not enough credits — the remaining decks were not uploaded or charged.";
  if (code === "pdf_too_large") return STAGED_ISSUE_LABELS.too_large;
  if (code === "pdf_required") return STAGED_ISSUE_LABELS.not_pdf;
  return "Upload failed — try this deck again.";
}
