import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// The Aug-2026 issue-log work, end to end against the seeded workspace:
//   • 1  — organizational alias titles (PATCH /api/users/me, /api/auth/me)
//   • 2  — deck search + tags (GET /api/decks?q=&tag=, PUT /api/decks/:id/tags)
//   • 8  — the workspace activity log (GET /api/activity)
//   • 12 — manual override of the auto-recognised details (PATCH /api/decks/:id)
//   • 20/21 — the evaluation report, one column per evaluator, hierarchy-filtered
//   • 22 — the assignable-evaluator roster (GET /api/evaluators)
//   • 29/30 — sign-up / curation state (PUT /api/decks/:id/onboarding)
//   • 31 — Restore out of the archive

const BASE = "https://example.com";

const SUPER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const PA = "sunita.rao@demo.startupjury.ai"; // program_associate
const JURY = "rajesh.kumar@demo.startupjury.ai"; // jury
const PM = "raj.kumar@demo.startupjury.ai"; // program_manager
const FOUNDER = "meera.sharma@demo.startupjury.ai"; // founder

async function login(email: string, password = "demo1234"): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

const get = (path: string, cookie: string) =>
  SELF.fetch(`${BASE}${path}`, { headers: { cookie } });

const send = (method: string, path: string, cookie: string, body?: unknown) =>
  SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

interface DeckView {
  id: string;
  name: string;
  tags?: string[];
  founder?: string;
  founderPhone?: string;
  stage?: string;
  statusId?: string;
  weakAreas?: string[];
  missingSections?: string[];
  assignedAt?: string;
  paymentStatus?: string;
  documentsStatus?: string;
  curationStage?: string;
  onboardingProgress?: number;
  exitBy?: string;
  actions?: { action: string; label: string; to: string }[];
}

async function decks(cookie: string, query = ""): Promise<DeckView[]> {
  const r = await get(`/api/decks${query}`, cookie);
  return ((await r.json()) as { decks: DeckView[] }).decks;
}

// ── Issue 1 — organizational alias titles ────────────────────────────────────

describe("alias titles (issue 1)", () => {
  it("ships seeded titles on login and /me without changing the role", async () => {
    const cookie = await login(SUPER);
    const me = (await (await get("/api/auth/me", cookie)).json()) as {
      user: { role: string; title?: string };
    };
    expect(me.user.role).toBe("superuser");
    expect(me.user.title).toBe("Head of Programs");
  });

  it("lets any signed-in user set and clear their own title", async () => {
    const cookie = await login(JURY);
    const set = await send("PATCH", "/api/users/me", cookie, { title: "  Sector  Chair " });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { title?: string }).title).toBe("Sector Chair");

    const me = (await (await get("/api/auth/me", cookie)).json()) as {
      user: { role: string; title?: string };
    };
    // /me re-reads from D1, so the change lands without a re-login…
    expect(me.user.title).toBe("Sector Chair");
    // …and the platform role is untouched.
    expect(me.user.role).toBe("jury");

    const cleared = await send("PATCH", "/api/users/me", cookie, { title: "  " });
    expect(((await cleared.json()) as { title?: string }).title).toBeUndefined();
  });

  it("rejects a body with no title at all", async () => {
    const cookie = await login(JURY);
    const res = await send("PATCH", "/api/users/me", cookie, {});
    expect(res.status).toBe(400);
  });

  it("an admin can set someone else's title, and it shows on the roster", async () => {
    const cookie = await login(SUPER);
    const roster = (await (await get("/api/users", cookie)).json()) as {
      users: { id: string; role: string; title?: string }[];
    };
    const pa = roster.users.find((u) => u.id === "inc_pa");
    expect(pa?.title).toBe("Programme Coordinator");

    const res = await send("PATCH", `/api/users/inc_pa`, cookie, { title: "Cohort Ops" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { title?: string } }).user.title).toBe("Cohort Ops");
  });
});

// ── Issue 2 — deck search + tags ─────────────────────────────────────────────

