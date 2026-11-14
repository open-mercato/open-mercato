# Sign In Activity interactive backend prototype

This directory contains a static, pre-implementation prototype derived from `.ai/specs/enterprise/2026-11-13-sign-in-activity.md`.

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

## Scope and verification (2026-11-13)

Screens: `s1` admin Sign-in activity list (live filters: user, result, date range, exact IP; no-results state; row click / Enter opens the detail drawer, Escape closes), `s2` static drawer review state, `s3` no-access state, `s4` own profile "Recent sign-ins" section (with/empty toggle), `s5` in-app new-device notification. Stories: US-A1, US-A2, US-U1, US-U2 from the spec.

Verification: passed. A headless Chromium walk exercised every filter, the empty state, drawer open/close by mouse and keyboard, the drawer "All sign-ins for this user" filter, the profile empty toggle and dark theme, with no console errors and no network requests beyond local files. The screenshots are in `.ai/specs/enterprise/assets/sign-in-activity/`.

This is a proposal only, not an accepted design. Device icons, copy and column order are illustrative.
