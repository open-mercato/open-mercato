# Customer Portal interactive prototype

This directory contains a static, pre-implementation prototype derived from
`.ai/specs/2026-08-14-storefront-customer-account.md` (rev 3) and the §15 story map added alongside it.

**Scope note.** All 25 screens are portal pages (`customer_accounts`/`portal`) — `om-mockup-prototype`'s own
boundary names "portal" as routed elsewhere, so this is a deliberate exception at the requester's explicit
request, on the same terms the previous revision recorded. Unlike the `storefront-app` and
`checkout-simple-checkout` prototypes, this one has higher DS fidelity: the portal is a first-class,
documented extension surface (`packages/ui/AGENTS.md` → Portal Extension), so every screen mirrors the real
`PortalShell` component (240px sidebar, "Portal"/"Account" nav groups, header, footer —
`packages/ui/src/portal/PortalShell.tsx`) and reuses the real backend `.dt`/table/form-layout classes
verbatim, since portal pages are built from the same `DataTable`/`CrudForm` components as the backoffice.

**Coverage.** Every account page from §6.1/§6.2 (10 shared + 6 B2B-only); every §7.1 difference class in one
worked reorder (R3); the §7.3 list-to-cart path in all three of its outcomes — clean conversion straight
through, preview-on-difference with a `resolutionToken`, and a stale token refused with a fresh preview;
`PRICE_MOVED` omitted rather than reported as "unchanged" in both of its cases (no snapshot, and a snapshot
taken under a different price kind); saved carts as parked baskets resumed once, resume delegating to
`cart.merge` with undo, and save-cart-as-list; and the module's load-bearing risk — the order visibility
policy (§4) — exercised through its default `own` scope, the `company_summary` header-only variant,
cross-company denial (R1/R6), and an approval decided twice (optimistic-lock conflict).

**Not drawn**, per §15: back-in-stock subscribe/confirm/unsubscribe (these live on the product page and in
email, not on an account surface) and the GDPR cascade (a `user-deleted-cascade.ts` subscriber with no screen).

## Personas

All data is fictitious. Four personas recur:

| Persona | Company | Scope and roles |
|---|---|---|
| Alex Morgan | — (B2C) | `own` |
| Dana Ruiz | Ironclad Supply Co. | `company`; `company_admin`, `purchase_approver` |
| Ravi Okonkwo | Ironclad Supply Co. | `company_summary` |
| Mira Halvorsen | Baltic Hardware AS | a different company entirely — used only for the denial screen |

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
- Illustrative, not implemented: every difference class, conflict and refusal is a drawn state, not a running
  resolver. The `resolutionToken` values, countdowns and totals are fixed text.
- Smooth-scroll click-through does not animate under browser automation; the handlers fire and the target
  screen is marked arrived. Presentation mode navigates correctly in all cases.
