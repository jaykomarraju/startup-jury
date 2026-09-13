import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import type {
  AgreementTemplateView,
  SignatoryPool,
  SigningMethodView,
} from "../../src/shared/agreements";

/**
 * W5-B — `/api/esign`: the Agreements library, the Authorised signatories pool
 * and the per-record signing method.
 *
 * The four properties this suite exists to hold:
 *
 *  1. **The countersign gate** (F0008). No signatory assigned → refused. Someone
 *     else assigned → refused. A grant revoked after assignment → refused.
 *  2. **The lock on the signing method** (F0025). A change after the founder
 *     signs is refused, and the refusal is the record's state (409), not the
 *     caller's authority.
 *  3. **§1.3** — every signature act records an `esign_outbox` row with
 *     `status='recorded'` and performs nothing. No provider, no credential.
 *  4. **AuthZ on every route** — an allowed role AND a forbidden one, per §4.
 */

const BASE = "https://example.com";

// Seed logins (migrations/0002_seed.sql · 0015_roles_users.sql).
const ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin
const SUPERUSER = "priya.sharma@demo.startupjury.ai"; // incubator superuser
const PM = "raj.kumar@demo.startupjury.ai"; // incubator program_manager
const PA = "sunita.rao@demo.startupjury.ai"; // incubator program_associate
const JURY = "rajesh.kumar@demo.startupjury.ai"; // incubator jury — never a sign-up actor
const FOUNDER = "meera.sharma@demo.startupjury.ai"; // owns inc_deck_meera_signup
const VC_ADMIN = "nisha.kapoor.vc@demo.startupjury.ai";

/** `0034` back-fills this one at status `initiated` — the editable record. */
const SIGNUP = "su_inc_deck_meera_signup";
/** Already at `progress`, so `0049` gave it a founder signature. */
const SIGNED_SIGNUP = "su_inc_deck_medixir";

async function login(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "demo1234" }),
  });
  const setCookie = res.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

const get = (p: string, c: string) => SELF.fetch(`${BASE}${p}`, { headers: { cookie: c } });

function send(method: string, path: string, cookie: string, body?: unknown) {
  const bodyless = method === "GET" || method === "HEAD";
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: bodyless ? { cookie } : { cookie, "content-type": "application/json" },
    body: bodyless ? undefined : JSON.stringify(body ?? {}),
  });
}
const post = (p: string, c: string, b?: unknown) => send("POST", p, c, b);
const put = (p: string, c: string, b?: unknown) => send("PUT", p, c, b);
const del = (p: string, c: string) => send("DELETE", p, c);

interface LibraryPayload {
  templates: Array<AgreementTemplateView & { summary: string }>;
  programmes: Array<{ id: string; name: string }>;
}

