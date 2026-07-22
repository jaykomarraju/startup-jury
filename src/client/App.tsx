import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import { AppShell } from "./components";
import { RequireAuth, RequireNav } from "./routes/guards";
import { LoginPage } from "./routes/LoginPage";
import { DashboardPage } from "./routes/DashboardPage";
import { UploadPage } from "./routes/UploadPage";
import { StubPage } from "./routes/StubPage";
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

/** Dashboard for "alldecks", Upload for the upload slugs; others are stubs. */
function NavRoute() {
  const { navId } = useParams();
  if (navId === "alldecks") return <DashboardPage />;
  if (navId === "upload" || navId === "founder-upload") return <UploadPage />;
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
