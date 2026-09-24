// Session 2 — Set up wizard (Settings → Set up). A four-step guided configuration
// of the workspace: Org type → Configure (sectors / programs / cohorts) →
// Select (active context) → Team. The Configure step drives the real
// Program/Cohort hierarchy API; the Select step writes the active context shared
// with the dashboard toolbar filters and the upload form.
//
// W6-C — step 4 is the real team step (`./setup/TeamStep.tsx`): the owner card,
// the super-user gate, per-member plan tiers, the seat bar and the buy-seats
// sub-flow. "Seat" in the Session 4 note below is a PERMISSION word (how much of
// the wizard a role may edit); the purchased seat lives in `src/shared/seats.ts`.
// Non-admin roles see three steps, not four — the prototype drops Org type for
// every role file that is not an Admin or Super User build (F1069).
//
// ── S2-SETUP · 21-Sep item 7 ────────────────────────────────────────────────
// "Delete step 1 (Org type) and step 4; only the programme setup remains." So
// for the incubator SUPER USER the wizard is Configure → Select, and Select
// finishes it. This REVERSES part of V3-PT item 16 (§3), which three commits ago
// turned step 4 into "Nominate your super user" — the same client asked for
// both, and the later instruction wins.
//
// **It is a deliberate deviation from the prototype.** Measured, not assumed:
// `AISJ_SuperuserV3.HTM:7742-7750` and `AISJ_IC_SuserV15.HTM` draw the same four
// `.ac-step` labels — Org type · Configure · Select · Team — byte for byte. The
// client's instruction wins over the file; §12 records it so the next parity
// capture does not put the two steps back.
//
// Nothing the two deleted steps owned is stranded (§13's two-part requirement):
//   · `branding.orgName` — the wizard was its ONLY writer and it has four
//     readers (`AccountPage` "Workspace", the invite email, the founder
//     resubmit email, every invoice document). It now has a field in Admin
//     console → Branding, which already re-reads and merges the record.
//   · Buy additional seats — `TeamStep` was the sole importer of
//     `purchaseSeats`. The flow moved WHOLE to `routes/seats/BuySeats.tsx` and
//     is mounted in Admin console → Team & roles, which is §4 Q84's own answer
//     and the destination the handoff card already pointed at.
//   · `branding.orgType` is written here and read by NOTHING (grepped across
//     src/): the Org type step's choice was already inert. Team & roles states
//     the workspace type instead, from the edition, and has since W4-A.
//
// ── R3-SETUP · the four-role extension, item 6 ──────────────────────────────
// The gate was `incubator` + `superuser`. The client's row for this item names
// *Superuser / Prog. manager / Admin*, so it now carries all three
// (`PROGRAMME_ONLY_ROLES`), and only those three: the program associate keeps
// their three-step read-only wizard and the jury has no `setup` nav at all
// (plan §2 ʰ). The VC edition is still untouched — it was never rescoped, and
// `e2e/seats.spec.ts` walks all four steps as the VC admin.
//
// What the widening costs, and where each cost is paid:
//   · the ADMIN is a `full` seat, so they lose the Team step and with it the
//     seat bar and Buy additional seats — the same stranding item 7 had to fix
//     for the super user. `SeatsCard` in Admin console → Team & roles now
//     admits them too (plan §2 ʷ); `/api/seats` already did
//     (`server/routes/seats.ts:60`, `requireTask("addmembers","admin")`), so
//     this closes a live inconsistency rather than opening a door.
//   · the PROGRAMME MANAGER is a `cohorts` seat, so they never had Org type,
//     the roster, the add-member form or Buy seats (`TeamStep`'s `manages` is
//     already false for them). Deleting their step 4 strands nothing.
//   · `branding.orgName` keeps a writer either way: the admin reaches Admin
//     console → Branding, where item 7 moved the field. `orgType` loses its
//     last incubator writer and that is inert — see the bullet above.
// Two e2e specs walked the admin through Org type and are re-pointed with this
// change (`programs`, `automation`); a third, `e2e/coverage.spec.ts`, is not
// this session's file — see `docs/parity-requests/R3-coverage-setup-walk.patch`.
//
// **Still a deliberate deviation from the prototypes**, now for three roles
// rather than one, and recorded in §12 / Q-A so the next parity capture does
// not put the two steps back and re-file them as a defect.
//
// Session 4 — role-scoped seats. admin/superuser get full editing. A program
// MANAGER can manage cohorts for the programs they LEAD (owner-scoped; sectors +
// programs stay org-admin-owned). A program ASSOCIATE is read-only ("Standard
// seat") — the server enforces all of this; the wizard reflects it.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Building2,
  TrendingUp,
  Briefcase,
  X,
  ArrowRight,
  ArrowLeft,
  Plus,
  Trash2,
  Check,
  Target,
  Lock,
} from "lucide-react";
import { Card, Button, Badge } from "../components";
import { TeamStep } from "./setup/TeamStep";
import { useAuth } from "../auth/useAuth";
import { useActiveContext } from "../activeContext";
import { editionLabel, type Role } from "../../shared/roles";
import {
  listPrograms,
  getConfigSummary,
  updateBranding,
  createSector,
  deleteSector,
  createProgram,
  updateProgram,
  deleteProgram,
  createCohort,
  deleteCohort,
  type ProgramsResponse,
  type ProgramView,
} from "../api";