async function library(cookie: string): Promise<LibraryPayload> {
  const res = await get("/api/esign/templates", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as LibraryPayload;
}

async function pool(cookie: string): Promise<SignatoryPool> {
  const res = await get("/api/esign/signatories", cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { pool: SignatoryPool }).pool;
}

async function method(signupId: string, cookie: string): Promise<SigningMethodView> {
  const res = await get(`/api/esign/signups/${signupId}/method`, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { method: SigningMethodView }).method;
}

/**
 * **This project's worker tests share one D1 across the file** — there is no
 * per-test storage isolation (proved by writing in one test and reading it in
 * the next), so every test here starts from a restored seed rather than from
 * whatever its predecessor left. Without this the suite passes or fails on its
 * own declaration order, which is the least useful kind of green.
 *
 * Restored: the one sign-up these tests drive, everything hanging off it, the
 * incubator signatory grants, and the incubator library including the templates
 * a test may have created. Mirrored from `migrations/0035`.
 */
beforeEach(async () => {
  await env.DB.batch([
    // The record under test, back to a freshly `initiated` sign-up.
    env.DB.prepare(
      "UPDATE signups SET status = 'initiated', signing_provider = NULL, sig_type = NULL, " +
        "in_app = 1, wet_ink = 0, authorised_signatory_role = NULL, " +
        "authorised_signatory_user_id = NULL, founder_signed_at = NULL, completed_at = NULL, " +
        // W6-A: the §8.3 PM assignment gate reads this column.
        "assigned_user_id = NULL WHERE id = ?",
    ).bind(SIGNUP),
    env.DB.prepare(
      "DELETE FROM signatures WHERE agreement_id IN (SELECT id FROM agreements WHERE signup_id = ?)",
    ).bind(SIGNUP),
    env.DB.prepare("DELETE FROM agreements WHERE signup_id = ?").bind(SIGNUP),
    env.DB.prepare("DELETE FROM esign_outbox WHERE signup_id = ?").bind(SIGNUP),
    env.DB.prepare("DELETE FROM audit_log WHERE edition = 'incubator' AND target_type IN ('agreement_template', 'authorised_signatories', 'signup')"),

    // The signatory grants, back to `s-susign.html`'s seeded switches.
    env.DB.prepare("DELETE FROM authorised_signatories WHERE edition = 'incubator'"),
    env.DB.prepare(
      "INSERT INTO authorised_signatories (id, edition, role, user_id, enabled) VALUES " +
        "('as_inc_role_superuser', 'incubator', 'superuser', NULL, 1), " +
        "('as_inc_role_program_manager', 'incubator', 'program_manager', NULL, 1), " +
        "('as_inc_role_program_associate', 'incubator', 'program_associate', NULL, 0), " +
        "('as_inc_role_jury', 'incubator', 'jury', NULL, 0), " +
        "('as_inc_user_superuser', 'incubator', NULL, 'inc_superuser', 1), " +
        "('as_inc_user_pm', 'incubator', NULL, 'inc_pm', 1), " +
        "('as_inc_user_admin', 'incubator', NULL, 'inc_admin', 0)",
    ),

    // The library: drop anything a test created, then restore the four seeds.
    env.DB.prepare(
      "DELETE FROM agreement_templates WHERE edition = 'incubator' " +
        "AND id NOT IN ('at_inc_incub', 'at_inc_safe', 'at_inc_mou', 'at_inc_nda')",
    ),
    env.DB.prepare(
      "UPDATE agreement_templates SET name = 'Incubation Agreement', file_name = 'incubation-agreement-v3.docx', " +
        "file_url = NULL, version = 'v3', status = 'active', stage = 'on_signup' WHERE id = 'at_inc_incub'",
    ),
    env.DB.prepare(
      "UPDATE agreement_templates SET name = 'SAFE Note', file_name = 'safe-note-v2.pdf', " +
        "file_url = NULL, version = 'v2', status = 'active', stage = 'on_signup' WHERE id = 'at_inc_safe'",
    ),
    env.DB.prepare(
      "UPDATE agreement_templates SET name = 'Mentorship MOU', file_name = 'mentorship-mou-v1.docx', " +
        "file_url = NULL, version = 'v1', status = 'draft', stage = 'on_signup' WHERE id = 'at_inc_mou'",
    ),
    env.DB.prepare(
      "UPDATE agreement_templates SET name = 'Mutual NDA', file_name = 'mutual-nda-v1.pdf', " +
        "file_url = NULL, version = 'v1', status = 'retired', stage = 'pre_signup' WHERE id = 'at_inc_nda'",
    ),

    env.DB.prepare(
      "DELETE FROM agreement_template_fields WHERE template_id IN ('at_inc_incub', 'at_inc_safe', 'at_inc_mou', 'at_inc_nda')",
    ),
    env.DB.prepare(
      "INSERT INTO agreement_template_fields (id, template_id, key, label, sample, sort_order) VALUES " +
        "('atf_inc_incub_1', 'at_inc_incub', 'startup', 'Startup legal name', 'NeuraLeaf AI Pvt Ltd', 1), " +
        "('atf_inc_incub_2', 'at_inc_incub', 'founder', 'Founder name', 'Ananya Menon', 2), " +
        "('atf_inc_incub_3', 'at_inc_incub', 'date', 'Effective date', '03 Jul 2026', 3), " +
        "('atf_inc_incub_4', 'at_inc_incub', 'term', 'Program term', '6 months', 4), " +
        "('atf_inc_incub_5', 'at_inc_incub', 'equity', 'Equity consideration', '4%', 5), " +
        "('atf_inc_safe_1', 'at_inc_safe', 'company', 'Company legal name', 'Aether Systems Pvt Ltd', 1), " +
        "('atf_inc_safe_2', 'at_inc_safe', 'cap', 'Valuation cap', '₹12 Cr', 2), " +
        "('atf_inc_safe_3', 'at_inc_safe', 'disc', 'Discount rate', '20%', 3), " +
        "('atf_inc_safe_4', 'at_inc_safe', 'amt', 'Investment amount', '₹1,50,00,000', 4), " +
        "('atf_inc_mou_1', 'at_inc_mou', 'startup', 'Startup name', NULL, 1), " +
        "('atf_inc_mou_2', 'at_inc_mou', 'mentor', 'Mentor name', NULL, 2), " +
        "('atf_inc_nda_1', 'at_inc_nda', 'party', 'Counterparty', NULL, 1)",
    ),

    env.DB.prepare(
      "DELETE FROM agreement_flow_steps WHERE template_id IN ('at_inc_incub', 'at_inc_safe', 'at_inc_mou', 'at_inc_nda')",
    ),
    env.DB.prepare(
      "INSERT INTO agreement_flow_steps (id, template_id, step_index, actor_role, action) VALUES " +
        "('afs_inc_incub_1', 'at_inc_incub', 1, 'program_associate', 'fill_blanks'), " +
        "('afs_inc_incub_2', 'at_inc_incub', 2, 'founder', 'sign_first'), " +
        "('afs_inc_incub_3', 'at_inc_incub', 3, 'superuser', 'countersign'), " +
        "('afs_inc_safe_1', 'at_inc_safe', 1, 'program_manager', 'fill_blanks'), " +
        "('afs_inc_safe_2', 'at_inc_safe', 2, 'founder', 'sign_first'), " +
        "('afs_inc_safe_3', 'at_inc_safe', 3, 'superuser', 'countersign'), " +
        "('afs_inc_mou_1', 'at_inc_mou', 1, 'program_associate', 'fill_blanks'), " +
        "('afs_inc_mou_2', 'at_inc_mou', 2, 'founder', 'sign_first'), " +
        "('afs_inc_mou_3', 'at_inc_mou', 3, 'program_manager', 'countersign'), " +
        "('afs_inc_nda_1', 'at_inc_nda', 1, 'program_associate', 'fill_blanks'), " +
        "('afs_inc_nda_2', 'at_inc_nda', 2, 'founder', 'sign_first'), " +
        "('afs_inc_nda_3', 'at_inc_nda', 3, 'program_manager', 'countersign')",
    ),

    env.DB.prepare(
      "DELETE FROM agreement_template_programs WHERE template_id IN ('at_inc_incub', 'at_inc_safe', 'at_inc_mou', 'at_inc_nda')",
    ),
    env.DB.prepare(
      "INSERT INTO agreement_template_programs (template_id, program_id) " +
        "SELECT 'at_inc_incub', id FROM programs WHERE edition = 'incubator' AND name = 'Fintech Accelerator'",
    ),
    env.DB.prepare(
      "INSERT INTO agreement_template_programs (template_id, program_id) " +
        "SELECT 'at_inc_safe', id FROM programs WHERE edition = 'incubator' AND name = 'SaaS Accelerator'",
    ),

    // W3-A's permission grid: the authZ suite revokes `adminconsole`.
    env.DB.prepare("DELETE FROM role_permissions WHERE edition = 'incubator' AND task_id = 'adminconsole'"),
  ]);
});

// ── The library ──────────────────────────────────────────────────────────────

describe("GET /api/esign/templates", () => {
  it("lists the seeded templates with their lifecycle, active first", async () => {
    const admin = await login(ADMIN);
    const { templates } = await library(admin);
    expect(templates.map((t) => t.name)).toEqual([
      "Incubation Agreement",
      "SAFE Note",
      "Mentorship MOU",
      "Mutual NDA",
    ]);
    expect(templates.map((t) => t.status)).toEqual(["active", "active", "draft", "retired"]);
  });

  it("renders the prototype's summary line for each row", async () => {
    const admin = await login(ADMIN);
    const { templates } = await library(admin);
    const incub = templates.find((t) => t.code === "incubation_agreement")!;
    expect(incub.summary).toBe(
      "incubation-agreement-v3.docx · v3 · 5 merge fields · Fintech Accelerator",
    );
    const mou = templates.find((t) => t.code === "mentorship_mou")!;
    expect(mou.summary).toBe("mentorship-mou-v1.docx · v1 · 2 merge fields · unmapped");
  });

  it("carries the merge fields, the programme map and the signing workflow", async () => {
    const admin = await login(ADMIN);
    const { templates } = await library(admin);
    const incub = templates.find((t) => t.code === "incubation_agreement")!;
    expect(incub.fields.map((f) => f.key)).toEqual([
      "startup",
      "founder",
      "date",
      "term",
      "equity",
    ]);
    expect(incub.fields[0].sample).toBe("NeuraLeaf AI Pvt Ltd");
    expect(incub.programNames).toEqual(["Fintech Accelerator"]);
    expect(incub.flow).toEqual([
      { actor: "program_associate", action: "fill_blanks" },
      { actor: "founder", action: "sign_first" },
      { actor: "superuser", action: "countersign" },
    ]);
    expect(incub.stage).toBe("on_signup");
  });

  it("is scoped to the caller's edition — the VC library is the VC set", async () => {
    const vc = await login(VC_ADMIN);
    const { templates } = await library(vc);
    expect(templates.map((t) => t.code).sort()).toEqual([
      "convertible_note",
      "safe_note",
      "shareholders_agreement",
      "term_sheet",
    ]);
    // `at_vc_sha` is a Post-sign-up template — the VC build's own stage spread.
    expect(templates.find((t) => t.code === "shareholders_agreement")!.stage).toBe("post_signup");
  });

  it("offers the edition's programmes as the Applies-to toggles", async () => {
    const admin = await login(ADMIN);
    const { programmes } = await library(admin);
    expect(programmes.map((p) => p.name)).toEqual([
      "Climate Cohort",
      "Fintech Accelerator",
      "SaaS Accelerator",
    ]);
  });
});

describe("the template editor", () => {
  it("saves merge fields, the stage, the programme map and the flow together", async () => {
    const admin = await login(ADMIN);
    const before = (await library(admin)).templates.find((t) => t.code === "mentorship_mou")!;
    const saas = (await library(admin)).programmes.find((p) => p.name === "SaaS Accelerator")!;

    const res = await put(`/api/esign/templates/${before.id}`, admin, {
      name: "Mentorship MOU",
      version: "v1",
      status: "active",
      stage: "pre_signup",
      fields: [
        { key: "startup", label: "Startup name", sample: "NeuraLeaf" },
        { key: "mentor", label: "Mentor name", sample: "Arjun Verma" },
        { key: "hours", label: "Committed hours", sample: "12 / month" },
      ],
      programIds: [saas.id],
      flow: [
        { actor: "program_associate", action: "fill_blanks" },
        { actor: "founder", action: "sign_first" },
        { actor: "program_manager", action: "countersign" },
      ],
    });
    expect(res.status).toBe(200);
    const { template } = (await res.json()) as { template: AgreementTemplateView };
    expect(template.stage).toBe("pre_signup");
    expect(template.status).toBe("active");
    expect(template.fields.map((f) => f.key)).toEqual(["startup", "mentor", "hours"]);
    expect(template.programNames).toEqual(["SaaS Accelerator"]);

    // It persists — re-read through the list rather than trusting the response.
    const after = (await library(admin)).templates.find((t) => t.id === before.id)!;
    expect(after.fields).toHaveLength(3);
    expect(after.programIds).toEqual([saas.id]);
  });

  it("refuses a duplicate merge-field key with the operator's sentence", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates[0];
    const res = await put(`/api/esign/templates/${t.id}`, admin, {
      fields: [
        { key: "startup", label: "Name", sample: null },
        { key: "startup", label: "Name again", sample: null },
      ],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("duplicate_key");
    expect(body.message).toContain("used by two merge fields");
    // Nothing was written.
    const after = (await library(admin)).templates.find((x) => x.id === t.id)!;
    expect(after.fields).toHaveLength(5);
  });

  it("refuses a key that cannot be a placeholder", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates[0];
    const res = await put(`/api/esign/templates/${t.id}`, admin, {
      fields: [{ key: "start up", label: "Name", sample: null }],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_key");
  });

  it("refuses a countersign step that runs before the founder signs", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates[0];
    const res = await put(`/api/esign/templates/${t.id}`, admin, {
      flow: [
        { actor: "superuser", action: "countersign" },
        { actor: "founder", action: "sign_first" },
      ],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("countersign_before_signature");
  });

  it("refuses a flow actor that is not a role of this edition", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates[0];
    const res = await put(`/api/esign/templates/${t.id}`, admin, {
      // A VC role, posted to an incubator template.
      flow: [{ actor: "partner", action: "fill_blanks" }],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("unknown_actor");
  });

  it("drops a programme id from the other edition rather than mapping it", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates.find((x) => x.code === "mentorship_mou")!;
    const res = await put(`/api/esign/templates/${t.id}`, admin, {
      programIds: ["prog_vc_0005"],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { template: AgreementTemplateView }).template.programIds).toEqual(
      [],
    );
  });

  it("adds a template as a Draft with the prototype's starting shape", async () => {
    const admin = await login(ADMIN);
    const res = await post("/api/esign/templates", admin, { name: "Data Processing Addendum" });
    expect(res.status).toBe(201);
    const { template } = (await res.json()) as { template: AgreementTemplateView };
    expect(template.status).toBe("draft");
    expect(template.version).toBe("v1");
    expect(template.stage).toBe("on_signup");
    expect(template.fileName).toBeNull();
    expect(template.fields.map((f) => f.key)).toEqual(["startup"]);
    expect(template.flow.map((s) => s.action)).toEqual([
      "fill_blanks",
      "sign_first",
      "countersign",
    ]);
  });

  it("does not collide on code when the same name is added twice", async () => {
    const admin = await login(ADMIN);
    expect((await post("/api/esign/templates", admin, { name: "Side Letter" })).status).toBe(201);
    const second = await post("/api/esign/templates", admin, { name: "Side Letter" });
    expect(second.status).toBe(201);
    const codes = (await library(admin)).templates.map((t) => t.code);
    expect(codes).toContain("side_letter");
    expect(codes).toContain("side_letter_2");
  });

  it("bumps the version and drops back to Draft — `suVersion`", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates.find((x) => x.code === "incubation_agreement")!;
    const res = await post(`/api/esign/templates/${t.id}/version`, admin);
    expect(res.status).toBe(200);
    const { template } = (await res.json()) as { template: AgreementTemplateView };
    expect(template.version).toBe("v4");
    expect(template.status).toBe("draft");
  });

  it("retires and restores — a restore comes back as a Draft, not Active", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates.find((x) => x.code === "safe_note")!;
    const retired = await post(`/api/esign/templates/${t.id}/retire`, admin);
    expect(((await retired.json()) as { template: AgreementTemplateView }).template.status).toBe(
      "retired",
    );
    const restored = await post(`/api/esign/templates/${t.id}/restore`, admin);
    expect(((await restored.json()) as { template: AgreementTemplateView }).template.status).toBe(
      "draft",
    );
  });

  it("deletes an unused draft, and refuses to delete anything else", async () => {
    const admin = await login(ADMIN);
    const created = (
      (await (await post("/api/esign/templates", admin, { name: "Scratch" })).json()) as {
        template: AgreementTemplateView;
      }
    ).template;
    expect((await del(`/api/esign/templates/${created.id}`, admin)).status).toBe(200);
    expect((await library(admin)).templates.find((t) => t.id === created.id)).toBeUndefined();

    const active = (await library(admin)).templates.find((t) => t.status === "active")!;
    const refused = await del(`/api/esign/templates/${active.id}`, admin);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("not_a_draft");
  });

  it("404s on a template from the other edition", async () => {
    const admin = await login(ADMIN);
    expect((await get("/api/esign/templates/at_vc_term", admin)).status).toBe(404);
    expect((await put("/api/esign/templates/at_vc_term", admin, {})).status).toBe(404);
  });
});

describe("the merge-field preview", () => {
  it("fills from the declared samples, and reports a blank and an undeclared placeholder", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates.find((x) => x.code === "mentorship_mou")!;
    // `at_inc_mou`'s two fields have NULL samples (`0035`), so both are blanks.
    const res = await post(`/api/esign/templates/${t.id}/preview`, admin, {
      text: "{{startup}} and {{mentor}} agree. Cap: {{cap}}.",
    });
    expect(res.status).toBe(200);
    const { result } = (await res.json()) as {
      result: { text: string; missing: string[]; unknown: string[]; filled: string[] };
    };
    expect(result.missing).toEqual(["startup", "mentor"]);
    expect(result.unknown).toEqual(["cap"]);
    expect(result.text).toContain("{{cap}}");
    expect(result.text).not.toContain("{{startup}}");
  });

  it("uses supplied values when given, and ignores an undeclared key", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates.find((x) => x.code === "incubation_agreement")!;
    const res = await post(`/api/esign/templates/${t.id}/preview`, admin, {
      text: "{{startup}} · {{equity}} · {{nonsense}}",
      values: { startup: "Aether Systems", equity: "6%", nonsense: "should never appear" },
    });
    const { result } = (await res.json()) as {
      result: { text: string; ignored: string[] };
    };
    expect(result.text).toContain("Aether Systems · 6%");
    expect(result.text).not.toContain("should never appear");
    expect(result.ignored).toEqual(["nonsense"]);
  });
});

