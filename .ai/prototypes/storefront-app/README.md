# Storefront app interactive prototype

This directory contains a static, pre-implementation prototype derived from
`.ai/specs/2026-08-14-storefront-app.md` and its §16 story map.

**Scope note.** These screens use **storefront chrome, not the backend AppShell** — a deliberate exception to
`om-mockup-prototype`'s backend/backoffice scope, at the requester's explicit request, on the same terms the
previous revision recorded. It is kept deliberately small: desktop only, no account area, no checkout funnel,
no mobile sheet variants. Those belong to the `storefront-customer-account` and `checkout-simple-checkout`
specs and prototypes.

**Coverage.** Five pages in eight states — home, category listing, product detail, cart and a content page.

Screens 2–4 are the same listing under three different server answers, because §5.4a's rule is only visible in
the difference between them:

| Screen | Channel | Options offered | Note |
|---|---|---|---|
| 2 | B2C | six, from `availableSorts` | none |
| 3 | B2B, `price_sort_fallback: 'unavailable'` | four — the price options are absent, not disabled | none, deliberately |
| 4 | same, reached via a shared `?sort=price_asc` link | four | one line, from `X-Sort-Unavailable` |

The control always shows the server's `appliedSort`, never what the visitor last clicked. The admin side of
that policy — where `price_sort_fallback` is set, and what each value costs — is the `ecommerce-store-admin`
prototype, screens 12–13.

Screens 7 and 8 render both arms of `StorefrontPage.body` through `ContentPageBody`: `format: 'html'`
rendered as received without a second sanitizer, and `format: 'blocks'` delegated to the same `BlockRenderer`
merchandising placements use. The union's third, unrecognized-`format` arm is described in screen 7's notes
rather than drawn — it renders as the *absence* of a body, which a screenshot cannot distinguish from a
loading state.

**Illustrative, not implemented.** No response is fetched and no sort is performed; the three listing states
are three drawn answers, not one component reacting to data. The dashed outlines and block labels on screen 8
are prototype annotation, not chrome the real page renders.

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
