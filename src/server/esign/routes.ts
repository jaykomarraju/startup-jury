/**
 * W5-B — `/api/esign`. Three surfaces on one router:
 *
 *   `/templates*`   Admin console → Sign-up → **Agreements library**
 *                   (`admin/s-suagr.html`) — F0007, F0032, F0045, F0046.
 *   `/signatories`  Admin console → Sign-up → **Authorised signatories**
 *                   (`admin/s-susign.html`) — F0008, F0035.
 *   `/signups/:id*` The sign-up workspace's **signing method** and its
 *                   in-workspace signatory assignment — F0025.
 *
 * The two gates are deliberately different, because the prototype's are:
 *
 *   - the library and the signatory pool are console configuration, so they
 *     take `requireTask("adminconsole", "admin")` — the same ANDed gate Wave 3
 *     put on every other console surface, so revoking the `adminconsole` cell
 *     closes the screen AND its API in one place (§8 Q16);
 *   - the workspace is not. `suAssignCard`'s own subtitle is "assign here — no
 *     admin console needed", so the method and the assignment are open to the
 *     staff who run sign-up: the incubator's PM / PA, the VC's partner /
 *     associate / analyst, admin in both, superuser by bypass. A jury member or
 *     an IC member gets 403 — they never touch a sign-up.
 *
 * Countersigning is stricter again, and the strictness is the feature: it is
 * refused unless a signatory is assigned AND the caller is that signatory AND
 * the grant behind them is still enabled. `countersignRefusal` in
 * `src/shared/agreements.ts` holds the rule; this router is where it bites.
 *
 * §1.3 — no vendor SDK, no credential, no network call. Every signature act
 * records an `esign_outbox` row through `./provider.ts` and reports
 * `status='recorded'`, never 'sent'.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Role } from "../../shared/roles";
import { ROLES_BY_EDITION } from "../../shared/roles";
import { requireAuth, requireRole, requireTask } from "../auth/middleware";
import { auditConfig } from "../audit/events";
import { changedFragment } from "../audit/log";
import {
  assignableOptions,
  canEditSigningMethod,
  countersignRefusal,
  defaultFlow,
  describeAssignment,
  describeCountersignRefusal,
  describeFlowError,
  describeMergeFieldError,
  ESIGN_PROVIDER_LABELS,
  isAssigned,
  isESignProvider,
  isFlowAction,
  isFlowActor,
  isSignatureType,
  isTemplateStage,
  isTemplateStatus,
  nextVersionLabel,
  SIGNATURE_TYPE_SHORT,
  substituteMergeFields,
  templateSummary,
  UNASSIGNED,
  validateFlow,
  validateMergeFields,
  type FlowStep,
  type MergeField,
  type SignatoryAssignment,
  type TemplateStage,
} from "../../shared/agreements";
import {
  applicableTemplate,
  countAgreements,
  createTemplate,
  deleteTemplate,
  listAttempts,
  listSignatures,
  listProgrammes,
  listTemplates,
  loadAgreement,
  loadSignatoryPool,
  loadSignup,
  loadTemplate,
  markCountersigned,
  markFounderSigned,
  prepareAgreement,
  recordSignature,
  saveAssignment,
  saveSigningMethod,
  setRoleGrant,
  setTemplateFile,
  setUserGrant,
  signingMethodView,
  updateTemplate,
} from "./store";
import { describeAttempt, recordESignAttempt } from "./provider";

const esign = new Hono<AppEnv>();
esign.use("*", requireAuth);

/** Who may work a sign-up record. See the header for why this is not `admin`. */
const WORKSPACE_ROLES: Role[] = [
  "admin",
  "program_manager",
  "program_associate",
  "partner",
  "associate",
  "analyst",
];

// Console configuration: the library and the signatory pool.
esign.use("/templates", requireTask("adminconsole", "admin"));
esign.use("/templates/*", requireTask("adminconsole", "admin"));
esign.use("/signatories", requireTask("adminconsole", "admin"));
// The workspace. `founder` is added on the two routes a founder legitimately
// reaches (their own method, and signing it), inside the handler.
esign.use("/signups/*", requireRole(...WORKSPACE_ROLES, "founder"));