describe("the template source file", () => {
  it("uploads a DOCX, records it, and streams it back", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates.find((x) => x.code === "mentorship_mou")!;
    expect(t.fileStored).toBe(false);

    const form = new FormData();
    form.append(
      "file",
      new File(["PK not really a docx"], "mentorship-mou-v2.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const res = await SELF.fetch(`${BASE}/api/esign/templates/${t.id}/file`, {
      method: "POST",
      headers: { cookie: admin },
      body: form,
    });
    expect(res.status).toBe(200);
    const { template } = (await res.json()) as { template: AgreementTemplateView };
    expect(template.fileName).toBe("mentorship-mou-v2.docx");
    expect(template.fileStored).toBe(true);

    const download = await get(`/api/esign/templates/${t.id}/file`, admin);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("wordprocessingml");
    // Decoded by hand: `.text()` warns when the Content-Type is binary.
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toContain("not really a docx");
  });

  it("keys the object by version so a bump cannot overwrite a signed document", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates.find((x) => x.code === "mentorship_mou")!;
    const form = new FormData();
    form.append("file", new File(["v1 body"], "mou.pdf", { type: "application/pdf" }));
    await SELF.fetch(`${BASE}/api/esign/templates/${t.id}/file`, {
      method: "POST",
      headers: { cookie: admin },
      body: form,
    });
    const stored = await env.DB.prepare(
      "SELECT file_url FROM agreement_templates WHERE id = ?",
    )
      .bind(t.id)
      .first<{ file_url: string }>();
    expect(stored!.file_url).toBe(`agreements/templates/${t.id}/v1/mou.pdf`);
  });

  it("refuses a type that is neither PDF nor DOCX", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates[0];
    const form = new FormData();
    form.append("file", new File(["<html>"], "template.html", { type: "text/html" }));
    const res = await SELF.fetch(`${BASE}/api/esign/templates/${t.id}/file`, {
      method: "POST",
      headers: { cookie: admin },
      body: form,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("unsupported_type");
  });

  it("404s the download when no file has been uploaded", async () => {
    const admin = await login(ADMIN);
    const t = (await library(admin)).templates.find((x) => x.code === "mutual_nda")!;
    const res = await get(`/api/esign/templates/${t.id}/file`, admin);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("no_file");
  });
});

