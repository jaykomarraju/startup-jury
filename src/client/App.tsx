import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import { usePermissions } from "./auth/usePermissions";
import { AppShell } from "./components";
import { RequireAuth, RequireNav } from "./routes/guards";
import { LoginPage } from "./routes/LoginPage";
import { SignupPage } from "./routes/SignupPage";
import { ForgotPasswordPage } from "./routes/ForgotPasswordPage";
import { ResetPasswordPage, ChangePasswordPage } from "./routes/ResetPasswordPage";
import ResubmitPage from "./routes/ResubmitPage";
import { DashboardPage } from "./routes/DashboardPage";
import { UploadPage } from "./routes/UploadPage";
import { StubPage } from "./routes/StubPage";
import { StagePage, INCUBATOR_STAGE_CONFIG, VC_STAGE_CONFIG } from "./routes/StagePage";
import { AssignPage } from "./routes/AssignPage";
import { EvaluatePage } from "./routes/EvaluatePage";
import { VcEvaluatePage } from "./routes/VcEvaluatePage";
import { IcVotePage } from "./routes/IcVotePage";
import { QueryPage } from "./routes/QueryPage";
import { ConfigPage } from "./routes/ConfigPage";
import { MyParamsPage } from "./routes/MyParamsPage";
import { SetupWizard } from "./routes/SetupWizard";
import { AdminConsole } from "./routes/admin";
import { AccountPage } from "./routes/AccountPage";
import { BuyCreditsPage } from "./routes/BuyCreditsPage";
import { FounderHomePage, FounderQueriesPage, FounderSignupPage } from "./routes/FounderPortal";
import { TicketsPage, ContactPage, HelpPage } from "./routes/SupportPages";
import { IssueLogPage } from "./routes/IssueLogPage";
import { CallsPage, INCUBATOR_CALLS_CONFIG, VC_CALLS_CONFIG } from "./routes/CallsPage";
import {
  CohortSummaryPage,
  EvaluatorScoresPage,
  ScoreDriftPage,
  FunnelPage,
} from "./routes/analytics/IncubatorReports";
import { RepDecksPage, RepScoresPage, RepDriftPage } from "./routes/analytics/JuryReports";
import {
  VcFunnelPage,
  CapitalPage,
  PortfolioPage,
  ScoringPage,
  DiligencePage,
  DecisionsPage,
} from "./routes/analytics/VcReports";
import { landingNavId } from "../shared/nav";

/** /login — redirect to the app if already authenticated. */
function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/app" replace />;
  return <LoginPage />;
}

/**
 * /signup — same gate as /login. Somebody already signed in has no account to
 * create, and showing them the form would end in a duplicate-address refusal.
 */
function SignupRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/app" replace />;
  return <SignupPage />;
}

/** /app index — send the user to their role's landing nav item. */
function LandingRedirect() {
  const { user } = useAuth();
  // The permission lookup matters here: without it a role whose FIRST nav item
  // has been switched off in the console is redirected to a slug `RequireNav`
  // then refuses, which reads as a broken app rather than a revoked permission.
  // `guards.tsx` already passes it; placed at Wave 3 integration per W3-A's §9
  // request (App.tsx is a hazard file no Wave 3 session owned).
  const can = usePermissions();
  if (!user) return null;
  return <Navigate to={`/app/${landingNavId(user.edition, user.role, can)}`} replace />;
}

