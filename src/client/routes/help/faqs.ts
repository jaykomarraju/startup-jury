/**
 * JURYbuddy — the FAQ content model, ported VERBATIM from the client's spec
 * (`Help_JURYbuddy.HTM`, 2026-09-20). V3 item 15.
 *
 * ── Why the questions and answers live here, and the clips do not ───────────
 * The spec is an 8.2 MB single file: 38.5 KB of markup and widget script, and
 * **7.81 MB of base64 `data:video/mp4` — 41 clips, 5.86 MB decoded.** The text
 * below is 12.7 KB, so it is bundled; the clips are served from R2 through
 * `GET /api/help/clips/:clipId` and never enter the bundle. See
 * `docs/prototype/tools/extract-help-clips.py` for the one-off extraction.
 *
 * ── The answers are the CLIENT'S copy, deliberately unedited ────────────────
 * Several assert things the built app does not do. They are shipped as written
 * because the copy is the client's to own, and every conflict is recorded in
 * `docs/plan_v3_superuser.md` §12 under "S5-HELP — answers that are wrong today".
 * Do not quietly correct one here; that hides the question instead of asking it.
 *
 * ARRAY ORDER IS LOAD-BEARING: the spec's home view is `FAQS.slice(0, 4)`
 * ("POPULAR RIGHT NOW") and its browse-all view groups by first appearance of
 * `section`, so reordering this array changes both screens.
 */

export interface HelpFaq {
  id: string;
  /** A section heading in the browse-all view. Free text in the spec, not an enum. */
  section: string;
  question: string;
  answer: string;
  /** Key into `HELP_CLIPS` and the R2 object name (`help/clips/<clipId>.mp4`). */
  clipId: string;
}

/** Clip METADATA only — the bytes live in R2, keyed by `clipId`. */
export interface HelpClip {
  title: string;
  durationSec: number;
}

