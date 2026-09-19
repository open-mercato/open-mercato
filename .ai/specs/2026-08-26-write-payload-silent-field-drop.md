# CRUD Write Payloads: Stop Accepting Fields and Discarding Them

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

The compatibility create/update adapters also need to forward these inputs.
Forwarding `phoneNumber` alone does not persist it: the canonical interaction
commands must map it to the `callPhoneNumber` custom field used by the UI.
Both activity and interaction reads expose it through `customValues`, not a new
phone-number column.

---

## Design

### Guard at the layer that owns the parse

`makeCrudRoute` funnels every ORM-backed write through two lines,
`createConfig.schema.parse(body)` and `updateConfig.schema.parse(body)`. That is
where the stripping happens, so that is where the guard goes. Factory-backed routes inherit it without opting in.

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

Three classes of key are excluded before inspection, because no write schema
declares them and reporting them would be noise rather than signal:

- **Custom fields** (`customFields`, `customValues`, `cf_*`, `cf:*`), routed by
  `splitCustomFieldPayload` further down. Without this a legitimate `cf_priority`
  would be reported as ignored.
- **Tenant and organization scope**, in both spellings. These come from trusted
  context per `.ai/review-checklist.md` §4. Aliasing them would additionally let a
  caller steer scope through the snake_case spelling that is ignored today.
- **Server-maintained timestamps** (`created_at`, `updated_at`, `deleted_at` and
  their camelCase spellings). List projections emit them, so without this every
  round-trip write would report two ignored fields.

`immutableFields` is enforced on update only. Those fields cannot change *after*
creation, so the create path must accept exactly them.

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
shared by modules rather than being wired per route.

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
| `packages/core/src/modules/customers/data/validators.ts` | `ActivityUpdateInput` retains optional `entityId` for source compatibility; the HTTP guard rejects immutable writes |
| `packages/core/src/modules/customers/commands/activities.ts` | Both create and update adapters forward `date` / `time` / `phoneNumber` |
| `packages/core/src/modules/customers/commands/interactions.ts` | Create/update map `phoneNumber` to the existing custom-field persistence path, within the existing transaction and undo snapshots |
| `packages/core/src/modules/customers/lib/interactionPhoneNumber.ts` | Merge the phone alias with custom values; reject conflicting representations before any write |

### Coverage

Factory-backed and `parseScopedCommandInput`-backed writes inherit the guard.
This PR adds an explicit guard to the hand-written activities update route.
Other bespoke handlers that call neither shared entry point must adopt
`guardWriteBody` explicitly; this PR does not cover every write entry point.

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
- No database schema change or migration. Accepted phone writes update existing
  custom-field storage.

**A previously-succeeding request can now return 400.** The additivity above is a
statement about FIELDS, not about REQUESTS, and the difference is worth stating
plainly. An aliased key now reaches `schema.parse`, so a snake_case value that does
not satisfy the camelCase field's validator fails the whole request where it was
previously dropped in silence:

```
PUT /api/customers/deals  {"id":"…","value_amount":"1 234,50"}
before: 200, value_amount discarded
after:  400, invalid_type
```

That is the intended behaviour of this change, not an accident: the endpoint either
applies the field or refuses it. It is recorded here so the trade-off is a decision
rather than a surprise. A straight round-trip is unaffected, because the read side
emits values the write schema accepts.

**`ActivityUpdateInput` preserves source compatibility.** Its optional `entityId`
field remains declared. The HTTP write guard rejects it as immutable before
parsing, without removing the field from the exported schema or TypeScript type.

**The programmatic path is not yet covered.** The guard fires on the HTTP route, so
`customers.activities.update` invoked directly still discards `entityId` in
`mapActivityUpdateInput`. Same outcome as before, so no
regression, but the "no silent drops" promise does not hold there yet.

**Deal write schemas now accept `null` on nullable columns.** Every `CustomerDeal`
column that is `nullable: true` accepts `null` in the write schemas, meaning "clear
it". This fixes a pre-existing defect that the aliasing would otherwise have exposed
to far more callers: `z.coerce.number()` maps `null` to `0` and `z.coerce.date()` maps
it to the epoch, so `{"value_amount": null}` from a round-tripped read wrote `0` and
`1970-01-01` under a `200`. `customers.deals.update` already applied `?? null` for
these fields; only the schema stood in the way, and `ownerUserId` had already been
given `.nullable()` for the same reason (TC-CRM-069).

---

## Phone-number persistence contract

- `POST` and `PUT` on `/api/customers/activities` and `/api/customers/interactions`
  persist a supplied `phoneNumber` as `customValues.callPhoneNumber`.
- Supplying both representations with matching trimmed values is accepted;
  conflicting values return `400` before any entity or custom-field write.
- Omitting the top-level field preserves custom-only writes and the existing phone.
  Other custom fields survive a phone-only edit.
- Explicit null is forwarded rather than discarded. Existing interaction validation
  still applies: a call update explicitly naming `interactionType: 'call'` requires
  a nonempty phone when supplied; clients can clear the custom field directly or
  send a partial update without the type.
- There is no new database column or migration. Existing custom-field snapshots
  and undo/redo remain the source of truth.

## Testing

- `packages/core/src/modules/customers/__integration__/TC-CRM-WRITE-GUARD-001.spec.ts`:
  deal round-trip aliases, ignored keys, immutable parent, plus activity and
  interaction create/read/update/read persistence, matching/conflicting phone
  representations, omitted phone preservation and explicit clearing.
- `packages/core/src/modules/customers/lib/__tests__/interactionPhoneNumber.test.ts`:
  custom-field preservation, duplicate conflict handling, null and omission.

- `packages/shared/src/lib/crud/__tests__/write-payload.test.ts` — key extraction
  across `merge`/`partial`/`ZodEffects`/union, aliasing, conflicts, immutability.
- `packages/shared/src/lib/api/__tests__/scoped.test.ts` — the guard through
  `parseScopedCommandInput`, including that custom-field keys are left alone.
- `packages/core/src/modules/customers/__tests__/write-payload-guard.test.ts` —
  regression cover against the **real** `dealUpdateSchema` / `activityUpdateSchema`,
  using the payloads observed on the running instance.

---

## Changelog

- **2026-09-13** - Resolve upstream indexer-wrapper conflicts while retaining the
  command-response input. Persist phone writes through canonical interaction
  custom fields, forward create inputs, and assert on the real read projection.
  Add conflict, omission and clearing coverage for both API surfaces. Preserve
  the public activity update schema while enforcing HTTP immutability in the guard.

- **2026-08-26** - Initial spec. Both cases reproduced against a deployed 0.6.7
  instance and confirmed still present on `develop`. Guard placed at the
  `makeCrudRoute` parse chokepoint so it covers every module, rather than being
  wired into the two endpoints where the bugs were reported.