const trimmed = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/** A code slug from a template name, so `agreement_templates.code` stays usable. */
function codeFrom(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || "agreement";
}

// ── Agreements library ───────────────────────────────────────────────────────

/** GET /api/esign/templates — the library, plus the programme toggles. */
esign.get("/templates", async (c) => {
  const edition = c.var.user.edition;
  const [templates, programmes] = await Promise.all([
    listTemplates(c.env, edition),
    listProgrammes(c.env, edition),
  ]);
  return c.json({
    edition,
    programmes,
    templates: templates.map((t) => ({ ...t, summary: templateSummary(t) })),
  });
});

interface CreateBody {
  name?: string;
  stage?: string;
}

/**
 * POST /api/esign/templates — `suAdd()`. A Draft with the prototype's own
 * starting shape: one `startup` / `company` field and the three-step flow.
 */
esign.post("/templates", async (c) => {
  const edition = c.var.user.edition;
  const body = await c.req.json<CreateBody>().catch(() => ({}) as CreateBody);
  const name = trimmed(body.name) ?? "New agreement";
  const stage: TemplateStage = isTemplateStage(body.stage) ? body.stage : "on_signup";

  // `agreement_templates` is UNIQUE (edition, code); a second "New agreement"
  // must not 500.
  const existing = await listTemplates(c.env, edition);
  const base = codeFrom(name);
  let code = base;
  for (let n = 2; existing.some((t) => t.code === code); n++) code = `${base}_${n}`;

  const firstField: MergeField =
    edition === "vc"
      ? { key: "company", label: "Company legal name", sample: null }
      : { key: "startup", label: "Startup name", sample: null };

  const id = await createTemplate(c.env, {
    edition,
    name,
    code,
    stage,
    fields: [firstField],
    flow: defaultFlow(edition),
  });
  await auditConfig(c, "agreement_template_created", `Agreement template created: ${name}`, {
    targetType: "agreement_template",
    targetId: id,
  });
  const template = await loadTemplate(c.env, edition, id);
  return c.json({ template }, 201);
});

/** GET /api/esign/templates/:id */
esign.get("/templates/:id", async (c) => {
  const template = await loadTemplate(c.env, c.var.user.edition, c.req.param("id"));
  if (!template) return c.json({ error: "not_found" }, 404);
  return c.json({ template, summary: templateSummary(template) });
});

interface TemplateBody {
  name?: string;
  version?: string;
  status?: string;
  stage?: string;
  fields?: Array<{ key?: unknown; label?: unknown; sample?: unknown }>;
  programIds?: unknown;
  flow?: Array<{ actor?: unknown; action?: unknown }>;
}

/**
 * PUT /api/esign/templates/:id — Save template. The editor posts every card at
 * once (file label + status, merge fields, Applies to, signing workflow), which
 * is why the merge-field and flow rules are validated here rather than per card.
 */
