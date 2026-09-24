import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VISIBILITY_ROLES } from "../../src/shared/scoreVisibility";

/**
 * **P0-2 — the console and the route now answer the same question.**
 * (`docs/plan_roles_incubator.md` §5, and Q-U (a) in §6.)
 *
 * The defect, as filed: `admin/ScoringFramework.tsx` drew the two
 * `Score visibility matrix` cards for the incubator **superuser** only, while
 * `PUT /api/config/scoring-framework` is `requireTask("adminconsole", "admin")`
 * and `visibilityWrites` persisted any well-formed `visibility` body. So an
 * **admin** could grant a program associate sight of program-manager scores —
 * a real, enforced permission change, driving the deck report and all three
 * incubator analytics reports — through an API whose console does not show them
 * the grid. The VC half was the same defect in the other edition: no VC console
 * draws either matrix, and both VC console roles could write them anyway.
 *
 * Decided **widen, not narrow**: the admin keeps the capability and gains the
 * grid. The role list was written `"admin"` deliberately, and the same role
 * already administers the strictly more powerful Task permissions grid through
 * the same task (`routes/permissions.ts`). Taking the narrower permission
 * system away from the role that holds the wider one is an inconsistency, not a
 * hardening. What actually closes the gap is that there is now exactly **one**
 * predicate — `canEditVisibility` in `server/routes/config.ts` — which both
 * decides the 403 and is shipped to the console as `visibilityEditable`.
 *
 * This file is the write-path proof, and it is deliberately written as a
 * PAIRING rather than as two lists: for every role, *"the console draws the
 * grid"* and *"the route accepts a cell"* are asserted to be the same boolean,
 * measured from real requests. A revert of either half — re-hard-coding the
 * client predicate, or dropping the server gate — separates them and fails
 * here. The client's own half (it renders on the flag and holds no role
 * opinion of its own) is `test/client/scoringFramework.test.tsx`.
 *
 * Negative control run for this file, both directions:
 *   • deleting the `canEditVisibility` gate in the PUT fails
 *     "refuses a matrix write from a console that does not draw the grid" for
 *     both VC roles;
 *   • reverting `visibilityEditable` to `role === "superuser"` fails
 *     "the flag and the 403 are the same predicate" on the admin row.
 */

const BASE = "https://example.com";

/** email → the answer both halves must give for that member. */
const INCUBATOR: Array<[label: string, email: string, mayEdit: boolean]> = [
  ["incubator superuser", "priya.sharma@demo.startupjury.ai", true],
  // The row P0-2 moves: capability without a screen, until now.
  ["incubator admin", "nisha.kapoor@demo.startupjury.ai", true],
  ["incubator program manager", "raj.kumar@demo.startupjury.ai", false],
  ["incubator program associate", "sunita.rao@demo.startupjury.ai", false],
  ["incubator jury", "rajesh.kumar@demo.startupjury.ai", false],
];

/**
 * Both VC console roles. No VC prototype draws either matrix — `admin/s-fw.html`
 * is byte-identical (md5 c3b534ba…) in both VC consoles — so neither may write
 * one, and the edition half of the predicate is what says so.
 */
const VC: Array<[label: string, email: string]> = [
  ["VC superuser", "aarav.khanna@demo.startupjury.ai"],
  ["VC admin", "nisha.kapoor.vc@demo.startupjury.ai"],
];

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const get = (path: string, cookie: string) => SELF.fetch(`${BASE}${path}`, { headers: { cookie } });

const send = (method: string, path: string, cookie: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

interface Framework {
  scoring: Record<string, unknown>;
  visibility: { incubator: Record<string, Record<string, boolean>> };
  editable: boolean;
  visibilityEditable?: boolean;
}

const framework = async (cookie: string): Promise<Framework> =>
  (await get("/api/config/scoring", cookie)).json() as Promise<Framework>;

/**
 * Save the section the way the console does: the settings it was just served,
 * plus whatever `visibility` this test is testing. Sending the settings back
 * unchanged keeps `compositionChanged` false, so no criteria bump and no
 * edition re-score — the suite shares one D1 (plan §8 Q17).
 */
async function saveSection(cookie: string, visibility: unknown): Promise<Response> {
  const { scoring } = await framework(cookie);
  return send("PUT", "/api/config/scoring-framework", cookie, { ...scoring, visibility });
}

const storedCells = async (): Promise<number> =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM score_visibility").first<{ n: number }>())!.n;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM score_visibility").run();
});

afterEach(async () => {
  await env.DB.prepare("DELETE FROM score_visibility").run();
  await env.DB.prepare("DELETE FROM audit_log WHERE action = 'score_visibility_changed'").run();
});

// ── The pairing ──────────────────────────────────────────────────────────────

