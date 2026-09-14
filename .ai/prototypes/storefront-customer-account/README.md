# Customer Portal interactive prototype

This directory contains a static, pre-implementation prototype derived from `.ai/specs/2026-08-14-storefront-customer-account.md`.

**Scope note.** All 19 screens are portal pages (`customer_accounts`/`portal`) — `om-mockup-prototype`'s own boundary
names "portal" as routed elsewhere, so this is a deliberate exception at the requester's explicit request, on the same
terms as the `storefront-app` and `checkout-simple-checkout` prototypes. Unlike those two, this one has higher DS
fidelity: the portal is a first-class, documented extension surface (`packages/ui/AGENTS.md` → Portal Extension), so
every screen mirrors the real `PortalShell` component (240px sidebar, "Portal"/"Account" nav groups, header, footer —
`packages/ui/src/portal/PortalShell.tsx`) and reuses the real backend `.dt`/table/form-layout classes verbatim, since
portal pages are built from the same `DataTable`/`CrudForm` components as the backoffice. Targets full behavioral
coverage: every account page from §6.1/§6.2 (10 shared + 6 B2B-only), every reorder difference class in one worked
example (R3), and the module's single load-bearing risk — the order visibility policy (§4) — exercised through its
default `own` scope, the `company_summary` header-only variant, cross-company denial (R1/R6), and an approval decided
twice (optimistic-lock conflict). Not drawn: back-in-stock subscribe/unsubscribe (lives on the PDP and in email, not
an account page) and GDPR cascade deletion (a backend subscriber, no screen).

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