esign.put("/templates/:id", async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const before = await loadTemplate(c.env, edition, id);
  if (!before) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<TemplateBody>().catch(() => ({}) as TemplateBody);

  let fields: MergeField[] | undefined;
  if (Array.isArray(body.fields)) {
    const raw = body.fields.map((f) => ({
      key: typeof f.key === "string" ? f.key : "",
      label: typeof f.label === "string" ? f.label : "",
      sample: typeof f.sample === "string" ? f.sample : null,
    }));
    const check = validateMergeFields(raw);
    if (!check.ok) {
      return c.json({ error: check.reason, message: describeMergeFieldError(check) }, 400);
    }
    fields = check.fields;
  }

  let flow: FlowStep[] | undefined;
  if (Array.isArray(body.flow)) {
    const raw: FlowStep[] = [];
    for (const s of body.flow) {
      if (!isFlowActor(edition, s.actor)) return c.json({ error: "unknown_actor" }, 400);
      if (!isFlowAction(s.action)) return c.json({ error: "unknown_action" }, 400);
      raw.push({ actor: s.actor, action: s.action });
    }
    const check = validateFlow(raw);
    if (!check.ok) {
      return c.json({ error: check.reason, message: describeFlowError(check) }, 400);
    }
    flow = check.steps;
  }

  if (body.status !== undefined && !isTemplateStatus(body.status)) {
    return c.json({ error: "unknown_status" }, 400);
  }
  if (body.stage !== undefined && !isTemplateStage(body.stage)) {
    return c.json({ error: "unknown_stage" }, 400);
  }
  const name = body.name === undefined ? undefined : trimmed(body.name);
  if (body.name !== undefined && name === null) return c.json({ error: "name_required" }, 400);

  const programIds = Array.isArray(body.programIds)
    ? body.programIds.filter((v): v is string => typeof v === "string")
    : undefined;

  await updateTemplate(c.env, edition, id, {
    name: name ?? undefined,
    version: trimmed(body.version) ?? undefined,
    status: isTemplateStatus(body.status) ? body.status : undefined,
    stage: isTemplateStage(body.stage) ? body.stage : undefined,
    fields,
    programIds,
    flow,
  });

  const after = await loadTemplate(c.env, edition, id);
  // The prototype's Audit log carries config rows in exactly this voice
  // ("Area weight updated: Team & execution 10% → 12%").
  const parts = [
    changedFragment("name", before.name, after!.name),
    changedFragment("version", before.version, after!.version),
    changedFragment("status", before.status, after!.status),
    changedFragment("stage", before.stage, after!.stage),
    changedFragment("merge fields", before.fields.length, after!.fields.length),
    changedFragment("mapped programs", before.programIds.length, after!.programIds.length),
    changedFragment("signing steps", before.flow.length, after!.flow.length),
  ].filter((p): p is string => p !== null);
  if (parts.length) {
    await auditConfig(
      c,
      "agreement_template_updated",
      `Agreement template updated: ${after!.name} — ${parts.join(", ")}`,
      { targetType: "agreement_template", targetId: id, detail: { before, after } },
    );
  }
  return c.json({ template: after, summary: templateSummary(after!) });
});

/**
 * POST /api/esign/templates/:id/version — `suVersion`. Bump the label and drop
 * back to Draft, so the live version keeps serving until the new one is marked
 * Active.
 */
esign.post("/templates/:id/version", async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const template = await loadTemplate(c.env, edition, id);
  if (!template) return c.json({ error: "not_found" }, 404);
  const version = nextVersionLabel(template.version);
  await updateTemplate(c.env, edition, id, { version, status: "draft" });
  await auditConfig(
    c,
    "agreement_template_versioned",
    `Agreement template new version: ${template.name} ${template.version} → ${version} (Draft)`,
    { targetType: "agreement_template", targetId: id },
  );
  return c.json({ template: await loadTemplate(c.env, edition, id) });
});

/**
 * POST /api/esign/templates/:id/retire  ·  …/restore — `suRetire` / `suRestore`.
 * "Retired templates stay for audit but can't be picked for new sign-ups", and a
 * restore comes back as a Draft rather than straight to Active, which is the
 * prototype's own choice and the safe one.
 */
esign.post("/templates/:id/retire", async (c) => setStatus(c, "retired"));
esign.post("/templates/:id/restore", async (c) => setStatus(c, "draft"));

async function setStatus(c: Context<AppEnv>, status: "retired" | "draft") {
  const edition = c.var.user.edition;
  // `?? ""` because these two helpers take a bare `Context<AppEnv>`, which does
  // not carry the route's path type; the id is always present at the call site.
  const id = c.req.param("id") ?? "";
  const template = await loadTemplate(c.env, edition, id);
  if (!template) return c.json({ error: "not_found" }, 404);
  await updateTemplate(c.env, edition, id, { status });
  await auditConfig(
    c,
    status === "retired" ? "agreement_template_retired" : "agreement_template_restored",
    `Agreement template ${status === "retired" ? "retired" : "restored as Draft"}: ${template.name}`,
    { targetType: "agreement_template", targetId: id },
  );
  return c.json({ template: await loadTemplate(c.env, edition, id) });
}

/**
 * DELETE /api/esign/templates/:id — **drafts that have never been used only.**
 *
 * The prototype has no delete, and for a template that has raised an agreement
 * that is right: retired-but-kept is what makes the library auditable. But
 * `suAdd()` creates a row the instant the button is clicked, before a name has
 * been typed, so without this a misclick leaves a permanent "New agreement"
 * draft in the library. A draft that no `agreements` row references has nothing
 * to audit, which is exactly the condition enforced here. Recorded as a
 * deliberate addition in the plan's §8.
 */
