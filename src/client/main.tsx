import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { BrandingProvider } from "./theme/BrandingProvider";
import { AuthProvider } from "./auth/AuthProvider";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        {/* W4-B — reads the workspace's saved branding and writes it onto
            <html> as CSS custom properties. Inside AuthProvider (the read needs
            a session) and inside ThemeProvider (the applier is theme-aware). */}
        <BrandingProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </BrandingProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
