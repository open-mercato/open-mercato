# SPEC-071: Product SEO Helper — Improve Validation Visibility

## Overview

Improve the visibility and user experience of Product SEO Helper validation when it blocks product save. Currently, the validation error appears only as a red toast at the top of the page and inside the SEO Helper widget in the sidebar — users must scroll to find what's wrong. The Description field is not marked as required despite being enforced by SEO validation.

**Reference:** Issue #948, Related: #901

---

## Problem Statement

1. **Hidden validation feedback** — When SEO Helper blocks save, the user sees a red toast ("SEO helper blocked save. Improve the highlighted fields.") but the actual issues are only visible inside the SEO Helper widget panel in the right sidebar. On smaller screens or when scrolled up, the widget is not visible.

2. **Description not marked as required** — The Description field has no `*` indicator, yet the product cannot be saved without it because SEO Helper enforces `description.trim().length > 0`.

3. **No inline field highlighting** — When SEO validation fails, the problematic fields (Title, Description) are not visually highlighted with red borders or inline error messages in the main form.

4. **Toast is too generic** — "Improve the highlighted fields" says highlighted, but no fields are actually highlighted in the main form area.

---

## Validation Contract

Formalize the `onBeforeSave` return type for injection widgets:

```typescript
export type InjectionBeforeSaveResult =
  | { ok: true }
  | {
      ok: false
      message?: string
      fieldErrors?: Record<string, string>
    }
```

**Behavior:**
- `ok: false` blocks save
- `message` is shown in toast
- `fieldErrors` are merged into CrudForm validation state
- First field error receives scroll/focus priority
- If no field-mapped error exists, scroll to widget container

**Field key constraint:** `fieldErrors` keys returned by injection widgets must use the same field path format consumed by CrudForm validation. If SEO widget returns `description`, the CrudForm field must also be keyed as `description`. Mismatched keys will silently fail to highlight.

---

## Proposed Solution

### 1. Inline Field Errors on Save Block

When `onBeforeSave` returns `{ ok: false, fieldErrors }`, CrudForm must consume those `fieldErrors` and merge them into the same field validation state used for standard server-side validation errors. Injection-originated field errors must render identically to server-originated field errors — same red border, same error text position, same clear behavior.

**Current flow:**
```
onBeforeSave → { ok: false, fieldErrors: { description: "..." } }
→ Red toast appears
→ SEO widget updates internally
→ Main form fields: NO visual change ❌
```

**Proposed flow:**
```
onBeforeSave → { ok: false, fieldErrors: { description: "..." } }
→ Red toast appears (keep)
→ SEO widget updates internally (keep)
→ Main form fields: red border + inline error message ✅ NEW
→ Auto-scroll to first errored field ✅ NEW
```

### 2. Multi-Source Error Merge

CrudForm must support field errors from multiple sources simultaneously:
- Server validation errors
- Injection widget A errors (e.g., SEO Helper)
- Injection widget B errors (future widgets)

**Merge rules:**
- Errors are merged by field key into the existing validation state
- If multiple sources return errors for the same field, the first blocking error is displayed
- All sources remain available for logging/debugging
- Save is blocked if any source returns `ok: false`

### 3. Error Clear Behavior

Injection-originated field errors clear on edit for the affected field, matching existing server-validation UX:
- User edits Description → Description inline error disappears immediately
- Full validation is re-evaluated on the next save attempt
- SEO widget internal state updates independently (via `subscribeProductSeoValidation`)

### 4. Mark Description as Required (metadata-driven)

**Decision:** Use widget metadata `requiredFields`. This keeps injection widgets self-describing and avoids catalog-specific hardcoding.

Add to injection widget metadata type:

```typescript
export interface InjectionWidgetMetadata {
  // ...existing fields
  requiredFields?: string[]
}
```

**Behavior:**
- CrudForm adds required marker `*` if any active widget declares that field required
- Required marker is present only while that widget is active/enabled
- Marker is visual only — enforcement still comes from `onBeforeSave` validation
- If base form already marks a field required, widget metadata does not change behavior
- Required fields from multiple widgets are unioned

**SEO Helper widget metadata update:**
```typescript
metadata: {
  // ...existing
  requiredFields: ['description']
}
```

### 5. Auto-scroll to First Error

When save is blocked:
- Auto-scroll prioritizes the first field in `fieldErrors`
- Use `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`
- If no field-mapped errors exist (widget returns only `message`, no `fieldErrors`), scroll to the blocking widget container

### 6. Improved Toast Message

Replace generic text with specific field-based issues:

**Format rules:**
- 1 issue: show exact issue
- 2–3 issues: list concise field-based issues
- >3 issues: summarize count and show first 2