esign.delete("/templates/:id", async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const template = await loadTemplate(c.env, edition, id);
  if (!template) return c.json({ error: "not_found" }, 404);
  if (template.status !== "draft") return c.json({ error: "not_a_draft" }, 409);
  if (template.agreementCount > 0) return c.json({ error: "template_in_use" }, 409);
  await deleteTemplate(c.env, edition, id);
  await auditConfig(c, "agreement_template_deleted", `Unused draft template deleted: ${template.name}`, {
    targetType: "agreement_template",
    targetId: id,
  });
  return c.json({ ok: true });
});

/** PDF and DOCX — the two the prototype's Replace file prompt names. */
const SOURCE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
};
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/esign/templates/:id/file — upload or replace the source file.
 *
 * Keyed by version, `agreements/templates/<id>/<version>/<name>`, so a version
 * bump does not overwrite the file the previous version was signed against —
 * which is the whole point of keeping a retired template "for audit".
 */
esign.post("/templates/:id/file", async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const template = await loadTemplate(c.env, edition, id);
  if (!template) return c.json({ error: "not_found" }, 404);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);
  const ext = SOURCE_TYPES[file.type];
  if (!ext) return c.json({ error: "unsupported_type", message: "Upload a PDF or DOCX." }, 400);
  if (file.size > MAX_SOURCE_BYTES) return c.json({ error: "file_too_large" }, 413);

  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || `template.${ext}`;
  const key = `agreements/templates/${id}/${template.version}/${safeName}`;
  await c.env.DECKS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  await setTemplateFile(c.env, edition, id, { name: safeName, key });
  await auditConfig(
    c,
    "agreement_template_file_uploaded",
    `Agreement template file uploaded: ${template.name} ${template.version} — ${safeName}`,
    { targetType: "agreement_template", targetId: id },
  );
  return c.json({ template: await loadTemplate(c.env, edition, id) });
});

/** GET /api/esign/templates/:id/file — stream the stored source back. */
esign.get("/templates/:id/file", async (c) => {
  const edition = c.var.user.edition;
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT file_name, file_url FROM agreement_templates WHERE id = ? AND edition = ?",
  )
    .bind(id, edition)
    .first<{ file_name: string | null; file_url: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!row.file_url) return c.json({ error: "no_file" }, 404);
  const object = await c.env.DECKS.get(row.file_url);
  if (!object) return c.json({ error: "no_file" }, 404);
  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("content-disposition", `inline; filename="${row.file_name ?? "template"}"`);
  headers.set("cache-control", "private, max-age=300");
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
});

/**
 * POST /api/esign/templates/:id/preview — run the merge fields over a body of
 * text and report what filled, what is still blank, and what the file asks for
 * that the template never declared.
 *
 * This is the editor's "does my placeholder set match my file?" check, and it is
 * the one route that exercises `substituteMergeFields` over real input.
 */
esign.post("/templates/:id/preview", async (c) => {
  const edition = c.var.user.edition;
  const template = await loadTemplate(c.env, edition, c.req.param("id"));
  if (!template) return c.json({ error: "not_found" }, 404);
  const body = await c.req
    .json<{ text?: unknown; values?: unknown }>()
    .catch(() => ({}) as { text?: unknown; values?: unknown });
  const text = typeof body.text === "string" ? body.text : "";
  const supplied =
    body.values && typeof body.values === "object" && !Array.isArray(body.values)
      ? (body.values as Record<string, string>)
      : undefined;
  // With no values supplied, preview against the declared samples — which is
  // what the `Sample value` column is for.
  const values =
    supplied ??
    Object.fromEntries(template.fields.map((f) => [f.key, f.sample ?? ""]));
  return c.json({ result: substituteMergeFields(text, template.fields, values) });
});

// ── Authorised signatories ───────────────────────────────────────────────────

