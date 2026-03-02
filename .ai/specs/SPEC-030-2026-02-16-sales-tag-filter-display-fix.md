# SPEC-030: Sales Document Tag Filter Display Fix

## TLDR
Fixed a bug where sales quote and order filters displayed tag UUIDs instead of tag names (labels). Added `formatValue` and `formatDescription` to the `tagIds` filter definition, ensuring proper name resolution in filter UI and filter bar.

## Overview
When filtering sales quotes and orders by tags, the filter UI incorrectly displayed tag UUIDs (e.g., `550e8400-e29b-41d4-a716-446655440000`) instead of human-readable tag names (e.g., "Urgent"). This issue #238 prevented users from easily understanding which tags were selected.

## Problem Statement
- **Symptom**: In the sales quotes/orders list page, when using the Tags filter, selected tags show their UUID instead of label
- **User Impact**: Users cannot easily identify which tags are being filtered
- **Root Cause**: The `tagIds` filter in `SalesDocumentsTable.tsx` lacked `formatValue` and `formatDescription` functions, while other similar filters (e.g., `customerId`) had them
- **Scope**: Affects `/backend/sales/quotes` and `/backend/sales/orders` filter UI

## Proposed Solution
Add `formatValue` and `formatDescription` functions to the `tagIds` filter configuration that:
1. Resolve tag IDs to their labels using the cached `tagOptions`
2. Resolve tag descriptions for better UX
3. Ensure tag names display in both:
   - Filter overlay (when selecting tags)
   - Filter bar (when tags are applied)

## Architecture
The fix leverages existing architecture patterns:

```
SalesDocumentsTable.tsx
├── fetchTagOptions() → /api/sales/tags API
├── loadTagOptions() → merges/caches options
├── tagOptions state → stores ID → label mapping
└── filterDefs.tagIds
    ├── formatValue: (val: string) => tagOptions.find(opt => opt.value === val)?.label
    ├── formatDescription: (val: string) => tagOptions.find(opt => opt.value === val)?.description
    └── [Consumed by FilterOverlay & FilterBar]
```

Flow:
1. User opens filter overlay
2. `FilterOverlay` renders `TagsInput` with `resolveLabel` callback
3. Callback uses `formatValue` to resolve UUID → label
4. User applies filter
5. `FilterBar` uses `formatValue` to display selected tags as labels
6. Tag names persist in filter bar until cleared

## Data Models
No data model changes. The fix works with existing entities:
- `SalesDocumentTag` (id, label, description)
- `SalesDocumentTagAssignment` (tag_id, document_id, document_kind)

## API Contracts
No API changes. The `/api/sales/tags` endpoint already returns:
```typescript
{
  id: string (UUID)
  label: string
  description?: string | null
  color?: string | null
  slug: string
}
```

## UI/UX
**Before**: Filter shows "550e8400..." (UUID)
**After**: Filter shows "Urgent" (label)

Both `FilterOverlay` (during selection) and `FilterBar` (after apply) now display tag labels via the `formatValue` callback.

## Configuration
No configuration changes required.

## Alternatives Considered
1. **Backend solution**: Modify API to return tag names in filter query results - rejected because API is working correctly; issue is UI-side resolution
2. **Cache in localStorage**: Store tag mappings globally - rejected because component-level state caching via `mergeOptions` is sufficient
3. **Duplicate requests**: Re-fetch tags each time filter is accessed - rejected as inefficient; `tagOptions` state already maintains cache

## Implementation Approach
1. ✅ Extended `FilterOption` type to include optional `description` field
2. ✅ Modified `fetchTagOptions` to extract and return tag description from API response
3. ✅ Added `formatValue` to `tagIds` filter to resolve ID → label
4. ✅ Added `formatDescription` to `tagIds` filter to resolve ID → description
5. ✅ Created integration test (TC-SALES-020) to validate tag filter display

## Migration Path
No migration needed. The fix is backward-compatible:
- Existing filter URLs with `tagIds=uuid1,uuid2` continue to work
- Tag names are now properly displayed in the UI
- Cache mechanism remains unchanged

## Success Metrics
- ✅ Filter overlay displays tag labels when selecting tags
- ✅ Filter bar displays tag labels after applying filter
- ✅ Tag descriptions appear in suggestions (if populated)
- ✅ Multiple tag selection works correctly
- ✅ Filter persists through navigation and page reload
- ✅ Integration test (TC-SALES-020) passes

## Open Questions
1. Should tag colors also be displayed in filter UI? (Out of scope for this fix)
2. Should we add a "tag management" link in the filter overlay? (Future enhancement)
3. Should deleted tags be handled gracefully in existing filters? (Edge case for future investigation)

## Risks & Impact Review

### Risk: Cache Invalidation
**Scenario**: User creates new tag → filter overlay doesn't show it  
**Severity**: Medium  
**Mitigation**: `loadTagOptions` callback merges new options into cache  
**Residual Risk**: Low (cache is merged, not replaced)

### Risk: Performance
**Scenario**: Large number of tags (100+) in filter  
**Severity**: Low  
**Mitigation**: API already paginates at 50 per page; `mergeOptions` uses Map for O(1) lookups  
**Residual Risk**: Very low

### Risk: Stale Cache
**Scenario**: Tag label updated → old name still displays in filter  
**Severity**: Very low  
**Mitigation**: Component state persists per session; refresh resets cache  
**Residual Risk**: Low (acceptable for typical session duration)

## Final Compliance Report
✅ All filter display issues resolved  
✅ No breaking changes to APIs or data models  
✅ Backward compatible with existing filter URLs  
✅ Integration test added (TC-SALES-020)  
✅ Follows existing patterns from `customerId` filter  
✅ No performance degradation  

## Changelog

### 2026-02-16
- Fixed tag filter display showing UUIDs instead of labels
- Added `formatValue` and `formatDescription` to tagIds filter
- Extended FilterOption type to support description field
- Created TC-SALES-020 integration test for tag filtering
- Committed to `develop` branch (commit `43e49b22`)