// V3-PT — v3 narrowed step 4 to nominating the account's super user and handed
// ongoing team management to Admin console → Team & roles. Only the incubator
// superuser prototype was reshared, so the label follows the same gate the step
// itself does (`TeamStep`'s `nominateOnly`).
const STEPS = ["Org type", "Configure", "Select", "Team"] as const;
const STEPS_SUPERUSER = ["Org type", "Configure", "Select", "Super user"] as const;
/** S2-SETUP item 7 — the programme setup alone, for the incubator super user. */
const STEPS_PROGRAMME = ["Configure", "Select"] as const;

/**
 * R3-SETUP — item 6 of the four-role extension, which widens item 7's narrowing
 * from the super user to the two roles the client's own row names alongside
 * them: *Superuser / Prog. manager / Admin*.
 *
 * The two roles NOT here are deliberate, not an oversight (plan §2 ʰ):
 *   · `program_associate` — a `readonly` seat, so they already see three steps.
 *     Narrowing them further would delete Configure and with it the only screen
 *     that carries `StandardSeatBanner`, the sole place the product tells them
 *     their seat is view-only. Their prototype has no Set up item at all.
 *   · `jury` — no `setup` nav (`nav.ts:172`), so the predicate can never be
 *     evaluated for them.
 * The VC edition is untouched: it was never rescoped, and `AISJ_ICAdmin_V6` and
 * every VC file still draw all four steps, so this remains a recorded deviation
 * from the prototypes rather than a match to them (§12, Q-A).
 */
const PROGRAMME_ONLY_ROLES: ReadonlySet<Role> = new Set<Role>([
  "superuser",
  "admin",
  "program_manager",
]);

/**
 * The steps a seat walks: Org type is an Admin / Super User step only.
 *
 * `first` indexes the FULL four-step numbering that `step` is held in, so the
 * two narrowings compose without compounding: `programmeOnly` returns `first: 1`
 * outright rather than slicing, because slicing an already-sliced list is
 * exactly how "non-admin roles already see three steps" would double-apply and
 * cost a `readonly` seat its Configure step.
 *
 * R3-SETUP — that hazard stopped being hypothetical. While `programmeOnly` meant
 * the super user alone it was always a `full` seat (`seatFor`), so the early
 * return was belt-and-braces; item 6 adds the PROGRAM MANAGER, whose seat is
 * `cohorts` — the list they would be sliced from is ALREADY sliced. The early
 * return is what stops their wizard opening on Select with nothing configured,
 * so it is load-bearing now rather than merely tidy: do not re-express it as a
 * second `slice`.
 */
function stepsFor(
  seat: Seat,
  nominateOnly = false,
  programmeOnly = false,
): { labels: readonly string[]; first: number } {
  if (programmeOnly) return { labels: STEPS_PROGRAMME, first: 1 };
  const all = nominateOnly ? STEPS_SUPERUSER : STEPS;
  return seat === "full" ? { labels: all, first: 0 } : { labels: all.slice(1), first: 1 };
}