// ── Authorised signatories ───────────────────────────────────────────────────

describe("/api/esign/signatories", () => {
  it("reports the seeded pool — Super User and Program Manager on, the rest off", async () => {
    const admin = await login(ADMIN);
    const p = await pool(admin);
    expect(p.roles.map((r) => [r.label, r.enabled])).toEqual([
      ["Super User", true],
      ["Admin", false],
      ["Program Manager", true],
      ["Program Associate", false],
      ["Jury Member", false],
    ]);
    expect(p.users.find((u) => u.userId === "inc_pm")!.enabled).toBe(true);
    expect(p.users.find((u) => u.userId === "inc_admin")!.enabled).toBe(false);
    // The founder is never a signatory on the organisation's behalf.
    expect(p.users.some((u) => u.role === "founder")).toBe(false);
  });

  it("uses the VC role vocabulary in the VC edition", async () => {
    const vc = await login(VC_ADMIN);
    const p = await pool(vc);
    expect(p.roles.map((r) => r.label)).toEqual([
      "Managing Partner",
      "Admin",
      "Partner",
      "IC Member",
      "Investment Associate",
      "Analyst",
    ]);
    expect(p.roles.find((r) => r.role === "partner")!.enabled).toBe(true);
  });

  it("toggles a role grant and a named individual, and persists both", async () => {
    const admin = await login(ADMIN);
    const res = await put("/api/esign/signatories", admin, {
      roles: { program_associate: true, program_manager: false },
      users: { inc_admin: true },
    });
    expect(res.status).toBe(200);
    const p = await pool(admin);
    expect(p.roles.find((r) => r.role === "program_associate")!.enabled).toBe(true);
    expect(p.roles.find((r) => r.role === "program_manager")!.enabled).toBe(false);
    expect(p.users.find((u) => u.userId === "inc_admin")!.enabled).toBe(true);
  });

  it("refuses a role that is not of this edition, and an unknown user", async () => {
    const admin = await login(ADMIN);
    expect((await put("/api/esign/signatories", admin, { roles: { partner: true } })).status).toBe(
      400,
    );
    expect(
      (await put("/api/esign/signatories", admin, { users: { nobody_at_all: true } })).status,
    ).toBe(400);
  });

  it("writes a config audit row naming what moved", async () => {
    const admin = await login(ADMIN);
    await put("/api/esign/signatories", admin, { roles: { jury: true } });
    const row = await env.DB.prepare(
      "SELECT summary FROM audit_log WHERE action = 'signatories_changed' AND summary LIKE '%Jury Member granted%'",
    ).first<{ summary: string }>();
    expect(row?.summary).toContain("Jury Member granted");
  });
});

