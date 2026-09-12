# Promotions Module interactive backend prototype

This directory contains a static, pre-implementation prototype derived from `.ai/specs/SPEC-055-2026-02-23-promotions-module.md`.

## Review

Open `index.html` directly, or serve this directory on localhost when browser automation requires HTTP:

```bash
python3 -m http.server 8899 --bind 127.0.0.1
```

Keep the server attached to the current terminal session and stop it immediately after review.

The toolbar supports click-through, presentation, and comment modes. Comments are not live collaboration: they remain in this browser until a reviewer chooses **Export for repository**, replaces `comments.js`, and commits the result. The operation-log format preserves independent replies and deletion tombstones when reviewers merge exports.

## Coverage

19 screens, rebuilt against **SPEC-055 v2.1.0**. Screen ids `s1`–`s19` are stable from this point; comment anchors depend on them.

| Screens | Covers |
|---|---|
| 1–5 | Promotion list (empty / populated / delete), create form, exclusions |
| **6–9** | **Application target and quantity caps** — whole-line discount, "first 5 pieces only", the *Which pieces* selector open, and the write-path 422 rejections |
| 10–12 | Buy 2 Get 1 Free, tiered loyalty, free shipping — each stating its `applies_to` |
| 13–14 | Rule-type and benefit-type dropdowns, including an extension declaring `capsHonoured: false` |
| 15–19 | Sub-group delete, promotional codes (list, create, dynamic pool) |

Screens 7, 8, 9 and 14 are new in this rebuild; the rest were renumbered from the v2.0.x prototype. `tiered_discount`'s old `Scope: cart` control and `delivery_discount`'s `Scope: order` hint are gone — both are now the same **Applies to** control every benefit card carries.

## Deliberately not included

An *evaluation preview* ("test this promotion against a sample cart", showing `appliedQuantity` in action) would be the only place an operator sees what a cap actually does before publishing a campaign. It is **not** in SPEC-055, so it is not drawn here rather than having the prototype promise a feature the spec does not describe.

## Limitations

- The HTML illustrates flow and layout; it is not production implementation.
- Icons use an embedded SVG sprite instead of `lucide-react`.
- Text is hardcoded instead of translated through `useT()`.
- Sample records must remain synthetic and fictional.
- `tokens.css` is generated. Refresh it with the skill's `sync-tokens.mjs` script rather than editing it.
