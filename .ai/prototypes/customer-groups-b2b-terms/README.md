# Customer Groups B2b Terms interactive backend prototype

This directory contains a static, pre-implementation prototype derived from `.ai/specs/2026-08-14-customer-groups-and-b2b-terms.md`.

**Coverage.** 21 screens against §17's story map (epics A–F): the group list in three states (populated with
the orphan banner, first-run empty, no-access), create/edit with every constraint that is easy to violate
(unique `code` and `priority`, parent cycles, the depth cap, one default per tenant), the delete confirm with
its dependant counts, the orphan reconciliation report and its adopt confirm, membership management from the
customer detail page (current/upcoming/expired, duplicate-assignment error, removal with the resolved
after-state), commercial terms in three states (inheriting, set, optimistic-lock conflict), the explain-terms
panel, the group picker in both host forms including the unknown-group error chip, the credit account with its
append-only ledger and adjust dialog, and the approvals queue with the double-decision conflict. Not drawn:
field-validation combinatorics, and the import/rule membership sources (they write the same rows as `manual`).

**Two things a reviewer should look at first.** Screen 15's assortment-scope card is a union across groups with
every contributing group named — it is deliberately *not* a scalar row with one source, because visibility
grants add up rather than one group overriding another (§6.4). Screen 13's scope picker carries all five keys of
the shared `AssortmentScope`, matching the store channel binding rather than reimplementing it.

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