// ── The signing method ───────────────────────────────────────────────────────

describe("GET /api/esign/signups/:id/method", () => {
  it("reports the platform default, editable, on a record with no method chosen", async () => {
    const pa = await login(PA);
    const m = await method(SIGNUP, pa);
    expect(m.configured).toBe(false);
    expect(m.provider).toBe("SignDesk");
    expect(m.sigType).toBe("standard");
    expect(m.inApp).toBe(true);
    // The prototype defaults BOTH fallbacks on, even though the column default
    // is 0 — `DEFAULT_SIGNING_METHOD` says why the prototype wins.
    expect(m.wetInk).toBe(true);
    expect(m.editable).toBe(true);
    expect(m.lockReason).toBeNull();
    expect(m.assignment).toEqual({ role: null, userId: null });
    expect(m.assignmentLabel).toBe("Not assigned");
  });

  it("reports a record whose founder has already signed as locked", async () => {
    const pa = await login(PA);
    const m = await method(SIGNED_SIGNUP, pa);
    expect(m.founderSignedAt).not.toBeNull();
    expect(m.editable).toBe(false);
    expect(m.lockReason).toBe("Signing method locked — founder has signed");
  });

  it("lets the founder read their own record, and nobody else's", async () => {
    const founder = await login(FOUNDER);
    const mine = await get(`/api/esign/signups/${SIGNUP}/method`, founder);
    expect(mine.status).toBe(200);
    const theirs = await get(`/api/esign/signups/${SIGNED_SIGNUP}/method`, founder);
    expect(theirs.status).toBe(404);
  });
});