const ORG_TYPES = [
  { id: "consulting", label: "Consulting Firm", icon: Briefcase, blurb: "Advisory or consulting practice — evaluate decks and advise clients. Suits individual-plan users working solo." },
  { id: "incubator", label: "Incubator / Accelerator", icon: Building2, blurb: "Run cohort programs, assign jury and mentors, manage multiple sectors and batches." },
  { id: "investor", label: "Investor", icon: TrendingUp, blurb: "VC firm or angel network — manage deal flow, analysts, IC pipeline and LP reporting." },
] as const;

/** How much of the wizard a role may edit. */
type Seat = "full" | "cohorts" | "readonly";
function seatFor(role: Role | undefined): Seat {
  if (role === "admin" || role === "superuser") return "full";
  if (role === "program_manager") return "cohorts"; // owner-scoped cohorts only
  return "readonly"; // program_associate (Standard seat) + any other role
}

/** The gold "Standard seat" read-only banner shown to a program associate. */
function StandardSeatBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-fg">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
      <p>
        <span className="font-medium">Read-only — Standard seat.</span> Set up is view-only on your seat, so
        you can't add or edit sectors, programs or cohorts here. Ask a Super User, Program Manager or Admin to
        make changes.
      </p>
    </div>
  );
}

export function SetupWizard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const edition = user?.edition ?? "incubator";
  const [, setCtx] = useActiveContext(edition);
  const seat = seatFor(user?.role);
  /**
   * The reshared prototype's audience, and nobody else — the same predicate
   * V3-PT gated step 4's narrowing on (§4 Q85). Item 7 now deletes the step
   * outright for them, so `nominateOnly` no longer reaches `TeamStep` from
   * here; it stays because the ADMIN and VC wizards still render step 4, and
   * `TeamStep` decides its own layout from the same two facts.
   */
  const programmeOnly = edition === "incubator" && !!user && PROGRAMME_ONLY_ROLES.has(user.role);

  // NO LONGER the same predicate twice, and that is the point. `nominateOnly`
  // only ever relabelled step 4 "Super user", and only for the incubator super
  // user; `stepsFor`'s early return shadows it, so `STEPS_SUPERUSER` is
  // unreachable today and is kept, like `TeamStep`'s matching branch, against a
  // reversal of item 7 (§12.5). It must stay NARROW while `programmeOnly`
  // widens: on a reversal an admin's or a programme manager's restored step 4
  // is the roster, not the nomination, so passing the wider predicate here
  // would relabel a step neither of them ever had.
  const nominateOnly = edition === "incubator" && user?.role === "superuser";
  const { labels: stepLabels, first: firstStep } = stepsFor(seat, nominateOnly, programmeOnly);
  const [step, setStep] = useState(firstStep);
  const [buying, setBuying] = useState(false);
  const [data, setData] = useState<ProgramsResponse | null>(null);
  const [branding, setBranding] = useState<Record<string, unknown>>({});
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState<string>(edition === "vc" ? "investor" : "incubator");

  function reload() {
    return listPrograms()
      .then(setData)
      .catch(() => setData({ sectors: [], programs: [] }));
  }

  useEffect(() => {
    reload();
    getConfigSummary()
      .then((c) => {
        setBranding(c.branding);
        const b = c.branding as Record<string, unknown>;
        if (typeof b.orgName === "string") setOrgName(b.orgName);
        if (typeof b.orgType === "string") setOrgType(b.orgType);
      })
      .catch(() => {});
  }, []);

  async function saveOrg() {
    try {
      // Re-read the latest branding so we merge onto (never clobber) the
      // wordmark/tagline/accent an admin may have set in Config.
      const current = await getConfigSummary()
        .then((c) => c.branding)
        .catch(() => branding);
      await updateBranding({ ...current, orgName: orgName.trim(), orgType });
    } catch {
      /* non-blocking — branding is a nicety, keep the wizard moving */
    }
  }

  if (!user) return null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Set up your workspace</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            Configure the sectors, programs and cohorts your {editionLabel(edition)} workspace runs on.
          </p>
        </div>
        <Link to="/app/alldecks" aria-label="Close set up">
          <Button variant="ghost" size="sm">
            <X className="h-4 w-4" /> Close
          </Button>
        </Link>
      </div>

      {!buying && <Stepper labels={stepLabels} step={step - firstStep} />}

      {seat === "readonly" && <StandardSeatBanner />}

      {step === 0 && seat === "full" && !programmeOnly && (
        <OrgTypeStep
          edition={edition}
          orgType={orgType}
          setOrgType={setOrgType}
          orgName={orgName}
          setOrgName={setOrgName}
          readOnly={seat !== "full"}
          onNext={async () => {
            if (seat === "full") await saveOrg();
            setStep(1);
          }}
        />
      )}
      {step === 1 && (
        <ConfigureStep
          data={data}
          reload={reload}
          edition={edition}
          seat={seat}
          userId={user.id}
          // No step 0 to return to once Org type is deleted — this is the other
          // half of the double-apply hazard, and it is a `full` seat, so the
          // seat check alone would have drawn a Back button into nothing.
          onBack={seat === "full" && !programmeOnly ? () => setStep(0) : undefined}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <SelectStep
          data={data}
          setCtx={setCtx}
          onBack={() => setStep(1)}
          // With step 4 deleted, Select is the end of the wizard and its own
          // Continue has to finish it, or the last step leads nowhere.
          onNext={programmeOnly ? () => navigate("/app/alldecks") : () => setStep(3)}
          isLast={programmeOnly}
        />
      )}
      {step === 3 && !programmeOnly && (
        <TeamStep
          user={user}
          edition={edition}
          seat={seat}
          programs={data?.programs ?? []}
          onFinish={() => navigate("/app/alldecks")}
          onFlowChange={setBuying}
        />
      )}
    </div>
  );
}

