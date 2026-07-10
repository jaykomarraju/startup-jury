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