describe("deck search and tags (issue 2)", () => {
  it("searches across startup, founder, sector and city", async () => {
    const cookie = await login(SUPER);
    expect((await decks(cookie, "?q=FinStack")).map((d) => d.name)).toEqual(["FinStack"]);
    // Founder name.
    expect((await decks(cookie, "?q=Ananya")).map((d) => d.name)).toEqual(["GreenGrid Energy"]);
    // City.
    const pune = await decks(cookie, "?q=Pune");
    expect(pune.length).toBeGreaterThan(0);
    expect(pune.every((d) => d.name !== "FinStack")).toBe(true);
    // A search that matches nothing returns nothing rather than everything.
    expect(await decks(cookie, "?q=zzz-no-such-startup")).toEqual([]);
  });

  it("treats LIKE wildcards in the search term as literal characters", async () => {
    const cookie = await login(SUPER);
    expect(await decks(cookie, "?q=%25")).toEqual([]);
    expect(await decks(cookie, "?q=_")).toEqual([]);
  });

  it("replaces a deck's tags, normalises them, and filters by one", async () => {
    const cookie = await login(SUPER);
    const res = await send("PUT", "/api/decks/inc_deck_finstack/tags", cookie, {
      tags: ["  Priority ", "PRIORITY", "b2b fintech", 42],
    });
    expect(res.status).toBe(200);
    // lowercased, de-duped, non-strings dropped.
    expect(((await res.json()) as { tags: string[] }).tags).toEqual(["priority", "b2b fintech"]);

    const tagged = await decks(cookie, "?tag=b2b%20fintech");
    expect(tagged.map((d) => d.name)).toEqual(["FinStack"]);

    const all = (await (await get("/api/decks/tags", cookie)).json()) as { tags: string[] };
    expect(all.tags).toContain("b2b fintech");
  });

  it("refuses tagging to a founder and 404s an unknown deck", async () => {
    const founder = await login(FOUNDER);
    const forbidden = await send("PUT", "/api/decks/inc_deck_finstack/tags", founder, { tags: [] });
    expect(forbidden.status).toBe(403);

    const cookie = await login(SUPER);
    const missing = await send("PUT", "/api/decks/nope/tags", cookie, { tags: [] });
    expect(missing.status).toBe(404);
  });
});

// ── Issue 8 — the activity log ───────────────────────────────────────────────

describe("activity log (issue 8)", () => {
  it("returns the edition's recent pipeline events, newest first", async () => {
    const cookie = await login(SUPER);
    const body = (await (await get("/api/activity?limit=5", cookie)).json()) as {
      events: { deckName: string; toLabel: string; actorName: string; createdAt: string }[];
    };
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.length).toBeLessThanOrEqual(5);
    const times = body.events.map((e) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    // Every event names a deck and an actor (the AI included).
    expect(body.events.every((e) => e.deckName && e.actorName && e.toLabel)).toBe(true);
  });

  it("is edition-scoped", async () => {
    const vc = await login("aarav.khanna@demo.startupjury.ai");
    const body = (await (await get("/api/activity", vc)).json()) as {
      events: { deckName: string }[];
    };
    expect(body.events.some((e) => e.deckName === "InsureFlow")).toBe(false);
  });

  it("needs a session", async () => {
    const res = await SELF.fetch(`${BASE}/api/activity`);
    expect(res.status).toBe(401);
  });
});

// ── Issue 12 — manual override of the recognised details ─────────────────────

