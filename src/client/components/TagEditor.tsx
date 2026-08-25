import { useState } from "react";
import { X, Plus } from "lucide-react";

interface TagEditorProps {
  tags: string[];
  /** Omit to render read-only chips. */
  onChange?: (tags: string[]) => void | Promise<void>;
  /** Existing tags in the workspace, offered as datalist suggestions. */
  suggestions?: string[];
  busy?: boolean;
}

/**
 * Deck tag chips with add/remove (Aug-2026 issue 2 — "search & tag deck
 * facility"). Tags are normalised server-side (lowercased, de-duped, capped),
 * so this only has to keep the list tidy while the user types.
 */
export function TagEditor({ tags, onChange, suggestions = [], busy = false }: TagEditorProps) {
  const [draft, setDraft] = useState("");
  const readOnly = !onChange;

  function commit(next: string[]) {
    void onChange?.(next);
  }

  function add() {
    const tag = draft.trim().toLowerCase();
    if (!tag || tags.includes(tag)) {
      setDraft("");
      return;
    }
    commit([...tags, tag]);
    setDraft("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.length === 0 && readOnly && <span className="text-xs text-fg-muted">No tags</span>}
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg"
        >
          {tag}
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              disabled={busy}
              className="text-fg-muted hover:text-signal-flagged disabled:opacity-40"
              onClick={() => commit(tags.filter((t) => t !== tag))}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <span className="inline-flex items-center gap-1">
          <input
            className="sj-input h-7 w-28 py-0 text-xs"
            list="sj-tag-suggestions"
            placeholder="Add tag…"
            aria-label="Add tag"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <datalist id="sj-tag-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button
            type="button"
            aria-label="Add tag"
            disabled={busy || !draft.trim()}
            className="rounded-md border border-line p-1 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            onClick={add}
          >
            <Plus className="h-3 w-3" />
          </button>
        </span>
      )}
    </div>
  );
}
