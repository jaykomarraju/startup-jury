import { useContext } from "react";
import { ThemeContext } from "./ThemeProvider";

/** Access the current theme + setters. Must be used within <ThemeProvider>. */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
