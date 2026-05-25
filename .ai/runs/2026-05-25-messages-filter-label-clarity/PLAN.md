# Plan — messages-filter-label-clarity

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Add tooltip support to FilterDef and FilterOverlay | done | d5e744ff4 |
| 2 | 2.1 | Update messages i18n locale files (all four locales) | done | f72639d02 |
| 2 | 2.2 | Wire new labels and tooltips in inboxFilters.ts | done | 3f07726f1 |
| 3 | 3.1 | Update TC-MSG-007 test scenario step text | done | f6d738882 |
| 3 | 3.2-test-fix | Add FilterOverlay tooltip rendering unit tests | done | 67febdbc7 |
| 3 | 3.3-test-repair | Fix inboxFilters.test.ts to use new label names and assert tooltip fields | done | 883b8d629 |

---

## Goal

Improve clarity of two Messages inbox filter labels for non-technical CRM users, and add contextual tooltip help text to both filters.

- "Has objects" → "Has related records"
- "Has actions" → "Has action requests"
- Add `tooltip?: string` to `FilterDef` and render it in `FilterOverlay`

## Source spec

`.ai/specs/2026-05-25-messages-filter-label-clarity.md`

## Scope

- `packages/ui/src/backend/FilterOverlay.tsx` — extend `FilterDef`, render tooltip icon
- `packages/core/src/modules/messages/i18n/{en,de,es,pl}.json` — update 2 values, add 2 tooltip keys each
- `packages/core/src/modules/messages/components/inboxFilters.ts` — update fallback strings, add tooltip fields
- `.ai/qa/scenarios/TC-MSG-007-search-and-filter-inbox.md` — update step text

## Non-goals

- No API changes (filter IDs `hasObjects`/`hasActions` unchanged)
- No i18n key renames (only string values change)
- No other modules or filters touched
- No database or entity changes

## Risks

- `FilterDef.tooltip` is an additive optional field — no existing call-sites break
- Machine-translated non-English tooltip strings may be slightly awkward; native-speaker review deferred to post-merge
- Inline `<svg>` at FilterOverlay line 215 is a pre-existing DS violation; not in scope of lines touched

## External References

None (`--skill-url` not used).

---

## Implementation Plan

### Phase 1 — FilterDef tooltip extension (packages/ui)

#### Step 1.1 — Add tooltip support to FilterDef and FilterOverlay

- Add `tooltip?: string` optional field to `FilterDef` type in `packages/ui/src/backend/FilterOverlay.tsx`
- Import `Info` from `lucide-react` and `SimpleTooltip` from `../primitives/tooltip`
- At line 223 (filter label render), replace `<div className="text-sm font-medium">{f.label}</div>` with a flex row that conditionally renders the `<SimpleTooltip>` + `<Info>` icon when `f.tooltip` is set
- DS: `Info` lucide icon, `size-3.5`, `text-muted-foreground`, `aria-label="More information"`

### Phase 2 — Messages i18n + filter wiring

#### Step 2.1 — Update messages i18n locale files (all four locales)

Update `en.json`, `de.json`, `es.json`, `pl.json`:
- Change `messages.filters.hasObjects` value to locale-appropriate "Has related records"
- Change `messages.filters.hasActions` value to locale-appropriate "Has action requests"
- Add `messages.filters.hasObjectsTooltip` with locale-appropriate tooltip copy
- Add `messages.filters.hasActionsTooltip` with locale-appropriate tooltip copy

New values per locale (from spec i18n section):
- en: "Has related records" / "Has action requests"
- de: "Hat verknüpfte Datensätze" / "Hat Aktionsanforderungen"
- es: "Tiene registros relacionados" / "Tiene solicitudes de acción"
- pl: "Ma powiązane rekordy" / "Ma żądania działań"

Tooltip en values:
- hasObjectsTooltip: "Shows messages that have Open Mercato records attached — such as orders, quotes, or customers."
- hasActionsTooltip: "Shows messages where one or more attached records require a response (approval, rejection, or review)."

#### Step 2.2 — Wire new labels and tooltips in inboxFilters.ts

In `packages/core/src/modules/messages/components/inboxFilters.ts`:
- Update `label` fallback string for `hasObjects` filter: `'Has related records'`
- Add `tooltip: t('messages.filters.hasObjectsTooltip', 'Shows messages that have Open Mercato records attached — such as orders, quotes, or customers.')`
- Update `label` fallback string for `hasActions` filter: `'Has action requests'`
- Add `tooltip: t('messages.filters.hasActionsTooltip', 'Shows messages where one or more attached records require a response (approval, rejection, or review).')`

### Phase 3 — Test scenario update

#### Step 3.1 — Update TC-MSG-007 test scenario step text

In `.ai/qa/scenarios/TC-MSG-007-search-and-filter-inbox.md`:
- Update step 4 from `"Apply 'Attachments = Yes' and 'Actions = Yes' filters"` to reference new label names: `"Apply 'Has attachments = Yes' and 'Has action requests = Yes' filters"`
