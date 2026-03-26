# Issue Log — Open Mercato Framework

Issues discovered during HackOn platform development that require framework-level fixes.

---

## ISSUE-001: Portal menu injection widgets cannot resolve `orgSlug` in hrefs

**Severity:** High
**Affects:** Any app module injecting portal sidebar navigation
**Discovered:** 2026-03-20 during HackOn Phase 2

### Problem

`InjectionMenuItemWidget.menuItems[].href` is typed as `string` — a static value defined at module load time. Portal URLs require an `orgSlug` prefix (e.g., `/acme-corp/portal/team`), but the slug is only known at runtime from the URL or portal context.

Built-in portal nav items work because they're constructed inside `PortalShell.tsx` where `orgSlug` is available:

```typescript
// PortalShell.tsx line 177 — works because orgSlug is in scope
const dashboardHref = orgSlug ? `/${orgSlug}/portal/dashboard` : '/portal/dashboard'
```

Injected menu items are static data widgets loaded via `usePortalInjectedMenuItems()`. The hook passes `href` through unchanged — no orgSlug resolution:

```typescript
// usePortalInjectedMenuItems.ts — items used as-is
entries.push({ ...menuItem, labelKey: normalizedLabelKey, features })
```

**Result:** Injected portal nav links navigate to `/portal/team` instead of `/acme-corp/portal/team` → 404.

### Current Workaround

Using a `get menuItems()` getter that reads `window.location.pathname` at access time:

```typescript
const widget: InjectionMenuItemWidget = {
  metadata: { id: 'teams.portal-nav' },
  get menuItems() {
    const match = window.location.pathname.match(/^\/([^/]+)\/portal/)
    const prefix = match ? `/${match[1]}/portal` : '/portal'
    return [
      { id: 'teams.portal-my-team', label: 'My Team', href: `${prefix}/team`, ... },
    ]
  },
}
```

This works but is fragile — relies on `window` availability, regex parsing, and the getter being called on every render cycle.

### Proposed Fix

**Option A (minimal, recommended): Resolve portal hrefs in `usePortalInjectedMenuItems`**

The hook already runs inside the portal context where `orgSlug` is available. Add automatic href resolution for items whose `href` starts with `/portal/`:

```typescript
// usePortalInjectedMenuItems.ts
export function usePortalInjectedMenuItems(surfaceId: PortalMenuSurfaceId) {
  const { widgets, isLoading } = useInjectionDataWidgets(surfaceId)
  const portalCtx = usePortalContext()                    // ← ADD
  const orgSlug = portalCtx?.orgSlug ?? ''                // ← ADD
  // ...

  const items = React.useMemo(() =>
    rawItems
      .filter(/* feature gate */)
      .map((item) => ({                                   // ← ADD
        ...item,
        href: item.href && orgSlug && item.href.startsWith('/portal/')
          ? `/${orgSlug}${item.href}`
          : item.href,
      })),
    [rawItems, grantedFeatures, orgSlug],                 // ← ADD orgSlug dep
  )

  return { items, isLoading }
}
```

Widget definitions would then use simple `/portal/...` paths:

```typescript
{ id: 'teams.portal-my-team', href: '/portal/team', ... }
```

**Pros:** Zero breaking changes. Existing widgets without `/portal/` prefix are unaffected. Convention is intuitive — portal-relative paths just work.

**Cons:** Implicit behavior. Developers must know to use `/portal/` prefix for auto-resolution.

**Option B (explicit): Add `portalRelative` flag to `InjectionMenuItem`**

```typescript
export type InjectionMenuItem = {
  // ...existing fields...
  href?: string
  portalRelative?: boolean  // ← NEW: when true, href is prefixed with /{orgSlug}
}
```

Resolution in `usePortalInjectedMenuItems`:

```typescript
href: item.portalRelative && orgSlug
  ? `/${orgSlug}${item.href}`
  : item.href
```

**Pros:** Explicit opt-in, no magic. Clear in widget definitions.

**Cons:** New field on a frozen type. Slightly more verbose for widget authors.

**Option C (flexible): Support href as function**

