# CrudForm custom-field error ownership

## TLDR

- Add an optional, backward-compatible custom-field declaration that tells `CrudForm` the component renders its own validation error.
- Keep wrapper-rendered errors as the default so existing custom fields do not lose validation feedback.
- Mark both registered phone fields and the customer form's `PrimaryPhoneField` as self-rendering, then cover both ownership modes with focused tests.

## Problem Statement

`CrudForm` passes `error` to every `type: 'custom'` component and also renders the same error below the component. Components such as the phone field pass that error to a nested input which renders it itself, producing duplicate validation messages. Suppressing the wrapper for every custom field would regress components that rely on the wrapper.

## Proposed Solution

Extend the additive `CrudCustomField` definition with an optional error-ownership flag. When the flag is absent or false, `CrudForm` preserves the current wrapper error. When true, the wrapper suppresses only its duplicate and the custom component remains responsible for rendering the supplied `error`.

## Overview

This change gives custom `CrudForm` fields one explicit owner for validation-message rendering. The host remains the owner by default; a component that already exposes the error through its composed input can opt in to owning the message.

Material UI follows the same explicit-composition principle: a complete `TextField` owns its helper text, while lower-level composed controls add `FormHelperText` themselves. The important invariant adopted here is that one composition layer owns the feedback node, not both.

## User Stories

- A form user sees each validation error exactly once.
- A module developer can keep relying on `CrudForm` to render errors for existing custom fields.
- A custom input that already renders `error` can declare ownership without changing its component contract.

## Architecture

- Add optional `rendersOwnError?: boolean` metadata to `CrudCustomField`.
- Keep `rendersOwnError` absent/false as the compatibility default.
- In the field row, render the wrapper error unless the field is custom and `rendersOwnError === true`.
- Apply the same ownership rule in `DealCustomFieldControl`, the second host that renders `CrudCustomField` definitions.
- Include the flag in the memoized field-row equality check so runtime configuration changes re-render correctly.
- Extend the internal field registry entry metadata so registered inputs can declare error ownership. The phone registration opts in, and custom-field form builders copy that metadata onto the generated `CrudCustomField`.
- Mark the customer form's directly declared `PrimaryPhoneField` as self-rendering because it forwards `error` to `PhoneNumberField.externalError` without passing through the registry.

### Frontend Architecture Contract

The existing `CrudForm.tsx` client boundary is unchanged. No provider, route, server component, bundle boundary, or additional client file is introduced. The change adds one boolean branch and no new dependency.

## Data Models

Not applicable. No persisted data, database schema, tenant scope, or entity behavior changes.

## API Contracts

The TypeScript contract changes additively:

```ts
export type CrudCustomField = CrudFieldBase & {
  type: 'custom'
  component: (props: CrudCustomFieldRenderProps) => React.ReactNode
  rendersOwnError?: boolean
}
```

No HTTP route, request, response, event, or import path changes.

## Internationalization

No new user-facing strings are introduced. Existing translated validation messages are rendered unchanged.

## UI/UX

- Default custom field: the existing wrapper renders the validation message.
- `rendersOwnError: true`: only the custom component renders the same supplied message.
- Existing semantic error styling remains unchanged; no design-system token or primitive changes.

## Migration & Backward Compatibility

This is an additive optional field on a stable exported type. Existing custom-field definitions compile and render byte-for-byte as before because the absent value follows the current wrapper path. No deprecation, migration, or downstream source change is required. Components should opt in only when they render the supplied `error` themselves.

## Implementation Plan

### Phase 1: Error ownership

1. Add `rendersOwnError` to `CrudCustomField`, the wrapper condition, and memo comparison.
2. Add registry metadata and propagate it through custom-field form construction.
3. Mark the phone input registration and the directly declared customer `PrimaryPhoneField` as self-rendering.
4. Add regression coverage for the default wrapper path, the self-rendered path, phone metadata propagation, and the concrete customer form configuration.
5. Run focused UI tests, UI package build/type validation, design-system review, and manual QA.

### File Manifest

