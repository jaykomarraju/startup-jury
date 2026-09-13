import { useState } from "react";
import { updateDeckDetails } from "../../api";
import type { DeckView } from "../../types";
import { INTAKE_DETAIL_FIELDS, INTAKE_FIELD_LABELS } from "../../../shared/intake";

/**
 * Aug-2026 issue 12 — what the AI recognised on an uploaded deck, every field
 * correctable. The issue asks for the override panel the prototype's read-only
 * results table does not have, so it lives in the review pane beside the deck
 * rather than as an eighth column on a table whose header set is the contract.
 * Saving writes straight to the deck and the server re-derives Incomplete.
 */
export function DeckDetails({
  deck,
  onSaved,
}: {
  deck: DeckView;
  onSaved: (deck: DeckView) => void;
}) {
  const initial = {
    name: deck.name ?? "",
    stage: deck.stage ?? "",
    founder: deck.founder ?? "",
    founderEmail: deck.founderEmail ?? "",
    founderPhone: deck.founderPhone ?? "",
    city: deck.city ?? "",
    sector: deck.sector ?? "",
  };
  const [values, setValues] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const missing = new Set<string>(deck.statusId && deck.statusId !== "pending_ai" ? (deck.missingFields ?? []) : []);

  const fields: { key: keyof typeof values; label: string }[] = [
    { key: "name", label: "Startup name" },
    { key: "stage", label: "Stage" },
    ...INTAKE_DETAIL_FIELDS.map((f) => ({ key: f, label: INTAKE_FIELD_LABELS[f] })),
  ];

  async function save() {
    setState("saving");
    try {
      const res = await updateDeckDetails(deck.id, values);
      setState("saved");
      if (res.deck) onSaved(res.deck);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="mb-2.5 rounded-[9px] border border-stone-dk bg-surface" data-testid="up-deck-details">
      <div className="border-b border-stone px-4 py-2.5">
        <div className="text-[12.5px] font-semibold text-navy">AI-extracted details</div>
        <div className="text-[10.5px] text-fg-muted">
          Correct anything the AI got wrong — your edit wins and is saved to the deck.
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 p-3.5">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-fg-2">
              {f.label}
              {missing.has(f.key) && !values[f.key] && (
                <span className="ml-1 text-signal-flagged">· not captured</span>
              )}
            </span>
            <input
              className="sj-input h-8"
              value={values[f.key]}
              placeholder="Not captured"
              onChange={(e) => {
                setValues((v) => ({ ...v, [f.key]: e.target.value }));
                setState("idle");
              }}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-stone px-4 py-2">
        <span className="text-[11px] text-fg-muted">
          {state === "saved"
            ? "Corrections saved to the deck."
            : state === "failed"
              ? "Couldn't save the corrections. Try again."
              : "Overriding a value replaces what the AI recognised."}
        </span>
        <button type="button" className="tbb" disabled={state === "saving"} onClick={save}>
          {state === "saving" ? "Saving…" : "Save corrections"}
        </button>
      </div>
    </div>
  );
}