```typescript
export type InjectionMenuItem = {
  // ...existing fields...
  href?: string | ((ctx: { orgSlug: string }) => string)  // ← EXTEND
}
```

Resolution in the hook or rendering:

```typescript
const resolvedHref = typeof item.href === 'function'
  ? item.href({ orgSlug })
  : item.href
```

**Pros:** Maximum flexibility. Works for any dynamic URL pattern.

**Cons:** Breaking type change if consumers do `typeof item.href === 'string'` checks. Function values can't be serialized.

### Recommendation

**Option A** — it's the smallest change (5 lines in one file), zero breaking changes, and follows the principle of least surprise: portal menu items naturally use portal-relative paths.

---

## ISSUE-002: `yarn db:generate` creates polluted migrations for new modules

**Severity:** Critical
**Affects:** Any app adding a new `@app` module with entities
**Discovered:** 2026-03-19 during HackOn Phase 1

### Problem

`dbGenerate` in `@open-mercato/cli` processes modules alphabetically, creating a separate MikroORM instance per module. However, MikroORM maintains a **global metadata registry** via `@Entity()` decorators. When a module's `data/entities.ts` is imported, its decorators register entities globally.

By the time a later module (alphabetically) is processed, all previously imported modules' entities are in the global metadata. MikroORM's `createMigration()` then generates a migration containing **all accumulated entities**, not just the target module's.

**Example:** The `competitions` module (processed after `catalog`, `customers`, etc.) gets a 1,182-line migration with 207 `CREATE TABLE` statements for tables across all core modules — not just the 5 competition tables.

Core modules aren't affected because their snapshots already match the accumulated state. But **any new module** gets a polluted migration on first `db:generate`.

### Current Workaround

1. Run `yarn db:generate` (creates polluted migration + correct snapshot)
2. Delete the polluted migration file
3. Hand-write a clean migration with only the module's tables
4. Run `yarn db:generate` again to verify "no changes"

### Proposed Fix

**Clear MikroORM's global metadata registry between module iterations** in `dbGenerate`:

```typescript
// cli/src/lib/db/commands.ts — inside the module loop
for (const entry of ordered) {
  // ← ADD: Clear global metadata before loading each module's entities
  const { MetadataStorage } = await import('@mikro-orm/core')
  MetadataStorage.clear()                                    // ← or equivalent reset

  const entities = await loadModuleEntities(entry, resolver)
  if (!entities.length) { ... continue }
  // ... rest of migration generation
}
```

If `MetadataStorage.clear()` doesn't exist, fork the entity loading into a child process or use `MikroORM.init()` with `discovery: { disableDynamicFileAccess: true }` to prevent metadata leakage.

**Alternative:** Run `loadModuleEntities` in an isolated `vm` context or worker thread so decorator side effects don't pollute the parent process.

### Note on Command Aliases

`yarn db:generate` (monorepo root) delegates to `yarn workspace @open-mercato/app db:generate`, which runs `mercato db generate`. Standalone apps use `yarn mercato db generate` (or `npx mercato db generate`) directly. Both invoke the same `dbGenerate(resolver)` in `packages/cli/src/lib/db/commands.ts`, so this issue affects monorepo and standalone apps equally.

### Impact

Without this fix, every developer adding a new module must manually clean up migrations — a significant DX friction that can lead to accidentally applying destructive migrations (dropping FK constraints on core tables).

---

## ISSUE-003: Example module snapshot contains full database schema

**Severity:** Medium
**Affects:** Starter/template projects with the `example` module
**Discovered:** 2026-03-19 during HackOn Phase 1

### Problem

The `.snapshot-open-mercato.json` in `src/modules/example/migrations/` shipped with the starter template contains the schema for **all core module tables** (~200 tables), not just the 3 example entities. This is a side effect of ISSUE-002 — the snapshot was generated with the full accumulated metadata.

When `db:generate` runs, it compares the example's 3 entities against this bloated snapshot, detecting a massive diff and generating a bogus migration that drops FK constraints on core tables.

### Proposed Fix

Regenerate the example module's snapshot with an isolated MikroORM instance (after fixing ISSUE-002), so it contains only the `example_items`, `todos`, and `example_customer_priorities` tables.

