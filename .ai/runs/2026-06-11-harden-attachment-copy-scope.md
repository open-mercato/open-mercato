# Execution plan — harden attachment copy scope (follow-up to PR #2879 / #2109)

## Goal

Eliminate the partial-null `(tenant_id, organization_id)` attachment-row construction paths
flagged in PR #2879 by deriving each copied/cloned attachment's scope pair **as a unit** from
its source row, so a row with exactly one scope column set can no longer be created.

## Context

PR #2879 (#2109) added a read-time fail-closed guard (`isSameScope`) and a creation guard
(`assertAttachmentScopeInvariant`) at the upload site, but explicitly left the cross-module
copy paths unhardened. Its audit named `messages/lib/attachments.ts`
(`copyAttachmentsForForwardMessages`) as the one path that can currently construct a
partial-null row, because it applies a caller-supplied nullable `targetOrganizationId`
alongside a non-null `tenantId` to every copy.

A second independent-coalescing path exists at `catalog/commands/variants.ts`
(`aggregateVariantMediaToProduct`), which sets
`organizationId: source.organizationId ?? variant.organizationId ?? null` and
`tenantId: source.tenantId ?? variant.tenantId ?? null` independently — these `??` chains
can resolve to one-null/one-set.

`sync_excel/lib/upload-storage.ts` and `sync-akeneo` pass a single scope object's
`organizationId`/`tenantId` through atomically (both-or-neither preserved by the caller), so
they are not partial-null construction sites and are left unchanged.

The PR #2879 creation guard lives on its (still-open) branch, so this follow-up must be
self-contained: it hardens structurally (derive the scope pair as a unit) rather than depend
on an unmerged import. A new `attachments/lib/scope.ts` file avoids merge conflicts with
#2879's edits to `attachments/lib/access.ts`.

## Scope

- New shared helper: `packages/core/src/modules/attachments/lib/scope.ts` —
  `resolveAttachmentScopePair(...candidates)` returns the first candidate that forms a valid
  both-or-neither pair (blank/whitespace normalized to null), else `null`.
- `messages/lib/attachments.ts` — `copyAttachmentsForForwardMessages` (and the
  `copyAttachmentsForForward` wrapper) derive each copy's scope from the **source attachment's
  own pair**; partial-null source rows (legacy dead data) are skipped, not propagated. Drop the
  now-meaningless `targetOrganizationId` parameter.
- `messages/commands/messages.ts` — update the single caller to the new signature.
- `catalog/commands/variants.ts` — `aggregateVariantMediaToProduct` resolves the clone's scope
  pair atomically (source pair, else variant pair, else global).
- Tests: new `attachments/lib/__tests__/scope.test.ts`; update messages attachments + forward
  tests for the signature change and add partial-null-source coverage.

## Non-goals

- No DB schema / `NOT NULL` / `CHECK` migration (that is #2879's documented Option-B decision).
- Do not touch `attachments/api/route.ts` (owned by #2879) or the sync_excel / sync-akeneo
  upload sites (atomic scope, not partial-null sites).
- No change to read-time access semantics (`checkAttachmentAccess` / `isSameScope`).

## Risks

- Signature change to `copyAttachmentsForForwardMessages` / `copyAttachmentsForForward`: these
  are module-internal lib helpers (relative-import only), not a `BACKWARD_COMPATIBILITY.md`
  contract surface. All callers (one command + tests) are updated in the same change.
- Behavioral nuance: forwarded-attachment copies now inherit the **source** attachment's org
  rather than the forward target's org. In practice a forward stays within the same thread/org,
  so these match; the change only differs in the cross-org edge case, where inheriting the
  source scope is the safer (invariant-preserving) choice per #2879's audit.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared scope helper

- [x] 1.1 Add `attachments/lib/scope.ts` with `resolveAttachmentScopePair`
- [x] 1.2 Add `attachments/lib/__tests__/scope.test.ts`

### Phase 2: Harden messages forward copy

- [x] 2.1 Refactor `copyAttachmentsForForwardMessages` to derive scope from source + skip partial-null; drop `targetOrganizationId`
- [x] 2.2 Update caller in `messages/commands/messages.ts`
- [x] 2.3 Update messages attachments + forward tests; add partial-null-source coverage

### Phase 3: Harden catalog variant clone

- [x] 3.1 Resolve clone scope pair atomically in `aggregateVariantMediaToProduct`

### Phase 4: Validation

- [x] 4.1 Targeted tests + typecheck for core; full gate
