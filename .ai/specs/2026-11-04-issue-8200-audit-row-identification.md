# Audit row identification and reachable actions (issue #8200)

## TLDR
Operators need to identify the record and change before choosing an audit undo. The proposal adds snapshot-derived record names and compact summaries, seconds, translated states, and sticky row actions.

## Problem Statement
Issue #8200 reports indistinguishable organization updates and off-screen undo controls at 1280px. Source PR #7678 is merged; its commit 0b89c4f80033bd0cb5560d1bdba68cfde3fedca0 is an ancestor of baseline e5774a707321fe14867a19663bc486d7a001492d.

## Resolved assumptions (autonomous defaults)
| Question | Choice | Rationale |
| --- | --- | --- |
| Split the six requested details? | One audit-row identification capability. | Each detail supports choosing and applying the intended row action; no separate subsystem. |
| Resolve names through additional reads? | Use existing authorized snapshots, then ID fallback. | Avoid new coupling, scope expansion, historical-name drift and requests per row. |
| Unknown or sensitive changes? | Show a localized field count without raw values. | Do not promote arbitrary JSON, secrets, nested objects or failed-decryption ciphertext into table previews. |

## Overview
Scope is audit_logs only. Existing DataTable rowActions is the integration seam. No directory, shared UI, commands, registry or schema changes.

## Proposed Solution
Use the existing audit response and DataTable rowActions/stickyActionsColumn. Preserve all undo authorization, ordering and request payloads.

## Architecture
Add a pure module-local row presentation helper. Read only the authorized row's snapshotAfter then snapshotBefore; support root objects and the existing directory `view` wrapper. Prefer displayName/display_name, name, title or label; use a resource ID when no nonempty safe string exists. Display the original kind and ID as secondary identification.

Choose a deterministic recognized change (name/display name/title/label, parentId, status, isActive, slug), format primitive before/after values as one line, and append a localized count of additional changes. Null parent means root level. Parent references without names retain their IDs. Do not perform relationship lookups or recursively search arbitrary payloads. Unknown fields receive only a change count; missing changes receive the existing no-changes text. Limit each preview value to 120 characters, flatten whitespace, and use the listed field order as precedence. Use a browser-safe envelope check (no server crypto imports) and reject strings matching the existing encrypted payload shape. Render as React text, never HTML.

## Data Models
No entity, storage, encryption-map or migration changes. The existing scoped ActionLogService decryption and API response remain authoritative. Presentation introduces no cache or backend read.

## API Contracts
GET `/api/audit_logs/audit-logs/actions` is consumed unchanged. Existing POST undo (`undoToken`) and redo (`logId`) remain unchanged. No new endpoint or response property. Preserve permission checks, latest-per-resource eligibility, latest-undone eligibility, loading/error states and operation-store updates.

## UI/UX
- Resource primary line identifies the historical snapshot name; retain kind and ID in a secondary line. Nameless/legacy/encrypted snapshots use the existing kind + ID representation.
- Compact single-line change summary appears below the action, with bounded plain text and a title for the bounded summary.
- Move controls from the custom controls column to DataTable `rowActions` with `stickyActionsColumn`. Keyboard buttons retain accessible labels and receive matching titles; row actions do not open the details dialog.
- Row undo reads “Undo this action”; the toolbar keeps “Undo last action”.
- Format Time with seconds. Translate done, undone, failed and redone in all five audit module locales. Unknown states retain their raw value for compatibility.
- Use existing Button and DataTable, semantic muted text and standard scale widths. No new status colors or component variants.

## Frontend Architecture Contract
`backend/audit-logs/page.tsx` continues owning list state and API calls. The existing `AuditLogsActions` client island retains stateful selection and undo/redo loading state; its existing details dialog remains unchanged. The new helper has no client directive, side effects, browser dependencies or providers. No new page roots, global providers, heavy dependencies or bootstrap changes; moving controls out of columns keeps the existing component near its current size. Budget: zero new network requests, bounded work per displayed row (50 by default), zero new dependencies. Evidence: real DataTable component tests plus Playwright route load, sticky controls at 1280px, row-click/undo interactions, and configured build gate where environment permits.

## Edge Cases & Failure Scenarios
Missing snapshots, unrecognized wrapper shapes or removed records use the ID. An empty after-name can fall back to before-name. Malformed dates retain the supplied text. Encrypted or complex summary values receive a generic changed-field count; they are never serialized. Unknown execution states remain visible. Unauthorized buttons remain absent. Undo refusal continues to surface the server reason through the existing page callback.

## Risks & Impact Review
| Risk | Severity / area | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Wrong record name from payload traversal | Medium / audit decisions | Only root and known view wrapper; no context or undo payload reads | Unsupported shapes show ID |
| Sensitive JSON in summaries | High / data exposure | Positive field allowlist, primitive-only formatting, ciphertext exclusion, authorized response only | Display names remain visible to existing audit readers |
| Click triggers details instead of mutation | Medium / actions | Native DataTable rowActions and existing interaction regressions | Browser geometry needs live verification |
| Sticky controls overlap scroll content | Low / layout | Reuse existing shared sticky surface/shadow | Verify laptop viewport |

## Migration & Backward Compatibility
No public API, schema, ACL, event, command, import or write-contract changes. Existing translation keys retain meanings; add a row-specific undo key. Rollback is a client presentation revert, with no data repair.

## Implementation Plan
### Phase 1: Identify audit rows
1.1 Add safe row presentation helper and tests for wrapped snapshots, fallback, primitives and sensitive/ciphertext values.
1.2 Integrate names/summaries, seconds and all locale state labels.
### Phase 2: Reach and verify actions
2.1 Reuse sticky rowActions and retain undo/redo eligibility and row-click behavior.
2.2 Add self-contained integration coverage creating two organization records, renaming them, checking rows and undoing the intended action; run targeted and configured validation, independent review and UI evidence where available.

## Integration Coverage
One issue-specific audit_logs Playwright test creates records through the existing directory API, uses audit GET to isolate their log IDs, loads `/backend/audit-logs`, verifies distinct names and name changes, seconds and localized states, and invokes undo/redo on the selected row. Cleanup deletes fixtures in finally. Unit coverage guards generic ID fallback, unknown changes, encrypted payloads, multiple fields and button eligibility. API handlers are unchanged; existing audit read-scope and undo/redo route tests remain the authorization evidence.

## Final Compliance Report
Root/core/UI/backend/spec/QA guidance and BACKWARD_COMPATIBILITY were reviewed. Scope, tenant boundaries, encryption and public contracts are preserved because this is a projection of existing authorized responses. DataTable/Button, apiCallOrThrow, semantic tokens and localized copy are reused. No new CRUD, DI, cache, events or persistence contracts apply. Live validation remains an implementation gate, not a spec claim.

## Research and evidence limits
The existing DataTable guidance explicitly recommends stickyActionsColumn for this exact overflow case. External comparison with GitLab audit-event documentation was attempted but access redirected to an unavailable authentication endpoint. No external product behavior is assumed. This worktree has no test-environment descriptor or running app; current-screen screenshots/mockups are deferred until an isolated app is available.

## Changelog
- 2026-11-04: Initial autonomous specification for #8200. Security: bounded allowlisted previews; performance: no requests or dependencies; commands/cache unchanged; risks documented. Implementation and runtime evidence pending.

### Independent review — 2026-11-04
Approved with implementation limits by fresh-context spec reviewer: cohesive capability, snapshot-only boundary and positive allowlist accepted. Specify 120-character values, explicit-null handling, browser-safe ciphertext check and live 1280px undo/redo evidence. No source edits performed in review.