For the starter template: ship a clean snapshot or no snapshot at all (let `db:generate` create it fresh on first run).

---

## ISSUE-004: Query engine entity ID convention undocumented — silent wrong-table fallback

**Severity:** Critical
**Affects:** Any module with entity classes whose name differs from the entity ID segment
**Discovered:** 2026-03-22 during HackOn Phase 2

### Problem

`resolveEntityTableName()` in `@open-mercato/shared/lib/query/engine.ts` resolves table names from entity IDs (`<module>:<entity>`) via this chain:

1. Split entity ID on `:`, take the second segment as `rawName`
2. Convert `rawName` to PascalCase via `toPascalCase()` → candidate class names
3. Look up ORM metadata by class name → if found, use `meta.tableName`
4. **Fallback:** pluralize `rawName` naively → use as table name

**The fallback at step 4 is silent.** When the class name lookup fails, the engine queries a non-existent table, producing a Postgres error: `relation "xxx" does not exist`.

**Example:** Entity ID `competitions:participation` with class `CompetitionParticipation`:

| Step | Value | Correct? |
|------|-------|----------|
| rawName | `participation` | — |
| PascalCase | `Participation` | — |
| ORM lookup | `Participation` → not found (`CompetitionParticipation`) | **FAIL** |
| Fallback | `pluralize('participation')` → `participations` | **WRONG** |
| Actual table | `competitions_participation` | — |
| Result | `SELECT * FROM "participations"` → **500 error** | |

The same issue affects any entity where the class name includes a module prefix (common for disambiguation):
- `TeamMember` with ID `teams:member` → looks for `Member`, falls back to `members`
- `TeamInvitation` with ID `teams:invitation` → looks for `Invitation`, falls back to `invitations`

### Current Workaround

Use entity ID segments that produce the correct PascalCase class name:

```
competitions:competition_participation  → toPascalCase → CompetitionParticipation ✓
teams:team_member                       → toPascalCase → TeamMember ✓
teams:team_invitation                   → toPascalCase → TeamInvitation ✓
```

This works but is undocumented, unintuitive, and discovered only via runtime errors.

### Proposed Fix

**Option A (recommended): Search ORM metadata by `tableName` as secondary lookup**

When the PascalCase class name lookup fails, search all registered entities for a matching `tableName` before falling back to pluralization:

```typescript
// engine.ts — resolveEntityTableName()
export function resolveEntityTableName(em: EntityManager | undefined, entity: EntityId): string {
  if (entityTableCache.has(entity)) return entityTableCache.get(entity)!

  const parts = String(entity || '').split(':')
  const rawName = (parts[1]?.trim().length > 0) ? parts[1] : (parts[0] || '').trim()
  const metadata = (em as any)?.getMetadata?.()

  if (metadata && rawName) {
    // Step 1: Try class name lookup (existing behavior)
    const candidates = candidateClassNames(rawName)
    for (const candidate of candidates) {
      try {
        const meta = metadata.find?.(candidate)
        if (meta?.tableName) {
          entityTableCache.set(entity, String(meta.tableName))
          return String(meta.tableName)
        }
      } catch {}
    }

    // Step 2: NEW — Try table name lookup across all entities
    const modulePrefix = parts[0] ?? ''
    const candidateTables = [
      `${modulePrefix}_${rawName}`,          // e.g., competitions_participation
      pluralizeBaseName(rawName),             // e.g., participations
      `${modulePrefix}_${pluralizeBaseName(rawName)}`, // e.g., competitions_participations
    ]
    try {
      const allMeta = metadata.getAll?.() ?? []
      for (const meta of allMeta) {
        if (meta?.tableName && candidateTables.includes(String(meta.tableName))) {
          entityTableCache.set(entity, String(meta.tableName))
          return String(meta.tableName)
        }
      }
    } catch {}
  }

  // Step 3: Fallback (existing) — but LOG A WARNING
  const fallback = pluralizeBaseName(rawName || '')
  console.warn(
    `[QueryEngine] Could not resolve entity "${entity}" via ORM metadata. ` +
    `Falling back to table name "${fallback}". ` +
    `This may be incorrect — ensure the entity ID segment matches the class name convention.`
  )
  entityTableCache.set(entity, fallback)
  return fallback
}
```

