# Offline Field Mode interactive prototype (illustrative only)

This directory contains a static, pre-implementation prototype derived from `.ai/specs/2026-09-22-offline-field-mode.md`.

**Illustrative only — the visual design is not binding.** `/field/*` is a storefront buyer surface built on `@open-mercato/storefront-ui` (storefront-app spec §3.3a, §5.8), not a backoffice page. The prototype was generated with backoffice tooling and uses backoffice design tokens (`tokens.css`); read it for flow, states and copy intent only, never for the storefront's look.

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
