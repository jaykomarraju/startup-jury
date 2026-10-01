import { env } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import {
  previousMonth,
  runMonthlyUsageSummary,
  runReminders,
  selectReminders,
  usageSummary,
  type PendingAssignment,
} from "../../src/server/scheduled";
import { DEFAULT_TENANT_ID, type TenantScope } from "../../src/shared/tenant";
import type { Env } from "../../src/server/types";

describe("selectReminders (pure)", () => {
  it("groups assignments into one reminder per evaluator", () => {
    const rows: PendingAssignment[] = [
      { evaluatorId: "j1", evaluatorName: "J1", evaluatorEmail: "j1@x", deckId: "d1", deckName: "Alpha" },
      { evaluatorId: "j1", evaluatorName: "J1", evaluatorEmail: "j1@x", deckId: "d2", deckName: "Beta" },
      { evaluatorId: "j2", evaluatorName: "J2", evaluatorEmail: "j2@x", deckId: "d3", deckName: "Gamma" },
    ];
    const out = selectReminders(rows);
    expect(out).toHaveLength(2);
    const j1 = out.find((r) => r.evaluatorId === "j1")!;
    expect(j1.deckNames).toEqual(["Alpha", "Beta"]);
  });
});

describe("runReminders (seeded)", () => {
  it("selects the jury member with the assigned-but-unscored deck and records the email", async () => {
    const reminders = await runReminders(env);
    // Only TaxPilot (0008) is parked at 'assigned', assigned to inc_jury.
    const jury = reminders.find((r) => r.evaluatorId === "inc_jury");
    expect(jury).toBeDefined();
    expect(jury!.deckNames).toContain("TaxPilot");
    // Decks in later stages (jury_evaluation, shortlisted…) are not reminded.
    expect(reminders.every((r) => r.deckNames.length > 0)).toBe(true);

    // The stubbed reminder was persisted to the outbox.
    const row = await env.DB.prepare(
      "SELECT kind FROM email_outbox WHERE kind = 'evaluator_reminder' AND to_email = ?",
    )
      .bind("rajesh.kumar@demo.startupjury.ai")
      .first<{ kind: string }>();
    expect(row?.kind).toBe("evaluator_reminder");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T1-PEOPLE, tenancy wave — THE CRON IS THE ONE PLACE WITH NO PRINCIPAL.
//
// Every other site in the wave takes its scope from `c.var.user`, so the scope is
// whatever the signed-in person's is and the only question is whether each
// statement binds it. A Cron Trigger has no session: `scheduled.ts` has to
// ENUMERATE the workspaces instead (`liveWorkspaces`), and that enumeration is a
// decision with no analogue anywhere else in the wave. These cases are about the
// enumeration, not the predicates — `test/worker/tenant-scope.test.ts` covers
// those.
//
// The file's own note said as much before this session touched it: "it returns
// what it archived, so your isolation test can assert that a sweep run for tenant A
// moved nothing belonging to tenant B. A per-table invariant will NOT catch a
// regression here — `decks` is already on that list and would stay green while this
// statement selected across tenants."
// ─────────────────────────────────────────────────────────────────────────────

const CRON_TENANT = "t_cron_probe";
const SUSPENDED = "t_cron_suspended";

describe("the cron enumerates workspaces, because it has no principal to ask", () => {
  beforeAll(async () => {
    const E = env as unknown as Env;
    const hash = await E.DB.prepare("SELECT password_hash FROM users WHERE id = 'inc_admin'").first<{
      password_hash: string;
    }>();
    await E.DB.batch([
      E.DB.prepare(
        "INSERT INTO organizations (id, name, slug, status) VALUES (?, 'Cron Probe', 'cron-probe', 'trial') " +
          "ON CONFLICT (id) DO NOTHING",
      ).bind(CRON_TENANT),
      // A SUSPENDED customer. `routes/auth.ts` already refuses their sign-in; the
      // cron must not keep mailing a workspace nobody can open.
      E.DB.prepare(
        "INSERT INTO organizations (id, name, slug, status) VALUES (?, 'Cron Suspended', 'cron-suspended', 'suspended') " +
          "ON CONFLICT (id) DO NOTHING",
      ).bind(SUSPENDED),
      // One jury member per customer, with the SAME address — which `0087`'s
      // `UNIQUE (tenant_id, email)` now permits and which is the whole point: if the
      // reminder join matched on anything but the tenant, these two would be
      // interchangeable.
      E.DB.prepare(
        "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash, active) " +
          "VALUES ('cron_jury', ?, 'Cron Juror', 'shared.juror@cron.test', 'jury', 'incubator', 'CJ', ?, 1)",
      ).bind(CRON_TENANT, hash!.password_hash),
      E.DB.prepare(
        "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash, active) " +
          "VALUES ('susp_jury', ?, 'Suspended Juror', 'shared.juror@cron.test', 'jury', 'incubator', 'SJ', ?, 1)",
      ).bind(SUSPENDED, hash!.password_hash),
      // `monthly_usage_summary`'s audience is admin + superuser, so a customer with
      // only a juror receives no digest at all and the case below would prove nothing.
      E.DB.prepare(
        "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash, active) " +
          "VALUES ('cron_admin', ?, 'Cron Admin', 'admin@cron.test', 'admin', 'incubator', 'CA', ?, 1)",
      ).bind(CRON_TENANT, hash!.password_hash),
      E.DB.prepare(
        "INSERT INTO users (id, tenant_id, name, email, role, edition, initials, password_hash, active) " +
          "VALUES ('susp_admin', ?, 'Susp Admin', 'admin@cron.test', 'admin', 'incubator', 'SA', ?, 1)",
      ).bind(SUSPENDED, hash!.password_hash),
      E.DB.prepare(
        "INSERT INTO decks (id, tenant_id, edition, name, status, assigned_to) " +
          "VALUES ('cron_deck', ?, 'incubator', 'CronCo', 'assigned', 'cron_jury')",
      ).bind(CRON_TENANT),
      // One deck per customer IN THE SAME MONTH, so the two usage counts differ and a
      // leaking aggregate is distinguishable from an isolated one. A probe whose two
      // numbers coincide is how an aggregate test goes quietly useless.
      E.DB.prepare(
        "INSERT INTO decks (id, tenant_id, edition, name, status) " +
          "VALUES ('cron_deck_b', ?, 'incubator', 'CronCo Two', 'new')",
      ).bind(CRON_TENANT),
      E.DB.prepare(
        "INSERT INTO decks (id, tenant_id, edition, name, status) " +
          "VALUES ('dflt_deck_month', ?, 'incubator', 'DefaultCo Month', 'new')",
      ).bind(DEFAULT_TENANT_ID),
      E.DB.prepare(
        "INSERT INTO decks (id, tenant_id, edition, name, status, assigned_to) " +
          "VALUES ('susp_deck', ?, 'incubator', 'SuspendedCo', 'assigned', 'susp_jury')",
      ).bind(SUSPENDED),
    ]);
  });

  it("reminds a live customer's evaluator, and skips a suspended customer's entirely", async () => {
    const reminders = await runReminders(env as unknown as Env);
    const live = reminders.find((r) => r.evaluatorId === "cron_jury");
    expect(live, "the trial customer's juror was not reminded").toBeDefined();
    expect(live!.deckNames).toEqual(["CronCo"]);
    // The suspended customer's juror holds an identically-named assignment and the
    // SAME email address, so this is not an absence by accident.
    expect(reminders.some((r) => r.evaluatorId === "susp_jury")).toBe(false);

    // And the reminder that did go out is filed against the customer it is about,
    // not against `DEFAULT_TENANT_ID` — the cron has no session, so the scope it
    // passes to `sendEmail` is the only thing that can get this right.
    const rows = await env.DB.prepare(
      "SELECT DISTINCT tenant_id FROM email_outbox WHERE kind = 'evaluator_reminder' AND to_email = ?",
    )
      .bind("shared.juror@cron.test")
      .all<{ tenant_id: string }>();
    expect(rows.results.map((r) => r.tenant_id)).toEqual([CRON_TENANT]);
  });

  it("a deck assigned to another customer's evaluator reminds nobody, rather than mailing them", async () => {
    // `decks.assigned_to` is a plain foreign key to `users(id)` with nothing tenant-
    // aware about it, so a cross-tenant assignment is REPRESENTABLE even though no
    // route should create one. This is the state the reminder join's
    // `AND u.tenant_id = d.tenant_id` defends against: without it the sweep scopes
    // the DECK correctly and then mails whoever the id points at, which is the
    // classic shape of §5b's warning — the parent is scoped, the child is reached by
    // id, and the two are assumed to agree.
    await env.DB.prepare(
      "INSERT INTO decks (id, tenant_id, edition, name, status, assigned_to) " +
        "VALUES ('crosstenant_deck', ?, 'incubator', 'CrossTenantCo', 'assigned', 'cron_jury')",
    )
      .bind(DEFAULT_TENANT_ID)
      .run();

    // EVERY entry, not the first match: `runReminders` returns one group per
    // evaluator PER WORKSPACE PASS, so a leak shows up as a second group with the
    // same `evaluatorId` further down the list — and a `.find()` would have returned
    // the legitimate one and reported success. Measured: with the join's tenant
    // condition removed, the `.find()` form stayed green and this form goes red.
    const names = (await runReminders(env as unknown as Env))
      .filter((r) => r.evaluatorId === "cron_jury")
      .flatMap((r) => r.deckNames);
    expect(
      names,
      "a mis-assigned deck reminded another customer's evaluator about a startup they cannot see",
    ).not.toContain("CrossTenantCo");
    expect(names, "the juror's own assignment went missing").toContain("CronCo");

    await env.DB.prepare("DELETE FROM decks WHERE id = 'crosstenant_deck'").run();
  });

  it("a workspace's usage numbers count that workspace, which is what gets emailed as a report", async () => {
    // §11's dangerous shape, and the sharpest version of it in the codebase: these
    // four counts are not merely displayed, they are MAILED to administrators as a
    // report and filed in `email_outbox` as the evidence that they were.
    const month = previousMonth(new Date());
    const probe: TenantScope = { tenantId: CRON_TENANT, edition: "incubator" };
    const dflt: TenantScope = { tenantId: DEFAULT_TENANT_ID, edition: "incubator" };
    await env.DB.prepare(
      "UPDATE decks SET created_at = ? WHERE id IN ('cron_deck', 'cron_deck_b', 'dflt_deck_month')",
    )
      .bind(`${month}-15T00:00:00.000Z`)
      .run();

    const mine = await usageSummary(env as unknown as Env, probe, month);
    const theirs = await usageSummary(env as unknown as Env, dflt, month);
    expect(mine.tenantId).toBe(CRON_TENANT);
    expect(mine.decksSubmitted).toBe(2);
    expect(theirs.decksSubmitted).toBeGreaterThan(0);

    // `creditsRemaining` is the one number here that comes from a SINGLE-ROW read
    // (`org_settings`), and `.first()` is what makes an unscoped version dangerous:
    // this customer has no `org_settings` row at all, so an `edition`-only predicate
    // returns the SEEDED workspace's balance and the digest tells a brand-new
    // customer they have credits they never bought. Zero is the right answer.
    expect(theirs.creditsRemaining).toBeGreaterThan(0);
    expect(
      mine.creditsRemaining,
      "a customer with no org_settings row was handed another customer's credit balance",
    ).toBe(0);
    // The seeded workspace has its own decks in other months; what matters is that
    // one customer's count is not the other's, and not the sum.
    const both = await env.DB.prepare(
      "SELECT COUNT(*) n FROM decks WHERE edition = 'incubator' AND substr(created_at, 1, 7) = ?",
    )
      .bind(month)
      .first<{ n: number }>();
    expect(
      mine.decksSubmitted + theirs.decksSubmitted,
      "the two customers' counts overlap, so a leak here would be undetectable",
    ).toBeLessThanOrEqual(both!.n);
    expect(mine.decksSubmitted).not.toBe(both!.n);
  });

  it("the digest's dedupe key names the customer, so it is no longer one key per edition", async () => {
    // §2 A8 at the call site. The suspended customer must not appear at all.
    await runMonthlyUsageSummary(env as unknown as Env, new Date("2026-05-04T08:00:00Z"));
    const { results } = await env.DB.prepare(
      "SELECT DISTINCT tenant_id FROM email_outbox WHERE dedupe_key LIKE 'monthly_usage_summary:%'",
    ).all<{ tenant_id: string }>();
    const tenants = results.map((r) => r.tenant_id);
    expect(tenants).toContain(CRON_TENANT);
    expect(tenants).toContain(DEFAULT_TENANT_ID);
    expect(tenants).not.toContain(SUSPENDED);
    const { results: keys } = await env.DB.prepare(
      "SELECT tenant_id, dedupe_key FROM email_outbox WHERE dedupe_key LIKE 'monthly_usage_summary:%'",
    ).all<{ tenant_id: string; dedupe_key: string }>();
    for (const k of keys) {
      expect(k.dedupe_key.startsWith(`monthly_usage_summary:${k.tenant_id}:`), k.dedupe_key).toBe(true);
    }
  });
});