export const HELP_FAQS: readonly HelpFaq[] = [
  {
    id: "what-does-it-do",
    section: "What Is This Platform?",
    question: "What does ai.STARTUPJURY actually do?",
    answer:
      "An AI-native venture intelligence platform that replaces manual evaluation with automated pitch deck scoring based on AI. It enables full pipeline management — from first upload through to a final decision.",
    clipId: "faq_clip_1",
  },
  {
    id: "who-is-it-for",
    section: "What Is This Platform?",
    question: "Who is ai.STARTUPJURY meant for?",
    answer:
      "A perfect tool for incubators, accelerators, VCs, family offices, individual investors, and consultants. One place to evaluate decks and coordinate with your team, see averaged evaluations, with reports for analytics. Every deck stored, archived, and retrievable anytime.",
    clipId: "faq_clip_2",
  },
  {
    id: "evaluation-work-standard",
    section: "What Is This Platform?",
    question: "How does ai.STARTUPJURY evaluation work, actually?",
    answer:
      "If you subscribe for an Individual plan and opt for a Standard seat, your pitch decks are evaluated automatically using AI, against 13 core parameters, with default criteria built in. You get an evaluation report with scores and remarks per parameter. Upload decks in bulk, get each report in quick time.",
    clipId: "evaluation_work_standard",
  },
  {
    id: "customize-core-13-pro",
    section: "What Is This Platform?",
    question: "Can I customize the core 13 parameters to suit our business as an Individual?",
    answer:
      "Yes — with an Individual plan and a Pro seat, you can customize each of the 13 core parameters and their weightages.",
    clipId: "faq_clip_4",
  },
  {
    id: "additional-params-premium",
    section: "What Is This Platform?",
    question: "Can we add additional parameters over the core 13, to evaluate?",
    answer:
      "Yes — with a Premium seat, you can add 3 parameters per seat, customized to suit your business. These additional parameters don't add to the score — they help you take the decision.",
    clipId: "additional_params_premium",
  },
  {
    id: "team-members-evaluate",
    section: "What Is This Platform?",
    question: "Can I get them evaluated by other team members too?",
    answer:
      "Yes — with an Organization plan, other team members can evaluate and score decks too, on the same 13 core parameters, and pass them to the next team member or jury in the workflow. You see the average of AI and team scores.",
    clipId: "faq_clip_6",
  },
  {
    id: "how-many-seat-types",
    section: "What Is This Platform?",
    question: "How many types of seats are there?",
    answer:
      "Three — Standard, Pro, and Premium. Standard: 13 core parameters, default criteria and weightages. Pro: customize the 13 core parameters and weightages. Premium: everything in Pro, plus 3 more customized parameters.",
    clipId: "how_many_seat_types",
  },
  {
    id: "free-trial",
    section: "What Is This Platform?",
    question: "Is there a free trial, or do I have to pay first?",
    answer:
      "Yes — sign up as an Individual and try 3 free credits. If you're satisfied, continue on a starter annual plan — one Premium seat, 125 credits by default.",
    clipId: "free_trial",
  },
  {
    id: "extended-trial",
    section: "What Is This Platform?",
    question: "After the trial, what if I'd like an extended time to get a better feel?",
    answer:
      "You can sign up for a paid trial — one Standard seat, 25 or 50 credits, valid for one quarter. Repeat it as long as you like, until you're ready for the starter annual plan.",
    clipId: "extended_trial",
  },
  {
    id: "credit-vs-seat",
    section: "What Is This Platform?",
    question: "What does each credit or a seat mean?",
    answer:
      "Each credit lets you evaluate one deck and get its report. Each seat unlocks the platform's features for that person — and customization, on Pro and Premium seats. Reports stay stored for your seat's full validity.",
    clipId: "credit_vs_seat",
  },
  {
    id: "alone-or-team",
    section: "What Is This Platform?",
    question: "Do I need my whole team to sign up, or can I try it alone first?",
    answer:
      "Either. Registration offers an Individual account — sign up alone, pick your role, add more seats as you go. Or set up an Organization account, invite your team, and assign roles. Organization unlocks a steep discount — a much lower price per seat or deck. You can even get the app customized or branded for you.",
    clipId: "alone_or_team",
  },
  {
    id: "how-to-register",
    section: "Signing Up",
    question: "How do I register?",
    answer:
      "On the website, click \"Try 3 decks free\" and register. You'll get approval for a trial, and you can explore on your own from there.",
    clipId: "how_to_register",
  },
  {
    id: "individual-vs-org",
    section: "Signing Up",
    question: "What's the difference between an Individual and an Organization account?",
    answer:
      "Individual suits solo consultants or investors — even people at organizations can register solo and upgrade later. Organization is built for VC firms, incubators, accelerators — invite your team, assign roles, manage multiple users from day one.",
    clipId: "individual_vs_org",
  },
  {
    id: "fund-incubator-which",
    section: "Signing Up",
    question: "I run a fund or incubator — should I sign up as Individual or Organization?",
    answer:
      "Organization — it's built for managing a team, multiple roles, and seats from the start. Or sign up Individual first, try the platform solo, then upgrade to Organization to add cofounders and associates.",
    clipId: "fund_incubator_which",
  },
  {
    id: "register-org-invite-team",
    section: "Signing Up",
    question: "How do I register my organization and invite my team?",
    answer:
      "Choose \"Organization\" at registration. Select your org type — Incubator/Accelerator or Investor. Fill in org details — name, business type, team size, location, contact person. Then pick your seats and decks for the annual plan.",
    clipId: "register_org_invite_team",
  },
  {
    id: "info-needed-superuser",
    section: "Signing Up",
    question: "What information do I need on hand before I start signing up?",
    answer:
      "As an Individual — your name, work email, and phone. As an Organization, you also need your super user — the owner who approves startups, payments, users, and delegates powers. Have their name and work email ready to nominate them.",
    clipId: "superuser_info_needed",
  },
  {
    id: "core-13-parameters",
    section: "Choosing a Plan",
    question: "What are the “13 core parameters”?",
    answer:
      "The standard framework every deck or deal is scored against, regardless of plan. AI scores each parameter first; your team can then add or adjust scores, and the average updates automatically as more scores come in. The default parameters are the common parameters that any incubator or accelerator looks for. They are Problem, Solution, Market, Product, Model, Traction, Competition, GTM, Team, Risks, Business Attractiveness, Moat and Story Telling",
    clipId: "faq_13_1",
  },
  {
    id: "additional-vs-core",
    section: "Choosing a Plan",
    question: "What are “additional parameters,” and how are they different from core parameters?",
    answer:
      "Additional parameters are a set of 3 extra scoring criteria layered on top of the 13 core parameters. Unlike the core 13 parameters. The core parameters apply the same way to everyone, but additional three parameters are configurable per role.",
    clipId: "faq_ad_1",
  },
  {
    id: "after-upload",
    section: "The Evaluation Workflow",
    question: "What happens right after I upload a deck?",
    answer:
      "Right after uploading the deck, the AI evaluates it and lists them under the “Uploaded” stat box in the dashboard. If you are in the individual plan, you can add your scores to the deck and remarks before submitting your evaluation. The evaluation report calculates the average scores automatically. You can export the report for your use. If you are in the Organization plan, you can assign the deck to the next role for evaluation.",
    clipId: "faq_af_1",
  },
  {
    id: "ai-scores-automatic",
    section: "The Evaluation Workflow",
    question: "Does AI score the deck automatically, or do I have to score it myself?",
    answer:
      "Both. AI scores every parameter first; each of you your team's role then adds scores on top, and the average updates automatically as more scores come in.",
    clipId: "faq_ai_1",
  },
  {
    id: "comments-notes",
    section: "The Evaluation Workflow",
    question: "Can I leave comments or notes for my team to see?",
    answer:
      "Yes — alignment call notes capture what was discussed on a call and are visible to the whole evaluation team, not just the person who took the call. Beyond that if you have something more, you can always collaborate through the application to send messages.",
    clipId: "faq_co_1",
  },
  {
    id: "find-program-settings",
    section: "First Login & Navigation",
    question: "Where do I find my program's or fund's settings?",
    answer:
      "Under Settings in the sidebar — Core Parameters, My Parameters, Set up, My account, and Admin console (the last one role-restricted). As soon as you open the account, you should define the Programs and Cohorts that you run. This enables you to define the parameters, weightages and rubric anchors (LIKE Best, Good, Average, Bad and Poor) per Program and Cohort, which can be selected as the relevant context before uploading the decks.",
    clipId: "faq_fi_1",
  },
  {
    id: "invite-team-member",
    section: "Team & Collaboration",
    question: "How do I invite someone to my team?",
    answer:
      "A team member can be added from the admin console by inviting by email and assigning a role. The admin console is accessible to only the Superuser or Admin appointed by the Superuser.",
    clipId: "faq_in_1",
  },
  {
    id: "logged-in-dashboard",
    section: "First Login & Navigation",
    question: "I just logged in — what am I looking at?",
    answer:
      "Your dashboard, scoped to your role. The sidebar is organized into Workflows (your evaluation pipeline), Reports, Settings, Collaborate, and Support — but which items you see under each depends on your role's permissions.",
    clipId: "faq_lo_1",
  },
  {
    id: "overall-score-calc",
    section: "The Evaluation Workflow",
    question: "How is the overall score calculated from individual parameter scores?",
    answer:
      "Individual parameter scores (0–10 each) roll up into one overall score, averaged automatically across every evaluator who has scored that parameter. The score would be as per the weightages and rubric anchors helps the application to put the decks into 5 categories like Poor, Bad, Average, Good, Best, as example, that you have set in the admin console. It is finally 50% of AI and 50% of human that’s taken as final average scores. However, the human discretion allows to see the additional parameters s’s scored by other roles and the remarks given by them to give a final human verdict.",
    clipId: "faq_ov_1",
  },
  {
    id: "override-ai-score",
    section: "The Evaluation Workflow",
    question: "Can I override or edit an AI-generated score?",
    answer:
      "No and Yes. The idea is to avoid bias by creating a consistent evaluation criteria and weightages. If you find any reason to override, you have to visit the prompts of the parameters, weightages given and the rubric anchors configured. You can override the AI score & remark, by not rejecting it but by taking a final human call. The idea is to let the application handle the triage of essential evaluation process so that you can spend quality time in the final verdict.",
    clipId: "faq_ov_2",
  },
  {
    id: "pipeline-stages",
    section: "The Evaluation Workflow",
    question: "What does each pipeline stage mean?",
    answer:
      "On the VC side, deals move through Upload → Review → Score → Decision → Archive, with separate IC, Partner, and Associate pipelines tracked independently. Due diligence stages (Investment DD, IC Pipeline, Alignment call, Term sheet Pipeline, Legal DD, Onboard ready) follow after an initial decision.",
    clipId: "faq_pi_1",
  },
  {
    id: "research-button",
    section: "The Evaluation Workflow",
    question: "How can I research on the startup details while I am evaluating the deck?",
    answer:
      "You can click on the “Research” button on top of the “Evaluation Report”. You get options to log in to your own accounts of AI chatbots or use the LLMs of the application to conduct research.",
    clipId: "faq_re_1",
  },
  {
    id: "role-meaning",
    section: "First Login & Navigation",
    question: "What does my role mean, and what can I actually do?",
    answer:
      "Each role has a defined scope. On the VC side, for example: Managing Partner (Super User) has full administrative control; Admin handles user/seat management and the support ticket queue; Partner/Principal leads deals across the pipeline; IC Member runs the Investment Committee workflow; Investment Associate handles hands-on deal execution; Analyst has a read-only view across parameters, scoring, and reports.",
    clipId: "faq_ro_1",
  },
  {
    id: "role-restricted-screens",
    section: "First Login & Navigation",
    question: "Why can't I see a particular screen — is that normal for my role?",
    answer:
      "Likely yes. Screens like Admin console, billing approvals, or org-wide settings are scoped to specific roles (typically Super User or Admin) and won't appear for every seat.",
    clipId: "faq_ro_2",
  },
  {
    id: "schedule-founder-call",
    section: "Team & Collaboration",
    question: "How do I schedule a call with a founder from inside the platform?",
    answer:
      "As and when you are assigned to be the scheduler of calls for the selected decks, you can choose the button “Schedule calls”, which takes you to regular options. You would get an intermediate screen with options to select the team members you want them to be part of the call. Once you select the team members click your option for the Video call and you will be able to schedule in a normal way.",
    clipId: "faq_sc_1",
  },
  {
    id: "upload-pitch-deck",
    section: "The Evaluation Workflow",
    question: "How do I upload a pitch deck?",
    answer:
      "From the Upload screen under your Evaluation workflow group in the sidebar. You can upload a single deck or upload in bulk. However, if you want a CRM integration to pull decks in automatically, you must be in the enterprise plan and we can help you customize that on raising a ticket.",
    clipId: "faq_up_1",
  },
  {
    id: "waiting-on-me",
    section: "The Evaluation Workflow",
    question: "How do I know if a deck or deal is waiting on me specifically?",
    answer:
      "The notification bell surfaces alerts for new submissions, reviews due, and decisions made. Every role has the pipeline item in the side bar which shows the decks assigned.",
    clipId: "faq_wa_1",
  },
  {
    id: "pricing-plans",
    section: "Billing & Credits",
    question: "Where can I see all the pricing plans?",
    answer:
      "On the sidebar, click on “My account” to explore the entire 3 free trials, paid trials, Credit packs under annual subscriptions of Individual and Enterprise plans.",
    clipId: "faq_pricing_plans",
  },
  {
    id: "credits-left",
    section: "Billing & Credits",
    question: "How do I see how many credits or decks I have left?",
    answer:
      "On the sidebar in the “upload” screen, you will always find the balance credits you have. On the sidebar in the “My account” screen you can see “Credits & billing” section, where you get all the details.",
    clipId: "faq_credits_left",
  },
  {
    id: "buy-more-credits",
    section: "Billing & Credits",
    question: "How do I buy more credits?",
    answer:
      "You can go to “My account” and create account before going to choose your plans. Under individual plans, you can go for one premium seat with 125 Credits, to start with. You can add credits from the credit packs available on the screen of “Annual Subscription,” as you go.",
    clipId: "faq_buy_more_credits",
  },
  {
    id: "upgrade-to-enterprise",
    section: "Billing & Credits",
    question: "How do I upgrade plan from Individual to Enterprise plan?",
    answer:
      "On the sidebar in the “my account” screen, you go to “Annual Subscriptions” and click “Upgrade to Enterprise”. It takes you to a screen where you have to nominate the superuser before going to “Annual Subscriptions” screen. Here you can pick and choose the seats you want or the credit packs you want. Or else click “Enterprise plans” on the bottom of the same page, and choose Basic or Basic Plus plan. It is self-explanatory there.",
    clipId: "faq_upgrade_to_enterprise",
  },
  {
    id: "who-manages-billing",
    section: "Billing & Credits",
    question: "Who in my organization can see or manage billing?",
    answer:
      "Only the Superuser by default. The users can send request for buying credits by raising a ticket (by clicking the “tickets” on the side bar. Only the Superuser has to approve it finally. Either superuser pays or shares his/her screen with someone who pays.",
    clipId: "faq_who_manages_billing",
  },
  {
    id: "raise-ticket",
    section: "Getting Unstuck",
    question: "How do I raise a support ticket?",
    answer:
      "Under Support in the sidebar, click “Tickets”, and submit your issue with a subject, category, and description. It goes to your designated admin in your organization. If you are an individual it comes to our support team.",
    clipId: "faq_raise_ticket",
  },
  {
    id: "track-ticket",
    section: "Getting Unstuck",
    question: "Can I track the status of a ticket I've raised?",
    answer:
      "Yes — your submitted tickets show their status (Open, Pending, Resolved) so you can check progress without waiting on a reply.",
    clipId: "faq_track_ticket",
  },
  {
    id: "help-documentation",
    section: "Getting Unstuck",
    question: "Where do I find help videos or documentation?",
    answer:
      "Under Support, Help can take you to search bar to type your key words. You can find answers to your FAQs along with quick clips. If your query is unresolved, you can raise a ticket for support from us.",
    clipId: "faq_help_documentation",
  },
];

