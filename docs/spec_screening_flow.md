# Deck screening — the client's flow, transcribed

**Source:** "Deck Screening Logic: Status & Action Flow", v1.0, September 2026 — the §5 status/button
matrix and the §4 flow diagram, both supplied 2026-09-30. Transcribed here because the diagram is an
image and the sessions need its logic in text.

**Where the diagram and the table disagree, the diagram is clearer and is followed — every such
place is listed in §3 rather than silently resolved.**

---

## 1. The decision tree, as the diagram draws it

```
Deck uploaded  (stays on the uploaded screen)
│
├─ Deck complete? ── No ──┐
│                          ├─ Contact complete? ── No ──> BOTH INCOMPLETE
│                          │                              Edit, Archive active
│                          │                              Query + Assign disabled
│                          └─ Contact complete? ── Yes ─> INCOMPLETE DECK
│                                                         Send to Query active
│                                                         Assign, Archive disabled
│                                                         remark: "as incomplete"
└─ Deck complete? ── Yes ─┐
                           ├─ Contact complete? ── No ──> INCOMPLETE CONTACT
                           │                              Edit, Archive active
                           │                              Query + Assign disabled
                           │                              remark: "as incomplete contact details"
                           └─ Contact complete? ── Yes ─┐
                                                         ├─ Rating ≥ threshold? ─ No ─> BELOW THRESHOLD
                                                         │                              Reject active
                                                         │                                   │
                                                         │                                   v
                                                         │                              REJECTED
                                                         │                              Archive active
                                                         └─ Rating ≥ threshold? ─ Yes ─> COMPLETE
                                                                                        Send to Assign active
```

**The edit branch.** `Edit` on **Incomplete contact** or on **Both incomplete** leads to
`CONTACT DETAILS EDITED`, which is a system re-check with no buttons of its own, and re-runs the
same three questions in the same order:

```
CONTACT DETAILS EDITED
│
├─ Contact complete? ── No ──> EDITED, INCOMPLETE CONTACT     Archive only
└─ Contact complete? ── Yes ─┐
                              ├─ Deck complete? ── No ──> EDITED, INCOMPLETE DECK   Send to Query active
                              └─ Deck complete? ── Yes ─┐
                                                         ├─ Rating ≥ threshold? ─ No ─> EDITED, BELOW THRESHOLD
                                                         │                              Reject active -> Rejected
                                                         └─ Rating ≥ threshold? ─ Yes ─> EDITED, ALL COMPLETE
                                                                                        Send to Assign active
```

## 2. The eleven intermediate statuses collapse to three finals

The diagram's own grouping, which the §5 table does not draw:

| Intermediate statuses | Final status | Stat box |
|---|---|---|
| Incomplete deck · Edited, incomplete deck | **Incomplete, Queried** | Incomplete |
| Complete · Edited, all complete | **AI Evaluated, Assigned** | Assigned |
| Incomplete contact · Both incomplete · Edited, incomplete contact · Rejected | **Archived** | Archived |

Diagram footer, verbatim: *"All decks, including archived, stay on the uploaded status screen.
Intermediate status shows until a final action; Query / Assign copy deck + report to Dashboard."*

## 3. Where the diagram and the table disagree — read these before building

1. **Incomplete deck: is "Send to Query" active?** The diagram says **yes** ("Send to Query active").
   The table's *Active buttons* column says only "Edit" — but its own *Next step* column then says
   "Send to Query → Status 'sent to Query'", which the deck could not reach if the button were
   disabled. **Follow the diagram: Send to Query is active.** The table's Active column appears to
   be an omission, not a rule.

2. **Below threshold: is Archive active?** The table's *Disabled* column reads "All buttons except
   Archive", which implies Archive IS available — but its *Active* column lists only "Reject". The
   diagram lists only "Reject active". **Ship the diagram's reading (Reject only)** and ask: the
   difference matters because it decides whether a below-threshold deck can be archived without
   first being rejected.

3. **Incomplete deck: Archive is DISABLED**, in both the diagram and the table ("Assign, Archive
   disabled"). Worth flagging to the client rather than assuming a slip: it means a deck whose file
   could not be read cannot be set aside — the only way out is Send to Query. That is a deliberate-
   looking constraint but it is unusual, and §7 of his own spec ("queried but the founder never
   responds… archived with status 'no response'") implies those decks do eventually get archived by
   another route.

4. **"Copy" is not defined.** *"Send to Query and Send to Assign place a COPY of the deck and its
   evaluation report on the Dashboard; the ORIGINAL stays on the uploaded status screen."* Read
   against the diagram's footer and the stat-box column, this describes one deck appearing in two
   views, not a duplicated row — the uploaded screen is the register of everything, and the stat
   boxes count where it ended up. **Ship it as one row in two views.** A literal second row would
   double every count on the screen that is meant to give "an overall view of every deck".

## 4. What this does NOT say, and must be asked

- Nothing defines when the **rating threshold** check runs relative to AI evaluation, or what a deck
  that has not yet been evaluated shows. The tree begins at "Deck complete?" with no state for
  "still being evaluated", yet that state exists and is currently "Not AI Evaluated".
- **"Deck complete"** and **"contact complete"** are used as given. Today they are
  `decks.ai_complete` (the model's verdict) and `decks.missing_fields` (the intake list) — the pair
  that migration `0075` separated on 21-Sep. That mapping is almost certainly right and should be
  confirmed once rather than assumed per session.
- The §7 open item is the client's own: decks Queried whose founder never responds get archived with
  status **"no response"** — a twelfth status, and a time-based rule with no interval stated.
