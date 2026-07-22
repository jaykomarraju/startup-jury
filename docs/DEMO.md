# ai.STARTUPJURY — Live Demo Guide

**Demo URL:** https://startup-jury.jay-komarraju.workers.dev
**Password for every demo login below:** `demo1234`

> _Venture intelligence first._ ai.STARTUPJURY is an AI-powered pitch-deck
> evaluation platform for **incubators / accelerators** and **VC firms**. This is
> an early, working preview — it shows the real product's look, navigation, and
> role-based access. The deeper workflows (AI scoring, uploads, pipeline actions,
> analytics) are on the way; see **"What's live vs. coming"** below.

---

## What this demo is

A single platform that runs **two editions** on the same engine:

- **Incubator edition** — for accelerator / incubator programs (Super User, Admin,
  Program Manager, Program Associate, Jury Member, plus a Founder portal).
- **VC edition** — for venture funds (Managing Partner, Admin, Partner, IC Member,
  Investment Associate, Analyst).

Each person logs in and sees **only the parts of the app their role is allowed to
use** — the navigation and actions change per role, exactly as they will in
production. That role-based access control is real and fully working in this demo.

## How to explore it (5 minutes)

1. Open **https://startup-jury.jay-komarraju.workers.dev** — you'll land on the
   sign-in screen.
2. Pick any login from the table below (the sign-in screen also lists these as
   one-click shortcuts). Password is always `demo1234`.
3. After signing in you'll see that role's **dashboard**: key metrics, a deck
   list, and a pipeline-progress panel.
4. **Click any startup row** to open its **Evaluation Report** panel (scores +
   extracted-slide layout).
5. Use the **sun/moon icon** (top-right) to switch between light and dark themes.
6. **Sign out** (top-right) and sign in as a different role to see how the
   navigation changes — e.g. a **Jury Member** sees a trimmed, evaluation-focused
   menu, while a **Super User** sees everything.

## Demo logins

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

## What's live vs. coming

**Live in this demo**

- The full **brand design system** (colors, typography, logo, light + dark themes).
- **Real sign-in** and **role-based navigation** — each role sees only its
  permitted areas (this is the actual permission model, not a mockup).
- Both the **Incubator** and **VC** editions, each with its own dashboard,
  pipeline stages, and menu.
- The **dashboard, deck list, and Evaluation Report** screens.

**Coming next (in build)**

- **Upload a pitch deck (PDF)** and have **AI read and score it** against the
  scoring rubric (the numbers you see today are illustrative sample data).
- **Moving deals through the pipeline** — assign to jury, shortlist, schedule
  calls, IC voting, term sheets, onboarding, archive, etc.
- **Founder query loop**, **analytics** (cohort summary, score drift, funnel,
  portfolio), **configuration** (parameters, weights, thresholds, branding), and
  **plan/credit** management.

## Good to know

- This is a **shared demo environment**. The numbers on the dashboards are
  **sample data for illustration**, not a real cohort.
- Please treat the demo logins as shared — anyone with the link and password can
  sign in. **Don't put any confidential information into the demo.**
- Everything runs on **Cloudflare** (a single global edge deployment), which is
  the same infrastructure the finished product will use.

_Questions or feedback on the demo? Reply to whoever shared this link._
