import { useState } from "react";
import { Link } from "react-router-dom";
import { createTicket } from "../../api";
import { CRM_PROVIDERS } from "./Wizard";

/**
 * The third method, "Upload from CRM" (`#up-um-crm`, F0300 / F0301 / F0307 /
 * F0313) — a peer of Single and Bulk, with the four provider tiles and the Pro
 * lock bar.
 *
 * Nothing on it pretends: an administrator's tile opens the Admin console's CRM
 * sync section, where the connection is really configured (`W3-D`); for anyone
 * else the tiles are labels and the card says who connects them. The lock bar
 * shows only on a plan below Pro, and its "Upgrade to Pro →" is a link only for
 * a viewer who can buy. Email triage — added by Aug-2026 issue 13, which the
 * prototype predates — stays as the one intake that still raises a ticket.
 */
export function CrmMethod({
  canConfigure,
  planBelowPro,
  canBuy,
}: {
  canConfigure: boolean;
  planBelowPro: boolean;
  canBuy: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "failed">("idle");

  async function requestTriage() {
    setState("busy");
    try {
      await createTicket(
        "Customization request — Email triage inbox",
        "Forward founder emails to a dedicated address; attachments are triaged into the pipeline automatically.\n\nRaised from the Upload screen. Please scope this integration for our workspace.",
        false,
      );
      setState("sent");
    } catch {
      setState("failed");
    }
  }

  const tile =
    "flex items-center gap-[7px] rounded-[7px] border border-stone-dk bg-surface px-[11px] py-[9px] text-[12px] font-medium text-fg-2";
  return (
    <>
      <p className="mb-2.5 text-[12px] leading-[1.6] text-fg-2">
        Connect your CRM to pull deals automatically when they match your configured filter rules.
      </p>
      <div className="grid grid-cols-2 gap-[7px]" data-testid="up-crm-grid">
        {CRM_PROVIDERS.map((p) =>
          canConfigure ? (
            <Link key={p} to="/app/admin?section=crm" className={`${tile} hover:border-gold-dk hover:bg-offwhite hover:text-gold-dk`}>
              {p}
            </Link>
          ) : (
            <div key={p} className={tile}>
              {p}
            </div>
          ),
        )}
      </div>
      {!canConfigure && (
        <p className="mt-2 text-[11px] text-fg-muted">An administrator connects CRM sync in the Admin console.</p>
      )}
      {planBelowPro && (
        <div className="mt-2 flex items-center gap-[7px] rounded-[7px] border border-stone-dk bg-stone px-[11px] py-2 text-[11.5px] text-fg-2" data-testid="up-lock-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13" className="shrink-0 text-fg-muted" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          CRM sync is available on Pro plan.
          {canBuy && (
            <Link to="/app/billing" className="ml-1 font-medium text-gold-dk">
              Upgrade to Pro →
            </Link>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone pt-2.5">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-navy">Email triage inbox</div>
          <p className="text-[11px] text-fg-muted">
            Forward founder emails to a dedicated address; built per workspace on request.
          </p>
        </div>
        {state === "sent" ? (
          <span className="text-[11px] font-medium text-positive">Request raised — we&rsquo;ll be in touch</span>
        ) : (
          <button type="button" className="tbb" disabled={state === "busy"} onClick={requestTriage}>
            {state === "busy" ? "Raising…" : "Request this"}
          </button>
        )}
      </div>
      {state === "failed" && (
        <p className="mt-1 text-[11px] text-signal-flagged">
          Couldn&rsquo;t raise the request. Try again, or file it from Support → Tickets.
        </p>
      )}
    </>
  );
}
