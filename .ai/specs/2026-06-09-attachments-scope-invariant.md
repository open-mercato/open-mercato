# SPEC: Attachments scope invariant — audit & hardening

> Status: **Implemented** · Date: 2026-06-09 · Scope: OSS
> Module: `packages/core/src/modules/attachments/`
> Issue: [open-mercato/open-mercato#2109](https://github.com/open-mercato/open-mercato/issues/2109) — "consider NOT NULL constraint on attachments.tenant_id and attachments.organization_id"
> Related: PR #2107 (read-time fail-closed fix), #2012 (mergeIdFilter fail-closed pattern)

## TLDR

`attachments.tenant_id` / `attachments.organization_id` are nullable. Issue #2109 asks
whether they should be `NOT NULL` to structurally prevent the fail-open class closed at
read time by PR #2107.

The audit found a **legitimate unscoped use case**: a row with **both** scope columns null
is an intentional "global attachment", explicitly supported by `isSameScope`
(`lib/access.ts:19-21`). A blanket `NOT NULL` migration would break that semantic and force
a sentinel-tenant backfill of legacy rows. This places the issue in **Option B** of its own
acceptance criteria (document the legitimate unscoped use case + regression coverage) rather
than the `NOT NULL` migration branch.

The real danger is **partial-null** (one column set, the other null): `isSameScope` fails
closed on it (#2107), so such a row is unreadable dead data that can only leak through a
future code path that bypasses `checkAttachmentAccess`. The hardening enforces the
**both-or-neither** invariant at the creation boundary instead of at the schema level.

## Audit — Attachment creation paths

| Creation site | Scope source | Can produce partial-null? |
|---------------|--------------|---------------------------|
| `attachments/api/route.ts:~424` (upload) | `auth.orgId!` / `auth.tenantId!`, gated by precondition | No — both set |
| `sync_excel/lib/upload-storage.ts:38` | required `organizationId` / `tenantId` inputs | No |
| `catalog/seed/examples.ts:102` | `SeedScope` (both required) | No |
| `catalog/commands/variants.ts:553` | `source ?? variant ?? null` (pair) | Only collapses to both-null global |
| `messages/lib/attachments.ts:177` (`copyAttachmentsForForwardMessages`) | non-null `tenantId` + **nullable** `targetOrganizationId` | **Yes** — tenant-set/org-null |

The access layer (`lib/access.ts`) is already correct and well-tested:
- both-null → accessible to any authenticated principal (global semantics)
- partial-null → fail-closed (403) for every non-superadmin principal
- scoped → exact-match required

## Decision

- **Reject** the `NOT NULL` migration: it would break the supported global-attachment
  shape and require a risky sentinel backfill, for a `priority-low` hardening task.
- **Reject** a DB `CHECK ((both null) OR (both set))` for now: it is an Ask-First schema
  change and would make the `messages` forward-copy path throw at runtime if an org is
  ever legitimately null there. Recorded below as an optional follow-up.
- **Adopt** an application-layer fail-closed guard at the creation boundary plus module
  documentation, matching acceptance-criteria Option B.

## What changed

1. `lib/access.ts` — new exported `assertAttachmentScopeInvariant({ tenantId, organizationId })`
   throwing on partial-null (blank/whitespace treated as null), accepting both fully-scoped
   and fully-global rows.
2. `api/route.ts` — calls the guard before persisting the uploaded attachment.
3. `AGENTS.md` (new) — documents the scope/access policy, the both-or-neither invariant, and
   the audited cross-module creation paths.
4. `lib/__tests__/access.test.ts` — unit tests for the guard (scoped ✓, global ✓, partial-null ✗,
   blank-string handling, error message naming the missing column).

## Acceptance criteria

- [x] Audit completed; outcome documented in this spec.
- [x] Legitimate "unscoped attachment" (both-null global) use case documented in module
  `AGENTS.md` with explicit access-policy notes, plus regression tests asserting the access
  check refuses cross-scope / partial-null reads (`lib/__tests__/access.test.ts`).

## Backward compatibility

No contract-surface change: nullable columns are unchanged, no API response field changes,
no event/DI/ACL/route changes. The new guard only rejects rows that are already unreadable
dead data, so no previously-valid attachment becomes invalid.

## Optional follow-up (not in this change)

If the team wants DB-level enforcement, a future PR could add a
`CHECK ((organization_id IS NULL AND tenant_id IS NULL) OR (organization_id IS NOT NULL AND tenant_id IS NOT NULL))`
constraint, **after** first changing `messages/lib/attachments.ts` to copy the source
attachment's scope pair (so the forward-copy path can never emit a partial-null row).
