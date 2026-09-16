# Buyer-scoped catalog visibility interactive prototype

This directory contains a static, pre-implementation prototype derived from
`.ai/specs/2026-08-21-buyer-scoped-catalog-visibility.md` and its User Stories section (US-A1–US-F1).

**Coverage.** Twenty backend screens. Group-level assortment scope in its editable, read-only and
validation-error states (US-A1, US-A2); channel-level scope and the `require_authentication` gate,
including the "0 products visible to anonymous visitors" preview (US-B1, US-B2); the diagnose panel
in its verdict, no-match and not-found states (US-C1), with the union-across-groups / AND-within-one-scope
trace that is §3.1's own worked example.

**Per-customer overrides (§3.6, §4.4, US-A4)** — screens 9–13 and 15, the material added to the spec on
2026-09-16. The "Assortment" section `customer_groups` injects into the customer detail page is drawn in
both directions and in every state the story names: the empty state stating the assortment comes entirely
from the buyer's groups, "Also allow" (`grant_scope`) widening, "Restrict to / exclude" (`restrict_scope`)
narrowing across *every* group grant, both blocks set to the same scope producing replacement semantics
with no `mode` switch, and the read-only variant. Screen 15 is the diagnose trace naming
`sourceCustomerOverrideId` beside `sourceGroupIds`, split by direction, with the channel scope shown last
because that is the order the layers apply (R8).

**Illustrative, not backend surfaces.** Screens 18–20 — the storefront 404, the cart add-rejection and the
flagged line blocking the checkout lock — are buyer-facing consequences this spec specifies but whose UI
sibling specs own. They are drawn schematically, without backend chrome, and each says so in its notes.

**Reused from the previous revision.** The 2026-09-16 spec change was purely additive: §3.6/§3.7/§4.4 and
US-A4 were added, and the changelog states explicitly that the read seam (§3.5), the cart write-side check
(§6) and the digest (§6.1) are unchanged. The fourteen screens covering US-A1–US-F1 were therefore still
accurate and are carried over verbatim rather than redrawn; screens 9–13 and 15 are new, and screen 14's
numbering shifted from 9. Two defects inherited from that revision are fixed here: an unsized tab icon on
the Channels tab, and seven sprite symbols the prototype never referenced.

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
