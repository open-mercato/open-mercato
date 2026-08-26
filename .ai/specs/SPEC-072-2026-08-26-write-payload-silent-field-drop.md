# SPEC-072: Customers Write API — Stop Accepting Fields and Discarding Them

## Overview

`PUT /api/customers/deals` and `PUT /api/customers/activities` answer
`200 {"ok":true}` while silently discarding part of the request body. A caller
cannot tell "written" from "ignored" without re-reading the record, which is the
opposite of what a `200` means.

A write endpoint should either apply a field or reject it. These did neither.

---

## Problem Statement

Two independent mechanisms produce the same symptom.

### 1. Zod strips unknown keys, and the read side emits snake_case

`dealUpdateSchema` is `z.object({ id }).merge(dealCreateSchema.partial())`. Zod
strips unknown keys by default, so any key that is not spelled exactly as the
schema declares it is dropped before the command ever sees it.

The deal list endpoint emits **snake_case** (`closure_outcome`, `loss_notes`,
`owner_user_id` — see the `list.fields` array in `api/deals/route.ts`), while the
write schema declares **camelCase**. A caller that reads a deal and writes it back
therefore sends keys that are silently discarded.

Observed against a running instance:

```
PUT /api/customers/deals
{"id":"…","status":"closed","closure_outcome":"lost","loss_notes":"…"}
→ 200 {"ok":true}
→ read back: status = "closed" (applied)
             closure_outcome = null, loss_notes = "" (both discarded)
```

The asymmetry is what makes it dangerous: `status` is spelled identically in both
directions, so part of the body lands and part vanishes, under one `200`.

### 2. A field passes validation and is then dropped by a hand-built input

`PUT /api/customers/activities` is a hand-written handler, not a `makeCrudRoute`.
It parses with `activityUpdateBodySchema` — which is `.passthrough()` and, via
`activityCreateSchema.partial()`, declared `entityId` — and then builds the
command input from a fixed list of ten fields that does not include it.

```
PUT /api/customers/activities
{"id":"…","entityId":"<different entity>", …}
→ 200 {"ok":true}
→ read back: entityId unchanged
```

`entityId` is **immutable by design** and that design is right: the canonical
`interactionUpdateSchema` declares no `entityId`, and `customers.interactions.update`
reads the owning entity off the stored record. There is no re-parent path. The bug
is only that the request reports success instead of rejecting.

The same hand-built list also drops `date`, `time` and `phoneNumber`, which
`activityUpdateSchema` declares **and** the canonical interaction update accepts
(it derives `scheduledAt` from `date`+`time`). Editing a call activity's phone
number through this endpoint reported success and changed nothing.

`mapActivityUpdateInput` in `commands/activities.ts` drops the same four fields on
the programmatic path.

---

## Design

### Guard at the layer that owns the parse

`makeCrudRoute` funnels every ORM-backed write through two lines,
`createConfig.schema.parse(body)` and `updateConfig.schema.parse(body)`. That is
where the stripping happens, so that is where the guard goes. It reaches 77 route
files across 19 modules without any of them opting in.

Two other write paths exist and get the same guard:

- **Command-backed actions** parse inside `mapInput`, usually through
  `parseScopedCommandInput`, which now delegates to the same function.
- **Hand-written handlers** that predate the factory call `guardWriteBody`
  directly. `api/customers/activities` does.

One implementation, in `packages/shared/src/lib/crud/write-payload.ts`:

- `collectWritableKeys(schema)`: the top-level keys a schema accepts, unwrapping
  the `ZodEffects` that `.superRefine()` / `.transform()` add. Returns `null` for a
  shape it cannot introspect, which every caller treats as "leave it alone", so
  behaviour is unchanged wherever introspection fails.
- `inspectWritePayload(payload, keys, { immutableFields })`: renames snake_case
  onto declared camelCase, classifies the rest as `unknown` or `immutable`.
- `guardWriteBody(schema, body, config)`: the entry point every write path calls.
  Throws `CrudHttpError(400)` for an ambiguous duplicate, an immutable field, and
  an unknown key when the route opted into strictness.
