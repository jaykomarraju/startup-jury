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
 *
 * ── L4, GCW pilot wave ──────────────────────────────────────────────────────
 * The same reason holds a second time, so three more groups land here rather
 * than in `api.ts`: the **approval queue** (`?approval=pending`, approve,
 * decline), the roster read that carries the two fields `UserView` cannot gain
 * in a file this lane does not own, and the **account surface**'s own calls.
 * The last of those sits in a module named `teamApi` on purpose: its sibling
 * `changeOwnPassword` has been here since W4-A with no caller at all, and the
 * screen that finally calls it is My account.
 */
import { ApiError, listUsers, type InviteResult, type UserView } from "../../api";

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

// ── The roster, with the two fields `UserView` cannot carry (L4) ─────────────

export type ApprovalState = "pending" | "approved" | "declined";

/** An absence, with `active` already resolved against today by the server so no
 *  screen re-derives it from two date strings. */
export interface OutOfOfficeState {
  from: string;
  to: string;
  delegateId: string | null;
  active: boolean;
}

/**
 * A roster row as `GET /api/users` now sends it.
 *
 * Both additions are OPTIONAL, following the precedent `UserView.invitePending`
 * set for exactly this reason ("Optional so a reader on an older payload still
 * type-checks") — and here it also keeps every existing test fixture that builds a
 * `UserView` by hand valid without touching it.
 *
 * `UserView` itself lives in `src/client/api.ts`, which this lane does not own, so
 * the extension is declared here rather than added there.
 */
export interface RosterUser extends UserView {
  approvalState?: ApprovalState;
  outOfOffice?: OutOfOfficeState | null;
  /**
   * This person was never sent a credential and has never signed in — an approved
   * SELF-REGISTRANT, who already holds the password they chose on the registration
   * form. `invitePending` is also true of them and means something else entirely,
   * so **Resend** must not be offered on their row: it would replace that password.
   *
   * Server-derived rather than inferred here from `inviteSentAt` being absent,
   * which matters: optional fields are absent on a payload that predates them, and
   * "absent" must mean today's behaviour (an ordinary invitee), never the new
   * branch. `POST /api/users/:id/resend-invite` refuses the same case with
   * `no_invite_to_resend`, so this only decides what is DRAWN.
   */
  selfRegistered?: boolean;
}

/**
 * `GET /api/users` — the roster, typed for the three L4 fields. The default
 * response now excludes registrations that are still pending or declined (see the
 * route).
 *
 * **It DELEGATES to `api.ts`'s `listUsers` rather than issuing its own fetch**, and
 * that is not tidiness: `test/client/adminConsole.test.tsx` drives this screen by
 * mocking the `api` MODULE (`vi.mocked(listUsers).mockResolvedValue(...)`), not by
 * mocking `fetch`. A second fetch here would walk straight past that mock and the
 * console's roster would render empty in a test file this lane does not own.
 *
 * No cast is needed and none is used: every field `RosterUser` adds to `UserView`
 * is optional, so `UserView` is assignable to it — which is also the exact reason
 * they are optional (a payload that predates a field must still type-check).
 */
export function listRoster(): Promise<{ users: RosterUser[] }> {
  return listUsers();
}

/** `GET /api/users?approval=pending` — self-registrations awaiting a decision,
 *  oldest first. */
export function listPendingRegistrations(): Promise<{ users: RosterUser[] }> {
  return fetch("/api/users?approval=pending").then((r) => json<{ users: RosterUser[] }>(r));
}

/** `POST /api/users/:id/approve` — admit a registrant with the role the
 *  administrator chose. The role is validated server-side against
 *  `creatableStaffRoles`; the screen offers exactly that list. */
export function approveRegistration(id: string, role: string, title?: string) {
  return send<{ ok: true; user: RosterUser }>("POST", `/api/users/${id}/approve`, {
    role,
    ...(title ? { title } : {}),
  });
}

/** `POST /api/users/:id/decline` — refuse a registration. The row is kept, which
 *  also keeps the address taken (see the route); `deleteUser` is the release. */
export function declineRegistration(id: string) {
  return send<{ ok: true; user: RosterUser }>("POST", `/api/users/${id}/decline`);
}

// ── My account: credential state and out of office (L4) ──────────────────────

export interface CoveredAssignment {
  deckId: string;
  deckName: string;
  dueAt: string | null;
}

export interface CoveredFor {
  userId: string;
  name: string;
  until: string;
  assignments: CoveredAssignment[];
}

/** `GET /api/users/me/account` — the facts about your own row that the cached
 *  principal in `AuthProvider` cannot carry, in one request. `minPasswordLength`
 *  comes from the server so the client never restates the number. */
export interface MyAccountView {
  mustChangePassword: boolean;
  minPasswordLength: number;
  outOfOffice: OutOfOfficeState | null;
  maxOutOfOfficeDays: number;
  delegates: { id: string; name: string; roleLabel: string }[];
  coveringFor: CoveredFor[];
}

export function getMyAccount(): Promise<MyAccountView> {
  return fetch("/api/users/me/account").then((r) => json<MyAccountView>(r));
}

/** `PUT /api/users/me/out-of-office`. `delegateId` null means "out, with nobody
 *  covering" — a state a person genuinely wants to record. */
export function setOutOfOffice(from: string, to: string, delegateId: string | null) {
  return send<{ ok: true; outOfOffice: OutOfOfficeState }>("PUT", "/api/users/me/out-of-office", {
    from,
    to,
    delegateId,
  });
}

/** `DELETE /api/users/me/out-of-office` — you are back. */
export function clearOutOfOffice() {
  return send<{ ok: true; outOfOffice: null }>("DELETE", "/api/users/me/out-of-office");
}
