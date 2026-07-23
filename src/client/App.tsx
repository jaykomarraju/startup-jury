import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import { AppShell } from "./components";
import { RequireAuth, RequireNav } from "./routes/guards";
import { LoginPage } from "./routes/LoginPage";
import { DashboardPage } from "./routes/DashboardPage";
import { UploadPage } from "./routes/UploadPage";
import { StubPage } from "./routes/StubPage";
import { StagePage, INCUBATOR_STAGE_CONFIG } from "./routes/StagePage";
import { AssignPage } from "./routes/AssignPage";
import { EvaluatePage } from "./routes/EvaluatePage";
import { QueryPage } from "./routes/QueryPage";
import { FounderHomePage, FounderQueriesPage, FounderSignupPage } from "./routes/FounderPortal";
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

  // Founder portal.
  if (navId === "founder-home") return <FounderHomePage />;
  if (navId === "founder-queries") return <FounderQueriesPage />;
  if (navId === "founder-signup") return <FounderSignupPage />;

  // Incubator staff workflow screens (Phase 4). VC keeps stubs until Phase 5.
  if (user.edition === "incubator") {
    if (navId === "assign") return <AssignPage />;
    // Staff "Evaluate" and a jury member's "Assigned" both open the scoring form.
    if (navId === "evaluate" || navId === "jassigned") return <EvaluatePage />;
    if (navId === "query") return <QueryPage />;
    const stage = INCUBATOR_STAGE_CONFIG[navId];
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