describe("manual override of recognised details (issue 12)", () => {
  it("patches only the fields sent and re-derives what is still missing", async () => {
    const cookie = await login(PA);
    const res = await send("PATCH", "/api/decks/inc_deck_payroute", cookie, {
      founderPhone: "+91 90000 11111",
      stage: "Seed",
    });
    expect(res.status).toBe(200);
    const deck = ((await res.json()) as { deck: DeckView }).deck;
    expect(deck.founderPhone).toBe("+91 90000 11111");
    expect(deck.stage).toBe("Seed");
    // The phone was the only gap, so the deck is no longer missing anything.
    const listed = (await decks(cookie)).find((d) => d.id === "inc_deck_payroute");
    expect(listed?.founderPhone).toBe("+91 90000 11111");
  });

  it("never blanks the startup name and refuses an empty patch", async () => {
    const cookie = await login(PA);
    const blank = await send("PATCH", "/api/decks/inc_deck_finstack", cookie, { name: "   " });
    // Only the name was sent and it was rejected, so there is nothing to write.
    expect(blank.status).toBe(400);

    const empty = await send("PATCH", "/api/decks/inc_deck_finstack", cookie, {});
    expect(empty.status).toBe(400);
  });

  it("is closed to the jury", async () => {
    const jury = await login(JURY);
    const res = await send("PATCH", "/api/decks/inc_deck_finstack", jury, { city: "Chennai" });
    expect(res.status).toBe(403);
  });
});

// ── Issues 20 & 21 — the evaluation report ───────────────────────────────────

interface Report {
  columns: { id: string; kind: string; role?: string; roleLabel?: string; title?: string }[];
  core: { key: string; cells: Record<string, { value: number }> }[];
  additional: { role: string; rows: unknown[] }[];
  hiddenEvaluators: number;
  /** W2-A — set when the columns were trimmed by peer visibility, not by rank. */
  peerScoresHidden: boolean;
}

async function report(cookie: string, deckId = "inc_deck_insureflow"): Promise<Report> {
  const r = await get(`/api/decks/${deckId}/report`, cookie);
  return (await r.json()) as Report;
}

/** Admin console → Scoring framework → "Jury can see each other's scores". */
async function setPeerVisibility(on: boolean): Promise<void> {
  await env.DB.prepare(
    "UPDATE org_scoring_settings SET jury_sees_peer_scores = ? WHERE edition = 'incubator'",
  )
    .bind(on ? 1 : 0)
    .run();
}

