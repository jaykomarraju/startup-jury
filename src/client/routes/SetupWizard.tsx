// Session 2 — Set up wizard (Settings → Set up). A four-step guided configuration
// of the workspace: Org type → Configure (sectors / programs / cohorts) →
// Select (active context) → Team. The Configure step drives the real
// Program/Cohort hierarchy API; the Select step writes the active context shared
// with the dashboard toolbar filters and the upload form. Admin/superuser only
// (nav-gated); full Program-Manager ownership + team management land in Session 4.

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
} from "lucide-react";
import { Card, Button, Badge, EmptyState } from "../components";
import { useAuth } from "../auth/useAuth";
import { useActiveContext } from "../activeContext";
import { editionLabel } from "../../shared/roles";
import {
  listPrograms,
  getConfigSummary,
  updateBranding,
  createSector,
  deleteSector,
  createProgram,
  deleteProgram,
  createCohort,
  deleteCohort,
  type ProgramsResponse,
  type ProgramView,
} from "../api";

const STEPS = ["Org type", "Configure", "Select", "Team"] as const;

const ORG_TYPES = [
  { id: "consulting", label: "Consulting Firm", icon: Briefcase, blurb: "Advisory practice — evaluate decks and advise clients." },
  { id: "incubator", label: "Incubator / Accelerator", icon: Building2, blurb: "Run cohort programs, assign jury and mentors across sectors and batches." },
  { id: "investor", label: "Investor", icon: TrendingUp, blurb: "VC firm or angel network — manage deal flow, analysts and the IC pipeline." },
] as const;

export function SetupWizard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const edition = user?.edition ?? "incubator";
  const [, setCtx] = useActiveContext(edition);

  const [step, setStep] = useState(0);
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

      <Stepper step={step} />

      {step === 0 && (
        <OrgTypeStep
          edition={edition}
          orgType={orgType}
          setOrgType={setOrgType}
          orgName={orgName}
          setOrgName={setOrgName}
          onNext={async () => {
            await saveOrg();
            setStep(1);
          }}
        />
      )}
      {step === 1 && (
        <ConfigureStep data={data} reload={reload} edition={edition} onBack={() => setStep(0)} onNext={() => setStep(2)} />
      )}
      {step === 2 && (
        <SelectStep data={data} edition={edition} setCtx={setCtx} onBack={() => setStep(1)} onNext={() => setStep(3)} />
      )}
      {step === 3 && (
        <TeamStep
          ownerName={user.name}
          onBack={() => setStep(2)}
          onFinish={() => navigate("/app/alldecks")}
        />
      )}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              i < step
                ? "bg-positive text-white"
                : i === step
                  ? "bg-accent text-white"
                  : "bg-surface-2 text-fg-muted"
            }`}
          >
            {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={`whitespace-nowrap text-sm ${i === step ? "font-medium text-fg" : "text-fg-muted"}`}>
            {label}
          </span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line sm:w-10" />}
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
  onNext,
}: {
  edition: "incubator" | "vc";
  orgType: string;
  setOrgType: (v: string) => void;
  orgName: string;
  setOrgName: (v: string) => void;
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
              onClick={() => setOrgType(o.id)}
              className={`flex flex-col gap-2 rounded-lg border p-4 text-left transition ${
                selected ? "border-accent bg-accent/5" : "border-line hover:bg-surface-2"
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
          className="sj-input h-9"
          value={orgName}
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
  onBack,
  onNext,
}: {
  data: ProgramsResponse | null;
  reload: () => Promise<unknown>;
  edition: "incubator" | "vc";
  onBack: () => void;
  onNext: () => void;
}) {
  if (!data) return <Card><p className="text-sm text-fg-muted">Loading…</p></Card>;
  return (
    <div className="flex flex-col gap-4">
      <SectorsEditor data={data} reload={reload} />
      <ProgramsEditor data={data} reload={reload} edition={edition} />
      <CohortsEditor data={data} reload={reload} />
      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext}>
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SectorsEditor({ data, reload }: { data: ProgramsResponse; reload: () => Promise<unknown> }) {
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
            <button type="button" aria-label={`Remove ${s.name}`} onClick={() => remove(s.id)} className="text-fg-muted hover:text-signal-flagged">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>
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
    </Card>
  );
}

function ProgramsEditor({
  data,
  reload,
  edition,
}: {
  data: ProgramsResponse;
  reload: () => Promise<unknown>;
  edition: "incubator" | "vc";
}) {
  const isVc = edition === "vc";
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [description, setDescription] = useState("");
  const [fundSize, setFundSize] = useState("");
  const [fundAllocated, setFundAllocated] = useState("");
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
      });
      setName("");
      setSector("");
      setDescription("");
      setFundSize("");
      setFundAllocated("");
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
              </div>
              {p.description && <p className="mt-0.5 truncate text-xs text-fg-muted">{p.description}</p>}
            </div>
            <button type="button" aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)} className="shrink-0 text-fg-muted hover:text-signal-flagged">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
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
    </Card>
  );
}

function CohortsEditor({ data, reload }: { data: ProgramsResponse; reload: () => Promise<unknown> }) {
  const [programId, setProgramId] = useState("");
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [busy, setBusy] = useState(false);

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
                  <button type="button" aria-label={`Remove ${ch.name}`} onClick={() => remove(ch.id)} className="text-fg-muted hover:text-signal-flagged">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Program</span>
          <select className="sj-input h-9" value={programId} onChange={(e) => setProgramId(e.target.value)}>
            <option value="">Select a program…</option>
            {data.programs.map((p) => (
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
    </Card>
  );
}

// ── Step 3: Select active context ─────────────────────────────────────────────

function SelectStep({
  data,
  edition,
  setCtx,
  onBack,
  onNext,
}: {
  data: ProgramsResponse | null;
  edition: "incubator" | "vc";
  setCtx: (ctx: { programId: string | null; cohortId: string | null }) => void;
  onBack: () => void;
  onNext: () => void;
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
          <span>Edition — <span className="text-fg">{editionLabel(edition)}</span></span>
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
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

// ── Step 4: Team ──────────────────────────────────────────────────────────────

function TeamStep({
  ownerName,
  onBack,
  onFinish,
}: {
  ownerName: string;
  onBack: () => void;
  onFinish: () => void;
}) {
  return (
    <Card>
      <div className="u-label">Team</div>
      <p className="mt-1 text-sm text-fg-muted">Invite colleagues and assign their role and plan.</p>
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-line px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
          {ownerName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
        </span>
        <div>
          <div className="text-sm font-medium text-fg">{ownerName}</div>
          <div className="text-xs text-fg-muted">You — account owner</div>
        </div>
        <Badge tone="positive" className="ml-auto">Owner</Badge>
      </div>
      <div className="mt-4">
        <EmptyState
          icon="Users"
          title="Team management is coming to the Admin console"
          description="Creating users — jurors, mentors and staff — and assigning roles lands in the Admin console. For now, your seeded team is ready to evaluate."
        />
      </div>
      <div className="mt-2 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onFinish}>
          Confirm &amp; go to dashboard <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