**Pros:** Fixes all cases where class name differs from entity ID. No breaking changes. Warning log helps developers catch misconfigured entity IDs early.

**Cons:** Additional metadata scan (but results are cached, so one-time cost).

**Option B: Add warning log to the existing fallback**

Minimal change — just add a `console.warn` at line 79 so developers see the fallback immediately instead of getting a cryptic Postgres error:

```typescript
const fallback = pluralizeBaseName(rawName || '')
console.warn(`[QueryEngine] Entity "${entity}" not found in ORM metadata — falling back to table "${fallback}"`)
entityTableCache.set(entity, fallback)
return fallback
```

**Pros:** 2-line change. Makes the failure visible immediately.

**Cons:** Doesn't fix the underlying issue — developers still need to know the naming convention.

**Option C: Document the convention explicitly**

Add to the module scaffold skill and AGENTS.md:

> Entity IDs must use the snake_case form of the entity class name after the colon. Example: class `CompetitionParticipation` → entity ID `competitions:competition_participation` (not `competitions:participation`).

**Pros:** Zero code changes.

**Cons:** Convention-only fix. Developers will continue to hit this issue until they read the docs.

### Recommendation

**Option A + B combined** — add the secondary table name lookup AND the warning log. This fixes the issue for existing code while making future misconfiguration immediately visible.

---

## ISSUE-005: Customer role update fails with 400 when UI sends `name` for system roles

**Severity:** Medium
**Affects:** Admin panel → Customer Accounts → Roles → Edit system role (e.g., `participant`)
**Discovered:** 2026-03-22 during HackOn portal permission setup

### Problem

The role edit page in the backend admin (`/backend/customer_accounts/roles/:id`) sends all form fields (including `name`) in a single `PUT /api/customer_accounts/admin/roles/:id` request, even when the `name` value hasn't changed.

The endpoint at `@open-mercato/core/modules/customer_accounts/api/admin/roles/[id].ts` (line 101-103) rejects the request if the role is a **system role** and `name` is present in the payload:

```typescript
if (role.isSystem && parsed.data.name !== undefined) {
  return NextResponse.json({ ok: false, error: 'Cannot change name of a system role' }, { status: 400 })
}
```

Since the `updateRoleSchema` marks `name` as `z.string().optional()`, and the UI always sends it (even unchanged), system roles cannot be updated at all — not even their description, permissions, or `customerAssignable` flag.

**Reproduction:**
1. Go to `/backend/customer_accounts/roles`
2. Click a system role (e.g., `participant`, `buyer`)
3. Change any field (e.g., toggle a permission checkbox)
4. Save → **400 "Cannot change name of a system role"**

### Root Cause

The role edit UI serializes the entire form including `name` on every save. The API endpoint treats the _presence_ of `name` in the payload as an attempted name change, even when the value is identical to the current name.

**File:** `@open-mercato/core/modules/customer_accounts/api/admin/roles/[id].ts` lines 101-103

### Proposed Fix

**Option A (recommended): Compare with current value before rejecting**

```typescript
// Line 101-103, replace:
if (role.isSystem && parsed.data.name !== undefined) {
  return NextResponse.json({ ok: false, error: 'Cannot change name of a system role' }, { status: 400 })
}

// With:
if (role.isSystem && parsed.data.name !== undefined && parsed.data.name !== role.name) {
  return NextResponse.json({ ok: false, error: 'Cannot change name of a system role' }, { status: 400 })
}
```

This allows the UI to send the unchanged `name` without triggering the guard. Only actual name changes are rejected.

**Option B: Strip `name` from payload for system roles**

```typescript
if (role.isSystem) {
  delete parsed.data.name
}
```

**Option C: Fix the UI to omit unchanged fields**

The role edit page should only include fields that were actually modified. This is a broader UI change.

### Recommendation

**Option A** — 1-line change, zero risk, preserves the system role protection while fixing the false positive.

---
