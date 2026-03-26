---
name: troubleshooter
description: Diagnose and fix common issues in Open Mercato standalone apps. Use when encountering errors, unexpected behavior, modules not loading, widgets not appearing, migrations failing, build errors, or any "it doesn't work" situation. Triggers on "error", "not working", "broken", "fix", "debug", "why isn't", "can't", "fails", "crash", "missing", "404", "500", "module not found", "widget not showing".
---

# Troubleshooter

Diagnose and fix common issues in Open Mercato standalone apps. Follow the systematic approach: identify symptoms, check common causes, verify fixes.

## Table of Contents

1. [Diagnostic Flow](#1-diagnostic-flow)
2. [Module Issues](#2-module-issues)
3. [Entity & Migration Issues](#3-entity--migration-issues)
4. [API Route Issues](#4-api-route-issues)
5. [UI & Widget Issues](#5-ui--widget-issues)
6. [Build & Type Issues](#6-build--type-issues)
7. [Extension Issues](#7-extension-issues)
8. [Database Issues](#8-database-issues)
9. [Quick Diagnostics](#9-quick-diagnostics)

---

## 1. Diagnostic Flow

When the developer reports a problem, follow this order:

### Step 1: Identify the Layer

| Symptom | Layer | Go to |
|---------|-------|-------|
| Module not discovered / route 404 | Module wiring | §2 |
| Database column/table errors | Entity & Migration | §3 |
| API returns 500 / wrong data | API Route | §4 |
| Page blank / component missing | UI & Widget | §5 |
| Build fails / type errors | Build & Type | §6 |
| Enricher/interceptor/widget not working | Extension | §7 |
| Connection refused / query errors | Database | §8 |

### Step 2: Check Generated Files

Run these commands first — they fix 60%+ of issues:

```bash
yarn generate          # Regenerate module discovery files
yarn dev               # Restart dev server
```

If the issue persists after `yarn generate`, continue to the specific section.

### Step 3: Verify the Basics

```bash
# Check module is registered
grep '<module_id>' src/modules.ts

# Check generated files exist
ls .mercato/generated/

# Check for TypeScript errors
yarn typecheck
```

---

## 2. Module Issues

### Module not found / not loading

**Symptoms**: 404 on module routes, module not in sidebar, "module not registered" errors

**Checklist**:

1. **Is the module registered in `src/modules.ts`?**
   ```typescript
   // Must have this entry:
   { id: '<module_id>', from: '@app' }
   ```
   Fix: Add the entry and run `yarn generate`.

2. **Did you run `yarn generate`?**
   Check if `.mercato/generated/` contains your module's entries.
   Fix: Run `yarn generate`.

3. **Is the module folder named correctly?**
   Must be plural, snake_case: `src/modules/<module_id>/`
   Fix: Rename folder to match module ID.

4. **Does `index.ts` export `metadata`?**
   ```typescript
   export const metadata: ModuleInfo = { name: '<module_id>', ... }
   ```
   Fix: Add the metadata export.

5. **Is the dev server running with latest changes?**
   Fix: Restart with `yarn dev`.

### Module loads but pages 404

**Symptoms**: Module appears in generated files but backend pages return 404

**Checklist**:

1. **Are backend page files in the right location?**
   - List page: `backend/page.tsx` (not `backend/index.tsx`)
   - Detail page: `backend/<entities>/[id].tsx` (bracket notation)
   Fix: Rename to match auto-discovery convention.

2. **Do pages export `metadata` with `requireAuth`?**
   ```typescript
   export const metadata = { requireAuth: true, features: ['<module_id>.view'] }
   ```
   Fix: Add metadata export.

3. **Does the user have the required ACL features?**
   Check `setup.ts` has `defaultRoleFeatures` for the user's role.
   Fix: Add features to role defaults, re-run setup.

---

## 3. Entity & Migration Issues

### "Column does not exist" / "Table does not exist"

**Symptoms**: Database queries fail with missing column/table errors

**Checklist**:

1. **Did you create a migration after adding/changing the entity?**
   ```bash
   yarn db:generate     # Creates migration file
   ```
   Fix: Run `yarn db:generate` to create the migration.

2. **Did you apply the migration?**
   ```bash
   yarn db:migrate      # Applies pending migrations
   ```
   Fix: Run `yarn db:migrate`.

3. **Is the migration file correct?**
   Check `src/modules/<module_id>/migrations/` for the latest migration.
   Verify it has the expected columns and types.
   Fix: If wrong, delete the migration file, fix the entity, and regenerate.

### Migration generation creates unexpected changes

**Symptoms**: `yarn db:generate` produces migrations for unrelated modules

**Checklist**:

1. **Are node_modules up to date?**
   ```bash
   yarn install
   ```

2. **Did you modify a core module entity without ejecting?**
   Never edit `node_modules/@open-mercato/*`.
   Fix: Revert changes to node_modules. Use UMES extensions instead, or eject the module.

### Entity changes not reflected

**Symptoms**: Changed entity file but API still returns old schema

**Checklist**:

1. Run `yarn generate` — entity discovery is cached
2. Run `yarn db:generate` — schema needs a migration
3. Run `yarn db:migrate` — migration needs to be applied
4. Restart `yarn dev` — server caches entity metadata

---

## 4. API Route Issues

### Route returns 404

**Checklist**:

1. **Is the file in the correct path?**
   `src/modules/<module_id>/api/<method>/<route-path>.ts`
   Method folders: `get/`, `post/`, `put/`, `delete/`

2. **Does it export a default handler?**
   ```typescript
   export default handler
   ```

3. **Does it export `openApi`?**
   ```typescript
   export const openApi = { summary: '...', tags: ['...'] }
   ```
   API routes without `openApi` export are not discovered.

4. **Did you run `yarn generate`?**

### Route returns 500

**Checklist**:

1. **Check server logs** — look for the actual error message
2. **Is the entity imported correctly?** Verify import path
3. **Is `organization_id` filtering applied?** Required for all tenant-scoped queries
4. **Is the zod schema matching the request body?** Schema validation errors return 422, not 500

### Route returns 401 / 403

**Checklist**:

1. **Is the user authenticated?** Check session/token
2. **Does the user have required features?** Check `acl.ts` + `setup.ts` role mapping
3. **Are features assigned to the user's role?** Check role configuration in admin

---

## 5. UI & Widget Issues

### Backend page is blank

**Checklist**:

1. **Does the page have `'use client'` directive?** Required for pages with interactivity
2. **Check browser console for errors** — React rendering errors appear there
3. **Is the correct import path used?** Use `@open-mercato/ui/backend/...`
4. **Are API calls using `apiCall` / `apiCallOrThrow`?** Never use raw `fetch`

### DataTable shows no data or missing rows

**Checklist**:

1. **Is the API path correct?** Check `apiPath` prop matches actual API route
2. **Is the entity ID correct?** Check `entityId` prop
3. **Does the API return data?** Test with `curl` or browser devtools
4. **Does the user have `view` feature?** Check ACL
5. **Are pagination props wired?** Without `page`, `pageSize`, `totalCount`, and `onPageChange`, the table only shows the first page with no pagination controls. Check the API returns `totalCount` in the response.
6. **Is `organization_id` scoping correct?** Records created without proper `organization_id` won't appear when the API filters by current org
7. **Are records soft-deleted?** Records with `deletedAt` set are filtered out by default

### Sidebar icons broken or wrong

**Checklist**:

1. **Are icons using `lucide-react` components?** Import from `lucide-react` (e.g., `import { Trophy } from 'lucide-react'`)
2. **AVOID `React.createElement('svg', ...)`** — inline SVG via `React.createElement` is fragile in bundler contexts and can produce broken icons after `yarn generate`
3. **Is the icon defined in `page.meta.ts`?** Export as part of `metadata.icon`
4. **Did you run `yarn generate`?** The generator reads icon metadata from `page.meta.ts`

**Correct pattern**:
```tsx
// page.meta.ts
import { Trophy } from 'lucide-react'
export const metadata = { icon: <Trophy className="size-4" /> }
```

### CrudForm doesn't save

**Checklist**:

1. **Check browser network tab** — look for the POST/PUT request and response
2. **Is the zod schema matching the form fields?** Mismatched field names cause silent failures
3. **Are required fields filled?** Check form validation
4. **Does the API route handle the HTTP method?** Check `api/post/` or `api/put/` exists

---

## 6. Build & Type Issues

### `yarn build` fails

**Checklist**:

1. **Run `yarn typecheck` first** — isolates type errors from build errors
2. **Run `yarn generate` first** — regenerates type-dependent files
3. **Check import paths** — use `@open-mercato/<package>/...` for framework imports
4. **Check for circular imports** — module A importing from module B importing from module A

### Type errors after adding a module

**Checklist**:

1. **Run `yarn generate`** — updates generated type files
2. **Check entity imports** — use correct relative or package paths
3. **Check zod schema matches entity** — types derived from zod must align

### "Module not found" in imports

**Checklist**:

1. **Is the package installed?** Check `package.json` dependencies
2. **Is the import path correct?** Framework packages use `@open-mercato/<package>/...`
3. **Is the package built?** Run `yarn install` to link workspace packages

---

## 7. Extension Issues

### Response Enricher data not appearing

**Checklist**:

1. **Is `data/enrichers.ts` exporting `enrichers` array?**
   ```typescript
   export const enrichers = [enricher]
   ```

2. **Did you run `yarn generate`?** Enrichers are auto-discovered

3. **Is `targetEntity` correct?** Must match the target module's entity ID exactly
   (e.g., `customers.person` not `customers.people`)

4. **Is the enricher throwing silently?** Check `critical: false` (default) — errors are swallowed.
   Temporarily set `critical: true` to surface errors.

5. **Check enricher `id` is unique** — duplicate IDs cause only one to run

### Widget not appearing in target module

**Checklist**:

1. **Is the widget mapped in `injection-table.ts`?**
   ```typescript
   export const widgetInjections = {
     '<spot-id>': { widgetId: '<your-widget-id>', priority: 50 },
   }
   ```

2. **Is the spot ID correct?** Check the exact format:
   - Forms: `crud-form:<entityId>:fields`
   - Tables: `data-table:<tableId>:columns`
   - Menus: `menu:sidebar:main`

3. **Does the widget file export default?**
   ```typescript
   export default widget
   ```

4. **Is the widget `metadata.id` unique?** Duplicate IDs cause conflicts

5. **Did you run `yarn generate`?** Widgets are auto-discovered

### API Interceptor not running

**Checklist**:

1. **Is `api/interceptors.ts` exporting `interceptors` array?**
   ```typescript
   export { interceptors }
   ```

2. **Does `targetRoute` match?** Check exact route path (without `/api/` prefix)

3. **Does `methods` include the HTTP method?** e.g., `['GET', 'POST']`

4. **Is the interceptor throwing instead of returning `{ ok: false }`?**
   Errors in interceptors are caught silently

5. **Check `priority`** — lower priority runs first. Another interceptor may be blocking

### Component replacement not working

**Checklist**:

1. **Is `widgets/components.ts` exporting `componentOverrides`?**
2. **Is the `componentId` handle correct?** Use `ComponentReplacementHandles` helpers
3. **For `replacement` mode**: is `propsSchema` provided?
4. **Did you run `yarn generate`?**

---

## 8. Database Issues

### Connection refused

**Checklist**:

1. **Is PostgreSQL running?**
   ```bash
   docker compose ps    # Check container status
   docker compose up -d # Start if stopped
   ```

2. **Is `.env` configured correctly?** Check `DATABASE_URL`

3. **Is the database created?**
   ```bash
   yarn initialize      # Creates DB + first admin
   ```

### Query timeout / slow queries

**Checklist**:

1. **Are indexes present on `organization_id` and `tenant_id`?** Check entity has `@Index()`
2. **Is the query filtering by `organization_id`?** Missing filter = full table scan
3. **Are enrichers using batch queries?** Missing `enrichMany` causes N+1

---

## 9. Quick Diagnostics

### The "Fix Everything" Sequence

When nothing else works, run this full reset sequence:

```bash
yarn generate          # 1. Regenerate all discovery files
yarn typecheck         # 2. Check for type errors
yarn db:generate       # 3. Check for pending migrations
yarn db:migrate        # 4. Apply any pending migrations
yarn dev               # 5. Restart dev server
```

### Common Error → Fix Table

| Error Message | Likely Cause | Fix |
|--------------|-------------|-----|
| `Module '<id>' not found` | Not in `src/modules.ts` | Add entry, `yarn generate` |
| `Table '<name>' does not exist` | Missing migration | `yarn db:generate` + `yarn db:migrate` |
| `Column '<name>' does not exist` | Entity changed without migration | `yarn db:generate` + `yarn db:migrate` |
| `Cannot find module '@open-mercato/...'` | Package not installed | `yarn install` |
| `Route not found` / 404 | Missing `openApi` export or wrong path | Add export, `yarn generate` |
| `401 Unauthorized` | Missing auth or session expired | Check login, check `requireAuth` |
| `403 Forbidden` | User lacks required feature | Check `acl.ts` + `setup.ts` roles |
| `422 Unprocessable Entity` | Zod validation failed | Check request body matches schema |
| Widget not showing | Missing `injection-table.ts` mapping | Add mapping, `yarn generate` |
| Enricher data missing | `critical: false` hiding errors | Set `critical: true` temporarily |
| Interceptor not running | Wrong `targetRoute` or `methods` | Check exact route path and methods |
| `ECONNREFUSED` | Database/service not running | `docker compose up -d` |
| DataTable shows fewer rows than expected | Missing pagination props or API `totalCount` | Wire `page`/`pageSize`/`totalCount`/`onPageChange` props |
| Sidebar icons broken or wrong | Inline SVG via `React.createElement` | Use `lucide-react` components in `page.meta.ts` |
| `yarn generate` changes unexpected files | Stale generated files | Delete `.mercato/generated/`, re-run |

---

## Rules

- **ALWAYS** run `yarn generate` as first diagnostic step
- **ALWAYS** check server logs / browser console for actual error messages
- **NEVER** edit files in `.mercato/generated/` or `node_modules/`
- **NEVER** assume the issue — verify with actual error output
- Fix the root cause, not the symptom — temporary workarounds become permanent bugs
- When suggesting a fix, include the exact command or code change needed
