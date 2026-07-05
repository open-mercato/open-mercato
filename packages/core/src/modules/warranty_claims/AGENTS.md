# Warranty Claims Module — Agent Guidelines

`warranty_claims` is the B2B warranty, RMA, core-return, and vendor-recovery claims desk. It owns the claim aggregate, line-level partials, customer-visible timeline, staff notifications, portal intake, SLA settings, risk signals, and sales-order tab injection while coupling to other modules only through IDs, snapshots, events, QueryEngine lookups, and widgets.

## Always

1. MUST keep claim lifecycle transitions in `lib/stateMachine.ts` and `data/constants.ts`; the status enum is FROZEN and lifecycle moves MUST go through `warranty_claims.claim.transition`, never generic `PUT`.
2. MUST preserve legal transitions: `closed -> in_review` is the reopen path, `cancelled` is terminal, and direct status writes through CRUD update are forbidden.
3. MUST treat claim lines as first-class partials with dispositions; line create/update/delete MUST recompute header money rollups inside the same atomic flush.
4. MUST keep SLA behavior settings-driven from `lib/settings.ts` and `/api/warranty_claims/settings-general`: due dates come from settings/defaults, `info_requested` pauses when configured, and resume shifts the due date instead of shortening the SLA window.
5. MUST keep auto-adjudication default OFF, risk-gated by `lib/risk.ts`, executed only inside the submit command path, and limited to auto-approval; never auto-deny.
6. MUST keep risk signals deterministic, tenant/org scoped, and based on code constants in `lib/risk.ts`; do not make thresholds tenant data without a spec.
7. MUST preserve the event split: `warranty_claims.claim.status_changed` is the staff/client broadcast and MUST NOT pin `recipientUserIds`; `warranty_claims.claim.portal_status_changed` is the portal broadcast and MUST pin customer-user recipient ids, skipping emit when there are no recipients.
8. MUST use FK-id plus snapshot coupling for sales, customers, catalog, and auth data; use QueryEngine or scoped decrypted lookups wrapped in `try/catch` for optional peer lookups.
9. MUST carry `tenantId` and `organizationId` in every ORM `where` clause. The scope argument to `findOneWithDecryption` / `findWithDecryption` is decryption scope only and does not add SQL filters.
10. MUST pin portal reads and writes to the server-resolved customer id; portal mutation guards use the customer-user id with an empty feature list.
11. MUST keep optimistic locking on by default for CRUD and settings; action endpoints use `enforceCommandOptimisticLock`, and UI line mutations send each line's own `updatedAt` header.
12. MUST keep free-text/correspondence fields in `encryption.ts` encrypted and excluded from search sources in `search.ts`.

## Ask First

- Ask before adding, renaming, or removing claim statuses, line statuses, dispositions, event ids, notification ids, API paths, widget spot ids, ACL ids, DI keys, or search entity ids.
- Ask before changing lifecycle semantics, reopen behavior, cancellation rules, SLA pause/resume math, risk thresholds, auto-adjudication policy, or vendor-recovery reconciliation.
- Ask before importing another module's ORM entity, writing to sales/customers/auth aggregates, or replacing FK-id plus snapshot coupling with direct relations.
- Ask before changing portal ownership rules, customer-user recipient selection, attachment ownership, or customer-visible timeline visibility.

## Never

- Never change `claimType` or `status` through generic CRUD update.
- Never import sales, customers, catalog, or auth ORM entities into this module.
- Never emit a portal-broadcast event without pinned customer-user recipients.
- Never rely on `findOneWithDecryption` scope to tenant-filter data; missing tenant/org in `where` is a data isolation bug.
- Never bypass mutation guards, command optimistic locks, encrypted field helpers, or atomic flush for claim/line writes.
- Never put encrypted text fields such as notes, resolution summary, fault description, inspection notes, or event body into search source text.
- Never edit `i18n/*.json` in packet work; record new keys and English fallbacks in the packet notes file.

## Validation Commands

```bash
cd packages/core
npx jest src/modules/warranty_claims/__tests__
cd ../..
yarn generate
yarn i18n:check-sync
```

Integration coverage lives under `packages/core/src/modules/warranty_claims/__integration__/TC-WC-*.spec.ts`; run the relevant `TC-WC-*` scenario when changing API or portal behavior.
