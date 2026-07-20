# The Complete State Matrix

A design that shows only the happy path is rejected. Every screen or flow accounts for every applicable row below; "not applicable" is a deliberate, stated decision, not an omission. In mockup documents, state intent lives in block props (e.g. an `/empty/i` prop) or the block `note` — that is what the mechanical empty-state check reads.

| State | The user must know / be able to | Common failure |
|---|---|---|
| Initial | What this screen is for and what to do first | A wall of controls with no starting point |
| Loading | That the system is working; cancel where >1s (`om-progress-over-1s`) | Frozen UI, double submits |
| Empty | Why it is empty and the next action to take (`om-empty-state-next-action`) | A blank region or a bare "No data" |
| No results | That the filter/search produced nothing, and how to relax it | Empty state and no-results state conflated |
| Partial | What loaded, what did not, and how to get the rest | Silent truncation |
| Validation error | Which field, what is wrong, how to fix it; typed data preserved | Error without how-to-fix; wiped input |
| System error | That it is not the user's fault; what to do next; data preserved | Blame-the-user copy, dead end |
| Offline | What still works, what is queued, what is lost | Indistinguishable from a system error |
| Permission denied | Why, and who/how to request access | Feature silently missing or a raw 403 |
| Success | That it worked, what changed, what happens next | Silent success; user re-submits |
| Destructive action | Consequences before; undo or recovery after (`om-destructive-confirm-undo`) | Confirm-dialog theater with no undo |

Recovery is part of the destructive row: an irreversible action is clearly marked as such *before* the act, and everything reversible offers Undo *after* it — prefer Undo over confirmation dialogs.