/** GET /api/esign/signatories — the pool, and the picker it projects to. */
esign.get("/signatories", async (c) => {
  const edition = c.var.user.edition;
  const pool = await loadSignatoryPool(c.env, edition);
  return c.json({ edition, pool, options: assignableOptions(pool) });
});

interface SignatoriesBody {
  roles?: Record<string, unknown>;
  users?: Record<string, unknown>;
}

/**
 * PUT /api/esign/signatories — toggle grants. A partial body is honoured: the
 * section sends only what moved.
 */
esign.put("/signatories", async (c) => {
  const edition = c.var.user.edition;
  const body = await c.req.json<SignatoriesBody>().catch(() => ({}) as SignatoriesBody);
  const before = await loadSignatoryPool(c.env, edition);

  const validRoles = new Set<string>(ROLES_BY_EDITION[edition].filter((r) => r !== "founder"));
  for (const [role, enabled] of Object.entries(body.roles ?? {})) {
    if (!validRoles.has(role)) return c.json({ error: "unknown_role", message: role }, 400);
    await setRoleGrant(c.env, edition, role as Role, enabled === true);
  }

  const validUsers = new Set(before.users.map((u) => u.userId));
  for (const [userId, enabled] of Object.entries(body.users ?? {})) {
    if (!validUsers.has(userId)) return c.json({ error: "unknown_user", message: userId }, 400);
    await setUserGrant(c.env, edition, userId, enabled === true);
  }

  const after = await loadSignatoryPool(c.env, edition);
  const moved = [
    ...after.roles
      .filter((r) => before.roles.find((b) => b.role === r.role)?.enabled !== r.enabled)
      .map((r) => `${r.label} ${r.enabled ? "granted" : "revoked"}`),
    ...after.users
      .filter((u) => before.users.find((b) => b.userId === u.userId)?.enabled !== u.enabled)
      .map((u) => `${u.name} ${u.enabled ? "granted" : "revoked"}`),
  ];
  if (moved.length) {
    await auditConfig(c, "signatories_changed", `Authorised signatories: ${moved.join(", ")}`, {
      targetType: "authorised_signatories",
      targetId: edition,
      detail: { before, after },
    });
  }
  return c.json({ edition, pool: after, options: assignableOptions(after) });
});

// ── The signing method, per record ───────────────────────────────────────────

/**
 * Resolve `:signupId` against the caller. A founder reaches only their own
 * record — founder isolation is a security invariant (`scripts/role-matrix.ts`
 * §B), so it is checked here rather than left to the role list.
 */
async function resolveSignup(c: Context<AppEnv>, opts: { founderMayRead: boolean }) {
  const user = c.var.user;
  // Checked BEFORE the lookup: a founder's refusal is about who they are, not
  // about which record they named, so it must be a 403 even for an id that does
  // not exist. `scripts/role-matrix.ts` probes these routes with a ghost id and
  // would otherwise report a founder as authorised.
  if (user.role === "founder" && !opts.founderMayRead) {
    return c.json({ error: "forbidden" }, 403);
  }
  const record = await loadSignup(c.env, c.req.param("signupId") ?? "");
  if (!record) return c.json({ error: "not_found" }, 404);
  if (record.edition !== user.edition) return c.json({ error: "not_found" }, 404);
  // Founder isolation: their own record only.
  if (user.role === "founder" && record.row.uploaded_by !== user.id) {
    return c.json({ error: "not_found" }, 404);
  }
  return record;
}

/**
 * GET /api/esign/signups/:signupId/method — the method card's whole state:
 * provider, type, both fallbacks, whether it is still editable, why not if not,
 * and who is assigned to countersign.
 *
 * Readable by the founder for their own record — that is the data behind the
 * prototype's founder-side mirror, "How you'll sign" (`suwFounderMethod`).
 */
esign.get("/signups/:signupId/method", async (c) => {
  const found = await resolveSignup(c, { founderMayRead: true });
  if (found instanceof Response) return found;
  const pool = await loadSignatoryPool(c.env, found.edition);
  const view = signingMethodView(found, pool);
  return c.json({
    method: view,
    options: assignableOptions(pool),
    providerLabel: ESIGN_PROVIDER_LABELS[view.provider],
    sigTypeLabel: SIGNATURE_TYPE_SHORT[view.sigType],
    attempts: c.var.user.role === "founder" ? [] : await listAttempts(c.env, found.row.id),
  });
});

