# Storefront App interactive prototype

This directory contains a static, pre-implementation prototype derived from `.ai/specs/2026-08-14-storefront-app.md`.

**Scope note.** `om-mockup-prototype` is written for backend/backoffice flows and explicitly routes storefront,
portal, and public-frontend work elsewhere. This prototype exists anyway, at the requester's explicit request,
kept deliberately small: 4 desktop-only screens (home, category listing, PDP, cart), no account or checkout
funnel, no mobile breakpoint screens. It reuses this skill's click-through/comment tooling but a storefront
chrome (top nav) rather than the backend AppShell, per the spec's own §6 Design System table.

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
