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
const INC_ADMIN = "nisha.kapoor@demo.startupjury.ai";
const VC_MP = "aarav.khanna@demo.startupjury.ai";

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
  // Extract the session token from Set-Cookie, if present.
  let sessionToken = null;
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const m = c.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    if (m && m[1] && m[1] !== "") sessionToken = m[1];
  }
  return { status: res.status, json, text, token: sessionToken };
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
    check(
      "GET /api/decks → non-empty list",
      decks.status === 200 && Array.isArray(list) && list.length > 0,
      `HTTP ${decks.status}, len ${Array.isArray(list) ? list.length : "n/a"}`,
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

  // 4. VC edition reads.
  console.log("vc edition");
  const vc = await login(VC_MP);
  check(
    "login VC managing partner → edition vc",
    vc.user?.edition === "vc",
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
      "VC GET /api/decks → non-empty list",
      decks.status === 200 && Array.isArray(list) && list.length > 0,
      `HTTP ${decks.status}`,
    );
  }

  // 5. Logout.
  console.log("session teardown");
  {
    const out = await req("POST", "/api/auth/logout", { token: inc.token });
    check("POST /api/auth/logout → 200", out.status === 200, `HTTP ${out.status}`);
    await req("POST", "/api/auth/logout", { token: vc.token });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\nsmoke run threw: ${err?.stack || err}`);
  process.exit(1);
});
