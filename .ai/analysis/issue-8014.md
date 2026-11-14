Summary: Replacement-order undo mistakes initial order approval for a later edit, and audit replay errors expose translation keys.

Root cause: The replacement bridge in warranty_claims/commands/claims.ts compares only the new sales order's updated_at. sales/workflows.ts initializes that order's status through sales.orders.update, advancing its version. Audit replay routes forward CrudHttpError bodies without translateCrudErrorBody.

Files to change:
- packages/core/src/modules/warranty_claims/commands/claims.ts and lib/replacementOrderUndo.ts — accept only a proven initial pending-approval update between the exact saved and current versions.
- packages/core/src/modules/sales/commands/documents.ts — include the order version in audit snapshots so the exception has a verifiable version chain.
- packages/core/src/modules/audit_logs/api/audit-logs/actions/{undo,redo}/route.ts — translate domain error bodies with the existing helper.
- Relevant command, helper, route, and integration tests — cover initial approval, genuine edits, missing evidence, scope, and localized errors.
- Existing warranty spec — document the bounded approval exception and compatibility limits.

Approach: Preserve the timestamp fast path and fail closed on missing evidence. Read decrypted, tenant/org-scoped audit entries through ActionLogService. Permit only a single initial null-to-pending_approval update whose before/after versions match and whose order data otherwise remains unchanged. Keep normal sales commands, approval workflow behavior, claim guards, and routes intact.

Risks: Historical sales snapshots without versions cannot prove the exception and retain the strict timestamp guard. Approval initialization includes an automatic status note. Redo must discard the original claim version while preserving request-level optimistic locking. No schema, endpoint, event, or ACL changes.
