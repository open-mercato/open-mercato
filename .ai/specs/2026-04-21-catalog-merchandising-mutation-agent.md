# Spec: Enable Mutations on Catalog Merchandising Assistant

**Date**: 2026-04-21
**Status**: Draft
**Module**: `catalog` + `ai-assistant`

## Problem

The `catalog.merchandising_assistant` agent already has four mutation tools defined, prompt sections describing mutation behavior, and the full pending-action approval UI — but ships as `readOnly: true` / `mutationPolicy: 'read-only'`. Mutations only activate when a tenant admin manually sets a mutation-policy override via the settings API. This means the flagship agent demo never shows mutations working out of the box.

## Goal

Flip the merchandising assistant to `mutationPolicy: 'confirm-required'` so it ships as a mutation-capable agent by default. Every write still routes through the pending-action approval card — the user always sees a diff and clicks Confirm before anything is written.

## Scope

### In Scope

1. Change agent declaration to `readOnly: false`, `mutationPolicy: 'confirm-required'`
2. Update agent `description`, `label`, and `dataCapabilities.operations` to reflect mutation capability
3. Update the `mutationPolicy` prompt section to remove the "read-only unless admin overrides" caveat
4. Add an `<AiChat>` trigger widget to the catalog products list page (if not already present)
5. Verify the end-to-end mutation flow works: propose -> preview card -> confirm -> result card
6. Integration test covering the golden path (single product update + bulk update)

### Out of Scope

- New mutation tools beyond the existing four
- Changes to the approval card UI
- Changes to the pending-action state machine
- Price-specific mutation safety rails (currency validation, margin checks)

## Existing Mutation Tools (Already Implemented)

| Tool | Type | Purpose |
|------|------|---------|
| `catalog.update_product` | Single | Update one product's title, description, attributes, or price |
| `catalog.bulk_update_products` | Bulk | Batch-update multiple selected products |
| `catalog.apply_attribute_extraction` | Single | Apply AI-extracted attributes to a product |
| `catalog.update_product_media_descriptions` | Single | Update alt-text / descriptions for product media |

All four tools already implement `loadBeforeRecord` / `loadBeforeRecords` for diff snapshots and `handler` for the actual write via commands. No new tool code is needed.

## Implementation

### Phase 1: Agent Declaration Change

**File**: `packages/core/src/modules/catalog/ai-agents.ts`

1. Change `merchandisingAgent`:
   ```typescript
   const merchandisingAgent: AiAgentDefinition = {
     // ...existing fields...
     description: 'Merchandising assistant: proposes and applies product descriptions, attribute extractions, title variants, and price adjustments for the current selection on the products list page.',
     readOnly: false,                        // was: true
     mutationPolicy: 'confirm-required',     // was: 'read-only'
     dataCapabilities: {
       entities: [
         'catalog.product',
         'catalog.product_media',
         'catalog.attribute_schema',
         'catalog.category',
       ],
       operations: ['read', 'search', 'update'],  // was: ['read', 'search']
     },
   }
   ```

2. Update the `mutationPolicy` prompt section (remove read-only caveat):
   ```
   MUTATION POLICY
   All writes route through the approval card. Never claim a change has been saved until you receive a mutation-result-card success outcome. For multi-record edits, always prefer the batch tool (catalog.bulk_update_products) so the user sees one approval card with per-record diffs instead of a stream of one-record approvals.
   ```

### Phase 2: AiChat Widget on Products List Page

**Check**: Verify `packages/core/src/modules/catalog/widgets/injection/` has a trigger widget injected into `data-table:catalog.products.list:header`. If not, scaffold one following the `customers` AI assistant trigger pattern:

- Widget client: `widgets/injection/ai-merchandising-trigger/widget.client.tsx`
- Widget meta: `widgets/injection/ai-merchandising-trigger/widget.client.meta.ts`
- Injection table entry mapping to `data-table:catalog.products.list:header`

The widget should:
- Pass `pageContext` with `view`, `recordId` (comma-joined selected IDs), and `extra.selectedCount` / `extra.totalMatching`
- Use `agent="catalog.merchandising_assistant"`
- Auto-focus the composer textarea when the sheet opens

### Phase 3: Verification

1. **Single product mutation flow**:
   - Open products list, select 1 product, open AI chat
   - Ask: "Make the description more compelling"
   - Agent calls `catalog.draft_description_from_attributes` (proposal)
   - Ask: "Apply this description"
   - Agent calls `catalog.update_product` -> pending-action created
   - MutationPreviewCard renders with field diff (description before/after)
   - Click Confirm -> ConfirmationCard -> MutationResultCard (success)
   - DataTable refreshes via `catalog.product.updated` event

2. **Bulk mutation flow**:
   - Select 3-5 products, open AI chat
   - Ask: "Increase all prices by 10%"
   - Agent calls `catalog.suggest_price_adjustment` (proposal)
   - Ask: "Apply these price changes"
   - Agent calls `catalog.bulk_update_products` -> pending-action created
   - MutationPreviewCard renders with per-record diffs
   - Click Confirm -> partial success case (if any version conflict)
   - MutationResultCard shows success count + any failed records

3. **Stale-version detection**:
   - Select 1 product, open AI chat, propose a title change
   - Before confirming, edit the product in another tab
   - Confirm -> 412 stale version error -> MutationResultCard shows conflict

## Migration & Backward Compatibility

- **No database migration** — agent declarations are code-only
- **No breaking change** — the mutation-policy override mechanism still works; tenant admins can override back to `read-only` if desired (the effective policy is always the most restrictive of code + override)
- **Feature gate** — mutations still require `catalog.products.manage` on the user's role ACL (declared in each mutation tool's `requiredFeatures`)
- **Rollback** — flip `readOnly: true` and `mutationPolicy: 'read-only'` back

## Integration Test Coverage

| Path | Test |
|------|------|
| `POST /api/ai_assistant/ai/chat?agent=catalog.merchandising_assistant` | Agent responds to product queries |
| Single product update via approval card | `catalog.update_product` -> pending action -> confirm -> product updated |
| Bulk update via approval card | `catalog.bulk_update_products` -> pending action -> confirm -> products updated |
| Stale-version rejection | Modify product between prepare and confirm -> 412 |
| Cancel pending action | Create pending action -> cancel -> status = cancelled |
| Read-only override | Tenant sets override to `read-only` -> mutation tools blocked |

## Acceptance Criteria

- [ ] Agent declaration ships with `mutationPolicy: 'confirm-required'`
- [ ] AI chat trigger widget visible on products list page header
- [ ] Single product update works end-to-end through approval card
- [ ] Bulk product update works end-to-end through approval card
- [ ] Stale-version detection rejects conflicting confirms with 412
- [ ] Tenant admin can override policy back to `read-only` to disable mutations
- [ ] Integration tests pass for golden path + error cases