function Stepper({ labels, step }: { labels: readonly string[]; step: number }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto">
      {labels.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              // White on amber measures 2.4:1 — below AA. The house pairing for
              // an amber fill is navy (Button's primary variant), at 6.9:1.
              i < step
                ? "bg-positive text-offwhite"
                : i === step
                  ? "bg-accent text-navy"
                  : "bg-surface-2 text-fg-muted"
            }`}
          >
            {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={`whitespace-nowrap text-sm ${i === step ? "font-medium text-fg" : "text-fg-muted"}`}>
            {label}
          </span>
          {i < labels.length - 1 && <span className="mx-1 h-px w-6 bg-line sm:w-10" />}
        </li>
      ))}
    </ol>
  );
}

// ── Step 1: Org type ──────────────────────────────────────────────────────────

function OrgTypeStep({
  edition,
  orgType,
  setOrgType,
  orgName,
  setOrgName,
  readOnly,
  onNext,
}: {
  edition: "incubator" | "vc";
  orgType: string;
  setOrgType: (v: string) => void;
  orgName: string;
  setOrgName: (v: string) => void;
  readOnly: boolean;
  onNext: () => void;
}) {
  return (
    <Card>
      <div className="u-label">What best describes your organisation?</div>
      <p className="mt-1 text-sm text-fg-muted">
        This shapes your dashboard, workflows and evaluation roles. Your workspace runs on the{" "}
        <span className="font-medium text-fg">{editionLabel(edition)}</span> edition.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {ORG_TYPES.map((o) => {
          const Icon = o.icon;
          const selected = orgType === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={readOnly}
              onClick={() => setOrgType(o.id)}
              className={`flex flex-col gap-2 rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                selected ? "border-accent bg-accent/5" : "border-line enabled:hover:bg-surface-2"
              }`}
            >
              <Icon className={`h-5 w-5 ${selected ? "text-accent" : "text-fg-muted"}`} />
              <span className="text-sm font-medium text-fg">{o.label}</span>
              <span className="text-xs text-fg-muted">{o.blurb}</span>
            </button>
          );
        })}
      </div>
      <label className="mt-5 flex max-w-md flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">Organisation name</span>
        <input
          className="sj-input h-9 disabled:opacity-60"
          value={orgName}
          disabled={readOnly}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="e.g. Horizon Ventures"
        />
      </label>
      <div className="mt-6 flex justify-end">
        <Button onClick={onNext}>
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

// ── Step 2: Configure (sectors / programs / cohorts) ──────────────────────────

function ConfigureStep({
  data,
  reload,
  edition,
  seat,
  userId,
  onBack,
  onNext,
}: {
  data: ProgramsResponse | null;
  reload: () => Promise<unknown>;
  edition: "incubator" | "vc";
  seat: Seat;
  userId: string;
  /** Absent when Configure is the seat's first step (no Org type step to return to). */
  onBack?: () => void;
  onNext: () => void;
}) {
  if (!data) return <Card><p className="text-sm text-fg-muted">Loading…</p></Card>;
  // Sectors + programs are org-admin-owned; a PM edits cohorts for programs they lead.
  const orgEditable = seat === "full";
  return (
    <div className="flex flex-col gap-4">
      {seat === "cohorts" && (
        <div className="rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-sm text-fg-muted">
          You can manage cohorts for the programs you lead. Sectors and programs are managed by an admin.
        </div>
      )}
      <SectorsEditor data={data} reload={reload} readOnly={!orgEditable} />
      <ProgramsEditor data={data} reload={reload} edition={edition} readOnly={!orgEditable} />
      <CohortsEditor data={data} reload={reload} seat={seat} userId={userId} />
      <div className="flex justify-between">
        {onBack ? (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onNext}>
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SectorsEditor({
  data,
  reload,
  readOnly,
}: {
  data: ProgramsResponse;
  reload: () => Promise<unknown>;
  readOnly: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await createSector(name.trim());
      setName("");
      await reload();
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    await deleteSector(id);
    await reload();
  }

  return (
    <Card>
      <div className="u-label">Sectors</div>
      <p className="mt-1 text-sm text-fg-muted">The industry verticals you operate in.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.sectors.length === 0 && <span className="text-sm text-fg-muted">None yet.</span>}
        {data.sectors.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-sm text-fg">
            {s.name}
            {!readOnly && (
              <button type="button" aria-label={`Remove ${s.name}`} onClick={() => remove(s.id)} className="text-fg-muted hover:text-signal-flagged">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!readOnly && (
        <div className="mt-3 flex gap-2">
          <input
            className="sj-input h-9 max-w-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder="e.g. HealthTech"
            aria-label="New sector name"
          />
          <Button size="sm" variant="secondary" onClick={add} disabled={busy || !name.trim()}>
            <Plus className="h-4 w-4" /> Add sector
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Per-program **shortlist floor** (Session 5, FINISH-PLAN §8). The admin sets a
 * minimum score and the system then blocks anyone shortlisting a deck below it —
 * the jury still shortlists, this is a guardrail. Blank clears the floor, which is
 * also the only way to release a deck the floor is holding back.
 */
function ShortlistFloorField({
  program,
  reload,
}: {
  program: ProgramView;
  reload: () => Promise<unknown>;
}) {
  const initial = program.shortlistMin !== undefined ? String(program.shortlistMin) : "";
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = value !== initial;

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await updateProgram(program.id, { shortlistMin: value === "" ? null : Number(value) });
      setSaved(true);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-fg-muted">
        Shortlist minimum
        <input
          type="number"
          min={0}
          max={10}
          step={0.1}
          aria-label={`Shortlist minimum for ${program.name}`}
          className="sj-input h-7 w-20 text-xs"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder="none"
        />
      </label>
      {dirty && (
        <Button size="sm" variant="secondary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      )}
      {saved && !dirty && <span className="text-xs text-positive">Saved</span>}
    </div>
  );
}

function ProgramsEditor({
  data,
  reload,
  edition,
  readOnly,
}: {
  data: ProgramsResponse;
  reload: () => Promise<unknown>;
  edition: "incubator" | "vc";
  readOnly: boolean;
}) {
  const isVc = edition === "vc";
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [description, setDescription] = useState("");
  const [fundSize, setFundSize] = useState("");
  const [fundAllocated, setFundAllocated] = useState("");
  const [shortlistMin, setShortlistMin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createProgram({
        name: name.trim(),
        sector: sector || undefined,
        description: description.trim() || undefined,
        fundSize: isVc && fundSize !== "" ? Number(fundSize) : undefined,
        fundAllocated: isVc && fundAllocated !== "" ? Number(fundAllocated) : undefined,
        shortlistMin: shortlistMin !== "" ? Number(shortlistMin) : undefined,
      });
      setName("");
      setSector("");
      setDescription("");
      setFundSize("");
      setFundAllocated("");
      setShortlistMin("");
      await reload();
    } catch {
      setError("Couldn't add the program. Check the fund amounts are valid numbers.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    await deleteProgram(id);
    await reload();
  }

  return (
    <Card>
      <div className="u-label">Programs</div>
      <p className="mt-1 text-sm text-fg-muted">
        The umbrella over everything — every upload, evaluation and report happens within a program.
        {isVc ? " VC programs carry fund economics that feed the Capital Deployment report." : ""}
      </p>
      {error && <p className="mt-2 text-sm text-signal-flagged">{error}</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {data.programs.length === 0 && <li className="text-sm text-fg-muted">No programs yet.</li>}
        {data.programs.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-fg">{p.name}</span>
                {p.sector && <Badge tone="neutral">{p.sector}</Badge>}
                {p.fundSize !== undefined && <Badge tone="info">₹{p.fundSize} Cr fund</Badge>}
                {p.shortlistMin !== undefined && (
                  <Badge tone="neutral">Shortlist min {p.shortlistMin.toFixed(1)}</Badge>
                )}
              </div>
              {p.description && <p className="mt-0.5 truncate text-xs text-fg-muted">{p.description}</p>}
              {!readOnly && <ShortlistFloorField program={p} reload={reload} />}
            </div>
            {!readOnly && (
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)} className="shrink-0 text-fg-muted hover:text-signal-flagged">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Program name</span>
              <input className="sj-input h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Climate Cohort" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Sector</span>
              <select className="sj-input h-9" value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="">—</option>
                {data.sectors.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-fg-muted">Description</span>
              <input className="sj-input h-9" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this program invests in / accelerates" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Shortlist minimum (0–10)</span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                className="sj-input h-9"
                value={shortlistMin}
                onChange={(e) => setShortlistMin(e.target.value)}
                placeholder="blank = no floor"
              />
            </label>
            {isVc && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-fg-muted">Fund size (₹ Cr)</span>
                  <input type="number" min={0} className="sj-input h-9" value={fundSize} onChange={(e) => setFundSize(e.target.value)} placeholder="e.g. 300" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-fg-muted">Allocated (₹ Cr)</span>
                  <input type="number" min={0} className="sj-input h-9" value={fundAllocated} onChange={(e) => setFundAllocated(e.target.value)} placeholder="e.g. 210" />
                </label>
              </>
            )}
          </div>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={add} disabled={busy || !name.trim()}>
              <Plus className="h-4 w-4" /> Add program
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function CohortsEditor({
  data,
  reload,
  seat,
  userId,
}: {
  data: ProgramsResponse;
  reload: () => Promise<unknown>;
  seat: Seat;
  userId: string;
}) {
  const [programId, setProgramId] = useState("");
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [busy, setBusy] = useState(false);

  // Which programs' cohorts this seat may manage: all (full) / owned (PM) / none.
  const editable = new Set(
    seat === "full"
      ? data.programs.map((p) => p.id)
      : seat === "cohorts"
        ? data.programs.filter((p) => p.ownerId === userId).map((p) => p.id)
        : [],
  );
  const canAdd = seat === "full" || seat === "cohorts";
  const addablePrograms = data.programs.filter((p) => editable.has(p.id));

  async function add() {
    if (!programId || !name.trim() || busy) return;
    setBusy(true);
    try {
      await createCohort(programId, {
        name: name.trim(),
        startsOn: startsOn || undefined,
        endsOn: endsOn || undefined,
      });
      setName("");
      setStartsOn("");
      setEndsOn("");
      await reload();
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    await deleteCohort(id);
    await reload();
  }

  const withCohorts = data.programs.filter((p) => p.cohorts.length > 0);

  return (
    <Card>
      <div className="u-label">Cohorts</div>
      <p className="mt-1 text-sm text-fg-muted">Batches under a program — e.g. a January cohort or the next quarter's intake.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {withCohorts.length === 0 && <li className="text-sm text-fg-muted">No cohorts yet.</li>}
        {withCohorts.map((p) => (
          <li key={p.id} className="rounded-lg border border-line px-3 py-2.5">
            <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{p.name}</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {p.cohorts.map((ch) => (
                <span key={ch.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-sm text-fg">
                  {ch.name}
                  {ch.startsOn && <span className="text-xs text-fg-muted">· {ch.startsOn}</span>}
                  {editable.has(p.id) && (
                    <button type="button" aria-label={`Remove ${ch.name}`} onClick={() => remove(ch.id)} className="text-fg-muted hover:text-signal-flagged">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {canAdd && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Program</span>
              <select className="sj-input h-9" value={programId} onChange={(e) => setProgramId(e.target.value)}>
                <option value="">Select a program…</option>
                {addablePrograms.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Cohort name</span>
              <input className="sj-input h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cohort 2026-A" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Starts</span>
              <input type="date" className="sj-input h-9" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Ends</span>
              <input type="date" className="sj-input h-9" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </label>
          </div>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={add} disabled={busy || !programId || !name.trim()}>
              <Plus className="h-4 w-4" /> Add cohort
            </Button>
          </div>
          {seat === "cohorts" && addablePrograms.length === 0 && (
            <p className="mt-2 text-xs text-fg-muted">You don't lead any programs yet — ask an admin to assign one.</p>
          )}
        </>
      )}
    </Card>
  );
}

// ── Step 3: Select active context ─────────────────────────────────────────────

function SelectStep({
  data,
  setCtx,
  onBack,
  onNext,
  isLast = false,
}: {
  data: ProgramsResponse | null;
  setCtx: (ctx: { programId: string | null; cohortId: string | null }) => void;
  onBack: () => void;
  onNext: () => void;
  /** S2-SETUP item 7 — Select is the last step once Team is deleted. */
  isLast?: boolean;
}) {
  const [sector, setSector] = useState("");
  const [programId, setProgramId] = useState("");
  const [cohortId, setCohortId] = useState("");

  const programs: ProgramView[] = data?.programs ?? [];
  const filtered = sector ? programs.filter((p) => p.sector === sector) : programs;
  const activeProgram = programs.find((p) => p.id === programId) ?? null;

  function pickProgram(id: string) {
    setProgramId(id);
    setCohortId("");
    setCtx({ programId: id || null, cohortId: null });
  }
  function pickCohort(id: string) {
    setCohortId(id);
    setCtx({ programId: programId || null, cohortId: id || null });
  }

  return (
    <Card>
      <div className="u-label">Select your active context</div>
      <p className="mt-1 text-sm text-fg-muted">
        Set the program and cohort you're working on now — this scopes your dashboard, uploads and filters. You can
        switch anytime from the toolbar.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Sector</span>
          <select className="sj-input h-9" value={sector} onChange={(e) => { setSector(e.target.value); pickProgram(""); }}>
            <option value="">All sectors</option>
            {(data?.sectors ?? []).map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Program</span>
          <select className="sj-input h-9" value={programId} onChange={(e) => pickProgram(e.target.value)}>
            <option value="">Select a program…</option>
            {filtered.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Cohort</span>
          <select
            className="sj-input h-9 disabled:opacity-50"
            value={cohortId}
            disabled={!activeProgram || activeProgram.cohorts.length === 0}
            onChange={(e) => pickCohort(e.target.value)}
          >
            <option value="">All cohorts</option>
            {(activeProgram?.cohorts ?? []).map((ch) => (
              <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-surface-2 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <Target className="h-4 w-4 text-accent" /> Your active context
        </div>
        <div className="mt-2 flex flex-col gap-1 text-sm text-fg-muted">
          <span>Sector — <span className="text-fg">{sector || "All sectors"}</span></span>
          <span>Program — <span className="text-fg">{activeProgram?.name ?? "All programs"}</span></span>
          <span>
            Cohort —{" "}
            <span className="text-fg">
              {activeProgram?.cohorts.find((c) => c.id === cohortId)?.name ?? "All cohorts"}
            </span>
          </span>
        </div>
      </div>

      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext}>
          {/* The wording the deleted step's footer used, so finishing the
              wizard reads the same as it did before the step went. */}
          {isLast ? "Confirm & go to dashboard" : "Continue"} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

// ── Step 4: Team — `./setup/TeamStep.tsx` (W6-C) ─────────────────────────────