/** Maps a nav slug to its live screen; unbuilt slugs fall through to StubPage. */
function NavRoute() {
  const { navId } = useParams();
  const { user } = useAuth();
  if (!navId || !user) return <StubPage />;

  if (navId === "alldecks") return <DashboardPage />;
  if (navId === "upload" || navId === "founder-upload") return <UploadPage />;

  // Config screens (Phase 6) — edition-agnostic, role-gated by nav (coreparams
  // is admin-only; myparams is visible to all roles, editable by admins).
  if (navId === "coreparams") return <ConfigPage />;
  if (navId === "myparams") return <MyParamsPage />;
  if (navId === "setup") return <SetupWizard />;

  // Admin console (W1-C) — the prototype's full-screen overlay, not an in-shell
  // page. It ships ELEVEN of the prototype's sixteen sections: `pc` Price
  // configuration was removed on 24-Sep and the whole Sign-up group (four
  // sections) is hidden until the next release — see `admin/sections.ts`. Both
  // sets of screens still exist and their routes are untouched. My account and
  // Buy credits (Session 4) are edition-agnostic; the nav guard already gates
  // admin/superuser vs all roles.
  if (navId === "admin") return <AdminConsole />;
  if (navId === "account") return <AccountPage />;
  if (navId === "billing") return <BuyCreditsPage />;

  // Analytics reports (Phase 7). Funnel is shared; the rest are edition-specific
  // but the nav guard already restricts visibility per edition/role.
  if (navId === "funnel") return user.edition === "vc" ? <VcFunnelPage /> : <FunnelPage />;
  if (navId === "cohortsummary") return <CohortSummaryPage />;
  if (navId === "evaluatorscores") return <EvaluatorScoresPage />;
  if (navId === "scoredrift") return <ScoreDriftPage />;
  if (navId === "repdecks") return <RepDecksPage />;
  if (navId === "repscores") return <RepScoresPage />;
  if (navId === "repdrift") return <RepDriftPage />;
  if (navId === "capital") return <CapitalPage />;
  if (navId === "portfolio") return <PortfolioPage />;
  if (navId === "scoring") return <ScoringPage />;
  if (navId === "diligence") return <DiligencePage />;
  if (navId === "decisions") return <DecisionsPage />;

  // Tickets + Contact (Phase 7).
  if (navId === "help") return <HelpPage />; // V3 item 15 · JURYbuddy
  if (navId === "support") return <TicketsPage />;
  if (navId === "issues") return <IssueLogPage />;
  if (navId === "contactadmin" || navId === "contactteam") return <ContactPage />;

  // Founder portal.
  if (navId === "founder-home") return <FounderHomePage />;
  if (navId === "founder-queries") return <FounderQueriesPage />;
  if (navId === "founder-signup") return <FounderSignupPage />;

  // Incubator staff workflow screens (Phase 4).
  if (user.edition === "incubator") {
    if (navId === "assign") return <AssignPage />;
    // Staff "Evaluate" and a jury member's "Assigned" both open the scoring form.
    if (navId === "evaluate" || navId === "jassigned") return <EvaluatePage />;
    if (navId === "query") return <QueryPage />;
    const calls = INCUBATOR_CALLS_CONFIG[navId];
    if (calls) return <CallsPage config={calls} />;
    const stage = INCUBATOR_STAGE_CONFIG[navId];
    if (stage) return <StagePage config={stage} />;
  }

  // VC pipeline screens (Phase 5).
  if (user.edition === "vc") {
    // "Evaluate" and "Submit" both open the rubric scoring + advance flow.
    if (navId === "evaluate" || navId === "assign") return <VcEvaluatePage />;
    if (navId === "icpipeline") return <IcVotePage />;
    if (navId === "query") return <QueryPage />;
    const calls = VC_CALLS_CONFIG[navId];
    if (calls) return <CallsPage config={calls} />;
    const stage = VC_STAGE_CONFIG[navId];
    if (stage) return <StagePage config={stage} />;
  }

  return <StubPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      {/* PUBLIC (L3): the credential screens. Siblings of /login and deliberately
          outside the /app subtree for the same reason /resubmit is — the people
          who need them have no session, and the catch-all below would bounce
          them straight back to the sign-in screen they are trying to get past.

          /change-password is the one of the four that DOES need a session, and it
          is here rather than under /app/:navId because it has no nav slug and
          needs none: `RequireNav` gates on `canAccessNav`, and changing your own
          password is not a role-gated task — every principal may do it, founders
          and mentors included. L4 links it from the account menu; it is also a
          URL that can be read out over the phone to somebody holding a temporary
          password, which is exactly the situation it exists for. */}
      <Route path="/signup" element={<SignupRoute />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/change-password"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />
      {/* PUBLIC (Session 6): the tokenized founder resubmit link from the
          Incomplete-deck email. A sibling of /login, deliberately outside the
          /app subtree — founders have no account to sign in with, and the
          catch-all below would otherwise bounce them to the login screen. */}
      <Route path="/resubmit/:token" element={<ResubmitPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<LandingRedirect />} />
        <Route
          path=":navId"
          element={
            <RequireNav>
              <NavRoute />
            </RequireNav>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
