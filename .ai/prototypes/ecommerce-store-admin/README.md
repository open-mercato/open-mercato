# Ecommerce Store Admin interactive backend prototype

This directory contains a static, pre-implementation prototype derived from `.ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md`.

**Coverage.** 15 screens against §10's story map (epics A–F) and §11's admin surface: the store list in three
states (populated, filter with no results, team-member read-only), create with a duplicate-code field error,
the one-way archive confirm, General with the default-locale rule and its optimistic-lock conflict, Branding
with the unsaved live preview and the missing-`branding.manage` read-only variant, Domains with read-only
verification state plus the unverified-binding warning and the dangling-`DomainMapping` diagnostic, Channels
with the full assortment scope, `require_authentication` and the live product count, the empty-intersection
alert, the missing-default-binding notification, and SEO. Not drawn: the archive→list transition animation and
per-field validation combinatorics.

**Two things a reviewer should look at first.** Screen 12 carries `require_authentication` and the
exclude-categories / exclude-tags keys added to `assortment_scope` on 2026-09-06 — the previous prototype
predated both. Screen 5 refuses to invent an unarchive button: the missing return transition is a spec gap
flagged for review, not something the prototype papers over.

**Deliberate DS exception.** The branding preview on screens 8 and 9 renders raw OKLCH values inline, because
it is previewing a tenant's arbitrary brand colours — the values the form edits. Everything outside that
preview panel uses semantic tokens only.

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