export const HELP_CLIPS: Readonly<Record<string, HelpClip>> = {
  "faq_clip_1": { title: "What does ai.STARTUPJURY actually do?", durationSec: 33 },
  "faq_clip_2": { title: "Who is ai.STARTUPJURY meant for?", durationSec: 35 },
  "evaluation_work_standard": { title: "How does evaluation work?", durationSec: 40 },
  "faq_clip_4": { title: "Customize core 13 parameters (Pro)", durationSec: 22 },
  "additional_params_premium": { title: "Additional parameters (Premium)", durationSec: 30 },
  "faq_clip_6": { title: "Team members evaluate too", durationSec: 35 },
  "how_many_seat_types": { title: "How many seat types?", durationSec: 40 },
  "free_trial": { title: "Free trial", durationSec: 36 },
  "extended_trial": { title: "Extended (paid) trial", durationSec: 38 },
  "credit_vs_seat": { title: "Credit vs. seat", durationSec: 32 },
  "alone_or_team": { title: "Alone or with a team", durationSec: 54 },
  "how_to_register": { title: "How do I register?", durationSec: 35 },
  "individual_vs_org": { title: "Individual vs. Organization", durationSec: 40 },
  "fund_incubator_which": { title: "Fund/incubator — which account", durationSec: 31 },
  "register_org_invite_team": { title: "Register org & invite team", durationSec: 44 },
  "superuser_info_needed": { title: "Info needed — super user", durationSec: 41 },
  "faq_13_1": { title: "The 13 core parameters", durationSec: 26 },
  "faq_ad_1": { title: "Additional vs core parameters", durationSec: 27 },
  "faq_af_1": { title: "What happens after upload", durationSec: 34 },
  "faq_ai_1": { title: "AI scoring, then your team", durationSec: 32 },
  "faq_co_1": { title: "Comments and notes for your team", durationSec: 24 },
  "faq_fi_1": { title: "Finding program/fund settings", durationSec: 44 },
  "faq_in_1": { title: "Inviting a team member", durationSec: 31 },
  "faq_lo_1": { title: "Your dashboard after login", durationSec: 35 },
  "faq_ov_1": { title: "How the overall score is calculated", durationSec: 32 },
  "faq_ov_2": { title: "Overriding an AI score", durationSec: 63 },
  "faq_pi_1": { title: "What each pipeline stage means", durationSec: 36 },
  "faq_re_1": { title: "Researching a startup while evaluating", durationSec: 29 },
  "faq_ro_1": { title: "What your role means", durationSec: 37 },
  "faq_ro_2": { title: "Role-restricted screens", durationSec: 34 },
  "faq_sc_1": { title: "Scheduling a founder call", durationSec: 38 },
  "faq_up_1": { title: "Uploading a pitch deck", durationSec: 45 },
  "faq_wa_1": { title: "Decks waiting on you", durationSec: 30 },
  "faq_pricing_plans": { title: "Where to see all pricing plans", durationSec: 32 },
  "faq_credits_left": { title: "Checking your credits/decks left", durationSec: 34 },
  "faq_buy_more_credits": { title: "Buying more credits", durationSec: 36 },
  "faq_upgrade_to_enterprise": { title: "Upgrading Individual to Enterprise", durationSec: 47 },
  "faq_who_manages_billing": { title: "Who manages billing", durationSec: 28 },
  "faq_raise_ticket": { title: "Raising a support ticket", durationSec: 36 },
  "faq_track_ticket": { title: "Tracking ticket status", durationSec: 28 },
  "faq_help_documentation": { title: "Finding help videos or docs", durationSec: 34 },
};

/** Sections in FIRST-APPEARANCE order, exactly as the spec's browse-all view derives them. */
export function helpSections(faqs: readonly HelpFaq[] = HELP_FAQS): string[] {
  return [...new Set(faqs.map((f) => f.section))];
}

/** The spec's "POPULAR RIGHT NOW" list: the first four entries, in array order. */
export const HELP_POPULAR_COUNT = 4;