interface MethodBody {
  provider?: unknown;
  sigType?: unknown;
  inApp?: unknown;
  wetInk?: unknown;
}

/**
 * PUT /api/esign/signups/:signupId/method — **the locked field.**
 *
 * Both specs §8.3: "a signing method is chosen per record and locked once the
 * founder signs". A change after that point is refused with 409, not silently
 * dropped and not 403 — the caller had the right to ask, the record's state is
 * what says no.
 */
esign.put("/signups/:signupId/method", async (c) => {
  const found = await resolveSignup(c, { founderMayRead: false });
  if (found instanceof Response) return found;

  if (!canEditSigningMethod({ status: found.status, founderSignedAt: found.row.founder_signed_at })) {
    return c.json(
      {
        error: "method_locked",
        message:
          found.row.founder_signed_at !== null
            ? "The founder has signed — the signing method can no longer be changed."
            : "This sign-up has moved past setup — the signing method can no longer be changed.",
      },
      409,
    );
  }

  const body = await c.req.json<MethodBody>().catch(() => ({}) as MethodBody);
  if (!isESignProvider(body.provider)) return c.json({ error: "unknown_provider" }, 400);
  if (!isSignatureType(body.sigType)) return c.json({ error: "unknown_sig_type" }, 400);
  const inApp = body.inApp !== false;
  const wetInk = body.wetInk !== false;
  // At least one channel has to remain, or the founder is shown a method with
  // no way to act on it. The prototype's two toggles can both be turned off;
  // that is an oversight, not an option.
  if (!inApp && !wetInk) {
    return c.json(
      {
        error: "no_signing_channel",
        message: "Leave at least one of In-app signature or Print, scan & upload enabled.",
      },
      400,
    );
  }

  const pool = await loadSignatoryPool(c.env, found.edition);
  const before = signingMethodView(found, pool);
  await saveSigningMethod(c.env, found.row.id, {
    provider: body.provider,
    sigType: body.sigType,
    inApp,
    wetInk,
  });

  const parts = [
    changedFragment("provider", before.provider, body.provider),
    changedFragment("signature type", before.sigType, body.sigType),
    changedFragment("in-app", before.inApp, inApp),
    changedFragment("print & upload", before.wetInk, wetInk),
  ].filter((p): p is string => p !== null);
  if (parts.length) {
    await auditConfig(
      c,
      "signing_method_changed",
      `Signing method set for ${found.row.deck_name}: ${parts.join(", ")}`,
      { targetType: "signup", targetId: found.row.id, deckId: found.row.deck_id },
    );
  }

  const refreshed = await loadSignup(c.env, found.row.id);
  return c.json({ method: signingMethodView(refreshed!, pool) });
});

interface AssignBody {
  role?: unknown;
  userId?: unknown;
}

/**
 * PUT /api/esign/signups/:signupId/signatory — the in-workspace assign
 * (`suAssignCard`). Only an *enabled* grant may be assigned: "Only those
 * enabled here appear in the sign-up countersign picker" is enforced, not just
 * rendered.
 */
esign.put("/signups/:signupId/signatory", async (c) => {
  const found = await resolveSignup(c, { founderMayRead: false });
  if (found instanceof Response) return found;
  // Once the agreement is completed the countersignatory is history, not a
  // setting — the prototype collapses the card to a read-only line at that
  // point (`suAssignCard`'s `locked` list).
  if (["completed", "onboarded", "archived"].includes(found.status)) {
    return c.json({ error: "signup_closed" }, 409);
  }

  const body = await c.req.json<AssignBody>().catch(() => ({}) as AssignBody);
  const pool = await loadSignatoryPool(c.env, found.edition);
  const options = assignableOptions(pool);

  let assignment: SignatoryAssignment;
  if (typeof body.userId === "string" && body.userId !== "") {
    if (!options.named.some((u) => u.userId === body.userId)) {
      return c.json({ error: "not_a_signatory", message: describeCountersignRefusal("not_authorised") }, 400);
    }
    assignment = { role: null, userId: body.userId };
  } else if (typeof body.role === "string" && body.role !== "") {
    if (!options.byRole.some((r) => r.role === body.role)) {
      return c.json({ error: "not_a_signatory", message: describeCountersignRefusal("not_authorised") }, 400);
    }
    assignment = { role: body.role as Role, userId: null };
  } else {
    assignment = UNASSIGNED;
  }

  await saveAssignment(c.env, found.row.id, assignment);
  await auditConfig(
    c,
    "signatory_assigned",
    isAssigned(assignment)
      ? `Countersignatory assigned for ${found.row.deck_name}: ${describeAssignment(pool, assignment)}`
      : `Countersignatory cleared for ${found.row.deck_name}`,
    { targetType: "signup", targetId: found.row.id, deckId: found.row.deck_id },
  );
  const refreshed = await loadSignup(c.env, found.row.id);
  return c.json({ method: signingMethodView(refreshed!, pool) });
});

