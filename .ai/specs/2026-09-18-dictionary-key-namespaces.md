# Dictionary Key Namespaces

- **Date**: 2026-09-18
- **Status**: Implemented — awaiting deployment, so the spec stays in `.ai/specs/` and is listed under Pending in the index
- **Scope**: `packages/core/src/modules/dictionaries`

## Problem

A module that owns a system dictionary reaches it two ways. `setup.ts` `seedDefaults` writes the row
straight through the `EntityManager`, which runs no zod validation. The browser-side helper creates
the same dictionary on demand through `POST /api/dictionaries`, which validates the key with
`dictionaryKeySchema`.

Those two paths disagreed. Most module-owned keys are namespaced with a dot —
`resources.capacity_unit`, `resources.activity-types`, `resources.address-types`,
`sales.shipment_status`, `warranty_claims.warranty_claim_reason`,
`planner.unavailability-reasons.{staff,resources,rulesets}` — while the create schema required a flat
slug, `/^[a-z0-9][a-z0-9_-]*$/`.

A tenant whose seed had run never noticed: the dictionary already existed, so the helper found it in
the list and never posted. A tenant that predates the module, or one where the seed did not run, hit
the create path on first use and the request failed. The route mapped the resulting `ZodError` onto
its catch-all 500, so the browser got no field message either and the feature was simply unavailable.

The update route had already met the same mismatch and worked around it locally: it parses a
resubmitted key with a loose schema and applies the strict one only when the key actually changes.

## Decision

Permit dot-separated namespace segments in `dictionaryKeySchema`:

```
/^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/
```

Each segment still obeys the original slug rule, so a leading, trailing or repeated dot is still
rejected, as is any uppercase letter, space or other separator. The pattern is exported as
`DICTIONARY_KEY_PATTERN` and the manager dialog validates against it instead of its own copy of the
literal.

### Why not renaming the module keys to flat slugs

Consistency would have argued for it, but the keys are persisted. `seedPlannerUnavailabilityReasons`
and the `resources` seeds write them into customer databases through `setup.ts`, and the dictionary
row is what its entries hang off. Renaming the constants would leave those rows and their entries
orphaned on upgrade, silently and with no error, and would require a data migration per module for
no behavioural gain. `BACKWARD_COMPATIBILITY.md` also classifies `data/validators.ts` schema exports
as a surface that must not narrow — widening is the sanctioned direction.

### Why the dots are safe

Nothing downstream splits, escapes or interpolates a dictionary key. Every dictionary route addresses
the record by uuid (`/api/dictionaries/{dictionaryId}`), the key is used for equality lookups
(`em.findOne({ key })`), for client-side list matching, and as display text. It is not a query-index
field name, a CSS selector, a URL segment or an export column.

## Related change

`POST /api/dictionaries` now answers a `ZodError` with `400` and the failing field's message, matching
the update, entries, reorder and set-default routes in the same module. It previously fell through to
the catch-all `500`.

## Coverage

`packages/core/src/__tests__/dictionary-key-schema-coverage.test.ts` parses every package's module
tree and asserts that each declared dictionary key satisfies the schema the create route enforces, so
a module shipping a key its own API rejects fails CI rather than a customer's first use. A
declaration is audited when its name ends in `DICTIONARY_KEY`, `DICTIONARY_KEYS` or `_DICTIONARIES`;
when its name ends in `DEFINITIONS` and its type annotation mentions "dictionary" (the bare
`DEFINITIONS` suffix is too generic to trust on its own); or, regardless of the declaration's name,
whenever a descriptor object carries an explicit `dictionaryKey` property.

## System dictionary preservation (#10341)

Dictionary writes preserve the keys and availability of records marked
`isSystem`. PATCH accepts an unchanged key and permits display name,
description, and entry sort order edits. PATCH that changes the key or archives
the record, and DELETE, return HTTP 400 in the existing localized error envelope.
The check runs after scope, optimistic lock, and mutation guard checks and before
the row or its update timestamp changes. Currency-specific protection continues
to apply to both reserved aliases. #10543 introduced these protections on main.
A PATCH that echoes the exact stored spelling of a legacy system key keeps
that key intact while applying the permitted metadata edits.

### Migration & Backward Compatibility

The existing PATCH and DELETE routes retain their schemas. Their mutation policy
rejects destructive operations on system dictionaries so the owning module can
continue to resolve the same key. A bridge would still permit the destructive
mutation. Clients can edit descriptive settings or use custom dictionaries for
data they need to rename or archive. No migration is required. Operators who
already have a missing system dictionary should follow the owning module's
recovery procedure. See the [upgrade notes](../../UPGRADE_NOTES.md#system-dictionary-preservation-10341).
A backport that introduces the destructive-write restriction still requires a
named human maintainer to acknowledge the compatibility exception.

### Regression coverage

Route tests cover the rejection and mutation guard lifecycle, both reserved
currency aliases, and permitted system and custom edits. The API integration
test creates a system dictionary and verifies that Sales can still resolve its
order status after the mutations are rejected.

## Changelog

- 2026-11-25. Added server-side preservation of system dictionary keys and availability (#10341).
