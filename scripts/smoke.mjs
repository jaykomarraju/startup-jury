#!/usr/bin/env node
// Post-deploy smoke test against a live ai.STARTUPJURY Workers deployment.
//
// Read-only / non-mutating: it logs in as seeded demo users (creates a KV
// session) and exercises health + read endpoints + authZ across both editions.
// It never uploads, transitions, or writes pipeline/config data, so it is safe
// to run against the public demo seed.
//
//   node scripts/smoke.mjs [baseUrl]
//   SMOKE_URL=https://... node scripts/smoke.mjs
//
// Exits 0 if every check passes, 1 otherwise.

const BASE = (
  process.argv[2] ||
  process.env.SMOKE_URL ||
  "https://startup-jury.jay-komarraju.workers.dev"
).replace(/\/$/, "");

const DEMO_PASSWORD = "demo1234";
// Deliberately NOT the superuser (Managing Partner) logins: superuser bypasses
// every nav guard, so authZ checks would pass vacuously. The incubator admin and
// the VC partner/analyst are ordinary role-gated principals, so the report reads
// and 403s below genuinely exercise canAccessNav.
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai"; // incubator admin (not superuser)
const VC_PARTNER = "ishaan.sethi@demo.startupjury.ai"; // VC partner — sees all VC reports
const VC_ANALYST = "rhea.nair@demo.startupjury.ai"; // VC analyst — sees only Scoring
const VC_ASSOCIATE = "sunita.rao.vc@demo.startupjury.ai"; // VC associate — schedules intro calls

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}
function fail(name, detail) {
  failed++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}
function check(name, cond, detail) {
  if (cond) ok(name);
  else fail(name, detail);
}

// Minimal cookie jar keyed on the session cookie the app sets.
const SESSION_COOKIE = "sj_session";

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Cookie"] = `${SESSION_COOKIE}=${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (e.g. SPA HTML fallback) */
  }
  // Extract the session token from Set-Cookie, if present. Prefer getSetCookie()
  // (Node ≥18.15 / modern undici), falling back to the raw combined header so the
  // script also works on older runtimes.
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length === 0) {
    const raw = res.headers.get("set-cookie");
    if (raw) setCookie.push(raw);
  }
  let sessionToken = null;
  for (const c of setCookie) {
    const m = c.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    if (m && m[1] && m[1] !== "") sessionToken = m[1];
  }
  return {
    status: res.status,
    json,
    text,
    token: sessionToken,
    contentType: res.headers.get("content-type"),
    headers: res.headers,
  };
}

async function login(email) {
  const r = await req("POST", "/api/auth/login", {
    body: { email, password: DEMO_PASSWORD },
  });
  if (r.status !== 200 || !r.token) {
    throw new Error(
      `login failed for ${email}: HTTP ${r.status} ${JSON.stringify(r.json)}`,
    );
  }
  return { token: r.token, user: r.json?.user };
}