/**
 * POST /api/esign/signups/:signupId/agreement — "Fill blanks".
 *
 * Raises the agreement instance for this record from the template the library
 * says applies (F0046: which template, for which programme, at which stage) and
 * stores the filled merge values. Idempotent: called again it updates the values
 * in place, until the founder signs and everything freezes.
 *
 * A value whose key the template never declared is not written — the response
 * reports it in `ignored`, which is `substituteMergeFields`'s own contract.
 */
esign.post("/signups/:signupId/agreement", async (c) => {
  const found = await resolveSignup(c, { founderMayRead: false });
  if (found instanceof Response) return found;
  if (found.row.founder_signed_at !== null) {
    return c.json(
      { error: "method_locked", message: "The founder has signed — the agreement is frozen." },
      409,
    );
  }

  const templates = await listTemplates(c.env, found.edition);
  const template = applicableTemplate(templates, {
    programId: found.row.program_id,
    stage: "on_signup",
  });
  if (!template) {
    return c.json(
      {
        error: "no_applicable_template",
        message:
          "No active template is mapped to this programme at the On sign-up stage. " +
          "Map one in Admin → Agreements library.",
      },
      409,
    );
  }

  const body = await c.req
    .json<{ values?: unknown }>()
    .catch(() => ({}) as { values?: unknown });
  const supplied =
    body.values && typeof body.values === "object" && !Array.isArray(body.values)
      ? (body.values as Record<string, unknown>)
      : {};
  const declared = new Set(template.fields.map((f) => f.key));
  const values: Record<string, string> = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(supplied)) {
    if (!declared.has(key)) {
      ignored.push(key);
      continue;
    }
    values[key] = typeof value === "string" ? value : "";
  }
  const missing = template.fields.filter((f) => !values[f.key]?.trim()).map((f) => f.key);

  const agreement = await prepareAgreement(c.env, found, template, values);
  return c.json({
    agreement: {
      id: agreement.id,
      templateId: agreement.template_id,
      kind: agreement.kind,
      methodLocked: agreement.method_locked === 1,
      values,
    },
    template: { id: template.id, name: template.name, version: template.version },
    missing,
    ignored,
  });
});

/**
 * POST /api/esign/signups/:signupId/founder-signature — **the act that locks
 * the method.**
 *
 * Reached two ways, which is why both the founder and the staff who run the
 * sign-up may call it: the founder signs in the app or at the provider, or the
 * team records a wet-ink signature that arrived by post ("Print, scan &
 * upload"). Either way the method freezes and the attempt is recorded through
 * the §1.3 stub.
 *
 * Idempotent: a second call returns the same recorded signature rather than
 * moving the record twice.
 */
