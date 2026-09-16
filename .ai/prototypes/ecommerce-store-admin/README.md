# Ecommerce store admin interactive prototype

This directory contains a static, pre-implementation prototype derived from
`.ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md` (§10a user stories, §11 admin surface).

**Coverage.** Sixteen backend screens. The store list in its populated, no-results and view-without-manage
states; create with a duplicate code caught as a field error; the one-way archive confirm that says it is
one-way (Epic A). General with the default-locale rule and its optimistic-lock conflict bar (Epic B).
Branding with defaults visible, the live preview explicitly marked unsaved, and the read-only variant for an
admin missing `ecommerce.branding.manage` (Epic C). Domains with read-only verification state, the warning
that a store will not serve at an unverified host yet, the dangling `DomainMapping` diagnostic, and binding
a domain ahead of DNS with the consequence stated (Epic D). Channels with assortment scope and the live
product count, the empty-intersection alert for a real buyer group (R7), and the missing-default-binding
notification (Epic E). SEO, where empty means empty (Epic F).

**`price_sort_fallback` (§5.3, US-E3)** — screens 12 and 13. The control sits with the other per-channel
catalogue policies, and **both** of its values are drawn: `approximate` on screen 12, `unavailable` on
screen 13. The choice is between two ways of being wrong — a price ranking computed from prices the buyer
does not pay, or a feature removed — so each screen states its own cost at the point of choosing rather
than describing the setting neutrally. The 5 000-product cap is named on the form.

Its buyer-facing consequence — the storefront sort control losing the price option, and a shared
`?sort=price_asc` link landing on the catalogue in the default order with a note — belongs to the
`storefront-app` prototype and is not drawn here.

**Reused from the previous revision.** Fifteen screens are carried over verbatim; screen 12 gained the new
control, screen 13 is new, and the old screens 13–15 shifted by one. Two defects inherited with them are
fixed: `.conflict-bar`/`.msg` were used but never defined, so the optimistic-lock bar rendered as a bare
div, and `.tabs button svg` had no size rule, so every tab icon rendered at its viewBox scale.

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
