# Checkout Funnel interactive prototype

This directory contains a static, pre-implementation prototype derived from `.ai/specs/2026-03-19-checkout-simple-checkout.md`.

**Scope note.** Screens 1–16 are the buyer-facing funnel (`apps/storefront`'s `checkout/` route) — the same
deliberate `om-mockup-prototype` scope exception as the `storefront-app` prototype, storefront top-nav chrome
rather than the backend AppShell. Screens 17–18 are the module's one genuine backend surface (`checkout.sessions.view`/
`.manage`, spec §9) and use the real AppShell — no exception needed there. This set targets full behavioral coverage:
every funnel step, both submit outcomes (order/quote), every named submit failure and compensation trigger with
buyer-visible behavior (R1–R10), the B2B approval gate plus its re-approval edge case (R8), the cart-lock conflict a
second tab sees, and the admin session/event-trail viewer. Not drawn: literal field-validation combinatorics, and the
already-shipped Phase A pay-link entry mode (noted in-line instead).

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
