# ai.STARTUPJURY — Live Demo

> **Venture intelligence, first.** ai.STARTUPJURY is an AI-powered pitch-deck
> evaluation platform for **incubators / accelerators** and **VC firms** — one
> engine, two editions. Upload a deck, and Claude reads it, scores it against a
> weighted rubric, and moves it through your real evaluation pipeline with a full
> audit trail. This is the complete working product, live on the edge.

**Try it now:** **https://startup-jury.jay-komarraju.workers.dev**
**Password for every login below:** `demo1234`

---

## What it is

A single platform that runs **two editions** on the same engine:

- **Incubator / Accelerator edition** — Super User, Admin, Program Manager,
  Program Associate, Jury Member, plus an isolated **Founder portal**.
- **VC edition** — Managing Partner, Admin, Partner, IC Member, Investment
  Associate, Analyst.

Every person signs in and sees **only the parts of the app their role is allowed
to use** — the navigation and the actions change per role. That role-based access
control is real and fully enforced, not a mockup.

## What's live

- **AI scoring, for real.** Upload a pitch deck (PDF) and **Claude reads the
  slides and scores every rubric parameter (0–10)**, computes a weighted total,
  applies a pass/fail gate, and writes an **Evaluation Report** — extracted slide
  layout + per-parameter scores + verdict. _(Live now; see the note below.)_
- **The full pipeline, both editions** — assign to jury, score, shortlist,
  intro / partner / alignment calls, IC voting, term sheets, legal DD,
  onboarding, archive — each transition role-gated and written to an **audit log**.
- **Founder query loop** — an Incomplete deck can be sent back to the founder for
  clarification and re-intaken, all from the isolated Founder portal.
- **Analytics** — Cohort summary, Evaluator scores, Score drift, Pipeline funnel
  (incubator); Capital deployment, Portfolio construction, Scoring summary,
  Diligence & risk, Decision history (VC).
- **Configuration (admin)** — parameter weights with live re-scoring, cohort
  thresholds, the AI system prompt, branding, plan tier, and credits.
- **Design system** — full brand look, light **and** dark themes.

## Sign in — demo logins

Every login uses the password **`demo1234`**. The sign-in screen also lists these
as one-click shortcuts.

**Incubator edition**

| Role | Email | What they see |
|---|---|---|
| Super User | `priya.sharma@demo.startupjury.ai` | Everything — the full incubator app |
| Admin | `nisha.kapoor@demo.startupjury.ai` | Full workflow + settings + tickets |
| Program Manager | `raj.kumar@demo.startupjury.ai` | Intake, evaluation, reports |
| Program Associate | `sunita.rao@demo.startupjury.ai` | Upload, assign, intro calls, sign-up |
| Jury Member | `rajesh.kumar@demo.startupjury.ai` | Trimmed, evaluation-only menu |
| Founder | `meera.sharma@demo.startupjury.ai` | Isolated founder portal |

**VC edition**

| Role | Email | What they see |
|---|---|---|
| Managing Partner | `aarav.khanna@demo.startupjury.ai` | Everything — the full VC app |
| Admin | `nisha.kapoor.vc@demo.startupjury.ai` | Full workflow + settings + tickets |
| Partner | `ishaan.sethi@demo.startupjury.ai` | Deal flow through diligence & term sheets |
| IC Member | `rajesh.kumar.vc@demo.startupjury.ai` | Committee-focused menu (IC pipeline, DD) |
| Investment Associate | `sunita.rao.vc@demo.startupjury.ai` | Sourcing, screening, associate pipeline |
| Analyst | `rhea.nair@demo.startupjury.ai` | Upload + evaluate + scoring only |

## Try it yourself — 5 minutes

1. Open **https://startup-jury.jay-komarraju.workers.dev**.
2. Sign in as the **Incubator Super User** (`priya.sharma@demo.startupjury.ai` /
   `demo1234`) to see the whole app.
3. On the dashboard, note the **KPIs**, the **deck list**, and the
   **pipeline-progress** panel. **Click any startup row** to open its
   **Evaluation Report** (per-parameter scores + extracted slides).
4. **Score a deck live:** go to **Upload**, drop in a PDF pitch deck, and watch
   Claude read and score it in ~15 seconds — then open its report.
   _(A ready-to-use sample deck is in the repo at
   `docs/demo-assets/gridbloom-sample-deck.pdf`, or ask whoever shared this link.)_
5. Use the **sun/moon icon** (top-right) to switch light / dark.
6. **Sign out** and sign back in as a **Jury Member** or the **VC Managing
   Partner** to watch the whole app reshape itself around a different role.

> **A note on AI scoring.** The scoring engine calls Claude directly on the
> uploaded PDF. It is **live and working**. Two things worth knowing: (1) scoring
> takes ~10–20 seconds per deck because the model reads the whole PDF; (2) the
> rubric rewards well-rounded decks — a deck that covers problem, market,
> traction, team, business model, risks **and climate/impact** scores highest.
> A thin or single-topic deck may be marked _Incomplete_. The sample deck above
> is built to score well.

## Good to know

- This is a **shared demo environment.** The seeded dashboard numbers are
  **sample data for illustration**, not a real cohort.
- The logins are **shared** — anyone with the link and password can sign in.
  **Please don't put any confidential information into the demo.**
- Everything runs on **Cloudflare's global edge** (Workers + D1 + R2 + Queues +
  Cron) — the same infrastructure the finished product uses.

_Questions or feedback? Reply to whoever shared this link._
