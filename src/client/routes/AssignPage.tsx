import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, UserPlus, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, Button, Badge, ScoreChip, SignalTag, EmptyState } from "../components";
import type { DeckView } from "../types";
import {
  listDecks,
  listEvaluators,
  assignDeck,
  type EvaluatorGroup,
} from "../api";

/**
 * Assign screen (Evaluation → Assign).
 *
 * Aug-2026 issue 22 — four panels: (1) the evaluated decks to allocate,
 * (2) the role to assign them to, (3) the members of that role, (4) the
 * resulting allocation with the confirm action.
 *
 * Picking several members spreads the selected decks across them round-robin —
 * panel 4 shows exactly which deck lands with whom BEFORE anything is written,
 * because a deck carries one assignee.
 */
export function AssignPage() {
  const [decks, setDecks] = useState<DeckView[] | null>(null);
  const [groups, setGroups] = useState<EvaluatorGroup[]>([]);
  const [deckIds, setDeckIds] = useState<string[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ deck: string; member: string; role: string }[] | null>(null);

  const load = useCallback(() => {
    return listDecks()
      .then((r) => setDecks(r.decks))
      .catch(() => setDecks([]));
  }, []);

  useEffect(() => {
    load();
    listEvaluators()
      .then((r) => setGroups(r.groups.filter((g) => g.members.length > 0)))
      .catch(() => setGroups([]));
  }, [load]);

  const rows = useMemo(
    () => (decks ?? []).filter((d) => d.statusId === "ai_evaluated" || d.statusId === "assigned"),
    [decks],
  );

  // Panel 1's companion view: decks the AI could not score for lack of detail.
  const incomplete = useMemo(
    () => (decks ?? []).filter((d) => d.statusId === "incomplete"),
    [decks],
  );

  const activeGroup = groups.find((g) => g.role === role) ?? null;
  const members = activeGroup?.members ?? [];
  const selectedMembers = useMemo(
    () => members.filter((m) => memberIds.includes(m.id)),
    [members, memberIds],
  );
  const selectedDecks = useMemo(
    () => rows.filter((d) => deckIds.includes(d.id)),
    [rows, deckIds],
  );

  /** Round-robin allocation, computed for panel 4 before anything is written. */
  const allocation = useMemo(() => {
    if (selectedDecks.length === 0 || selectedMembers.length === 0) return [];
    return selectedDecks.map((deck, i) => ({
      deck,
      member: selectedMembers[i % selectedMembers.length],
    }));
  }, [selectedDecks, selectedMembers]);

  function toggleDeck(id: string) {
    setDone(null);
    setDeckIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function toggleAllDecks() {
    setDone(null);
    setDeckIds((ids) => (ids.length === rows.length ? [] : rows.map((d) => d.id)));
  }

  function pickRole(next: string) {
    setDone(null);
    setRole(next);
    setMemberIds([]);
  }

  function toggleMember(id: string) {
    setDone(null);
    setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function confirm() {
    if (allocation.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const written: { deck: string; member: string; role: string }[] = [];
      for (const { deck, member } of allocation) {
        await assignDeck(deck.id, member.id);
        written.push({
          deck: deck.name,
          member: member.name,
          role: activeGroup?.roleLabel ?? member.role,
        });
      }
      setDone(written);
      setDeckIds([]);
      setMemberIds([]);
      await load();
    } catch {
      setError("Assignment failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Assign</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            Select evaluated decks · choose a role · pick one or more members · confirm.
          </p>
        </div>
        {incomplete.length > 0 && (
          <Link to="/app/query">
            <Button size="sm" variant="secondary">
              <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
              Incomplete {incomplete.length}
            </Button>
          </Link>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
          {error}
        </div>
      )}

      {done && (
        <div className="rounded-lg border border-positive/40 bg-positive/10 px-4 py-3">
          <div className="text-sm font-medium text-fg">
            Assignment confirmed · {done.length} deck{done.length === 1 ? "" : "s"} dispatched
          </div>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-fg-muted">
            {done.map((d) => (
              <li key={`${d.deck}-${d.member}`}>
                {d.deck} → {d.member} ({d.role})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Issue 22 — four panels. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr_1fr_1.2fr]">
        {/* PANEL 1 — evaluated decks */}
        <Card flush className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="u-label">Evaluated decks</span>
            <button
              type="button"
              className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
              onClick={toggleAllDecks}
              disabled={rows.length === 0}
            >
              {deckIds.length === rows.length && rows.length > 0 ? "Clear all" : "Select all"}
            </button>
          </div>
          {decks !== null && rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="UserPlus"
                title="Nothing to assign"
                description="Decks that pass the AI gate appear here."
              />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((deck) => (
                <li key={deck.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-2.5 border-b border-line px-4 py-2.5 transition-colors hover:bg-surface-2 ${
                      deckIds.includes(deck.id) ? "bg-accent/5" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={`Select ${deck.name}`}
                      checked={deckIds.includes(deck.id)}
                      onChange={() => toggleDeck(deck.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{deck.name}</span>
                      <span className="block truncate text-xs text-fg-muted">
                        {[deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ")}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <ScoreChip value={deck.aiScore} />
                        {deck.signal && <SignalTag signal={deck.signal} />}
                        {deck.statusId === "assigned" && deck.assignedToName && (
                          <Badge tone="positive">{deck.assignedToName}</Badge>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line px-4 py-2 text-xs text-fg-muted">
            {deckIds.length} selected
          </div>
        </Card>

        {/* PANEL 2 — role */}
        <Card flush className="flex min-h-0 flex-col overflow-hidden">
          <div className="u-label border-b border-line px-4 py-3">Role</div>
          {groups.length === 0 ? (
            <p className="p-4 text-sm text-fg-muted">No evaluator roles are staffed yet.</p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {groups.map((g) => (
                <li key={g.role}>
                  <button
                    type="button"
                    onClick={() => pickRole(g.role)}
                    className={`flex w-full items-center justify-between gap-2 border-b border-line px-4 py-3 text-left text-sm transition-colors hover:bg-surface-2 ${
                      role === g.role ? "bg-accent/5 font-medium text-fg" : "text-fg-muted"
                    }`}
                  >
                    <span className="truncate">{g.roleLabel}</span>
                    <Badge tone="neutral">{g.members.length}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* PANEL 3 — members of that role */}
        <Card flush className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="u-label">{activeGroup ? activeGroup.roleLabel : "Users"}</div>
            <p className="text-xs text-fg-muted">
              {activeGroup ? "Tick one or more members" : "Choose a role to see its members"}
            </p>
          </div>
          {!activeGroup ? (
            <div className="p-4">
              <EmptyState icon="Users" title="No role selected" description="Pick a role in the previous panel." />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {members.map((m) => (
                <li key={m.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-2.5 border-b border-line px-4 py-2.5 transition-colors hover:bg-surface-2 ${
                      memberIds.includes(m.id) ? "bg-accent/5" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${m.name}`}
                      checked={memberIds.includes(m.id)}
                      onChange={() => toggleMember(m.id)}
                    />
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg">
                      {m.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{m.name}</span>
                      <span className="block truncate text-xs text-fg-muted">
                        {m.title ?? activeGroup.roleLabel} · {m.openDecks} open
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* PANEL 4 — allocation summary + confirm */}
        <Card flush className="flex min-h-0 flex-col overflow-hidden">
          <div className="u-label border-b border-line px-4 py-3">Assignment summary</div>
          {allocation.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="UserPlus"
                title="Nothing to confirm yet"
                description="Select decks, choose a role, and tick one or more members — the allocation appears here before you confirm."
              />
            </div>
          ) : (
            <>
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {allocation.map(({ deck, member }) => (
                  <li
                    key={deck.id}
                    className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-fg">{deck.name}</span>
                      <span className="block truncate text-xs text-fg-muted">
                        {member.name} · {member.title ?? activeGroup?.roleLabel}
                      </span>
                    </span>
                    <UserPlus className="h-4 w-4 shrink-0 text-fg-muted" />
                  </li>
                ))}
              </ul>
              <div className="border-t border-line px-4 py-3">
                <p className="text-xs text-fg-muted">
                  {allocation.length} deck{allocation.length === 1 ? "" : "s"} across{" "}
                  {selectedMembers.length} member{selectedMembers.length === 1 ? "" : "s"}
                  {selectedMembers.length > 1 ? " (spread evenly)" : ""}.
                </p>
                <Button className="mt-2 w-full" disabled={busy} onClick={confirm}>
                  <Check className="mr-1.5 h-4 w-4" />
                  {busy ? "Assigning…" : "Confirm assignment"}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
