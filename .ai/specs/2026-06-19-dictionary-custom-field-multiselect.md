# Dictionary Custom Field Multiselect

## TLDR

Dictionary-backed custom fields can opt into multiple values by setting `multi: true`. Generated `CrudForm` custom-field sections render those fields as built-in multi-select listboxes backed by the existing dictionary entries endpoint, and values round-trip as arrays through the existing custom-field EAV storage.

## Overview

The custom-field system already supports multi-value fields and array persistence for user-editable custom fields. Dictionary custom fields, however, were wired to a specialized single-value dictionary selector so generated forms could only choose one entry even when the definition carried `multi: true`.

This change makes dictionary multi-value support a form-generation concern. Single-value dictionary fields keep using the existing registered dictionary control, including inline entry creation. Multi-value dictionary fields use the generic `CrudForm` select/listbox behavior and load options from `/api/dictionaries/:id/entries`.

## Problem Statement

Users defining dictionary custom fields need a way to select more than one dictionary entry in generated create/edit forms. The previous generated form path treated dictionary fields as scalar custom controls, so records could not be edited naturally with multiple dictionary values even though custom-field storage can already persist arrays.

The change must not introduce a new storage model, widen `CustomFieldDefinition.defaultValue`, or change dictionary entry APIs.

## Proposed Solution

- Extend custom-field form mapping so `kind: "dictionary"` plus `multi: true` returns a built-in `select` field with `multiple: true`, `listbox: true`, empty initial options, and async `loadOptions`.
- Resolve options from `def.optionsUrl` when supplied, otherwise from `/api/dictionaries/:dictionaryId/entries`.
- Preserve existing registered dictionary custom input behavior for single-value dictionary fields.
- Add a `Multiple values` toggle to the dictionary custom-field definition editor.
- Hide and clear the single-value default selector when multiple values are enabled.
- Keep `dictionaryInlineCreate` scoped to single-value dictionary fields; multi inline-create is intentionally out of scope.

## Architecture

The implementation touches two form surfaces:

- `packages/ui/src/backend/utils/customFieldForms.ts` owns generated `CrudForm` field definitions. It now branches dictionary fields by `multi`.
- `packages/core/src/modules/dictionaries/fields/dictionary.tsx` owns dictionary-specific custom-field definition editing. It exposes the multi toggle and hides scalar-only controls when enabled.

No server route needs to change. Custom-field definition payloads already carry `multi`, `dictionaryId`, and `optionsUrl`, and entity record writes already accept array values for multi fields.

## Data Models

No database migration is required.

- `CustomFieldDefinition.defaultValue` remains scalar.
- Multi dictionary record values are stored using the existing custom-field EAV array handling.
- Dictionary entry values remain the persisted token values returned by the existing entries API.

## API Contracts

No new endpoints or route contracts are introduced.

Covered existing APIs:

- `GET /api/dictionaries/:id/entries` for option loading.
- `POST /api/entities/definitions` for dictionary custom-field definitions with `multi: true`.
- `POST /api/entities/records` and `PUT /api/entities/records` for array custom-field values.
- `GET /api/entities/records` for list/detail readback.

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
| --- | --- | --- | --- | --- |
| Single-value dictionary behavior regresses | Medium | Generated CRUD forms | Unit coverage asserts single dictionary fields remain custom registered inputs. | Low |
| Multi dictionary option loading diverges from dictionary APIs | Medium | Generated CRUD forms | Reuses the existing dictionary entries endpoint and shared remote-option loader. | Low |
| Array values fail to round-trip | High | Custom entities and records | Integration coverage creates, updates, and reads back multi dictionary values. | Low |
| Scalar default values accidentally become arrays | Medium | Custom-field definitions | Multi default values stay out of scope and the editor clears scalar defaults when multi is enabled. | Low |

## Final Compliance Report

- Tenant and organization scoping is unchanged.
- No database schema, migration, or dictionary entry API changes are introduced.
- Single-value dictionary fields keep their current inline-create flow.
- Multi-value defaults and multi inline-create are deferred by design.
- The feature is covered by focused UI helper tests and custom-entity API readback coverage.

## Changelog

- 2026-06-19: Added dictionary multi-select support for generated custom-field forms and dictionary field-definition editing.
