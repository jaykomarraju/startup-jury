import { useContext } from "react";
import { AuthContext } from "./AuthProvider";

/** Access the current auth state + login/logout. Must be within <AuthProvider>. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
