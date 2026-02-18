# SPEC-017: Version History Panel

**Date:** 2026-02-03  
**Status:** Implemented (Synced)  
**Module:** `audit_logs` (`@open-mercato/core`) + `version-history` (`@open-mercato/ui`)  
**Related:**
- [SPEC-016: Form Headers & Footers](SPEC-016-2026-02-03-form-headers-footers.md)
- [SPEC-020: Related Entity Version History](SPEC-020-2026-02-07-related-entity-version-history.md)

## TLDR
- Version history is delivered as a right-side panel opened by `VersionHistoryAction`.
- Backend endpoint is `GET /api/audit_logs/audit-logs/actions` with optional `resourceKind`, `resourceId`, `includeRelated`, and cursor params.
- Visibility is ACL-driven: `audit_logs.view_tenant` sees tenant-wide entries; otherwise endpoint and UI both enforce self-only view.
- `VersionHistoryConfig` already supports `includeRelated` and parent linkage fields are returned as `parentResourceKind`/`parentResourceId`.
- Panel supports undo/redo actions with ACL auto-check or explicit override.

## Overview
The feature exposes command/audit history in context of edited records without leaving form/detail pages. It is used by `CrudForm` via `versionHistory` prop and by custom detail pages using `VersionHistoryAction` directly.

The current implementation is already live on `develop`; this update aligns the spec with real behavior after related-entity history and undo/redo updates.

## Problem Statement
Original spec assumptions diverged from the codebase in three areas:
1. ACL and actor visibility (self-only vs tenant-wide) were incompletely documented.
2. Related entity support (`includeRelated`, `parentResourceKind`, `parentResourceId`) was missing from older description.
3. `VersionHistoryAction`/`VersionHistoryConfig` and undo/redo UX details changed since initial draft.

## Proposed Solution
Keep implementation as-is and update this specification to be implementation-accurate:
- Document effective permission model (`view_self` baseline + `view_tenant` widening).
- Document exact request/response shape and UI types.
- Document undo/redo path and ACL checks from panel.

## Architecture
### UI components
- `packages/ui/src/backend/version-history/VersionHistoryAction.tsx`
- `packages/ui/src/backend/version-history/VersionHistoryPanel.tsx`
- `packages/ui/src/backend/version-history/VersionHistoryDetail.tsx`
- `packages/ui/src/backend/version-history/useVersionHistory.ts`
- `packages/ui/src/backend/version-history/useAuditPermissions.ts`

### Backend components
- `packages/core/src/modules/audit_logs/api/audit-logs/actions/route.ts`
- `packages/core/src/modules/audit_logs/api/audit-logs/actions/undo/route.ts`
- `packages/core/src/modules/audit_logs/api/audit-logs/actions/redo/route.ts`
- `packages/core/src/modules/audit_logs/services/actionLogService.ts`

### Data flow
1. UI gets `VersionHistoryConfig` and opens panel.
2. Hook calls `GET /api/audit_logs/audit-logs/actions` with:
   - required `resourceKind`, `resourceId`
   - optional `organizationId`
   - `includeRelated=true` unless explicitly disabled
   - optional `before` cursor for pagination
3. Backend filters action logs by resource and tenant scope.
4. Panel renders entries and optionally allows undo/redo depending on ACL.

## Data Models
### Action log fields consumed by version history
From `action_logs` / API response:
- `id`, `commandId`, `actionLabel`, `executionState`
- `actorUserId`, `actorUserName`
- `resourceKind`, `resourceId`
- `parentResourceKind`, `parentResourceId`
- `undoToken`
- `snapshotBefore`, `snapshotAfter`, `changes`, `context`
- `createdAt`, `updatedAt`

### UI type contracts
`VersionHistoryConfig` (`packages/ui/src/backend/version-history/types.ts`):
```ts
{
  resourceKind: string
  resourceId: string
  resourceIdFallback?: string
  organizationId?: string
  includeRelated?: boolean
}
```

`VersionHistoryActionProps` (`packages/ui/src/backend/version-history/VersionHistoryAction.tsx`):
```ts
{
  config: VersionHistoryConfig | null
  t: TranslateFn
  buttonClassName?: string
  iconClassName?: string
  canUndoRedo?: boolean
  autoCheckAcl?: boolean
}
```

