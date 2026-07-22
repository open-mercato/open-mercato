# `mercato auth sync-role-acls` CLI

**Date**: 2026-04-25
**Status**: Implemented
**Module**: `auth` (`packages/core/src/modules/auth/`)
**Related**: SPEC-013 (Decouple Module Setup)

---

## TLDR

Adds an idempotent CLI command that re-applies every enabled module's `defaultRoleFeatures` to existing tenants. Closes the gap left by `setupTenantAndPrimaryUser` (which only runs during initial bootstrap): when a module ships new features in `acl.ts` + `setup.ts`, those features never reach existing production/staging tenants until something runs the merge again.

---

## Problem

When a module adds a new feature:

1. `acl.ts` declares the feature.
2. `setup.ts` adds it to `defaultRoleFeatures`.
3. New tenants pick it up via `setupInitialTenant` → `ensureDefaultRoleAcls`.
4. **Existing tenants do not.** Their `RoleAcl.featuresJson` rows were written by an older deploy and never re-merged.

Operators previously had to write ad-hoc scripts or apply features by hand from the UI per tenant.

---

## Contract

```
mercato auth sync-role-acls [--tenant <tenantId>] [--no-superadmin]
```

**Behaviour:**
- Resolves enabled modules from `getCliModules()` (the generated CLI registry); errors out if generators have not run.
- Without `--tenant`: iterates every `Tenant` row, applies `ensureDefaultRoleAcls` + `ensureCustomRoleAcls`. Logs and exits cleanly when no tenants exist.
- With `--tenant <id>`: validates the value is a non-empty string, **looks up the `Tenant` row, errors out if missing**, then runs the sync against that tenant only.
- `--no-superadmin`: skips writing the superadmin RoleAcl (matches the same flag on `setupInitialTenant`).
- Sync is **additive**: existing custom features in `RoleAcl.featuresJson` are preserved; only missing default features are merged in. Superadmin's `isSuperAdmin` flag is upgraded if currently false.

**Exit / output contract:**
- `❌ Invalid --tenant value: <raw>` — empty/whitespace `--tenant`.
- `❌ Tenant not found: <id>` — `--tenant` value is a syntactically valid id but no `Tenant` row exists.
- `❌ No CLI modules registered. Run \`yarn generate\` first.` — generators not run.
- `No tenants found; nothing to sync.` — no `--tenant` and no rows.
- `✅ Synced role ACLs for tenant <id>` — per tenant on success.

---

## Integration Coverage

### Unit (`packages/core/src/modules/auth/__tests__/cli-sync-role-acls.test.ts`)

- Built-in + custom roles get RoleAcl rows with the correct merged feature list when `--tenant <id>` targets an existing tenant.
- Sync is additive and idempotent — existing custom features (`legacy.custom.kept`) survive, missing defaults get added.
- `--no-superadmin` skips the superadmin RoleAcl write but still writes the rest.
- Without `--tenant`, every `Tenant` row is iterated.
- `No tenants found; nothing to sync.` is logged when there are no tenants.
- `--tenant <missing-id>` writes nothing and emits `❌ Tenant not found: <id>`.

### Integration (`packages/core/src/modules/auth/__integration__/TC-AUTH-033.spec.ts`)

- **Recovery path:** snapshots the admin role's ACL, clears it via `PUT /api/auth/roles/acl`, runs the CLI, asserts that the admin features are restored (must include `auth.*`). Restores original state in `finally` to avoid leaking into other tests. Uses a `superadmin` token for state mutation so the cleared admin role cannot lock the test runner out.
- **Idempotency:** running twice in a row produces the same `✅ Synced role ACLs for tenant <id>` output without error.
- **Invalid `--tenant`:** whitespace-only value yields `Invalid --tenant value` and no sync runs.
- **Missing `--tenant`:** a syntactically valid but non-existent UUID yields `Tenant not found: <id>` and never logs `Synced role ACLs for tenant <id>`.

---

## Migration & Backward Compatibility

- **No breaking change.** New CLI command; nothing renamed or removed.
- The auth CLI list export (`packages/core/src/modules/auth/cli.ts` default export) gains one entry; existing entries (`add-user`, `seed-roles`, `setup`, `add-org`, `set-password`, `rotate-encryption-key`, `list-organizations`, `list-tenants`, `list-users`) are unchanged.
- No DB schema change. `RoleAcl` is read/written via the same path as `setupInitialTenant`.
- Operators running the command against a tenant that already has the latest features see no row mutation (the merge is a no-op when nothing is missing).

**Operator workflow after deploying new features:**

```bash
# All tenants
yarn mercato auth sync-role-acls

# Single tenant (e.g. staging)
yarn mercato auth sync-role-acls --tenant <tenantId>
```

---

## Files Touched

- `packages/core/src/modules/auth/cli.ts` — adds `syncRoleAcls` ModuleCli entry.
- `packages/core/src/modules/auth/__tests__/cli-sync-role-acls.test.ts` — unit coverage.
- `packages/core/src/modules/auth/__integration__/TC-AUTH-033.spec.ts` — integration coverage.
- `packages/core/src/modules/auth/README.md` — CLI usage line.
- `packages/core/src/modules/auth/AGENTS.md` — already documents calling `sync-role-acls` from the "Adding New Features" workflow.
