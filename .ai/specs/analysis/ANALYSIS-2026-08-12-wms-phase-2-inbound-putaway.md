# Pre-Implementation Analysis: WMS Phase 2 — Inbound and Putaway

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Spec** | `.ai/specs/2026-04-15-wms-phase-2-inbound-putaway.md` |
| **Branch context** | `feat/388-wms-phase-2` (= `upstream/develop` with Phase 1 WMS merged) |
| **Related** | Issue #388, `.ai/specs/2026-04-15-wms-roadmap.md`, `.ai/specs/2026-04-15-wms-phase-1-core-inventory.md` |

## Executive Summary

The April Phase 2 draft is structurally complete enough to implement (entities, APIs, UI paths, tests, risks), but it was written **before Phase 1 landed in `develop`**. Critical remediations: reconcile with existing ad-hoc `wms.inventory.receive` / move-`putaway` paths, treat `wms.receive_inventory` as already shipped (not net-new ACL), align inventory **undo policy** with Phase 1 (`isUndoable: false` + counter-actions), and gate procurement on the existing `wms_integration_procurement_goods_receipt` toggle. After those updates land in the spec (rev 4), Phase 2 is ready to implement story-by-story.

**Recommendation:** Needs spec updates first (applied in the same changelog rev) → then Ready to implement.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | ACL features | Spec lists `wms.receive_inventory` as a Phase 2 addition; feature **already exists** in `acl.ts`, `roleFeatures.ts`, receive API, and operator defaults | Warning | Document as **extend semantics** (ASN line + QC), not introduce; only add `wms.manage_asn` + `wms.manage_putaway` as net-new |
| 2 | Event IDs | Spec introduces `wms.asn.*` / `wms.putaway.*` / `wms.inventory.receipt_qc_failed` while `wms.inventory.received` already exists for ad-hoc receive | Warning | Keep both: ad-hoc receive continues to emit `wms.inventory.received`; ASN path emits `wms.asn.line_received` (+ may also emit `wms.inventory.received` when stock increases, or document single emission — pick one in spec) |
| 3 | API route URLs | Spec must not rename/remove `POST /api/wms/inventory/receive` or move-with-`putaway` | Critical if broken | Explicit coexistence: ASN routes are additive; P1 receive/move remain supported shortcuts |
| 4 | Function / command contracts | Spec undo text conflicts with Phase 1 inventory undo policy (append-only ledger, `isUndoable: false`) | Critical | Adopt Phase 1 undo policy for stock-affecting receive/putaway commands; counter-actions instead of generic undo |
| 5 | DI / feature toggles | Spec consumes `procurement.goods_receipt.created` without referencing existing toggle `wms_integration_procurement_goods_receipt` (default **false**) | Warning | Subscriber must no-op when toggle off or procurement module absent (`tryResolve`) |

### Missing BC Section

