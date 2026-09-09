import type { Edition, Role } from "../shared/roles";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  role: Role;
  edition: Edition;
  initials: string;
  active: number;
  /** Organizational alias title (Aug-2026 issue 1); NULL = use the role label. */
  title: string | null;
}

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRow | null> {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email)
    .first<UserRow>();
}

export async function getUserById(
  db: D1Database,
  id: string,
): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

/**
 * A row of `parameters`, the evaluation rubric's definition table. Server code
 * has been selecting subsets of this ad hoc; the shape is declared once here
 * now that W1-B's `0025` added the two columns the specs' `parameter_definitions`
 * sketch names — a scorer-facing `description`, and the admin console's
 * *Permit configuration* flag.
 */
export interface ParameterRow {
  id: string;
  edition: Edition;
  key: string;
  name: string;
  /** 0 for informational / role-scoped additional parameters. */
  weight: number;
  informational: number;
  /** The owning role for an additional parameter; NULL for the 13 core areas. */
  role_scope: string | null;
  /** Per-parameter AI extraction / guidance prompt. */
  prompt: string | null;
  /** Shown to the scorer beside the parameter (specs §6.2). */
  description: string | null;
  /** Admin console → Area weights → "Permit configuration". */
  config_permitted: number;
  sort_order: number;
  active: number;
}

export async function getParameters(
  db: D1Database,
  edition: Edition,
  { includeInactive = false } = {},
): Promise<ParameterRow[]> {
  const sql =
    "SELECT * FROM parameters WHERE edition = ?" +
    (includeInactive ? "" : " AND active = 1") +
    " ORDER BY sort_order";
  const { results } = await db.prepare(sql).bind(edition).all<ParameterRow>();
  return results;
}