- `withIgnoredFieldsReport(payload, input)`: attaches `ignoredFields` to a response.

Custom-field keys (`customFields`, `customValues`, `cf_*`, `cf:*`) are excluded
before inspection. No write schema declares them, so without that a legitimate
`cf_priority` would be reported as a field the endpoint ignored.

### Four outcomes, none of them silent

| Case | Behaviour |
|---|---|
| snake_case spelling of a declared field | **Applied** (aliased onto the camelCase key) |
| Both spellings, different values | **400**, ambiguous, never guessed |
| A real field that cannot change (`entityId`) | **400** "cannot be changed after creation" |
| An unknown key | **Reported** as `ignoredFields`, or **400** with `rejectUnknownFields` |

### Why aliasing is on by default and rejection is not

Aliasing is safe to default on at this reach precisely because it is additive: it
only ever applies keys Zod was already discarding, so no field that takes effect
today changes behaviour. That property is what lets the guard sit at a chokepoint
covering 19 modules rather than being wired per route.

Rejecting unknown keys is **opt-in** per route (`writeGuard.rejectUnknownFields`).
Widget injection routinely puts non-schema keys into form payloads, so flipping
strictness on globally would break working forms. Reporting `ignoredFields` gives
a caller something to assert on without that risk.

---

## Changes

| File | Change |
|---|---|
| `packages/shared/src/lib/crud/write-payload.ts` | New. The guard, and the only implementation of it |
| `packages/shared/src/lib/crud/factory.ts` | Guard applied to both parse chokepoints; new `writeGuard` option; create/update responses report `ignoredFields`; command `response` receives `input` |
| `packages/shared/src/lib/api/scoped.ts` | `parseScopedCommandInput` delegates to the shared guard |
| `packages/core/src/modules/customers/api/deals/route.ts` | Update response reports `ignoredFields` |
| `packages/core/src/modules/customers/api/activities/route.ts` | Calls the guard directly; rejects `entityId`; forwards `date` / `time` / `phoneNumber` |
| `packages/core/src/modules/customers/data/validators.ts` | `activityUpdateSchema` no longer declares `entityId` |
| `packages/core/src/modules/customers/commands/activities.ts` | `mapActivityUpdateInput` forwards `date` / `time` / `phoneNumber` |

### Coverage

In the customers module, 9 of 15 `PUT` endpoints are now guarded, up from the 2
the reported bugs live in. The remaining 6 are bespoke handlers (`pipelines`,
`pipeline-stages`, the two `roles` routes, two `settings` routes) that use neither
the factory nor `parseScopedCommandInput`; each can adopt the guard with a single
`guardWriteBody` call. Framework-wide, every `makeCrudRoute` write inherits it.

---

## Backward Compatibility

- Previously-discarded snake_case keys are now **applied**. This is the intended
  fix, and it is the one behavioural change a caller could notice: a client that
  was sending `closure_outcome` and relying on it being ignored would now write it.
  No such client can exist deliberately, since the field never took effect.
- `PUT /api/customers/activities` carrying `entityId` now returns **400** instead
  of a misleading `200`. This is the point of the change.
- Responses gain an optional `ignoredFields` array. Absent anything to report, the
  response is byte-identical to today's.
- No schema, migration or persisted-data changes.

---

## Testing

- `packages/shared/src/lib/crud/__tests__/write-payload.test.ts` — key extraction
  across `merge`/`partial`/`ZodEffects`/union, aliasing, conflicts, immutability.
- `packages/shared/src/lib/api/__tests__/scoped.test.ts` — the guard through
  `parseScopedCommandInput`, including that custom-field keys are left alone.
- `packages/core/src/modules/customers/__tests__/write-payload-guard.test.ts` —
  regression cover against the **real** `dealUpdateSchema` / `activityUpdateSchema`,
  using the payloads observed on the running instance.

---

## Changelog

- **2026-08-26** - Initial spec. Both cases reproduced against a deployed 0.6.7
  instance and confirmed still present on `develop`. Guard placed at the
  `makeCrudRoute` parse chokepoint so it covers every module, rather than being
  wired into the two endpoints where the bugs were reported.
