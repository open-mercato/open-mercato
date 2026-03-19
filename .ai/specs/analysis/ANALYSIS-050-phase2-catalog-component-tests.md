# Pre-Implementation Analysis: SPEC-050 Phase 2 — Component Interaction Unit Tests

## Executive Summary

Phase 2 is **ready to implement** with zero blockers. This phase adds only test files — no runtime code, no API changes, no DB migrations, no BC concerns. All 8 source components exist and haven't changed since the spec was written. The existing `catalogComponentsRender.test.tsx` provides a proven mock setup pattern to follow.

## Backward Compatibility

### Violations Found

None. Phase 2 adds test files only — no contract surfaces are touched.

### Missing BC Section

N/A — not required for test-only changes.

## Spec Completeness

### Missing Sections

None relevant. The spec covers all necessary detail for test-only work.

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Step 2.2 (CategorySlugFieldSync) | Component returns `null` — spec says "8 test cases" but interactions are effect-based, not DOM-based | Test via `setValue` mock assertions instead of DOM queries. May yield fewer than 8 meaningful cases (~5-6 realistic). |
| Step 2.4 (VariantBuilder) | Spec says ~15 test cases but component has 6 sub-sections each with distinct props | Prioritize BasicsSection and PricesSection which have the most user interactions. Some sections (Media, Metadata) delegate to sub-components tested separately. |
| Step 2.5 (ProductMediaManager) | Component calls `apiCall()` with FormData for uploads | Need to mock `FormData` in jsdom or test upload logic via callback assertions rather than real FormData construction. |
| Step 2.6 (PriceKindSettings) | Component uses `useConfirmDialog()` and `useCurrencyDictionary()` — not mentioned in spec mock list | Add these to shared mock setup. Reference test already mocks both. |

## AGENTS.md Compliance

### Violations

None. Test files follow established conventions:
- Location: `__tests__/` directories colocated with source
- Naming: `*.test.tsx` pattern
- Environment: `@jest-environment jsdom` pragma
- No `any` types — mocks use `jest.Mock` casts
- No hardcoded strings in assertions (use translation keys or mock return values)

## Risk Assessment

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Mock drift — component APIs may have changed since spec was written | False positives in tests | Verified all 8 components exist with expected exports. TypeScript compilation catches shape mismatches. |
| `CategorySlugFieldSync` returns null — harder to test with RTL | Fewer meaningful test cases than spec estimates | Test effects via `setValue` mock calls and ref behavior. Accept ~5-6 cases instead of 8. |
| `ProductMediaManager` uses FormData + file upload | jsdom FormData support is limited | Mock `apiCall` at boundary level, don't test actual FormData construction. |
| `PriceKindSettings` is the most complex component (~300 lines, full CRUD dialog) | May need more careful mock setup | Follow existing `catalogComponentsRender.test.tsx` patterns which already test this component's render. |

### No High or Medium Risks Identified

## Gap Analysis

### No Critical Gaps

### Important Gaps (Should Address During Implementation)

- **`useConfirmDialog` mock**: Not listed in spec's shared mock setup but needed by PriceKindSettings and CategoriesDataTable. Already mocked in reference test.
- **`useCurrencyDictionary` mock**: Needed by PriceKindSettings. Already mocked in reference test.
- **`slugify` mock/import**: Needed by CategorySlugFieldSync. Can use real function (pure, no side effects) or mock for controlled output.
- **`#generated/entities.ids.generated` mock**: VariantBuilder imports entity IDs. Need moduleNameMapper or mock.
- **`buildAttachmentImageUrl` mock**: Needed by ProductMediaManager. Already mocked in reference test.

### Nice-to-Have Gaps

- Spec doesn't specify exact assertion patterns (getByRole vs getByText vs getByTestId). Follow reference test patterns.

## Component Complexity Ranking (Implementation Order Suggestion)

| Priority | Component | Complexity | Est. Test Cases | Notes |
|----------|-----------|-----------|----------------|-------|
| 1 | CategorySlugFieldSync | Low | ~5-6 | Effects-only, no DOM output |
| 2 | ProductCategorizeSection | Low | ~10 | 3 TagsInput fields, straightforward |
| 3 | MetadataEditor | Medium | ~15 | State management, entry CRUD |
| 4 | CategorySelect | Medium | ~10 | Async fetch, select behavior |
| 5 | ProductMediaManager | Medium | ~12 | Upload/delete, drag-drop |
| 6 | CategoriesDataTable | Medium-High | ~10 | Full DataTable + permissions |
| 7 | VariantBuilder | High | ~15 | 6 sub-sections, many props |
| 8 | PriceKindSettings | High | ~12 | Full CRUD dialog + DataTable |

## Remediation Plan

### Before Implementation (Must Do)

1. **Verify jest + jsdom work**: Run existing `catalogComponentsRender.test.tsx` to confirm test infra is functional.
2. **Create `categories/__tests__/` directory**: Doesn't exist yet, needed for CategorySlugFieldSync and CategorySelect tests.

### During Implementation (Add to Spec)

1. **Add `useConfirmDialog` and `useCurrencyDictionary` to shared mock list** in spec Phase 2 section.
2. **Add `#generated/entities.ids.generated` mock** to shared mock list.
3. **Adjust CategorySlugFieldSync test count** from ~8 to ~5-6 given null-return component.

### Post-Implementation (Follow Up)

1. **Update spec Implementation Status** table to mark Phase 2 as Done.
2. **Run `yarn test --filter=@open-mercato/core`** to verify all Phase 1 + Phase 2 tests pass together.

## Recommendation

**Ready to implement.** No spec updates required before starting. Minor gaps (additional mocks) can be addressed inline during implementation.
