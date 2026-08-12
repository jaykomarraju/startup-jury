# ai.STARTUPJURY — Live Demo Guide

**Demo URL:** https://startup-jury.jay-komarraju.workers.dev
**Password for every demo login below:** `demo1234`

> _Venture intelligence first._ ai.STARTUPJURY is an AI-powered pitch-deck
> evaluation platform for **incubators / accelerators** and **VC firms**. This is
> the full working product — real role-based access, uploads, AI scoring, the
> complete pipeline for both editions, analytics, and configuration. See
> **"What's live"** below.

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

## What's live

The full product is built and deployed. In this demo you can:

- Use the full **brand design system** (colors, typography, logo, light + dark themes).
- **Sign in** with real, **role-based navigation** — each role sees only its
  permitted areas (this is the actual permission model, not a mockup).
- Explore both the **Incubator** and **VC** editions, each with its own dashboard,
  deck list, pipeline stages, and menu.
- **Upload a pitch deck (PDF)** and have **Claude read and score it** against the
  weighted scoring rubric, then open the **Evaluation Report** (extracted slides +
  per-parameter scores + weighted total).
- Work a deck in the **evaluator workbench** — the actual PDF rendered in-app
  (click a slide to enlarge, next/prev), the **AI's score and reasoning for every
  parameter**, **AI · My · Average** columns where the average updates live as you
  score, "deck 3 of 5" progress across your queue, and a **Research** button that
  opens your *own* ChatGPT / Claude / Perplexity / Gemini / Copilot in a new tab.
- See the **rescore guard** in action: the AI will not re-score a deck unless its
  content changed or an admin changed the criteria — it tells you so instead.
- Browse the **Sector → Program → Cohort** hierarchy, filter the deck list by
  program and cohort, and run the four-step **Set up wizard**.
- See the **22-parameter rubric**: 13 weighted core areas that make up the score,
  plus up to 3 additional AI-assisted parameters per role, each with its own
  editable prompt (Premium plan).
- Watch the **guardrails** work — a per-program **minimum shortlist score** that
  blocks a shortlist below it, **duplicate / returning-company** flags, and
  **upload validation** that marks a deck **Incomplete** when required founder
  details are missing.
- Follow the **Incomplete → resubmit loop**: the founder is emailed a secure link,
  sees exactly which sections are missing, re-uploads a corrected deck as a **new
  version**, and it is re-scored automatically. Try it with no login at all:
  **/resubmit/aisj-demo-nimbushr-resubmit-2026**
- **Schedule intro / partner / alignment calls** with any participants (team +
  founder, any email domain) and download the universal **`.ics`** invite.
- **Manage your team** in the Admin console (create jurors, staff and mentors),
  view **My account**, and top up **credits**.
- Log testing issues in the in-app **Issue log**, and **export** any deck table
  to CSV.
- **Move deals through the pipeline** — assign to jury, score, shortlist, schedule
  intro/partner/alignment calls, IC voting, term sheets, legal DD, onboarding,
  archive — with a full audit log of every transition.
- Run the **founder query loop** (Incomplete → query → founder response → re-intake)
  from the isolated **Founder portal**.
- View **analytics** — Cohort summary, Evaluator scores, Score drift, Pipeline
  funnel (incubator); Capital deployment, Portfolio construction, Scoring summary,
  Diligence & risk, Decision history (VC).
- **Configure** the platform (admin) — parameter weights (with live re-scoring),
  cohort thresholds, AI system prompt, branding, plan tier, and admin-granted
  **credits**; raise **support tickets** and **contact** messages.

> **AI scoring note:** live scoring is **on and verified** — upload a PDF and
> Claude reads the slides and scores them in about 10–20 seconds. If the platform's
> Anthropic account ever runs out of credits, the deck is still stored and the app
> now **says so plainly** on the dashboard (with the real reason and a "Re-run AI"
> button) instead of leaving it silently stuck. The numbers on the seeded demo
> cohort are illustrative sample data.

> **Email note:** the app composes and records every message it would send
> (Incomplete notices, call invites with their `.ics`, new-user invites). Actual
> delivery switches on the moment a verified sending domain is configured — until
> then messages are recorded rather than sent, and the app never claims otherwise.

## Good to know

- This is a **shared demo environment**. The numbers on the dashboards are
  **sample data for illustration**, not a real cohort.
- Please treat the demo logins as shared — anyone with the link and password can
  sign in. **Don't put any confidential information into the demo.**
- Everything runs on **Cloudflare** (a single global edge deployment), which is
  the same infrastructure the finished product will use.

_Questions or feedback on the demo? Reply to whoever shared this link._
