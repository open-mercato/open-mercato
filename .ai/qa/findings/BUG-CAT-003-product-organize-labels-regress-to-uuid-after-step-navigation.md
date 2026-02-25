# BUG-CAT-003: Product Organize Labels Regress to UUID After Step Navigation

## Summary
In product create flow, selected values in `Organize` step are rendered as UUIDs instead of human-readable labels after navigating away and back (`Continue` to next step, then `Previous`).

## Severity
Major

## Area
Catalog / Products / Create Form / Organize Step

## Reproducible Steps
1. Open `/backend/catalog/products/create`.
2. Fill `General data` fields and go to `Organize`.
3. Select category from categories picker.
4. Select sales channel from channels picker.
5. Move to next step (`Continue` / `Variants`).
6. Return to `Organize` with `Previous`.

## Actual Result
- Selected chips in `Categories` and `Sales channels` show UUID values.
- Human-readable names are lost after step navigation.

## Expected Result
- Selected chips should keep readable labels (category name, channel name) after returning to `Organize`.
- UUID should remain internal value only, never displayed as user-facing label.

## Evidence
- Failing test: `packages/core/src/modules/catalog/__integration__/TC-CAT-015.spec.ts`
- Failure message confirms UUID rendered in categories section instead of fixture name.
- Error context shows both fields as UUID:
  - Categories: `645406ec-a2d9-45cc-b9d6-2defe7cce484`
  - Sales channels: `4a8a8c0b-c4a1-40d5-8c09-f4da58281a48`
- Screenshot: `.ai/qa/tests/.ai/qa/test-results/artifacts/packages-core-src-modules--5893c-s-after-Continue---Previous/test-failed-1.png`
- Error context: `.ai/qa/tests/.ai/qa/test-results/artifacts/packages-core-src-modules--5893c-s-after-Continue---Previous/error-context.md`

## Triage Classification
- Type: Product bug
- Regression test: `packages/core/src/modules/catalog/__integration__/TC-CAT-015.spec.ts`

## Status
Fixed. `categoryOptionsMap` / `channelOptionsMap` lifted to `ProductBuilder` via
`onCategoryOptionsResolved` / `onChannelOptionsResolved` callbacks with upsert merge.
Remount seeded via `initialCategoryOptions` / `initialChannelOptions` props + lazy `useState`
initializer in `ProductCategorizeSection`. TC-CAT-015 passes.
