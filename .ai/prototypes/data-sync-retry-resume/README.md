# Data Sync Retry Resume interactive backend prototype

This directory contains a static, pre-implementation prototype derived from `.ai/prototypes/data-sync-retry-resume/REQUIREMENTS.md`.

## Review

Open `index.html` directly, or serve this directory on localhost when browser automation requires HTTP:

```bash
python3 -m http.server 8899 --bind 127.0.0.1
```

Keep the server attached to the current terminal session and stop it immediately after review.

The toolbar supports click-through, presentation, and comment modes. Comments are not live collaboration: they remain in this browser until a reviewer chooses **Export for repository**, replaces `comments.js`, and commits the result. The operation-log format preserves independent replies and deletion tombstones when reviewers merge exports.

## Limitations

- The HTML illustrates flow and layout; it is not production implementation.
- Icons use an embedded SVG sprite instead of `lucide-react`.
- Text is hardcoded instead of translated through `useT()`.
- Sample records must remain synthetic and fictional.
- `tokens.css` is generated. Refresh it with the skill's `sync-tokens.mjs` script rather than editing it.

## Screens

| # | Screen | What it decides |
|---|---|---|
| 1 | Action model by run state | The whole design in one table — read first |
| 2 | Runs list, all states | Confirms the list table itself is unchanged |
| 3 | Row menu — failed, replay available | The three-item menu and the resume-point sub-label |
| 4 | Row menu — failed, replay forbidden | What disappears when the adapter forbids full sync |
| 5 | Row menu — completed and running | Why `completed` gets "Run again" and not Retry |
| 6 | Confirm — "Retry from the beginning" | The only from-scratch path in the UI |
| 7 | Run detail — failed, resume point known | The helper line that fixes the original confusion |
| 8 | Run detail — failed before batch 1 | Copy when there is no cursor to resume from |
| 9 | Run detail — cancelled | Whether "Retry" is the right word for a deliberate stop |
| 10 | Run detail — running | What occupies the action area when no retry exists |
| 11 | Run detail — completed | One action, no overflow |
| 12 | Start form prefilled by "Run again" | The three additions that need no new endpoint |
| 13 | When a retry is refused | 422 `parametersStale`, 409 overlap, and the new 422 |

## Decisions taken — and where they live now

**The specification is the authority, not this prototype.** Where the two ever disagree, the spec wins:
[`.ai/specs/2026-09-16-data-sync-retry-resume-actions.md`](../../specs/2026-09-16-data-sync-retry-resume-actions.md).

These screens were reviewed, and seven of the choices they originally drew were reversed. The screens
have been redrawn; each redrawn screen's `.notes` block records what changed and why.

| # | Decision | Screens redrawn |
|---|---|---|
| D0 | Neither `run` nor `retry` enforces `supportsStartControl('fullSync', …)` — the declaration governs what the dashboard **offers**, never what the API **accepts** | 1, 4, 13 |
| D1 | A `cancelled` run's primary action reads **Resume**, not Retry | 1, 9 |
| D2 | "Run again" is offered on `completed` runs only | 1, 3, 4, 6, 7 |
| ~~D3~~ | ~~"Retry from the beginning" is hidden when no batch was committed~~ — **withdrawn after specification review.** The two requests are not identical: the endpoint falls back to the shared cursor, so hiding the from-scratch action removed the only control that guarantees a replay, exactly where it was needed | 1, 8 |
| D4 | The prefilled start form seeds only what `sync_runs` actually stores — integration, entity type, direction, parameters. **Restated after review:** there is no `full_sync` or `batch_size` column, so an earlier "copies it faithfully" was not buildable | 12 |
| D5 | The row-action menu carries no delta-only footnote; the detail page states it | 4 |
| D6 | The runs list gains no "resumed from" column | 2 |
| D7 | Nothing renders in the resume-point slot for a non-retryable state | 10 |

**D0 is the one worth reading twice.** An earlier draft of this work called the missing
`supportsStartControl` check on the retry endpoint a "server-side hole", and screens 4 and 13 said so.
It is not a hole — `BACKWARD_COMPATIBILITY.md` § Data Sync Start Control Applicability commits in
writing that the separation "MUST hold for any future change here". The claim is withdrawn and those
screens are corrected.

## Corrected after specification review

A fresh-context specification review of the spec found three blockers and eight majors, and four of
this prototype's screens were redrawn a second time as a result. The corrections are recorded in each
screen's notes and in the spec's Changelog; the substantive ones:

- **Screen 8's copy was false.** "Retry starts from the beginning" is not what happens when a run
  committed no batch — the endpoint falls back to the shared cursor. The copy is now non-committal and
  D3 is withdrawn.
- **Screens 1, 3, 4, 7 and 9 dropped the "of ~118" denominator.** It is not derivable: `totalCount`
  estimates source records, not batches.
- **Screens 3 and 4's two-line menu items collapsed into one label.** `RowActionItem.label` is a
  `string` with no sub-label slot — the same constraint the spec had already found in `ConfirmDialog`.
- **Screen 12's prefill no longer claims to copy `fullSync`.** No such column exists.

## Still open

Nothing in the flow itself. Three things the spec records as known gaps rather than decisions:

- There is no `retried_from_run_id` column, so no screen can show a retry chain as one logical sync.
- There is no additive `retryStartCursor` response field, which is why screen 8 can only be
  non-committal about where a retry will resume.
- `paused` is in the status union but nothing in the engine ever writes it. Flagged for its own issue.

## Verified

Rendered at 1500×1000 in Chromium, light and dark, on 2026-09-16: no console errors, no
horizontal overflow in any shell, no dangling `data-goto`/hash targets, no missing icon
symbols, modal and popovers unclipped, and comment create → reload → re-anchor round-trips
through the per-prototype `localStorage` namespace.