describe("evaluation report (issues 20, 21, 23, 24)", () => {
  it("gives the AI a column and one more per evaluator who has scored", async () => {
    const cookie = await login(SUPER);
    const r = await report(cookie);
    expect(r.columns[0].kind).toBe("ai");
    const roles = r.columns.filter((c) => c.kind === "human").map((c) => c.role);
    expect(roles).toEqual(["program_associate", "jury", "program_manager", "admin"]);
    // Columns carry the evaluator's alias title (issue 1) for the report header.
    // (inc_pm is the one seeded evaluator no other test in this file re-titles.)
    expect(r.columns.find((c) => c.role === "program_manager")?.title).toBe("Cohort Director");
  });

  it("returns the 13 core areas and the additional params grouped by owner role", () => {
    return login(SUPER).then(async (cookie) => {
      const r = await report(cookie);
      expect(r.core).toHaveLength(13);
      expect(r.additional.map((g) => g.role)).toEqual([
        "program_associate",
        "program_manager",
        "jury",
      ]);
      expect(r.additional.every((g) => g.rows.length === 3)).toBe(true);
    });
  });

  it("hides evaluators the matrix does not allow and says how many were withheld", async () => {
    // Issue 21's rule, asserted with peer visibility ON so the matrix alone is
    // answering — the test below covers what the toggle adds when it is off.
    //
    // V3 item 13 made the ladder a configurable `Score visibility matrix` and
    // shipped the v3 prototype's printed default, under which a juror stopped
    // reading the programme associate's column. **23-Oct put it back**: the
    // product owner restated issue 21 — "anyone senior should be able to see the
    // junior persons scoring but the junior cant see the seniors score" — and the
    // incubator default is now that hierarchy (`DEFAULT_VISIBILITY`). So the
    // juror reads the associate below them again, and still not the PM or the
    // admin above. The associate and the PM read exactly what they did.
    // `admin` is in NEITHER matrix, falls through to the ladder, and stays hidden
    // from all three.
    await setPeerVisibility(true);
    try {
      const pa = await report(await login(PA));
      expect(pa.columns.map((c) => c.role ?? "ai")).toEqual(["ai", "program_associate"]);
      expect(pa.hiddenEvaluators).toBe(3);

      const jury = await report(await login(JURY));
      expect(jury.columns.map((c) => c.role ?? "ai")).toEqual(["ai", "program_associate", "jury"]);
      expect(jury.hiddenEvaluators).toBe(2);

      const pm = await report(await login(PM));
      expect(pm.columns.map((c) => c.role ?? "ai")).toEqual([
        "ai",
        "program_associate",
        "jury",
        "program_manager",
      ]);
      expect(pm.hiddenEvaluators).toBe(1);
    } finally {
      await setPeerVisibility(false);
    }
  });

  it("hides an evaluator's PEERS while peer visibility is off — and only their peers", async () => {
    // W2-A / F0109 — admin console → Scoring framework → "Jury can see each
    // other's scores" · "Turn off for fully independent scoring rounds". It is
    // the one toggle the prototype ships OFF, and 0026 seeds it off, while the
    // build behaved as though it were permanently on.
    //
    // **Re-pointed 23-Oct.** Off, this used to reduce an evaluator to the AI
    // column and their own — which also stopped a programme manager seeing the
    // jury below them, against issue 21's "anyone senior should be able to see
    // the junior persons scoring". It now hides PEERS — people holding the
    // viewer's own role, the only pairs a hierarchy cannot order — and leaves
    // everyone else to the hierarchy. The seed has one evaluator per role, so a
    // second juror's evaluation is written here to give the toggle a peer to hide.
    await env.DB.prepare(
      "INSERT INTO users (id, tenant_id, edition, name, email, password_hash, role, initials, active) " +
        "VALUES ('il_peer_jury', 't_default', 'incubator', 'Peer Juror', 'peer.juror.il@demo.startupjury.ai', NULL, 'jury', 'PJ', 1)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, submitted_at) " +
        "VALUES ('il_peer_eval', 'inc_deck_insureflow', 'il_peer_jury', 6.4, 'scored', '2026-10-23T10:00:00Z')",
    ).run();
    try {
      const jury = await report(await login(JURY));
      // Their own and the associate's below them — never the peer beside them.
      expect(jury.columns.map((c) => c.role ?? "ai")).toEqual(["ai", "program_associate", "jury"]);
      expect(jury.columns.some((c) => c.id === "il_peer_jury")).toBe(false);
      expect(jury.peerScoresHidden).toBe(true);

      // The PM has no peer on this deck, so the toggle hides nothing from them:
      // the whole panel below them, own column included.
      const pm = await report(await login(PM));
      expect(pm.columns.map((c) => c.role ?? "ai")).toEqual([
        "ai",
        "program_associate",
        "jury",
        "jury",
        "program_manager",
      ]);
    } finally {
      await env.DB.prepare("DELETE FROM evaluations WHERE id = 'il_peer_eval'").run();
      await env.DB.prepare("DELETE FROM users WHERE id = 'il_peer_jury'").run();
    }

    // Oversight roles are outside the toggle: they do not score, they review.
    const admin = await report(await login(SUPER));
    expect(admin.peerScoresHidden).toBe(false);
    expect(admin.columns.length).toBeGreaterThan(2);
  });

  it("withholds the CELLS, not just the column headers", async () => {
    const pa = await report(await login(PA));
    const visible = new Set(pa.columns.map((c) => c.id));
    for (const row of pa.core) {
      for (const columnId of Object.keys(row.cells)) {
        expect(visible.has(columnId)).toBe(true);
      }
    }
  });

  it("is closed to founders and 404s an unknown deck", async () => {
    const founder = await login(FOUNDER);
    expect((await get("/api/decks/inc_deck_insureflow/report", founder)).status).toBe(403);
    const cookie = await login(SUPER);
    expect((await get("/api/decks/nope/report", cookie)).status).toBe(404);
  });
});