async function main() {
  console.log(`ai.STARTUPJURY post-deploy smoke → ${BASE}\n`);

  // 1. Health (unauthenticated).
  console.log("health");
  {
    const r = await req("GET", "/api/health");
    check("GET /api/health → 200", r.status === 200, `HTTP ${r.status}`);
    check(
      "health payload status=ok",
      r.json?.status === "ok" && r.json?.service === "startup-jury",
      JSON.stringify(r.json),
    );
  }

  // 1b. Security headers on the SPA document (src/server/security.ts).
  //
  // Worth a live check rather than trusting the unit tests: the first deploy of
  // this header reached `curl` but NOT browsers, because the edge was still
  // serving a cached `index.html` variant. `run_worker_first` + `no-store` fixed
  // it, and these assertions are what would catch that class of regression.
  console.log("security headers");
  {
    const doc = await req("GET", "/login");
    const csp = doc.headers.get("content-security-policy") ?? "";
    check(
      "SPA document → CSP with the deck-viewer directives",
      doc.status === 200 &&
        (doc.contentType ?? "").includes("text/html") &&
        csp.includes("img-src 'self' data:") &&
        csp.includes("worker-src 'self' blob:") &&
        csp.includes("style-src 'self' 'unsafe-inline'"),
      csp || "(no CSP header)",
    );
    check(
      "SPA document → CSP locks scripts to self",
      csp.includes("script-src 'self'") &&
        csp.includes("default-src 'self'") &&
        csp.includes("object-src 'none'") &&
        csp.includes("frame-ancestors 'none'"),
      csp || "(no CSP header)",
    );
    // The Worker sends `no-store`, but Cloudflare's asset layer rewrites it at
    // the edge to `public, max-age=0, must-revalidate` (see security.ts). Both
    // mean "revalidate before reuse", which is the property that matters: a
    // long-lived cached document would strand browsers on a pre-deploy shell
    // with no CSP and stale /assets/* references. Assert that, not the literal.
    const cc = doc.headers.get("cache-control") ?? "";
    check(
      "SPA document → revalidated, never long-lived, + nosniff",
      (cc.includes("no-store") || (cc.includes("max-age=0") && cc.includes("must-revalidate"))) &&
        doc.headers.get("x-content-type-options") === "nosniff",
      `cache-control=${cc} nosniff=${doc.headers.get("x-content-type-options")}`,
    );
    const api = await req("GET", "/api/health");
    check(
      "API → hardened, and carries no CSP",
      api.headers.get("x-content-type-options") === "nosniff" &&
        api.headers.get("referrer-policy") === "strict-origin-when-cross-origin" &&
        api.headers.get("content-security-policy") === null,
      `csp=${api.headers.get("content-security-policy")}`,
    );
  }

  // 2. Auth gate + invalid creds.
  console.log("auth");
  {
    const anon = await req("GET", "/api/auth/me");
    check("GET /api/auth/me anon → 401", anon.status === 401, `HTTP ${anon.status}`);

    const bad = await req("POST", "/api/auth/login", {
      body: { email: INC_ADMIN, password: "wrong-password" },
    });
    check("login wrong password → 401", bad.status === 401, `HTTP ${bad.status}`);
  }

  // 3. Incubator edition reads.
  console.log("incubator edition");
  const inc = await login(INC_ADMIN);
  check(
    "login incubator admin → edition incubator",
    inc.user?.edition === "incubator" && inc.user?.role === "admin",
    JSON.stringify(inc.user),
  );
  {
    const me = await req("GET", "/api/auth/me", { token: inc.token });
    check("GET /api/auth/me → 200", me.status === 200 && me.json?.user?.id === inc.user?.id);

    const decks = await req("GET", "/api/decks", { token: inc.token });
    const list = Array.isArray(decks.json?.decks) ? decks.json.decks : decks.json;
    // Assert the endpoint is healthy and shaped as a list — NOT that seed data
    // exists (an empty cohort is a valid 200, e.g. a freshly-migrated env).
    check(
      "GET /api/decks → 200 list",
      decks.status === 200 && Array.isArray(list),
      `HTTP ${decks.status}, ${Array.isArray(list) ? `len ${list.length}` : "not-array"}`,
    );

    const summary = await req("GET", "/api/config/summary", { token: inc.token });
    check(
      "GET /api/config/summary → has plan + coreParams",
      summary.status === 200 &&
        typeof summary.json?.plan === "string" &&
        Array.isArray(summary.json?.coreParams) &&
        summary.json.coreParams.length > 0,
      `HTTP ${summary.status}`,
    );

    // User management roster (Session 4) — admin-gated read.
    const users = await req("GET", "/api/users", { token: inc.token });
    check(
      "GET /api/users → 200 roster with roles",
      users.status === 200 &&
        Array.isArray(users.json?.users) &&
        users.json.users.length > 0 &&
        typeof users.json.users[0]?.roleLabel === "string",
      `HTTP ${users.status}`,
    );

    for (const slug of ["cohort", "funnel", "evaluators", "drift"]) {
      const a = await req("GET", `/api/analytics/${slug}`, { token: inc.token });
      check(`GET /api/analytics/${slug} → 200`, a.status === 200, `HTTP ${a.status}`);
    }

    // Cross-edition authZ: incubator user must not read a VC-only report.
    const capital = await req("GET", "/api/analytics/capital", { token: inc.token });
    check(
      "incubator → /api/analytics/capital → 403",
      capital.status === 403,
      `HTTP ${capital.status}`,
    );
  }

  // 4. VC edition reads — as a partner (role-gated, NOT superuser), so the report
  //    guards are genuinely exercised.
  console.log("vc edition");
  const vc = await login(VC_PARTNER);
  check(
    "login VC partner → edition vc, role partner",
    vc.user?.edition === "vc" && vc.user?.role === "partner",
    JSON.stringify(vc.user),
  );
  {
    for (const slug of ["capital", "portfolio", "scoring", "diligence", "decisions", "funnel"]) {
      const a = await req("GET", `/api/analytics/${slug}`, { token: vc.token });
      check(`GET /api/analytics/${slug} → 200`, a.status === 200, `HTTP ${a.status}`);
    }
    const decks = await req("GET", "/api/decks", { token: vc.token });
    const list = Array.isArray(decks.json?.decks) ? decks.json.decks : decks.json;
    check(
      "VC GET /api/decks → 200 list",
      decks.status === 200 && Array.isArray(list),
      `HTTP ${decks.status}`,
    );
    // Cross-edition authZ: a VC user must not read an incubator-only report.
    const cohort = await req("GET", "/api/analytics/cohort", { token: vc.token });
    check("VC → /api/analytics/cohort → 403", cohort.status === 403, `HTTP ${cohort.status}`);
  }

  // 4b. Intra-VC authZ: an analyst sees only Scoring — capital must 403. (Not a
  //     superuser, so this is a real per-role guard check, not a vacuous pass.)
  console.log("vc role gating");
  const analyst = await login(VC_ANALYST);
  check(
    "login VC analyst → role analyst",
    analyst.user?.role === "analyst" && analyst.user?.edition === "vc",
    JSON.stringify(analyst.user),
  );
  {
    const scoring = await req("GET", "/api/analytics/scoring", { token: analyst.token });
    check("analyst → /api/analytics/scoring → 200", scoring.status === 200, `HTTP ${scoring.status}`);
    const capital = await req("GET", "/api/analytics/capital", { token: analyst.token });
    check("analyst → /api/analytics/capital → 403", capital.status === 403, `HTTP ${capital.status}`);
  }

  // 4c. Session 7 — call scheduling / ICS, the issue log, and the AI-health
  //     surfacing. All read-only: nothing here schedules, invites or re-drives.
  console.log("session 7 surfaces");
  {
    // A scheduler role sees the edition's calls and can reach the directory.
    const assoc = await login(VC_ASSOCIATE);
    const calls = await req("GET", "/api/calls?kind=intro", { token: assoc.token });
    check(
      "associate GET /api/calls → 200, canSchedule",
      calls.status === 200 && calls.json?.canSchedule === true && Array.isArray(calls.json?.calls),
      `HTTP ${calls.status}`,
    );
    const dir = await req("GET", "/api/calls/directory", { token: assoc.token });
    check(
      "associate GET /api/calls/directory → 200",
      dir.status === 200 && Array.isArray(dir.json?.people) && dir.json.people.length > 0,
      `HTTP ${dir.status}`,
    );

    // A read-only role must not reach the directory, and sees only its own calls.
    const analystCalls = await req("GET", "/api/calls", { token: analyst.token });
    check(
      "analyst GET /api/calls → 200 but canSchedule false",
      analystCalls.status === 200 && analystCalls.json?.canSchedule === false,
      `HTTP ${analystCalls.status}`,
    );
    const analystDir = await req("GET", "/api/calls/directory", { token: analyst.token });
    check(
      "analyst → /api/calls/directory → 403",
      analystDir.status === 403,
      `HTTP ${analystDir.status}`,
    );

    // The .ics endpoint returns a real calendar document, not JSON or the SPA.
    const ics = await req("GET", "/api/calls/call_seed_wealthos_intro/ics", { token: assoc.token });
    check(
      "GET /api/calls/:id/ics → 200 text/calendar VEVENT",
      ics.status === 200 &&
        (ics.contentType || "").includes("text/calendar") &&
        typeof ics.text === "string" &&
        ics.text.startsWith("BEGIN:VCALENDAR") &&
        ics.text.includes("BEGIN:VEVENT"),
      `HTTP ${ics.status} ${ics.contentType}`,
    );

    // The internal issue log is edition-scoped and separate from the ticket queue.
    const issues = await req("GET", "/api/issues", { token: assoc.token });
    check(
      "GET /api/issues → 200 internal log",
      issues.status === 200 && Array.isArray(issues.json?.issues),
      `HTTP ${issues.status}`,
    );

    // §9: every deck view carries an explicit AI state, so "Pending AI" is no
    // longer ambiguous between running and permanently stuck.
    const decks = await req("GET", "/api/decks", { token: inc.token });
    const rows = Array.isArray(decks.json?.decks) ? decks.json.decks : [];
    check(
      "decks carry aiState (§9 stuck-deck surfacing)",
      rows.length > 0 && rows.every((d) => typeof d.aiState === "string"),
      `${rows.length} decks`,
    );

    await req("POST", "/api/auth/logout", { token: assoc.token });
  }

  // 4b. Session 8 — seed coherence + the public resubmit route.
  console.log("\nSession 8 — seed coherence + public resubmit");
  {
    const decks = await req("GET", "/api/decks", { token: inc.token });
    const rows = Array.isArray(decks.json?.decks) ? decks.json.decks : [];

    // Every scored deck must have a real per-parameter breakdown behind its
    // headline number, not just the number (migration 0020).
    const scored = rows.filter((d) => typeof d.aiScore === "number");
    const sample = scored[0];
    if (sample) {
      const detail = await req(`GET`, `/api/decks/${sample.id}`, { token: inc.token });
      const aiScores = Array.isArray(detail.json?.scores) ? detail.json.scores : [];
      check(
        "a scored deck exposes its full AI breakdown",
        detail.status === 200 && aiScores.length >= 13,
        `${sample.name}: ${aiScores.length} parameter scores`,
      );
    } else {
      check("a scored deck exposes its full AI breakdown", false, "no scored deck found");
    }

    // Every deck sits inside the Sector → Program → Cohort hierarchy, so the
    // toolbar filters never silently hide one (0019 dropped the old free text).
    check(
      "every deck resolves a program",
      rows.length > 0 && rows.every((d) => typeof d.programName === "string" && d.programName),
      `${rows.filter((d) => !d.programName).length} without a program`,
    );

    // The §9 AI-health surface has something to render.
    check(
      "the AI-health surface has a failed deck to report",
      rows.some((d) => d.aiState === "failed"),
      `states: ${[...new Set(rows.map((d) => d.aiState))].join(", ")}`,
    );

    // The tokenized founder page is public — no cookie involved — and leaks
    // nothing but what the founder has to fix.
    const pub = await req("GET", "/api/resubmit/aisj-demo-nimbushr-resubmit-2026");
    check(
      "public resubmit link → 200 with no session",
      pub.status === 200 && Array.isArray(pub.json?.missingFields),
      `HTTP ${pub.status}`,
    );
    check(
      "the resubmit payload carries no scores or evaluator data",
      pub.status === 200 && pub.json?.aiScore === undefined && pub.json?.scores === undefined,
      "score fields present",
    );
    const bogus = await req("GET", "/api/resubmit/not-a-real-token");
    check("a bogus resubmit token → 404", bogus.status === 404, `HTTP ${bogus.status}`);
  }

  // 5. Logout.
  console.log("session teardown");
  {
    const out = await req("POST", "/api/auth/logout", { token: inc.token });
    check("POST /api/auth/logout → 200", out.status === 200, `HTTP ${out.status}`);
    await req("POST", "/api/auth/logout", { token: vc.token });
    await req("POST", "/api/auth/logout", { token: analyst.token });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\nsmoke run threw: ${err?.stack || err}`);
  process.exit(1);
});