| File | Action | Purpose |
| --- | --- | --- |
| `packages/ui/src/backend/CrudForm.tsx` | Modify | Add and honor custom-field error ownership |
| `packages/ui/src/backend/fields/registry.ts` | Modify | Carry input error-ownership metadata |
| `packages/ui/src/backend/fields/phone.tsx` | Modify | Declare that the phone input renders its own error |
| `packages/ui/src/backend/utils/customFieldForms.ts` | Modify | Propagate registry metadata into generated fields |
| `packages/ui/src/backend/**/__tests__/*` | Modify | Cover both rendering paths and phone propagation |
| `packages/core/src/modules/customers/components/formConfig.tsx` | Modify | Opt the concrete `PrimaryPhoneField` into component-owned error rendering |
| `packages/core/src/modules/customers/components/__tests__/formConfig.test.ts` | Modify | Cover the concrete customer phone-field declaration |
| `packages/core/src/modules/customers/components/detail/create/dealCustomFieldControl.tsx` | Modify | Honor custom-field error ownership in deal quick-create |
| `packages/core/src/modules/customers/components/detail/create/__tests__/dealCustomFieldControl.test.tsx` | Modify | Cover component-owned errors in the second custom-field host |

## Testing Strategy

- Submit required custom fields with empty values and assert the default wrapper error remains.
- Submit a required custom field with `rendersOwnError: true` and assert the message appears only in the component-owned location.
- Assert the registered phone field produces a custom-field definition with `rendersOwnError: true`.
- Assert the customer form's direct `PrimaryPhoneField` declaration sets `rendersOwnError: true`.
- Assert deal quick-create suppresses its wrapper message when the custom component owns the error.
- Run the focused Jest files, the `@open-mercato/ui` package validation, and manual browser QA on a form containing the phone custom field.

## Risks & Impact Review

### Existing custom fields lose validation feedback

- **Scenario**: The wrapper is suppressed for all custom fields rather than only explicit opt-ins.
- **Severity**: Medium
- **Affected area**: Any `CrudForm` consumer with a custom field that ignores the `error` render prop.
- **Mitigation**: The flag is optional and defaults to the current wrapper behavior; a regression test covers that path.
- **Residual risk**: A caller can opt in incorrectly and hide its own message, which is an explicit local configuration error.

### Memoized rows retain stale ownership

- **Scenario**: A host changes `rendersOwnError` without changing the component function, but the memo comparator skips rendering.
- **Severity**: Low
- **Affected area**: Dynamically reconfigured custom-field rows.
- **Mitigation**: Compare `rendersOwnError` in the custom-field memo branch.
- **Residual risk**: None beyond React configuration errors already present in the field array.

### Data, security, and operational impact

There are no writes, network calls, persistence changes, tenant boundaries, secrets, events, caches, workers, or external services in this change. Failure is isolated to duplicate or missing inline visual feedback in one field row.

## Final Compliance Report — 2026-08-06

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| `AGENTS.md` | Preserve behavior unless explicitly changed | Compliant | Existing custom fields retain wrapper rendering |
| `AGENTS.md` | Keep changes minimal and focused | Compliant | One optional flag and internal propagation only |
| `BACKWARD_COMPATIBILITY.md` | Stable types may gain optional fields | Compliant | `rendersOwnError` is optional and default-preserving |
| `packages/ui/AGENTS.md` | Ask before changing `CrudForm` contracts | Compliant | Issue claim and implementation request explicitly approve the additive contract |
| `packages/ui/AGENTS.md` | Use semantic design-system tokens | Compliant | Existing `text-status-error-text` output is unchanged |
| `packages/ui/src/backend/AGENTS.md` | Preserve `CrudForm` event behavior and stable host surfaces | Compliant | No event, spot, or replacement-handle change |
| `packages/core/src/modules/customers/AGENTS.md` | Preserve customer form and custom-field integration behavior | Compliant | The direct phone field changes only validation-message ownership |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match API contracts | Pass | Neither surface changes |
| API contracts match UI/UX | Pass | Optional TS flag directly controls wrapper rendering |
| Risks cover all write operations | Pass | No write operations exist |
| Commands defined for all mutations | Pass | No mutations exist |
| Cache strategy covers all read APIs | Pass | No read APIs or cache exist |

### Non-Compliant Items

None.

### Verdict

Fully compliant: approved for implementation.

## Changelog

### 2026-08-06

- Added the initial specification for backward-compatible custom-field error ownership in `CrudForm`.
- Fresh-context scope review passed: the `CrudForm` flag, registry propagation, phone opt-in, and tests form one cohesive capability and do not require splitting into separate specs.
- Implementation completed with focused regression coverage for wrapper-owned and component-owned validation messages, including the concrete customer `PrimaryPhoneField`.
- Extended the ownership rule and regression coverage to the deal quick-create custom-field host.
