import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CrmMethod } from "../../src/client/routes/upload/CrmMethod";

/**
 * Oct-3 issue 27 — Upload/Evaluate → "CRM option: when clicked, it should say
 * 'coming soon'".
 *
 * Clicking the option opens this panel (`#up-um-crm`, the wizard's third
 * method), so the panel is where the words have to be. Rendered directly rather
 * than through the wizard: the radio and the accordion belong to `Wizard.tsx`
 * and are not what changed, and `upload.test.tsx` already walks the click.
 *
 * The second half of each test is the one that matters — the notice must not
 * have been bought by withdrawing what DOES work. An administrator's four
 * provider tiles still link into the Admin console's CRM sync section, where a
 * connection is really recorded; `e2e/crm-sync.spec.ts` clicks Salesforce and
 * lands on that section, and it would be red if the notice had replaced them.
 */
describe("Upload → CRM (issue 27)", () => {
  const mount = (props: Partial<Parameters<typeof CrmMethod>[0]> = {}) =>
    render(
      <MemoryRouter>
        <CrmMethod canConfigure={false} planBelowPro={false} canBuy={false} {...props} />
      </MemoryRouter>,
    );

  it("says coming soon, and says what to use instead", () => {
    mount();
    const notice = screen.getByTestId("up-crm-soon");
    expect(notice).toHaveTextContent("Upload from CRM — coming soon");
    expect(notice).toHaveTextContent(/use Single or Bulk\s+upload meanwhile/);
  });

  it("an administrator still reaches the section where the connection is configured", () => {
    mount({ canConfigure: true });
    expect(screen.getByTestId("up-crm-soon")).toBeInTheDocument();

    const grid = screen.getByTestId("up-crm-grid");
    const links = within(grid).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Salesforce", "HubSpot", "Pipedrive", "Other API"]);
    expect(links[0]).toHaveAttribute("href", "/app/admin?section=crm");
  });

  it("a viewer who cannot configure gets the notice and no dead link", () => {
    mount({ canConfigure: false });
    expect(screen.getByTestId("up-crm-soon")).toBeInTheDocument();
    expect(within(screen.getByTestId("up-crm-grid")).queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("An administrator connects CRM sync in the Admin console.")).toBeInTheDocument();
  });
});
