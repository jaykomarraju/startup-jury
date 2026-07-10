import type { Edition, Role } from "../shared/roles";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SESSIONS: KVNamespace;
}

/** The authenticated principal stored in the session and exposed on the context. */
export interface SessionUser {
  id: string;
  name: string;
  initials: string;
  role: Role;
  edition: Edition;
}

/** Hono environment for typed bindings + context variables. */
export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser };
};
