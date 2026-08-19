# Manufacturing Bom Drafts interactive backend prototype

This directory contains a static, pre-implementation prototype derived from:

- `.ai\specs\2026-08-19-manufacturing-bom-drafts.md` (P1.4a direct draft authoring);
- `.ai\specs\2026-08-19-manufacturing-bom-draft-preview.md` (P1.4b bounded multi-level preview).

It covers the review story map `US-BOM-01` through `US-BOM-10`: list and
empty states, first draft creation, direct component occurrences, add/edit
dialog behavior, unresolved `produce` and cycle feedback, the bounded tree,
stale/limit states, read-only access, and an aggregate-version conflict.

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
- Buttons move through review screens; they do not call APIs or persist domain data.
- The preview's quantities, limits, conflict and cycle messages are illustrative proposals, not a running implementation.
