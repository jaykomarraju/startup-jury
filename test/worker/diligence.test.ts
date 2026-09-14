import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { DdItemView, DealView } from "../../src/shared/diligence";

/**
 * W9-C — `/api/diligence`: the VC diligence checklists, the deal record around
 * them and the term sheet's status and document (migration 0063).
 *
 * Every write test seeds its own deck: the demo deals are what the stage
 * screens and the e2e walk read, and must not move under them.
 */

const BASE = "https://example.com";
const SU = "aarav.khanna@demo.startupjury.ai";
const ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";
const PARTNER = "ishaan.sethi@demo.startupjury.ai";
const IC = "rajesh.kumar.vc@demo.startupjury.ai";
const ASSOCIATE = "sunita.rao.vc@demo.startupjury.ai";
const INC_PM = "raj.kumar@demo.startupjury.ai";

const cookies = new Map<string, string>();
async function login(email: string): Promise<string> {
  const cached = cookies.get(email);
  if (cached) return cached;
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  cookies.set(email, cookie);
  return cookie;
}

function call(method: string, path: string, cookie: string, body?: unknown) {
  return SELF.fetch(`${BASE}/api/diligence${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedDeck(id: string, status: string, name = id): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO decks (id, edition, name, status, r2_key, uploaded_by, founder, complete) VALUES (?, 'vc', ?, ?, ?, 'vc_analyst', 'Ada Founder', 1)",
  )
    .bind(id, name, status, `decks/${id}.pdf`)
    .run();
}

async function deals(cookie: string): Promise<DealView[]> {
  const res = await call("GET", "", cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { deals: DealView[] }).deals;
}

async function checklist(cookie: string, deckId: string, track: string) {
  const res = await call("GET", `/${deckId}/checklist/${track}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as { items: DdItemView[]; summary: { done: number; total: number; flagged: number } };
}

describe("GET /api/diligence — one deal record per deal from Investment DD to close", () => {
  it("serves the seeded demo deals with their checklist summaries and deal fields", async () => {
    const list = await deals(await login(SU));
    const byId = new Map(list.map((d) => [d.deckId, d]));

    const solar = byId.get("vc_deck_solarnest")!;
    expect(solar.stage).toBe("investment_dd");
    expect(solar.investment).toEqual({ done: 3, total: 6, flagged: 1, started: true });
    expect(solar.legal).toBeNull();
    expect(solar.ask).toBe("₹3.0 Cr");
    // Not chosen yet → derived from the checklist (`ddInitRow`).
    expect(solar.mpApprovalSet).toBe(false);
    expect(solar.mpApproval).toBe("approved");
    expect(solar.ddStatus).toBe("in_progress");

    const cyber = byId.get("vc_deck_cybervault")!;
    expect(cyber.legal).toEqual({ done: 5, total: 7, flagged: 0, started: true });
    expect(cyber.termSheet.status).toBe("signed");
    expect(cyber.termSheet.doc).toMatchObject({ templateName: "Term Sheet", version: "executed" });

    // Stages before Investment DD and exits carry no record.
    expect(list.every((d) => d.stage !== "archived" && d.stage !== "partner_review")).toBe(true);
  });

  it("materialises the prototype's items for a deal that arrives with none", async () => {
    await seedDeck("dd_new_ic", "ic_review", "NewCo");
    const su = await login(SU);
    const deal = (await deals(su)).find((d) => d.deckId === "dd_new_ic")!;
    expect(deal.investment).toEqual({ done: 0, total: 6, flagged: 0, started: false });
    expect(deal.mpApproval).toBe("not_approved");
    expect(deal.ddStatus).toBe("yet_to_start");

    const { items } = await checklist(su, "dd_new_ic", "investment");
    expect(items.map((i) => i.label)).toEqual([
      "Market",
      "Team references",
      "Customer calls",
      "Product / Tech review",
      "Financials & metrics",
      "Competitive positioning",
    ]);
    // Reading twice never duplicates a slot.
    await deals(su);
    expect((await checklist(su, "dd_new_ic", "investment")).items).toHaveLength(6);
  });

  it("admits the three Due Diligence roles and refuses the rest", async () => {
    for (const email of [ADMIN, PARTNER, IC]) {
      expect((await call("GET", "", await login(email))).status, email).toBe(200);
    }
    expect((await call("GET", "", await login(ASSOCIATE))).status).toBe(403);
    const inc = await call("GET", "", await login(INC_PM));
    expect(inc.status).toBe(403);
    expect(await inc.json()).toEqual({ error: "wrong_edition" });
    expect((await SELF.fetch(`${BASE}/api/diligence`)).status).toBe(401);
  });
});

describe("the checklist — `ddSet` / `ldSet`", () => {
  it("moves one item, persists every field, and the deal summary follows", async () => {
    await seedDeck("dd_move", "investment_dd", "MoveCo");
    const partner = await login(PARTNER);
    const [first] = (await checklist(partner, "dd_move", "investment")).items;

    const res = await call("PATCH", `/dd_move/checklist/investment/${first.id}`, partner, {
      status: "flagged",
      owner: "  M.  Sharma ",
      rating: "concern",
      finding: "Top client = 41% of revenue\nconcentration risk",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: DdItemView; deal: DealView };
    expect(body.item).toMatchObject({
      status: "flagged",
      owner: "M. Sharma",
      rating: "concern",
      finding: "Top client = 41% of revenue\nconcentration risk",
    });
    expect(body.deal.investment).toEqual({ done: 0, total: 6, flagged: 1, started: true });

    const row = await env.DB.prepare("SELECT status, owner, rating, updated_by FROM dd_items WHERE id = ?")
      .bind(first.id)
      .first();
    expect(row).toEqual({ status: "flagged", owner: "M. Sharma", rating: "concern", updated_by: "vc_partner" });

    // Clearing the rating is `—`.
    const cleared = await call("PATCH", `/dd_move/checklist/investment/${first.id}`, partner, { rating: null });
    expect(((await cleared.json()) as { item: DdItemView }).item.rating).toBeNull();
  });

  it("refuses an invalid field without writing anything else in the request", async () => {
    await seedDeck("dd_bad", "investment_dd");
    const su = await login(SU);
    const [first] = (await checklist(su, "dd_bad", "investment")).items;
    for (const bad of [{ status: "verified" }, { rating: "great" }, { owner: 7 }, { finding: "x".repeat(2001) }]) {
      // A valid owner rides along with each invalid field; it must not land either.
      const res = await call("PATCH", `/dd_bad/checklist/investment/${first.id}`, su, { owner: "Kept out", ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call("PATCH", `/dd_bad/checklist/investment/${first.id}`, su, {})).status).toBe(400);
    const row = await env.DB.prepare("SELECT status, owner, rating FROM dd_items WHERE id = ?").bind(first.id).first();
    expect(row).toEqual({ status: "not_started", owner: null, rating: null });
  });

  it("renames an investment item (clearing restores the default) but never a legal one", async () => {
    await seedDeck("dd_label", "legal_dd");
    const su = await login(SU);
    const inv = (await checklist(su, "dd_label", "investment")).items[2];
    const renamed = await call("PATCH", `/dd_label/checklist/investment/${inv.id}`, su, { label: "Channel partner calls" });
    expect(((await renamed.json()) as { item: DdItemView }).item).toMatchObject({
      label: "Channel partner calls",
      defaultLabel: "Customer calls",
    });
    const restored = await call("PATCH", `/dd_label/checklist/investment/${inv.id}`, su, { label: "" });
    expect(((await restored.json()) as { item: DdItemView }).item.label).toBe("Customer calls");

    const legal = (await checklist(su, "dd_label", "legal")).items[0];
    expect(legal.label).toBe("Cap table verification");
    const refused = await call("PATCH", `/dd_label/checklist/legal/${legal.id}`, su, { label: "Anything" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "label_fixed" });
  });

  it("the legal checklist opens only at Legal DD; a deal before it is a 409", async () => {
    await seedDeck("dd_early", "investment_dd");
    const su = await login(SU);
    const res = await call("GET", "/dd_early/checklist/legal", su);
    expect(res.status).toBe(409);
    expect((await call("GET", "/dd_early/checklist/nonsense", su)).status).toBe(404);
    expect((await call("GET", "/ghost/checklist/investment", su)).status).toBe(404);
  });

  it("gates writes on `openchecklist`: the IC member may, the associate may not", async () => {
    await seedDeck("dd_gate", "investment_dd");
    const ic = await login(IC);
    const [first] = (await checklist(ic, "dd_gate", "investment")).items;
    expect((await call("PATCH", `/dd_gate/checklist/investment/${first.id}`, ic, { status: "in_progress" })).status).toBe(200);
    const assoc = await login(ASSOCIATE);
    expect((await call("PATCH", `/dd_gate/checklist/investment/${first.id}`, assoc, { status: "done" })).status).toBe(403);
    expect((await call("GET", "/dd_gate/checklist/investment", assoc)).status).toBe(403);
  });
});

describe("the deal record", () => {
  it("MP approval is the partner's (`mpapproval`), recorded without moving the deal", async () => {
    await seedDeck("dd_mp", "investment_dd");
    const partner = await login(PARTNER);
    const res = await call("PUT", "/dd_mp/mp-approval", partner, { value: "not_approved" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deal: DealView }).deal).toMatchObject({ mpApproval: "not_approved", mpApprovalSet: true });
    const deck = await env.DB.prepare("SELECT status FROM decks WHERE id = 'dd_mp'").first<{ status: string }>();
    expect(deck?.status).toBe("investment_dd");

    expect((await call("PUT", "/dd_mp/mp-approval", partner, { value: "maybe" })).status).toBe(400);
    expect((await call("PUT", "/dd_mp/mp-approval", await login(IC), { value: "approved" })).status).toBe(403);
    expect((await call("PUT", "/dd_mp/mp-approval", await login(ADMIN), { value: "approved" })).status).toBe(403);
  });

  it("row status, leads, ask and pre-money round-trip; a blank clears", async () => {
    await seedDeck("dd_deal", "investment_dd");
    const su = await login(SU);
    const res = await call("PUT", "/dd_deal/deal", su, {
      ddStatus: "completed",
      investmentLead: "R. Kumar",
      ask: "₹3.0 Cr",
      valuation: "₹15 Cr",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deal: DealView }).deal).toMatchObject({
      ddStatus: "completed",
      investmentLead: "R. Kumar",
      ask: "₹3.0 Cr",
      valuation: "₹15 Cr",
    });
    const again = await call("PUT", "/dd_deal/deal", su, { ask: "  " });
    expect(((await again.json()) as { deal: DealView }).deal).toMatchObject({ ask: null, valuation: "₹15 Cr" });
    expect((await call("PUT", "/dd_deal/deal", su, { ddStatus: "done" })).status).toBe(400);
    expect((await call("PUT", "/dd_deal/deal", su, {})).status).toBe(400);
  });

  it("term-sheet status is `signup`'s: admin and partner yes, IC member no, and only from Term sheet on", async () => {
    await seedDeck("dd_ts", "term_sheet");
    const admin = await login(ADMIN);
    const res = await call("PUT", "/dd_ts/term-sheet", admin, { status: "declined" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deal: DealView }).deal.termSheet).toEqual({ status: "declined", doc: null });
    expect((await call("PUT", "/dd_ts/term-sheet", admin, { status: "executed" })).status).toBe(400);
    expect((await call("PUT", "/dd_ts/term-sheet", await login(IC), { status: "signed" })).status).toBe(403);

    await seedDeck("dd_ts_early", "investment_dd");
    expect((await call("PUT", "/dd_ts_early/term-sheet", admin, { status: "issued" })).status).toBe(409);
  });

  it("attaches an Agreements-library template — never a retired one — and the badge follows the status", async () => {
    await seedDeck("dd_attach", "term_sheet", "AttachCo");
    const partner = await login(PARTNER);
    const tpl = await call("GET", "/templates", partner);
    const { templates } = (await tpl.json()) as { templates: { id: string; status: string; pickable: boolean }[] };
    expect(templates.find((t) => t.id === "at_vc_cnote")).toMatchObject({ status: "retired", pickable: false });

    const retired = await call("POST", "/dd_attach/term-sheet/attach", partner, { templateId: "at_vc_cnote" });
    expect(retired.status).toBe(400);
    expect(await retired.json()).toEqual({ error: "template_retired" });
    expect((await call("POST", "/dd_attach/term-sheet/attach", partner, { templateId: "at_inc_x" })).status).toBe(404);

    const ok = await call("POST", "/dd_attach/term-sheet/attach", partner, { templateId: "at_vc_term" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { deal: DealView }).deal.termSheet).toEqual({
      status: "drafted",
      doc: { fileName: "AttachCo_term-sheet-v3.docx", templateName: "Term Sheet", templateVersion: "v3", version: "draft" },
    });
    const signed = await call("PUT", "/dd_attach/term-sheet", partner, { status: "signed" });
    expect(((await signed.json()) as { deal: DealView }).deal.termSheet.doc?.version).toBe("executed");
    expect((await call("GET", "/templates", await login(IC))).status).toBe(403);
  });
});
