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

## What is a proposal, not a decision

Every screen's `.notes` block marks its own open questions. The ones that need an answer
before a spec can be written:

- Should a `cancelled` run's button say **Resume** rather than **Retry** (screen 9)?
- Should "Run again" appear on `failed` runs or only on `completed` ones (screen 3)?
- Should "Retry from the beginning" hide when no cursor was committed (screen 8)?
- Should the prefilled start form default "Run as full sync" on, or copy the source run's
  value (screen 12)?
- Does the row-action menu carry the "this feed is delta-only" footnote, or stay terse (screen 4)?

## Verified

Rendered at 1500×1000 in Chromium, light and dark, on 2026-09-16: no console errors, no
horizontal overflow in any shell, no dangling `data-goto`/hash targets, no missing icon
symbols, modal and popovers unclipped, and comment create → reload → re-anchor round-trips
through the per-prototype `localStorage` namespace.