esign.post("/signups/:signupId/founder-signature", async (c) => {
  const found = await resolveSignup(c, { founderMayRead: true });
  if (found instanceof Response) return found;
  const pool = await loadSignatoryPool(c.env, found.edition);

  if (found.row.founder_signed_at !== null) {
    return c.json({ method: signingMethodView(found, pool), alreadySigned: true });
  }
  if (found.status !== "initiated" && found.status !== "progress") {
    return c.json({ error: "signup_closed" }, 409);
  }

  const view = signingMethodView(found, pool);
  const at = new Date().toISOString();

  // The founder cannot sign a document nobody raised, so raise it here if the
  // team has not — with no merge values, which is what `missing` then reports.
  let agreement = await loadAgreement(c.env, found.row.id);
  if (!agreement) {
    const template = applicableTemplate(await listTemplates(c.env, found.edition), {
      programId: found.row.program_id,
      stage: "on_signup",
    });
    if (template) agreement = await prepareAgreement(c.env, found, template, {});
  }

  await markFounderSigned(c.env, found.row.id, at);
  const attempt = await recordESignAttempt(c.env, {
    kind: "founder_signature",
    signupId: found.row.id,
    agreementId: agreement?.id ?? null,
    provider: view.provider,
    sigType: view.sigType,
    recipients: found.row.founder_email ? [found.row.founder_email] : [],
    documentName: found.row.deck_name,
    dedupeKey: `founder_signature:${found.row.id}`,
  });
  if (agreement) {
    await recordSignature(c.env, {
      agreementId: agreement.id,
      // A founder signer is identified by email, not by a users row
      // (`migrations/0035`'s own comment on `signatures`).
      signerUserId: null,
      signerEmail: found.row.founder_email,
      signerName: found.row.deck_name,
      provider: view.provider,
      sigType: view.sigType,
      providerReference: attempt.providerReference,
      at,
    });
  }

  const refreshed = await loadSignup(c.env, found.row.id);
  return c.json({
    method: signingMethodView(refreshed!, pool),
    agreementId: agreement?.id ?? null,
    attempt: { ...attempt, note: describeAttempt(attempt) },
  });
});

/**
 * POST /api/esign/signups/:signupId/countersign — **the gate** (F0008).
 *
 * Refused with 409 and the prototype's own sentence when no signatory is
 * assigned ("Assign an authorised signatory to countersign."); with 403 when
 * someone else is assigned or the grant behind the assignment has been revoked.
 * The distinction matters: the first is a missing step, the second is an
 * authorisation failure.
 */
esign.post("/signups/:signupId/countersign", async (c) => {
  const found = await resolveSignup(c, { founderMayRead: false });
  if (found instanceof Response) return found;
  const user = c.var.user;
  const pool = await loadSignatoryPool(c.env, found.edition);

  if (found.row.founder_signed_at === null) {
    return c.json(
      { error: "founder_has_not_signed", message: "The founder signs first." },
      409,
    );
  }
  const refusal = countersignRefusal(pool, found.assignment, { id: user.id, role: user.role });
  if (refusal) {
    return c.json(
      { error: refusal, message: describeCountersignRefusal(refusal) },
      refusal === "no_signatory" ? 409 : 403,
    );
  }

  const view = signingMethodView(found, pool);
  const at = new Date().toISOString();
  const agreement = await loadAgreement(c.env, found.row.id);
  await markCountersigned(c.env, found.row.id, user.id, at);
  const attempt = await recordESignAttempt(c.env, {
    kind: "countersign",
    signupId: found.row.id,
    agreementId: agreement?.id ?? null,
    provider: view.provider,
    sigType: view.sigType,
    recipients: found.row.founder_email ? [found.row.founder_email] : [],
    documentName: found.row.deck_name,
    dedupeKey: `countersign:${found.row.id}`,
  });
  if (agreement) {
    await recordSignature(c.env, {
      agreementId: agreement.id,
      signerUserId: user.id,
      signerEmail: null,
      signerName: user.name,
      provider: view.provider,
      sigType: view.sigType,
      providerReference: attempt.providerReference,
      at,
    });
  }
  await auditConfig(
    c,
    "agreement_countersigned",
    `Agreement countersigned for ${found.row.deck_name} by ${describeAssignment(pool, found.assignment)}`,
    { targetType: "signup", targetId: found.row.id, deckId: found.row.deck_id },
  );

  const refreshed = await loadSignup(c.env, found.row.id);
  return c.json({
    method: signingMethodView(refreshed!, pool),
    agreements: await countAgreements(c.env, found.row.id),
    signatures: agreement ? await listSignatures(c.env, agreement.id) : [],
    attempt: { ...attempt, note: describeAttempt(attempt) },
  });
});

export default esign;
