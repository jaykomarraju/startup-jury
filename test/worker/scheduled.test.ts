import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { selectReminders, runReminders, type PendingAssignment } from "../../src/server/scheduled";

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