Spec has **Migration & Compatibility** but it does not mention coexistence with shipped Phase 1 receive/putaway surfaces. Rev 4 expands that section.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Phase 1 coexistence / dual-path receive | Implementers may delete or duplicate P1 receive | Add dedicated subsection (done in rev 4) |
| Optimistic locking | New editable entities need `updated_at` + UI/command headers | Require `updated_at` (already in global columns) + CrudForm / `enforceCommandOptimisticLock` on mutating action endpoints |
| Search config | ASN/putaway lists may lack search | Add `search.ts` entity entries for `Asn` and optionally `PutawayTask` in Story 1–2 |
| Cache invalidation | Stale `_wms.inboundSummary` / ASN lists | Document indexer + cache tags on ASN/putaway writes |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Barcode-scan endpoints | Names only; no request/response schemas | Add minimal zod contracts in rev 4 |
| QC fail → stock | “No available stock” but quarantine location unclear | Fail = audit + line `qc_status=failed`; **no** balance increase; **no** putaway task; quarantine location deferred |
| Putaway rules (fixed/dynamic from #388) | Thin | MVP: auto-create open task after QC pass; target confirmed on complete; directed rules deferred |
| Commands vs existing `wms.inventory.receive` | Unclear reuse | ASN receive shares ledger helpers; does not replace ad-hoc command |
| Sales re-evaluation | “may trigger” vague vs existing `re-run-reservation` / automation | Wire subscribers to existing automation when sales integration toggle is on |
| Problem Statement | Claims P1 cannot enforce tracking / sales blind — partially obsolete | Soften wording to “no ASN expected vs accepted pipeline” |
| Undo expectations | Conflicts with P1 | Rewrite per inventory mutation undo policy |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| No cross-module ORM; optional peers via tryResolve | Procurement subscriber | No-op when module/toggle absent |
| ACL features mirrored in `setup.ts` `defaultRoleFeatures` | ACL section | Add `manage_asn` / `manage_putaway` to supervisor (and document operator keeps `receive_inventory`) |
| Optimistic locking default ON for editable entities | Data models | Keep `updated_at`; list/detail return `updatedAt`; action routes send lock headers |
| Inventory commands undo policy (module comment in `inventory-actions.ts`) | Undo expectations | Align spec with `isUndoable: false` + counter-actions |
| Mutation guards on custom write routes | Custom action endpoints | Spec must require `runMutationGuards` / command bus pattern used by existing WMS custom POSTs |
| Encryption | ASN `notes`, rejection reasons | Evaluate whether free-text needs `encryption.ts` maps; if PII-adjacent vendor notes, declare maps |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Dual receive paths diverge (ad-hoc vs ASN) | Inconsistent ledger metadata / UX confusion | Shared helper for movement+balance; clear UI labels (Receive vs Receive ASN) |
| Spec undo vs P1 ledger policy | Broken undo or ledger corruption | Follow P1 policy; document counter-actions |
| Premature availability on QC fail | Bad stock promised to sales | Only QC-passed qty writes balances; tests WMS-P2-INT-03 |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Sales reservation lag | Backorders not cleared | Subscriber on `wms.asn.line_received` / `wms.putaway.completed` → existing re-eval path |
| Procurement bridge enabled too early | Half-built ASN spam | Toggle defaults false; subscriber gated |
| Putaway without capacity rules | Overfilled bins | Validate active location + type; capacity soft-check deferred |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Scan API under-specified | Rework later | Ship minimal resolve/receive/putaway schemas in Story 1–2 |
| Extra `/backend/wms/receiving` vs ASN detail | Duplicate UX | Prefer ASN detail as primary receive surface; receiving queue can filter open ASNs |

## Gap Analysis

### Critical Gaps (Block Implementation)

- Phase 1 coexistence contract for `POST /api/wms/inventory/receive` and move-`putaway`
- Undo policy alignment with Phase 1 inventory mutations
- ACL: `receive_inventory` already shipped; only add `manage_asn` + `manage_putaway`

### Important Gaps (Should Address)

- Procurement toggle + absent-module no-op
- Scan endpoint request/response shapes (minimal)
- QC-fail stock semantics (no balance, no putaway task)
- Sales re-eval wiring to existing automation
- Optimistic lock on new entities / action endpoints
- Search + indexer for ASN / putaway lists

### Nice-to-Have Gaps

- Directed putaway rules engine (fixed/dynamic)
- Quarantine location type behavior
- Mobile scanner shell UI
- Dedicated `/backend/wms/receiving` vs ASN-detail-only MVP

## Remediation Plan

### Before Implementation (Must Do)

1. Apply **rev 4** updates to the Phase 2 spec (coexistence, ACL, undo, procurement toggle, QC, scan stubs, sales re-eval).
2. Keep Status = Draft until Story 1 lands; do not claim `implemented/` until Stories 1–4 + INT coverage complete.

### During Implementation (Add to Spec)

1. Changelog each story with exact routes/commands/tests added.
2. Record whether ASN receipt dual-emits `wms.inventory.received`.
3. Note any deferred putaway-rule engine as follow-up issue.

### Post-Implementation (Follow Up)

1. Move spec to `.ai/specs/implemented/` when Done.
2. Update roadmap checklist / issue #388 for M2 inbound items.
3. Consider deprecating ad-hoc receive UI copy once ASN flow is default (not remove API).

## Recommendation

**Needs spec updates first** → remediations applied in changelog rev 4 on the same day → **Ready to implement** Story 1 (ASN + ReceivingLine) on `feat/388-wms-phase-2`.

## Codebase anchors (Phase 1 already present)

| Anchor | Path / ID |
|--------|-----------|
| Ad-hoc receive command/API | `wms.inventory.receive`, `api/inventory/receive/route.ts` |
| Event | `wms.inventory.received` |
| ACL | `wms.receive_inventory` (operator + supervisor) |
| Manual putaway | `MoveInventoryDialog` `movementType: 'putaway'` |
| Sales re-run | `api/sales-orders/[id]/re-run-reservation`, `salesOrderInventoryAutomation.ts` |
| Procurement toggle | `wms_integration_procurement_goods_receipt` (default false) |
| Entities today | Warehouse*, Profile, Lot, Balance, Reservation, Movement, SalesOrderWarehouseAssignment — **no Asn/ReceivingLine/PutawayTask** |