describe("PUT /api/esign/signups/:id/method", () => {
  it("sets the provider, the signature type and both fallbacks", async () => {
    const pa = await login(PA);
    const res = await put(`/api/esign/signups/${SIGNUP}/method`, pa, {
      provider: "eMudhra",
      sigType: "certificate",
      inApp: false,
      wetInk: true,
    });
    expect(res.status).toBe(200);
    const { method: m } = (await res.json()) as { method: SigningMethodView };
    expect(m.provider).toBe("eMudhra");
    expect(m.sigType).toBe("certificate");
    expect(m.inApp).toBe(false);
    expect(m.wetInk).toBe(true);
    expect(m.configured).toBe(true);
    expect((await method(SIGNUP, pa)).provider).toBe("eMudhra");
  });

  it("refuses a provider outside the five", async () => {
    const pa = await login(PA);
    const res = await put(`/api/esign/signups/${SIGNUP}/method`, pa, {
      provider: "HelloSign",
      sigType: "standard",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("unknown_provider");
  });

  it("refuses turning BOTH fallbacks off — the founder would have no way to sign", async () => {
    const pa = await login(PA);
    const res = await put(`/api/esign/signups/${SIGNUP}/method`, pa, {
      provider: "DocuSign",
      sigType: "standard",
      inApp: false,
      wetInk: false,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("no_signing_channel");
  });

  it("**LOCKS ON THE FOUNDER'S SIGNATURE** — a later change is refused", async () => {
    const pa = await login(PA);
    // Editable now.
    expect(
      (
        await put(`/api/esign/signups/${SIGNUP}/method`, pa, {
          provider: "DocuSign",
          sigType: "standard",
        })
      ).status,
    ).toBe(200);

    // The founder signs.
    const signed = await post(`/api/esign/signups/${SIGNUP}/founder-signature`, pa);
    expect(signed.status).toBe(200);
    const after = ((await signed.json()) as { method: SigningMethodView }).method;
    expect(after.founderSignedAt).not.toBeNull();
    expect(after.editable).toBe(false);

    // And the method is frozen.
    const refused = await put(`/api/esign/signups/${SIGNUP}/method`, pa, {
      provider: "Zoho",
      sigType: "certificate",
    });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: string; message: string };
    expect(body.error).toBe("method_locked");
    expect(body.message).toContain("founder has signed");
    // Unchanged.
    expect((await method(SIGNUP, pa)).provider).toBe("DocuSign");
  });

  it("refuses a change on a record that has moved past setup, even unsigned", async () => {
    // `signups.status` is advanced directly: this asserts the STATUS half of
    // `canEditSigningMethod`, with no founder signature involved.
    await env.DB.prepare("UPDATE signups SET status = 'completed' WHERE id = ?")
      .bind(SIGNUP)
      .run();
    const pa = await login(PA);
    const res = await put(`/api/esign/signups/${SIGNUP}/method`, pa, {
      provider: "Zoho",
      sigType: "standard",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toContain("past setup");
  });

  it("is not something a founder may do to their own record", async () => {
    const founder = await login(FOUNDER);
    const res = await put(`/api/esign/signups/${SIGNUP}/method`, founder, {
      provider: "Zoho",
      sigType: "standard",
    });
    expect(res.status).toBe(403);
  });
});

// ── The countersign gate ─────────────────────────────────────────────────────

describe("POST /api/esign/signups/:id/countersign", () => {
  it("refuses while the founder has not signed", async () => {
    const su = await login(SUPERUSER);
    await put(`/api/esign/signups/${SIGNUP}/signatory`, su, { role: "superuser" });
    const res = await post(`/api/esign/signups/${SIGNUP}/countersign`, su);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("founder_has_not_signed");
  });

  it("**REFUSES WITH NO SIGNATORY ASSIGNED**, in the prototype's own words", async () => {
    const su = await login(SUPERUSER);
    await post(`/api/esign/signups/${SIGNUP}/founder-signature`, su);
    const res = await post(`/api/esign/signups/${SIGNUP}/countersign`, su);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("no_signatory");
    expect(body.message).toBe("Assign an authorised signatory to countersign.");
  });

  it("completes the sign-up once a signatory is assigned and signs", async () => {
    const su = await login(SUPERUSER);
    await put(`/api/esign/signups/${SIGNUP}/signatory`, su, { role: "superuser" });
    await post(`/api/esign/signups/${SIGNUP}/founder-signature`, su);
    const res = await post(`/api/esign/signups/${SIGNUP}/countersign`, su);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      method: SigningMethodView;
      signatures: Array<{ signerName: string | null }>;
    };
    expect(body.method.status).toBe("completed");
    // Founder first, countersignatory second — the order the flow declares.
    expect(body.signatures.map((s) => s.signerName)).toEqual(["LedgerLite", "Priya Sharma"]);
    const agreement = await env.DB.prepare(
      "SELECT countersigned_by, method_locked FROM agreements WHERE signup_id = ?",
    )
      .bind(SIGNUP)
      .first<{ countersigned_by: string; method_locked: number }>();
    expect(agreement!.countersigned_by).toBe("inc_superuser");
    expect(agreement!.method_locked).toBe(1);
  });

  it("refuses someone who is not the assigned signatory", async () => {
    const su = await login(SUPERUSER);
    // Assign the PM by name, then have the superuser try.
    await put(`/api/esign/signups/${SIGNUP}/signatory`, su, { userId: "inc_pm" });
    await post(`/api/esign/signups/${SIGNUP}/founder-signature`, su);
    const res = await post(`/api/esign/signups/${SIGNUP}/countersign`, su);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_the_signatory");
  });

  it("refuses once the grant behind an assignment is revoked in the console", async () => {
    const admin = await login(ADMIN);
    const pm = await login(PM);
    await put(`/api/esign/signups/${SIGNUP}/signatory`, admin, { userId: "inc_pm" });
    // W6-A: a Program Manager acts on a sign-up only once assigned to it (§8.3);
    // unassigned, the refusal would be `read_only` before the grant is consulted.
    expect((await put(`/api/signups/${SIGNUP}/assignee`, admin, { userId: "inc_pm" })).status).toBe(200);
    await post(`/api/esign/signups/${SIGNUP}/founder-signature`, admin);
    // The console revokes the person who was already assigned.
    await put("/api/esign/signatories", admin, { users: { inc_pm: false } });
    const res = await post(`/api/esign/signups/${SIGNUP}/countersign`, pm);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("not_authorised");
    expect(body.message).toContain("no longer enabled");
  });
});

describe("PUT /api/esign/signups/:id/signatory", () => {
  it("assigns by role and by named individual, and clears", async () => {
    const admin = await login(ADMIN);
    const byRole = await put(`/api/esign/signups/${SIGNUP}/signatory`, admin, {
      role: "program_manager",
    });
    expect(((await byRole.json()) as { method: SigningMethodView }).method.assignmentLabel).toBe(
      "Program Manager (any)",
    );
    const byName = await put(`/api/esign/signups/${SIGNUP}/signatory`, admin, {
      userId: "inc_pm",
    });
    const named = ((await byName.json()) as { method: SigningMethodView }).method;
    expect(named.assignmentLabel).toBe("Raj Kumar — Program Manager");
    // Exactly one of the two columns is ever set.
    expect(named.assignment).toEqual({ role: null, userId: "inc_pm" });

    const cleared = await put(`/api/esign/signups/${SIGNUP}/signatory`, admin, {});
    expect(((await cleared.json()) as { method: SigningMethodView }).method.assignment).toEqual({
      role: null,
      userId: null,
    });
  });

  it("refuses to assign someone who is not an enabled signatory", async () => {
    const admin = await login(ADMIN);
    // `program_associate` is seeded OFF, and `inc_admin` is seeded OFF.
    expect(
      (await put(`/api/esign/signups/${SIGNUP}/signatory`, admin, { role: "program_associate" }))
        .status,
    ).toBe(400);
    expect(
      (await put(`/api/esign/signups/${SIGNUP}/signatory`, admin, { userId: "inc_admin" })).status,
    ).toBe(400);
  });
});

// ── §1.3: the provider is stubbed and records ────────────────────────────────

describe("§1.3 — the e-signature provider is stubbed", () => {
  it("records the founder's signature in `esign_outbox` as 'recorded', never 'sent'", async () => {
    const pa = await login(PA);
    const res = await post(`/api/esign/signups/${SIGNUP}/founder-signature`, pa);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attempt: { status: string; providerReference: string; note: string };
    };
    expect(body.attempt.status).toBe("recorded");
    expect(body.attempt.providerReference).toMatch(/^stub:signdesk:/);
    expect(body.attempt.note).toContain("no e-signature provider is configured");

    const row = await env.DB.prepare(
      "SELECT kind, provider, status, recipients_json FROM esign_outbox WHERE signup_id = ? AND kind = 'founder_signature'",
    )
      .bind(SIGNUP)
      .first<{ kind: string; provider: string; status: string; recipients_json: string }>();
    expect(row!.status).toBe("recorded");
    expect(row!.provider).toBe("SignDesk");
    expect(JSON.parse(row!.recipients_json)).toEqual(["meera.sharma@demo.startupjury.ai"]);
  });

  it("is idempotent — a second founder signature does not move the record again", async () => {
    const pa = await login(PA);
    const first = await post(`/api/esign/signups/${SIGNUP}/founder-signature`, pa);
    const firstAt = ((await first.json()) as { method: SigningMethodView }).method.founderSignedAt;
    const second = await post(`/api/esign/signups/${SIGNUP}/founder-signature`, pa);
    const body = (await second.json()) as { method: SigningMethodView; alreadySigned: boolean };
    expect(body.alreadySigned).toBe(true);
    expect(body.method.founderSignedAt).toBe(firstAt);
    const n = await env.DB.prepare(
      "SELECT COUNT(*) n FROM esign_outbox WHERE signup_id = ? AND kind = 'founder_signature'",
    )
      .bind(SIGNUP)
      .first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("holds no credential anywhere in the outbox row", async () => {
    const pa = await login(PA);
    await post(`/api/esign/signups/${SIGNUP}/founder-signature`, pa);
    const row = await env.DB.prepare("SELECT * FROM esign_outbox WHERE signup_id = ?")
      .bind(SIGNUP)
      .first<Record<string, unknown>>();
    expect(Object.keys(row!)).not.toContain("credential");
    expect(JSON.stringify(row)).not.toMatch(/token|secret|api[_-]?key/i);
  });
});

// ── The agreement instance ───────────────────────────────────────────────────

describe("POST /api/esign/signups/:id/agreement", () => {
  it("raises the agreement from the template mapped to the record's programme", async () => {
    const pa = await login(PA);
    // `inc_deck_meera_signup` is on SaaS Accelerator, which `0035` maps to the
    // SAFE Note — so that is the template that applies.
    const res = await post(`/api/esign/signups/${SIGNUP}/agreement`, pa, {
      values: { company: "LedgerLite Pvt Ltd", cap: "₹8 Cr" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      template: { name: string };
      missing: string[];
      ignored: string[];
      agreement: { kind: string; values: Record<string, string> };
    };
    expect(body.template.name).toBe("SAFE Note");
    expect(body.agreement.kind).toBe("safe_note");
    expect(body.agreement.values).toEqual({ company: "LedgerLite Pvt Ltd", cap: "₹8 Cr" });
    // `disc` and `amt` are declared and still blank.
    expect(body.missing).toEqual(["disc", "amt"]);
    expect(body.ignored).toEqual([]);
  });

  it("never stores a value whose key the template did not declare", async () => {
    const pa = await login(PA);
    const res = await post(`/api/esign/signups/${SIGNUP}/agreement`, pa, {
      values: { company: "LedgerLite", nonsense: "drop me" },
    });
    const body = (await res.json()) as {
      ignored: string[];
      agreement: { values: Record<string, string> };
    };
    expect(body.ignored).toEqual(["nonsense"]);
    expect(body.agreement.values).not.toHaveProperty("nonsense");
    const stored = await env.DB.prepare(
      "SELECT merge_values_json FROM agreements WHERE signup_id = ?",
    )
      .bind(SIGNUP)
      .first<{ merge_values_json: string }>();
    expect(stored!.merge_values_json).not.toContain("nonsense");
  });

  it("refuses to change the filled blanks once the founder has signed", async () => {
    const pa = await login(PA);
    await post(`/api/esign/signups/${SIGNUP}/agreement`, pa, { values: { company: "LedgerLite" } });
    await post(`/api/esign/signups/${SIGNUP}/founder-signature`, pa);
    const res = await post(`/api/esign/signups/${SIGNUP}/agreement`, pa, {
      values: { company: "Something Else" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("method_locked");
  });

  it("refuses when no active template is mapped to the stage", async () => {
    const admin = await login(ADMIN);
    // Retire both Active on-sign-up templates and unmap the rest.
    const { templates } = await library(admin);
    for (const t of templates.filter((x) => x.status === "active")) {
      await post(`/api/esign/templates/${t.id}/retire`, admin);
    }
    const res = await post(`/api/esign/signups/${SIGNUP}/agreement`, admin, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("no_applicable_template");
  });
});

// ── AuthZ, per §4: an allowed role AND a forbidden one on every route ────────

describe("authZ", () => {
  const LIBRARY_ROUTES: Array<[string, string]> = [
    ["GET", "/api/esign/templates"],
    ["POST", "/api/esign/templates"],
    ["GET", "/api/esign/templates/at_inc_incub"],
    ["PUT", "/api/esign/templates/at_inc_incub"],
    ["DELETE", "/api/esign/templates/at_inc_incub"],
    ["POST", "/api/esign/templates/at_inc_incub/version"],
    ["POST", "/api/esign/templates/at_inc_incub/retire"],
    ["POST", "/api/esign/templates/at_inc_incub/restore"],
    ["POST", "/api/esign/templates/at_inc_incub/preview"],
    ["POST", "/api/esign/templates/at_inc_incub/file"],
    ["GET", "/api/esign/templates/at_inc_incub/file"],
    ["GET", "/api/esign/signatories"],
    ["PUT", "/api/esign/signatories"],
  ];

  it("admin reaches every console route; a program associate reaches none", async () => {
    const admin = await login(ADMIN);
    const pa = await login(PA);
    for (const [verb, path] of LIBRARY_ROUTES) {
      const allowed = await send(verb, path, admin);
      expect(allowed.status, `${verb} ${path} (admin)`).not.toBe(403);
      const refused = await send(verb, path, pa);
      expect(refused.status, `${verb} ${path} (program_associate)`).toBe(403);
    }
  });

  it("a jury member reaches no console route and no workspace route", async () => {
    const jury = await login(JURY);
    for (const [verb, path] of LIBRARY_ROUTES) {
      expect((await send(verb, path, jury)).status, `${verb} ${path}`).toBe(403);
    }
    for (const [verb, path] of [
      ["GET", `/api/esign/signups/${SIGNUP}/method`],
      ["PUT", `/api/esign/signups/${SIGNUP}/method`],
      ["PUT", `/api/esign/signups/${SIGNUP}/signatory`],
      ["POST", `/api/esign/signups/${SIGNUP}/agreement`],
      ["POST", `/api/esign/signups/${SIGNUP}/founder-signature`],
      ["POST", `/api/esign/signups/${SIGNUP}/countersign`],
    ] as Array<[string, string]>) {
      expect((await send(verb, path, jury)).status, `${verb} ${path}`).toBe(403);
    }
  });

  it("the program manager and the program associate work the sign-up, the jury does not", async () => {
    for (const email of [PM, PA]) {
      const cookie = await login(email);
      expect((await get(`/api/esign/signups/${SIGNUP}/method`, cookie)).status, email).toBe(200);
    }
    const jury = await login(JURY);
    expect((await get(`/api/esign/signups/${SIGNUP}/method`, jury)).status).toBe(403);
  });

  it("the superuser bypass reaches both halves", async () => {
    const su = await login(SUPERUSER);
    expect((await get("/api/esign/templates", su)).status).toBe(200);
    expect((await get(`/api/esign/signups/${SIGNUP}/method`, su)).status).toBe(200);
  });

  it("refuses an unauthenticated caller on every route", async () => {
    for (const [verb, path] of LIBRARY_ROUTES) {
      expect((await send(verb, path, "")).status, `${verb} ${path}`).toBe(401);
    }
    expect((await get(`/api/esign/signups/${SIGNUP}/method`, "")).status).toBe(401);
  });

  it("closes the whole console API when the `adminconsole` permission is revoked", async () => {
    // §8 Q16's property: the grid is the gate for the screen AND its API.
    await env.DB.prepare(
      "INSERT INTO role_permissions (edition, role, task_id, granted) VALUES ('incubator', 'admin', 'adminconsole', 0) " +
        "ON CONFLICT (edition, role, task_id) DO UPDATE SET granted = 0",
    ).run();
    const admin = await login(ADMIN);
    expect((await get("/api/esign/templates", admin)).status).toBe(403);
    expect((await get("/api/esign/signatories", admin)).status).toBe(403);
  });
});
