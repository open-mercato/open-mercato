# Execution plan — DataTable `showQueryTime` opt-out (FR #5304)

## Goal

Give `DataTable` an additive, opt-out `showQueryTime` prop so a list page can suppress the
footer's "… in 142ms" query-duration suffix, without changing behaviour for any existing
call site.

## Scope

- `packages/ui/src/backend/DataTable.tsx` — add `showQueryTime?: boolean` to `DataTableProps`,
  default it to `true`, and gate the footer's duration label on it.
- A unit test pinning **both** branches of the footer string.

### Non-goals

- No environment-dependent default (issue #5304 explicitly leaves "on in dev, off in prod"
  as a separate, later decision; this PR keeps the default `true` everywhere).
- No new locale keys — the `false` branch reuses the existing
  `ui.dataTable.pagination.results` key that the footer already falls back to when no
  duration is available.
- No call-site changes anywhere in the product; the prop is purely additive.

## Backward compatibility

`BACKWARD_COMPATIBILITY.md` classifies `DataTable` component props (§3, `@open-mercato/ui/backend`)
as **MUST NOT remove existing props** — an additive optional prop is permitted with no
deprecation protocol. No existing prop changes shape, and the default preserves today's
rendering exactly.

## Implementation Plan

### Phase 1: Prop and footer gate

- 1.1 Add `showQueryTime?: boolean` to `DataTableProps` with a doc comment, and destructure
  it in the `DataTable` component with a `= true` default.
- 1.2 Gate the footer's `durationLabel` on the prop so a `false` value renders the
  count-only `ui.dataTable.pagination.results` string, and add the prop to the footer
  memo's dependency array.

### Phase 2: Test coverage

- 2.1 Add a test that pins both branches: with a `pagination.durationMs` supplied, the
  default renders the duration and `showQueryTime={false}` renders the count-only string.

## Risks

- Low. The change is one conditional in a memoized footer renderer. The only real risk is
  forgetting the memo dependency, which would make a runtime toggle of the prop stale —
  covered by adding `showQueryTime` to the dependency list in step 1.2.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Prop and footer gate

- [ ] 1.1 Add the prop to DataTableProps and destructure with a true default
- [ ] 1.2 Gate the footer duration label and update the memo dependencies

### Phase 2: Test coverage

- [ ] 2.1 Add a test pinning both the on and off footer branches
