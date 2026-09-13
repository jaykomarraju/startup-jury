import { Link } from "react-router-dom";

/**
 * The credits bar (`.up-credits-bar`, `panel-upload.html:154-167`).
 *
 * Everyone who can open Upload sees the balance, the sub-line and the meter.
 * The two buttons are drawn only for a viewer who can FOLLOW them (F0226,
 * F1041, F1046): **Buy credits** needs the `billing` nav item (the `upgrade`
 * task) — the VC prototypes delete the button for partner / associate /
 * analyst / IC for exactly this reason — and **Balance** needs the Admin
 * console's Credits & billing section. A PM or PA therefore sees the numbers
 * and no control that would land on "Not available for your role".
 *
 * `/app/billing` IS the prototype's `openBuyCredits()`: the account overlay,
 * opened at the credit packs.
 */
export function CreditsBar({
  balance,
  subline,
  meterPct,
  canBuy,
  canSeeBalance,
}: {
  balance: number | null;
  subline: string | null;
  meterPct: number;
  canBuy: boolean;
  canSeeBalance: boolean;
}) {
  return (
    <div
      data-testid="up-credits-bar"
      className="mb-3.5 flex items-center gap-3 rounded-[10px] border-[1.5px] bg-offwhite px-3.5 py-3"
      style={{ borderColor: "rgba(186,119,23,.4)" }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-gold-lt" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--gold-dk)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-gold-dk" data-testid="up-credits-title">
          Credits balance — {balance === null ? "unavailable" : `${balance} remaining`}
        </div>
        {subline && <div className="mt-0.5 text-[11px] text-gold-dk">{subline}</div>}
        <div
          className="mt-[5px] h-[5px] w-[120px] overflow-hidden rounded-[3px] bg-stone"
          role="meter"
          aria-label="Credits remaining"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meterPct}
        >
          <div className="h-full rounded-[3px] bg-olive-dk" style={{ width: `${meterPct}%` }} />
        </div>
      </div>
      {(canSeeBalance || canBuy) && (
        <div className="ml-auto flex flex-col gap-[5px]">
          {canSeeBalance && (
            <Link to="/app/admin?section=bl" className={CR_BTN}>
              Balance
            </Link>
          )}
          {canBuy && (
            <Link to="/app/billing" className={CR_BTN}>
              Buy credits
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** `.up-cr-btn` */
const CR_BTN =
  "flex items-center justify-center gap-[5px] whitespace-nowrap rounded-[7px] border border-stone-dk bg-surface px-3 py-[5px] text-[11.5px] font-medium text-navy hover:bg-stone";
