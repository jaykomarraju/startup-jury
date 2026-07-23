import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import { AppShell } from "./components";
import { RequireAuth, RequireNav } from "./routes/guards";
import { LoginPage } from "./routes/LoginPage";
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
import { FounderHomePage, FounderQueriesPage, FounderSignupPage } from "./routes/FounderPortal";
import { TicketsPage, ContactPage } from "./routes/SupportPages";
import {
  CohortSummaryPage,
  EvaluatorScoresPage,
  ScoreDriftPage,
  FunnelPage,
} from "./routes/analytics/IncubatorReports";
import { RepDecksPage, RepScoresPage, RepDriftPage } from "./routes/analytics/JuryReports";
import {
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

/** /app index — send the user to their role's landing nav item. */
function LandingRedirect() {
  const { user } = useAuth();
  if (!user) return null;
  return <Navigate to={`/app/${landingNavId(user.edition, user.role)}`} replace />;
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

  // Analytics reports (Phase 7). Funnel is shared; the rest are edition-specific
  // but the nav guard already restricts visibility per edition/role.
  if (navId === "funnel") return <FunnelPage />;
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
  if (navId === "support") return <TicketsPage />;
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
    const stage = INCUBATOR_STAGE_CONFIG[navId];
    if (stage) return <StagePage config={stage} />;
  }

  // VC pipeline screens (Phase 5).
  if (user.edition === "vc") {
    // "Evaluate" and "Submit" both open the rubric scoring + advance flow.
    if (navId === "evaluate" || navId === "assign") return <VcEvaluatePage />;
    if (navId === "icpipeline") return <IcVotePage />;
    const stage = VC_STAGE_CONFIG[navId];
    if (stage) return <StagePage config={stage} />;
  }

  return <StubPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
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