## API Contracts
### List history
`GET /api/audit_logs/audit-logs/actions`

Query params:
- `organizationId?: string`
- `actorUserId?: string` (effective only with tenant view permission)
- `resourceKind?: string`
- `resourceId?: string`
- `includeRelated?: 'true' | 'false'`
- `undoableOnly?: 'true' | 'false'`
- `limit?: string` (1..200)
- `before?: ISO datetime`
- `after?: ISO datetime`

Response:
```ts
{
  items: VersionHistoryEntry[]
  canViewTenant: boolean
}
```

### Undo
`POST /api/audit_logs/audit-logs/actions/undo`
- Body: `{ undoToken: string }`
- Requires `audit_logs.undo_self` (or tenant feature for cross-user target)

### Redo
`POST /api/audit_logs/audit-logs/actions/redo`
- Body: `{ logId: string }`
- Requires `audit_logs.redo_self` (or tenant feature for cross-user target)

### ACL / visibility behavior (actual)
1. Route metadata always requires `audit_logs.view_self`.
2. Route computes `canViewTenant` via `audit_logs.view_tenant`.
3. If `canViewTenant=false`, API enforces `actorUserId=auth.sub`.
4. If `canViewTenant=true`, caller may optionally filter by `actorUserId`; default is no actor filter.
5. UI additionally auto-checks features via `/api/auth/feature-check` and filters visible entries to current user when tenant view is unavailable.

## UI/UX
- Trigger: clock button in form/detail action area (`VersionHistoryAction`).
- Panel behavior:
  - right-side modal panel with list and detail mode.
  - child/related entries (`parentResourceKind != null`) are visually indented and labeled by `resourceKind`.
  - load-more pagination on demand.
- Undo/redo behavior:
  - undo is enabled only for latest undoable entry in visible scope.
  - redo is enabled only for latest undone entry in visible scope.
  - on successful undo/redo, page reloads to refresh data.

## Risks & Impact Review
#### Over-filtered timeline for users without tenant scope
- **Scenario**: User expects team history but sees only own entries.
- **Severity**: Low
- **Affected area**: UX expectations.
- **Mitigation**: In-panel notice clarifies self-only mode.
- **Residual risk**: Some confusion remains without admin onboarding.

#### Related entries increase list volume
- **Scenario**: `includeRelated=true` returns many child events.
- **Severity**: Medium
- **Affected area**: Panel performance/readability.
- **Mitigation**: Cursor pagination (`limit=20`, `before` cursor) and dedup in hook.
- **Residual risk**: Very active records can still require multiple load-more actions.

#### Undo/redo eligibility race
- **Scenario**: Another action invalidates latest undo/redo target before submission.
- **Severity**: Medium
- **Affected area**: Undo/redo reliability.
- **Mitigation**: Backend validates latest eligible target before execution.
- **Residual risk**: User may receive a recoverable `400` and retry.

## Final Compliance Report — 2026-02-17
### AGENTS.md Files Reviewed
- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| `AGENTS.md` | Tenant isolation must be enforced in API handlers | Compliant | Route scopes by tenant/org and ACL |
| `packages/core/AGENTS.md` | API routes export `openApi` | Compliant | Actions/undo/redo routes define OpenAPI docs |
| `packages/core/AGENTS.md` | ACL features must be module-declared | Compliant | `audit_logs` features include view/undo/redo self+tenant |
| `packages/ui/AGENTS.md` | Reuse shared patterns for panel/dialog and shortcuts | Compliant | Uses shared button/notice and panel pattern |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Spec matches current response fields including parent resource fields |
| API contracts match UI/UX section | Pass | Hook and panel use documented params/fields |
| Risks cover all write operations | Pass | Undo/redo race and volume risks documented |
| Commands/events coverage | Pass | Undo/redo command execution described |
| Cache strategy coverage | N/A | Feature reads directly from audit API without cache layer |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved — implementation is aligned.

## Changelog
### 2026-02-17
- Synced spec with current code: ACL visibility behavior, `includeRelated`, `parentResourceKind/parentResourceId`.
- Updated documented shapes for `VersionHistoryConfig` and `VersionHistoryAction`.
- Added explicit undo/redo behavior and compliance review.

### Review — 2026-02-17
- **Reviewer**: Codex Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: N/A
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved

### 2026-02-03
- Initial specification draft.
