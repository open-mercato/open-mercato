# Deals Close Timeline interactive backend prototype

This directory contains a static, pre-implementation prototype derived from `.ai/prototypes/deals-close-timeline/REQUIREMENTS.md`.

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
- `timeline.css` holds the proposed timeline composition: a lanes × time-bucket grid (weeks, months or quarters) holding compact Kanban-style deal cards. It has no `@open-mercato/ui` equivalent yet.
- `timeline.js` makes drag-to-reschedule live on screen 1 only. You can drag a card into another week, press Esc mid-drag to cancel, use Undo in the "Last operation" banner, click a card (or focus it and press Enter) to open the deal drawer, or move between cards with the Arrow keys. Screen 17 shows the drawer as a static state. Nothing is persisted. All other screens are static states.
- Screens follow `.ai/specs/2026-10-26-deals-close-date-timeline.md`, which wins where they differ. A few spec states are not drawn: the truncation alert with partial counts, the "Show deal" flash, muted won/lost cards under All deals, the view-only drawer, and the drawer for a won or lost deal (Schedule follow-up only).