**Examples:**
- `"SEO helper: Description is missing."`
- `"SEO helper: Description is missing. Title must be at least 10 characters."`
- `"SEO helper: 4 issues found. Description is missing. Title must be at least 10 characters."`

---

## Architecture

### Files to Modify

**`packages/shared/src/modules/widgets/injection.ts`**
- Add formal `InjectionBeforeSaveResult` type
- Add optional `requiredFields?: string[]` to `InjectionWidgetMetadata`

**`packages/core/src/modules/catalog/widgets/injection/product-seo/widget.ts`**
- Add `requiredFields: ['description']` to metadata
- Update `onBeforeSave` to return concise, field-specific `message`
- Keep `fieldErrors` as-is (already returns correct structure)

**`packages/core/src/modules/catalog/widgets/injection/product-seo/widget.client.tsx`**
- No changes needed (already displays issues correctly in the widget)

**`packages/ui/src/backend/` (CrudForm or form infrastructure)**
- Capture failed `onBeforeSave` result from injection widgets
- Merge `fieldErrors` into form validation state (same pipeline as server errors)
- Trigger same rendering path as server errors
- Scroll to first errored field, fall back to widget container if no field target
- Read `requiredFields` from active widget metadata, add `*` to matching fields

### Impact Analysis

- **Injection widget system** — additive changes to types. Existing widgets without `fieldErrors` or `requiredFields` continue working unchanged.
- **CrudForm** — needs to accept `fieldErrors` from injection widget results, not just from server responses. This reuses the existing error rendering pipeline.
- **Catalog module** — only the SEO widget metadata and message are updated.
- **UMES events** — no new events needed.
- **Database** — no migrations required.

---

## Acceptance Criteria

### Functional
1. When SEO Helper blocks save with `fieldErrors.description`, the Description field shows error styling and inline message in the main form.
2. When SEO Helper blocks save with `fieldErrors.title`, the Title field shows error styling and inline message in the main form.
3. The existing SEO widget continues to display its internal issue list.
4. The toast still appears with specific field-based message.
5. The form scrolls to the first errored field if it is off-screen.
6. If no field-mapped errors exist, the page scrolls to the SEO Helper widget.
7. Description shows a required indicator `*` while SEO Helper is active and declares it required.
8. Injection widgets that do not return `fieldErrors` continue working without changes.

### UX Behavior
9. Editing an errored field clears its visible inline error state immediately.
10. Re-saving re-runs SEO validation and re-adds errors if still invalid.
11. The toast message references actual failing fields rather than "highlighted fields" generically.

### Non-regression
12. Standard server-side validation styling and behavior remain unchanged.
13. Multiple injection widgets can return `fieldErrors` without crashing or dropping standard validation errors.
14. Disabling SEO Helper removes the `*` from Description and stops validation blocking.

---

## Alternatives Considered

### A. Move validation from SEO Helper to standard form validation
**Rejected** — SEO Helper is an injection widget (example/demo). Moving its logic to core form validation defeats the purpose of the injection system.

### B. Show all SEO issues only in the toast
**Rejected as sole solution** — toast disappears after a few seconds. Inline field errors persist and are scannable.

### C. Remove save-blocking behavior, make SEO Helper warning-only
**Out of scope** — configurable `blockSave: true/false` in widget metadata is a separate concern. Fix visibility first.

### D. Create parallel "widget validation" display path
**Rejected** — reuse the existing form error mechanism. No separate rendering for injection widget errors.

---

## Implementation Phases

### Phase 1: Validation Contract + Inline Field Errors (highest impact)
- Add `InjectionBeforeSaveResult` type to `packages/shared`
- Propagate `fieldErrors` from `onBeforeSave` to CrudForm field state
- Red border + error message under Title/Description when SEO blocks save
- Define merge behavior for multiple error sources
- Clears on field edit, re-validates on next save

### Phase 2: Required Indicator
- Add `requiredFields` to `InjectionWidgetMetadata`
- Add `requiredFields: ['description']` to SEO Helper metadata
- CrudForm reads metadata and adds `*` to declared fields

### Phase 3: Auto-scroll
- On save block, scroll to first field with error
- Fall back to widget container if no field-mapped errors

### Phase 4: Improved Toast
- Update SEO Helper `onBeforeSave` message to include specific fields
- Apply toast format rules (1 issue / 2-3 issues / >3 issues)

---

## Open Questions

1. **Field key mapping** — Does CrudForm use flat field names (`description`) or nested paths (`content.description`)? If nested, SEO Helper must return matching keys. Verify before implementation.

---

## Changelog

### 2026-04-06
- Initial specification
- Incorporated review feedback: formalized validation contract, multi-source merge rules, error clear behavior, metadata-driven required fields, acceptance criteria
