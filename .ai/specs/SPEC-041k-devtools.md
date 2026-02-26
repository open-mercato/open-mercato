# SPEC-041k — DevTools + Conflict Detection

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | K (PR 11) |
| **Branch** | `feat/umes-devtools` |
| **Depends On** | All previous phases |
| **Status** | Draft |

## Goal

Provide developer-facing tooling for debugging, inspecting, and validating UMES extensions: a DevTools panel for runtime inspection and build-time conflict detection.

---

## Scope

### 1. UMES DevTools Panel (Dev Mode Only)

In development mode, a DevTools panel shows:

- **Active Extension Points**: All UMES extension points on the current page (slots, enrichers, interceptors, component replacements)
- **Module Registrations**: Which modules have registered for each point, with priority ordering
- **Conflict Detection**: Visual warnings when two modules target the same point at same priority
- **Real-Time Event Flow**: Live feed showing `onBeforeSave` fired → widget X responded → blocked/allowed
- **Enricher Timing**: Which enrichers ran, how long each took (with slow-enricher warnings)
- **Component Replacements**: Which components are replaced and by which module
- **Interceptor Activity**: Which interceptors fired for the last API call

### 2. Build-Time Conflict Detection (`yarn generate`)

During `yarn generate`, detect:

| Conflict | Severity | Action |
|----------|----------|--------|
| Two modules replacing the same component at same priority | Error | Build fails |
| Enricher adding fields that conflict with core fields | Warning | Console warning |
| Circular widget dependencies | Error | Build fails |
| Missing feature declarations for gated extensions | Warning | Console warning |
| Multiple interceptors on same route at same priority | Warning | Console warning |

### 3. CLI Commands

```bash
# List all UMES extensions
yarn umes:list

# Show extension tree for a specific module
yarn umes:inspect --module loyalty

# Check for conflicts without building
yarn umes:check
```

### 4. Enricher Performance Logging

In development mode, log enricher execution time:
- < 100ms: normal (no log)
- 100–500ms: warning in console
- > 500ms: error in console with suggestion to add caching

### 5. Extension Header Protocol

Widgets and interceptors communicate via scoped headers (existing pattern from record-locking):

```
x-om-ext-<module>-<key>: <value>
```

Example:
```
x-om-ext-record-locks-token: abc123
x-om-ext-business-rules-override: skip-credit-check
```

### 6. Response Metadata

When enrichers are active, responses include metadata:

```json
{
  "data": { /* enriched record */ },
  "_meta": {
    "enrichedBy": ["loyalty.customer-points", "credit.score"]
  }
}
```

### 7. Enricher Cache (Optional)

For performance-critical enrichers, an optional cache layer using existing `@open-mercato/cache` infrastructure:

```typescript
{
  id: 'loyalty.customer-points',
  cache: {
    strategy: 'read-through',
    ttl: 60,  // seconds
    tags: ['loyalty', 'customers'],
    invalidateOn: ['loyalty.points.updated', 'loyalty.tier.changed'],
  },
}
```

### 8. No New Database Entities for UI Phases

Phases A-B (UI slots, menus, component replacement) are purely runtime — no database changes. All configuration is in code. Phase D (enrichers) optionally uses cache infrastructure. Phase E (interceptors) optionally uses existing `action_log` for audit.

### 9. Interceptor Audit Trail

All interceptor rejections are logged as `action_log` entries:
```sql
-- Uses existing action_log infrastructure; no new table needed
-- action_type: 'api_interceptor_reject'
-- metadata: { interceptorId, route, method, message }
```

---

## Example Module Additions

No example module additions — this phase is infrastructure only. The DevTools panel displays information from all UMES mechanisms implemented in previous phases.

---

## Integration Tests

### TC-UMES-DT01: DevTools panel lists all active extensions on current page

**Type**: UI (Playwright)

**Preconditions**: Dev server running in development mode, example module UMES extensions active from previous phases

**Steps**:
1. Start dev server in development mode
2. Navigate to customer list page (has enrichers, column injection, row actions from Phase F)
3. Open the UMES DevTools panel (keyboard shortcut, e.g., `Ctrl+Shift+U`)
4. Inspect the extension list

**Expected**: Panel shows:
- Enricher: `example.customer-todo-count` targeting `customers.person`
- Column injection: `example.injection.customer-todo-count-column`
- Row action injection: `example.injection.customer-todo-actions`
- Any active interceptors for the current route

**Testing notes**:
- DevTools only available in `NODE_ENV=development`
- Panel activation via keyboard shortcut or a UI toggle
- Verify panel is NOT present in production mode
- Check that enricher timing is displayed (e.g., "12ms")

### TC-UMES-DT02: Build-time conflict detection warns on duplicate priority replacements

**Type**: CLI (Script)

**Steps**:
1. Create two temporary modules with component overrides targeting the same component ID at the same priority
2. Run `yarn generate`
3. Check output for conflict warning

**Expected**: Warning message: "Conflict: modules X and Y both replace component Z at priority 100"

**Testing notes**:
- May need temporary test fixture files
- Verify build succeeds with warning (not hard error for warnings)
- Verify build FAILS for errors (e.g., circular dependencies)
- Clean up fixture files after test

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/ui/src/backend/devtools/UmesDevToolsPanel.tsx` |
| **NEW** | `packages/ui/src/backend/devtools/useUmesDevTools.ts` |
| **MODIFY** | Generator scripts (add conflict detection logic) |
| **MODIFY** | CLI commands (add `umes:list`, `umes:inspect`, `umes:check`) |

**Estimated scope**: Medium

---

## Backward Compatibility

- DevTools panel only renders in development mode — zero production impact
- Build-time checks are additive — existing `yarn generate` behavior unchanged
- CLI commands are new additions — no existing commands modified
- Interceptor audit logging uses existing `action_log` infrastructure
