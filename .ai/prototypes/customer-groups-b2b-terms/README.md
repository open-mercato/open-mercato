# Customer groups & B2B terms interactive prototype

This directory contains a static, pre-implementation prototype derived from
`.ai/specs/2026-08-14-customer-groups-and-b2b-terms.md` and its §17 story map (US-A1–US-F1, plus US-C3).

**Coverage.** Twenty-two backend screens: the groups list with the orphan-reference banner, its first-run
empty and no-access states, unique code/priority caught inline on create, hierarchy with cycle prevention
and the single-default rule, delete with dependants named rather than counted vaguely, the reconciliation
report and the adopt-orphans write (Epics A–B); membership with its current / upcoming / expired states and
the terms a buyer lands on after a removal; commercial terms empty and populated, the shared
category/tag/exclude picker, and the optimistic-lock conflict bar (Epic C); the group picker in a catalog
price row and the unknown-group error chip (Epic D); the credit account, its ledger and an exposure
adjustment presented as the append it is (Epic E); and purchase approvals including the second approver who
was one click late (Epic F).

**Per-customer assortment override (§5.7, §6.4, US-C3).** Screen 10 draws the "Assortment" section
`customer_groups` injects into the customer detail page, with both directions live at once — a grant that
widens and a restriction that narrows across every group grant. Screen 16's explain-terms panel names
`sourceCustomerOverrideId` beside `sourceGroupIds`, adds the customer's own branch to the union and shows
the narrowing applied to all three branches.

**Shared with the sibling prototype, deliberately.** The Assortment section markup is lifted verbatim from
`.ai/prototypes/buyer-scoped-catalog-visibility/`, which owns that spec and carries the section's empty,
replacement and read-only variants. It is one injected component, so it is drawn once and reused — the
variants are not redrawn here, and the two prototypes cannot drift.

**Reused from the previous revision.** The 2026-09-16 spec change was additive and states "no change to any
consumer", so the twenty-one screens covering US-A1–US-F1 were still accurate and are carried over verbatim
rather than redrawn; screen 10 is new, screen 9 gained an Assortment tab, screen 16 gained the override, and
everything from the old screen 10 onward shifted by one. Two defects inherited from that revision are fixed
here: four CSS classes it used but never defined — the optimistic-lock conflict bar and the no-access page
state both rendered as bare, unstyled divs — and six unreferenced sprite symbols.

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
