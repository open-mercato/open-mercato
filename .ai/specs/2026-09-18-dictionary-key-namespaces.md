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
