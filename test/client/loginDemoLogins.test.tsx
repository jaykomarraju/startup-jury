import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthContext } from "../../src/client/auth/AuthProvider";
import { LoginPage } from "../../src/client/routes/LoginPage";
// Vite's `?raw`, not `node:fs` — this project's tsconfig carries `vite/client`
// and no node types, so a filesystem read here fails `npm run typecheck` while
// passing under vitest, which is the worst of both.
import seedSql from "../../migrations/0002_seed.sql?raw";

/**
 * The sign-in page's "Demo logins" card, against the seed it claims to describe.
 *
 * This card is the ONLY set of credentials the product hands out. It listed six
 * of the twelve seeded accounts and omitted the incubator Admin and Program
 * Manager, and on 21-Sep-2026 the client filed "There should be 5 roles …
 * Prog. manager and Admin. are missing" — their sentence, verbatim, from a card
 * rendered BEFORE sign-in, which is why the row cites no screen. A tester who
 * has not been sent `docs/DEMO.md` cannot sign in as a role this card leaves
 * off, and reasonably concludes the role was never built. Both had been built
 * all along.
 *
 * It is also not dev-gated (`LoginPage.tsx` renders it unconditionally), so it
 * ships to production and is the first thing anyone evaluating the product
 * reads.
 *
 * The expectation is PARSED FROM THE SEED rather than written out here: a
 * literal list would be a second copy to drift, which is the defect itself.
 */

/** Every `('id', 'Name', 'email@…', …, 'role', 'edition', 'XX')` row. */
function seededAccounts(): { email: string; role: string; edition: string }[] {
  const rows = [...seedSql.matchAll(/\(\s*'[^']*',\s*'[^']*',\s*'([^']*@demo\.startupjury\.ai)'[^)]*\)/g)];
  return rows.map((m) => {
    const quoted = [...m[0].matchAll(/'([^']*)'/g)].map((q) => q[1]);
    // …, role, edition, initials) — counted from the end, so an added column
    // between the password and the role cannot silently shift this.
    return { email: m[1], role: quoted[quoted.length - 3], edition: quoted[quoted.length - 2] };
  });
}

function renderLogin() {
  return render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{ user: null, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
      >
        <LoginPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

/**
 * The emails the card actually DRAWS — not the constant behind it.
 *
 * Matched on the email element's OWN text, anchored. Scraping each button's
 * `textContent` instead runs the label and the email together, so
 * "Incubator · Superuser" + "priya.sharma@…" reads as
 * "Superuserpriya.sharma@…" and every comparison here fails on a card that is
 * perfectly correct.
 */
function offeredEmails(): string[] {
  return screen
    .getAllByText(/^[\w.]+@demo\.startupjury\.ai$/)
    .map((el) => el.textContent ?? "");
}

describe("the sign-in page's demo logins", () => {
  it("parses the seed it is checked against", () => {
    const seeded = seededAccounts();
    // Guard the parser itself: if the seed's shape changes, this test must fail
    // loudly rather than quietly comparing against an empty list — which would
    // make every assertion below vacuously true.
    expect(seeded.length).toBe(12);
    expect(seeded.filter((a) => a.edition === "incubator")).toHaveLength(6);
    expect(seeded.map((a) => a.email)).toContain("nisha.kapoor@demo.startupjury.ai");
  });

  it("offers EVERY seeded account, so no role can look unbuilt", () => {
    renderLogin();
    const offered = offeredEmails();
    for (const { email, role, edition } of seededAccounts()) {
      expect(offered, `${edition} ${role} (${email}) is seeded but not offered`).toContain(email);
    }
  });

  it("names the two roles the client reported as missing", () => {
    renderLogin();
    // The literal regression. These are the words on the card, and the roles
    // whose absence produced the 21-Sep row.
    expect(screen.getByText("Incubator · Admin")).toBeInTheDocument();
    expect(screen.getByText("Incubator · Program Manager")).toBeInTheDocument();
    expect(screen.getByText("nisha.kapoor@demo.startupjury.ai")).toBeInTheDocument();
    expect(screen.getByText("raj.kumar@demo.startupjury.ai")).toBeInTheDocument();
  });

  it("offers all five incubator STAFF roles — the client's own list of five", () => {
    renderLogin();
    const offered = new Set(offeredEmails());
    const staff = seededAccounts().filter((a) => a.edition === "incubator" && a.role !== "founder");
    expect(staff).toHaveLength(5);
    expect(staff.every((a) => offered.has(a.email))).toBe(true);
  });

  it("offers nothing that is not seeded, so a dead login cannot be advertised", () => {
    renderLogin();
    const seeded = new Set(seededAccounts().map((a) => a.email));
    for (const email of offeredEmails()) {
      expect(seeded, `${email} is offered but not seeded`).toContain(email);
    }
  });
});
