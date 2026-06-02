# CrudForm initial focus without open-state flicker

**Status:** draft
**Owner:** ui
**Date:** 2026-05-09
**Tracking issue:** [open-mercato/open-mercato#1820](https://github.com/open-mercato/open-mercato/issues/1820)

## TLDR
`CrudForm` still needs mount-time autofocus for ordinary forms, but hosts must be able to suppress that autofocus while async data is loading. When autofocus is enabled again, the first eligible field should gain focus without causing focus-driven controls such as comboboxes or tag pickers to flash their own suggestion UI.

This spec covers:
- a host-controlled `disableInitialFocus` flag on `CrudForm`
- preserving mount autofocus once data is ready
- guarding controls with their own open-on-focus behavior so the first programmatic focus does not briefly open and close their popup state

## Overview
The original bug report was not about removing autofocus altogether. The problem is narrower:

1. the host sometimes renders `CrudForm` before its record data is ready
2. `CrudForm` applies mount autofocus as soon as it can
3. some inputs, especially `combobox` and similar suggestion-driven controls, open their UI on focus
4. the initial programmatic focus therefore creates a flicker or flash during the loading transition

The intended solution is to let the host delay initial focus until loading is finished, while still keeping the default focus behavior for normal forms.

## Problem Statement
`CrudForm` currently assumes that the first eligible field should be focused during mount. That behavior is correct for plain text inputs, but it is too eager for forms whose first interactive field is a control with its own focus/open lifecycle.

Concrete failure mode:
- host mounts the form with loading data
- `CrudForm` focuses the first eligible field
- a control like `ComboboxInput` reacts to focus by showing suggestions
- the form then re-renders as data settles, and the control state changes again
- the user sees a short flash or open/close flicker

The fix must preserve:
- autofocus for normal forms
- autofocus after async data has loaded
- autofocus after validation errors, when appropriate

The fix must avoid:
- forcing open-state controls to flash on first mount
- requiring every host page to hand-roll focus management

## Proposed Solution
1. Add `disableInitialFocus?: boolean` to `CrudForm`.
2. When `disableInitialFocus` is true, suppress mount-time autofocus entirely.
3. When the host flips `disableInitialFocus` back to false after data has loaded, `CrudForm` may autofocus the first eligible field.
4. Keep the first-focus behavior for normal inputs unchanged.
5. Audit controls with their own open-on-focus behavior and suppress the initial programmatic open path only on the first mount focus.

## Architecture
### `CrudForm`
- Add the `disableInitialFocus` prop to the public props type.
- Use it in the mount autofocus effect and in the `autoFocus` flag passed to rendered fields.
- Do not change validation-driven autofocus behavior unless the form is still in a loading-disabled state.
- Preserve current behavior for non-loading pages that rely on autofocus today.

### `ComboboxInput`
- Keep autofocus on the input itself.
- Suppress the first programmatic focus from immediately opening suggestions.
- Allow subsequent user-driven focuses to open suggestions normally.

### `TagsInput`
- Suppress the first programmatic focus from triggering suggestion loading or suggestion display.
- Allow later user-driven focus and typing to load suggestions normally.

### Other UI core inputs
- `DatePicker`, `DateTimePicker`, `TimePicker`, `LookupSelect`, `EventSelect`, `PhoneNumberField`, and `SwitchableMarkdownInput` do not currently open a popup purely because they received focus, so they are not expected to need the same suppression path.
- If a future input introduces `focus -> open` behavior, it should adopt the same mount-suppression pattern instead of depending on host workarounds.

## Data Models
No data model changes.

## API Contracts
### `CrudForm`
Add:
```ts
disableInitialFocus?: boolean
```

Semantics:
- `false` or omitted: existing behavior, mount autofocus is allowed
- `true`: mount autofocus is suppressed until the host turns the flag off

### `ComboboxInput`
Add an internal mount-focus suppression path, but keep the public API stable unless the final implementation needs an explicit prop for other host surfaces.

### `TagsInput`
Add `suppressInitialSuggestionsOnFocus?: boolean` for host surfaces that need the same one-shot suppression outside `CrudForm`.

## Risks & Impact Review
| Risk | Severity | Area | Mitigation | Residual risk |
|---|---|---|---|---|
| `disableInitialFocus` suppresses autofocus for forms that actually wanted immediate focus | Medium | UX | Default the flag to `false`; only set it during async loading flows | Low |
| Suppressing initial focus only on comboboxes hides the bug but regresses keyboard discovery if over-applied | Medium | Accessibility / UX | Apply suppression only to the first programmatic focus, not to user-initiated focus | Low |
| `TagsInput` may behave similarly but remain unhandled | Medium | UX consistency | Add one-shot suppression and cover with tests | Low |
| Future open-on-focus controls reintroduce the same problem | Medium | Maintainability | Document the pattern in this spec and in `packages/ui/AGENTS.md` | Medium |
| Validation autofocus accidentally becomes too conservative | High | Form usability | Keep validation autofocus separate from mount autofocus and cover both in tests | Low |

## Test Plan
### Unit / component tests
- `CrudForm` autofocuses the first eligible field when `disableInitialFocus` is false.
- `CrudForm` does not autofocus on mount when `disableInitialFocus` is true.
- `CrudForm` still autofocuses again after the host flips `disableInitialFocus` off.
- `ComboboxInput` does not open suggestions on the first programmatic focus.
- `ComboboxInput` opens suggestions on a later user focus.
- `TagsInput` does not fetch or display suggestions on the first programmatic focus.
- `TagsInput` keeps normal suggestion loading for later user-driven focus and typing.

### Manual verification
- Load a record page with async data and confirm there is no visible suggestion flash while loading.
- Confirm that once the data is ready, autofocus still lands on the first field.
- Confirm plain text forms still autofocus immediately.

## Final Compliance Report
### AGENTS.md Files Reviewed
- `AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/specs/AGENTS.md`

### Verdict
- Draft updated to reflect the host-controlled initial focus design and the control-level suppression needed to avoid suggestion flicker.

## Changelog
### 2026-05-09
- Replaced the demo-only reproduction draft with the real implementation spec for host-controlled initial focus and open-on-focus suppression.
