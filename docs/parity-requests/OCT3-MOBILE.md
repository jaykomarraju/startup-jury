# OCT3-MOBILE — handoff

Lane: the two measured phone-width defects on `JuryBuddyLauncher.tsx` and
`DashboardPage.tsx`. Both shipped. Two items below need an owner outside this
lane's file list.

## Shipped

1. **JURYbuddy launcher geometry is now mobile-first.**
   `src/client/routes/help/JuryBuddyLauncher.tsx`. The spec's numbers (60px disc
   at `right:28 bottom:28`, panel 360×520 at `bottom:100`) moved behind `sm:`
   — the 1440px tier they were measured on. Below `sm:` the launcher is a 44px
   disc in the shell's 16px gutter and the panel spans gutter-to-gutter with
   `max-h-[70vh]`. Desktop rendering is byte-identical.

2. **Dashboard toolbar stacks at phone width.**
   `src/client/routes/DashboardPage.tsx`. New local `useIsPhone()`
   (`(max-width: 639px)`, same shape as `Sidebar.tsx`'s `useIconRail`). At that
   width the action group moves into the subtitle column, so `.tb` has one
   full-width child instead of two. The wrapper keeps the `tbr` class, so
   `@media (max-width:899px){.tbr .tbb:not(.pr){display:none}}` still hides the
   non-primary actions exactly as before. Desktop is unchanged.

Tests: `test/client/juryBuddyLauncher.test.tsx` (geometry split across the two
tiers, with class-SET membership — `toContain("bottom-7")` was also satisfied by
`sm:bottom-7`) and the new `test/client/dashboardHeaderPhone.test.tsx`.

## Needs an owner — outside this lane

- **`PanelFrame` body needs bottom padding at phone width** (`PanelFrame.tsx`
  and/or `.sj-frame` in `index.css`). Shrinking the launcher to 44px in the
  gutter cuts its footprint from an 88×88 corner box to 60×60 and takes it out
  of the padding box, but a fixed helper over a region that scrolls *under* it
  can only be fully cleared by reserving space at the bottom of that region.
  Suggested: `padding-bottom: 72px` on the frame's scrolling body below `sm`.

- **The stacking fix is per-screen, not systemic.** `.tb` is a non-wrapping flex
  row with a `flex-shrink: 0` action group for *every* `PanelFrame` screen. The
  same five-line subtitle wrap is latent on `EvaluatePage`, `ConfigPage`,
  `MyParamsPage` and `AnalyticsKit`. The systemic fix is two CSS lines —
  `flex-wrap: wrap` on `.tb` plus `flex-basis: 100%` on its first child under
  `@media (max-width: 639px)` — which would let every screen (and
  `DashboardPage`'s own `useIsPhone` indirection) be deleted. That belongs to
  whoever owns `index.css`.

- **Edition note.** Both changes are ungated by edition, so the VC dashboard
  also stacks at phone width. Deliberate: a responsive layout rule is not
  behaviour, nothing changes at or above `sm`, and gating it would leave the VC
  screen broken at phone width for no reason. `e2e/vc-intake.spec.ts` runs at
  desktop width and is unaffected.