describe("the flag and the 403 are the same predicate", () => {
  for (const [label, email, mayEdit] of INCUBATOR) {
    it(`${label}: console ${mayEdit ? "draws" : "hides"} the grid, and the route ${mayEdit ? "accepts" : "refuses"} a cell`, async () => {
      const cookie = await login(email);

      // Half one — what the console is told. The component renders the grids on
      // this and nothing else, so this IS "does the screen show the matrix".
      const view = await framework(cookie);
      expect(view.visibilityEditable).toBe(mayEdit);

      // Half two — what the route does with a real cell, from the same member.
      const res = await saveSection(cookie, {
        incubator: { program_associate: { program_manager: true } },
      });
      expect(res.ok).toBe(mayEdit);
      if (!mayEdit) expect(res.status).toBe(403);

      // …and the two halves agree, which is the whole of P0-2. Asserted as one
      // statement so a future change that moves only one of them fails here
      // rather than shipping a console that lies about what it can do.
      expect(view.visibilityEditable).toBe(res.ok);

      // A refusal writes nothing at all — not the cell, not the rest of the
      // section's own save, because the gate runs before any validation.
      expect(await storedCells()).toBe(mayEdit ? 1 : 0);
    });
  }

  it("the grant P0-2 names actually lands — the admin's write is a real permission change", async () => {
    // "An admin can grant a program associate sight of program-manager scores."
    // The point of widening rather than narrowing is that this stays true; the
    // point of the fix is that the admin can now SEE the grid that does it.
    // Proven against the stored row and the resolved matrix the report reads,
    // not against a 200.
    const admin = await login("nisha.kapoor@demo.startupjury.ai");
    expect((await framework(admin)).visibility.incubator.program_associate.program_manager).toBe(
      false,
    );

    expect(
      (await saveSection(admin, {
        incubator: { program_associate: { program_manager: true } },
      })).status,
    ).toBe(200);

    const row = await env.DB.prepare(
      "SELECT visible, updated_by FROM score_visibility WHERE edition = 'incubator' " +
        "AND viewer_role = 'program_associate' AND target_role = 'program_manager'",
    ).first<{ visible: number; updated_by: string }>();
    expect(row).toMatchObject({ visible: 1, updated_by: "inc_admin" });

    // The resolved matrix — what `canSeeEvaluatorScoresIn` answers from — moved.
    expect((await framework(admin)).visibility.incubator.program_associate.program_manager).toBe(
      true,
    );
  });
});

// ── The edition half ─────────────────────────────────────────────────────────

describe("refuses a matrix write from a console that does not draw the grid", () => {
  for (const [label, email] of VC) {
    it(`${label}: no flag, and a 403 for either matrix`, async () => {
      const cookie = await login(email);
      const view = await framework(cookie);
      // They administer their own console — this is not a permission problem.
      expect(view.editable).toBe(true);
      expect(view.visibilityEditable).toBe(false);

      // Their own edition's 5×5 …
      expect((await saveSection(cookie, { vc: { analyst: { partner: true } } })).status).toBe(403);
      // … and the incubator's 4×4, which the same body may carry.
      expect(
        (await saveSection(cookie, { incubator: { jury: { jury: true } } })).status,
      ).toBe(403);
      expect(await storedCells()).toBe(0);
    });

    it(`${label}: their ORDINARY save of the section is untouched`, async () => {
      // The negative control on the negative control. `s-fw` has one Save
      // (F0168) and the console posts `visibility` on every press, so a gate
      // that fired on the KEY rather than on a stored cell would break every
      // VC admin's save of a screen that has nothing to do with matrices.
      const cookie = await login(email);
      expect((await saveSection(cookie, {})).status).toBe(200);
      expect((await saveSection(cookie, undefined)).status).toBe(200);
      // A body whose only cells name roles the matrix does not draw stores
      // nothing, so it is still dropped silently rather than turned into a 403
      // nobody caused.
      expect(
        (await saveSection(cookie, { incubator: { admin: { jury: true } } })).status,
      ).toBe(200);
      expect(await storedCells()).toBe(0);
    });
  }
});

// ── What the fix deliberately does NOT change ────────────────────────────────

describe("Q-U (b) is untouched — admin is still in neither matrix", () => {
  it("opening the editor did not add a fifth row and column", async () => {
    // Adding `admin` moves migration 0072's persisted shape and the server-side
    // filters on the report and all three analytics reports. Wave R takes no
    // migration (§5 item 8), so the admin gets a grid that does not contain
    // their own role — and the console says so on the screen rather than
    // leaving it to be filed as a missing role.
    expect(VISIBILITY_ROLES.incubator).not.toContain("admin");
    expect(VISIBILITY_ROLES.vc).not.toContain("admin");

    const admin = await login("nisha.kapoor@demo.startupjury.ai");
    const { visibility } = await framework(admin);
    expect(Object.keys(visibility.incubator).sort()).toEqual(
      [...VISIBILITY_ROLES.incubator].sort(),
    );
  });

  it("a founder still cannot read the framework at all", async () => {
    const founder = await login("meera.sharma@demo.startupjury.ai");
    expect((await get("/api/config/scoring", founder)).status).toBe(403);
  });
});
