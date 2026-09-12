/**
 * Client calls for the Admin console's **Team & roles** and **User access**
 * sections (W4-A): the task-permission grid W3-A's API serves, and the three
 * user verbs §8 Q27 left without one.
 *
 * Its own module rather than an append to `src/client/api.ts`, following the
 * precedent `scoringApi.ts` set in Wave 2: four Wave 4 sessions land in
 * parallel and `api.ts` is the file all four would otherwise touch. `ApiError`
 * and `UserView` still come from `api.ts`; only the routes this session added
 * live here. Folding it back is a later tidy-up, not a behaviour change (§9).
 */
import { ApiError, type InviteResult } from "../../api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => json<T>(r));
}

// ── The task-permission grid ─────────────────────────────────────────────────

export interface PermissionRoleColumn {
  role: string;
  /** The application's own role name — `ROLE_LABELS`, not the prototype's. */
  label: string;
}

export interface PermissionTaskRow {
  id: string;
  /** The prototype's own row label ("Permit to add team members"). */
  label: string;
  group: string;
  /** Why a row exists that nothing enforces yet — see `NOT_ENFORCED` below. */
  note?: string;
}

/**
 * `GET /api/permissions`. The `grid` is already RESOLVED — an override where one
 * exists, the shipped seed otherwise — so the screen renders it as it arrives
 * and never re-derives a cell from `DEFAULT_ROLE_PERMISSIONS`, which would show
 * the seed and silently ignore every edit an administrator has made.
 */
export interface PermissionGrid {
  edition: "incubator" | "vc";
  roles: PermissionRoleColumn[];
  tasks: PermissionTaskRow[];
  /** `grid[taskId][role]`. */
  grid: Record<string, Record<string, boolean>>;
}

export function getPermissionGrid(): Promise<PermissionGrid> {
  return fetch("/api/permissions").then((r) => json<PermissionGrid>(r));
}

export interface PermissionCell {
  role: string;
  taskId: string;
  granted: boolean;
}

/** `PUT /api/permissions`. Refuses `immutable_superuser` and
 *  `cannot_lock_yourself_out`; the screen does not offer either. */
export function putPermissionCells(cells: PermissionCell[]) {
  return send<{ ok: true; updated: number; cells: PermissionCell[] }>("PUT", "/api/permissions", {
    cells,
  });
}

// ── User lifecycle verbs (W4-A) ──────────────────────────────────────────────

/** `DELETE /api/users/:id` — remove a member, or cancel a pending invite. */
export function deleteUser(id: string) {
  return send<{ ok: true; id: string; cancelledInvite: boolean }>("DELETE", `/api/users/${id}`);
}

/** What came back from a route that ISSUED a credential. `tempPassword` is
 *  present only when the mail could not be delivered — never a stored one. */
export interface CredentialIssued {
  ok: true;
  tempPassword?: string;
  invite: InviteResult;
}

/** `POST /api/users/:id/reset-password` — issue a fresh temporary credential. */
export function resetUserPassword(id: string) {
  return send<CredentialIssued>("POST", `/api/users/${id}/reset-password`);
}

/** `POST /api/users/:id/resend-invite` — send a pending invite again. */
export function resendInvite(id: string) {
  return send<CredentialIssued>("POST", `/api/users/${id}/resend-invite`);
}

/**
 * `POST /api/users/:id/transfer-ownership` — hand the account owner's seat over
 * (F0062). Superuser only, and it ENDS the caller's session: the response comes
 * back with the cookie already cleared, so the caller must sign in again.
 */
export function transferOwnership(id: string) {
  return send<{ ok: true; owner: { id: string; name: string; email: string }; signedOut: true }>(
    "POST",
    `/api/users/${id}/transfer-ownership`,
  );
}

/** `PUT /api/users/me/password` — change your own password (F0075). */
export function changeOwnPassword(currentPassword: string, newPassword: string) {
  return send<{ ok: true }>("PUT", "/api/users/me/password", { currentPassword, newPassword });
}