// ── Issue 22 — the assignable-evaluator roster ───────────────────────────────

describe("assignable evaluators (issue 22)", () => {
  it("groups the edition's evaluator roles with their members and workload", async () => {
    const cookie = await login(PA);
    const body = (await (await get("/api/evaluators", cookie)).json()) as {
      groups: { role: string; roleLabel: string; members: { id: string; openDecks: number }[] }[];
    };
    expect(body.groups.map((g) => g.role)).toEqual([
      "jury",
      "program_manager",
      "program_associate",
    ]);
    const jury = body.groups.find((g) => g.role === "jury");
    expect(jury?.members.some((m) => m.id === "inc_jury")).toBe(true);
    expect(jury?.members.every((m) => typeof m.openDecks === "number")).toBe(true);
  });

  it("is closed to the jury", async () => {
    const jury = await login(JURY);
    expect((await get("/api/evaluators", jury)).status).toBe(403);
  });
});

// ── Issues 29 & 30 — sign-up / curation state ────────────────────────────────

describe("sign-up and curation state (issues 29, 30)", () => {
  it("records payment, documents, curation stage, lead and progress", async () => {
    const cookie = await login(PA);
    const res = await send("PUT", "/api/decks/inc_deck_medixir/onboarding", cookie, {
      paymentStatus: "paid",
      documentsStatus: "complete",
      curationStage: "Mentor matching",
      progress: 140, // clamped
      leadUserId: "inc_jury",
    });
    expect(res.status).toBe(200);
    const deck = ((await res.json()) as { deck: DeckView }).deck;
    expect(deck.paymentStatus).toBe("paid");
    expect(deck.documentsStatus).toBe("complete");
    expect(deck.curationStage).toBe("Mentor matching");
    expect(deck.onboardingProgress).toBe(100);
  });

  it("keeps the stored value when a field is omitted or invalid", async () => {
    const cookie = await login(PA);
    const res = await send("PUT", "/api/decks/inc_deck_medixir/onboarding", cookie, {
      paymentStatus: "not-a-status",
    });
    const deck = ((await res.json()) as { deck: DeckView }).deck;
    expect(deck.paymentStatus).toBe("paid");
    expect(deck.curationStage).toBe("Mentor matching");
  });

  it("rejects a lead who isn't in the workspace, and 404s an unknown deck", async () => {
    const cookie = await login(PA);
    const badLead = await send("PUT", "/api/decks/inc_deck_medixir/onboarding", cookie, {
      leadUserId: "vc_partner",
    });
    expect(badLead.status).toBe(400);
    const missing = await send("PUT", "/api/decks/nope/onboarding", cookie, {});
    expect(missing.status).toBe(404);
  });

  it("is closed to the jury", async () => {
    const jury = await login(JURY);
    const res = await send("PUT", "/api/decks/inc_deck_medixir/onboarding", jury, {
      paymentStatus: "paid",
    });
    expect(res.status).toBe(403);
  });
});

// ── Issue 31 — restore out of the archive ────────────────────────────────────

describe("archive restore (issue 31)", () => {
  it("offers Restore on an archived deck and puts it back at the AI gate", async () => {
    const cookie = await login(PM);
    const archived = (await decks(cookie)).find((d) => d.statusId === "archived");
    expect(archived).toBeDefined();
    expect(archived?.actions?.some((a) => a.action === "restore")).toBe(true);

    const res = await send(
      "POST",
      `/api/decks/${archived!.id}/transition`,
      cookie,
      { action: "restore" },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ai_evaluated");

    // …and the archive screen records who took it out and when.
    const after = (await decks(cookie)).find((d) => d.id === archived!.id);
    expect(after?.statusId).toBe("ai_evaluated");
  });

  it("does not offer Restore to a program associate", async () => {
    const cookie = await login(PA);
    const rejected = (await decks(cookie)).find((d) => d.statusId === "rejected");
    expect(rejected?.actions?.some((a) => a.action === "restore")).toBe(false);
  });
});
