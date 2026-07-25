# Attachments Module — Agent Guidelines

The `attachments` module owns file uploads, storage drivers, partitions, OCR, and
the `attachments` table. Every attachment row carries a `tenant_id` /
`organization_id` scope pair that governs cross-tenant access.

## Scope & Access Policy

`attachments.tenant_id` and `attachments.organization_id` are **nullable** at the
DB level, but only two scope shapes are valid:

| Shape | `tenant_id` | `organization_id` | Meaning | Who can read it |
|-------|-------------|-------------------|---------|-----------------|
| **Scoped** | set | set | Belongs to one tenant + org | Same-scope principals + superadmin |
| **Global** | null | null | Legacy "global attachment" | Any authenticated principal (and unauthenticated only on a `is_public` partition) |
| **Partial-null** ❌ | set / null | null / set | **Invalid — never create** | Nobody (fail-closed) except superadmin |

The "both-or-neither" rule is the legitimate-unscoped use case referenced by
[#2109](https://github.com/open-mercato/open-mercato/issues/2109): a fully-global
(both-null) attachment is intentionally supported by `isSameScope`, so the columns
cannot simply be made `NOT NULL` without breaking that semantic or backfilling a
sentinel tenant onto legacy rows.

### Why partial-null is dangerous

`isSameScope` (`lib/access.ts`) deliberately **fails closed** on partial-null rows
(#2107): a row with one scope column set and the other null matches no principal's
auth and is unreadable by everyone except a superadmin. Such a row is therefore
*dead data* — it can only ever leak through a future code path that reads or
exports attachments **without** going through `checkAttachmentAccess` (a new export
endpoint, webhook delivery, OCR worker, or migration backfill). That is exactly the
fail-open class the access fix closed at read time; the creation guard closes it at
write time.

## Always

- **MUST call `assertAttachmentScopeInvariant({ tenantId, organizationId })` from
  `lib/access.ts` before persisting any new `Attachment` row.** It throws on a
  partial-null scope and accepts both fully-scoped and fully-global rows. The
  attachments upload route (`api/route.ts`) already guards its creation site.
- **MUST gate every attachment read through `checkAttachmentAccess`** (`lib/access.ts`)
  so tenant scoping and partition visibility are enforced consistently.
- When copying/cloning attachments across records, **carry the source row's scope
  pair as a unit** (both columns together) rather than overriding one column with a
  possibly-null value.

## Never

- **Never create a partial-null attachment** (one scope column set, the other null).
- **Never read or expose attachment rows without `checkAttachmentAccess`** — bypassing
  it reintroduces the cross-tenant fail-open class.

## Known cross-module creation paths

These paths create `Attachment` rows from other modules and must preserve the
both-or-neither invariant (audited for #2109):

- `packages/core/src/modules/attachments/api/route.ts` — primary upload; scope comes
  from authenticated request context (both set). **Guarded.**
- `packages/core/src/modules/sync_excel/lib/upload-storage.ts` — both scopes are
  required inputs (type-enforced). Safe.
- `packages/core/src/modules/catalog/seed/examples.ts` — both scopes required on
  `SeedScope`. Safe.
- `packages/core/src/modules/catalog/commands/variants.ts` — clones variant media to
  the product; inherits the source/variant scope pair (`?? null` only collapses to
  the global both-null shape).
- `packages/core/src/modules/messages/lib/attachments.ts`
  (`copyAttachmentsForForwardMessages`) — copies forwarded message attachments and
  accepts a nullable `targetOrganizationId` with a non-null `tenantId`. This is the
  one path that can construct a partial-null row; copy the **source attachment's**
  scope pair when wiring new callers, and apply the creation guard if this path is
  refactored.

## Validation Commands

```bash
yarn workspace @open-mercato/core test -- access
yarn workspace @open-mercato/core build
```
