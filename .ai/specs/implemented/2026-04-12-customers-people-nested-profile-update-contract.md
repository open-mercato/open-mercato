# Customers People Nested Profile Update Contract

## TLDR

- Issue `#793` is reproducible by inspection in the current codebase.
- `GET /api/customers/people/{id}` returns person-specific fields in a nested `profile` object, but `PUT /api/customers/people` only accepts a flat top-level update shape.
- Because the update route validates with a permissive Zod object shape, nested `profile` payloads are stripped instead of rejected, and the route still returns `{ ok: true }`.
- PR `#796` identifies the right seam for a fix: normalize known nested `profile.*` fields before validation in the people create/update API route.
- The chosen direction is intentionally narrow:
  - treat nested `profile` support as a compatibility shim
  - keep OpenAPI flat
  - apply the people fix to `PUT /api/customers/people`
  - return specific validation messages for malformed or unsupported nested `profile` payloads
- Specific validation messages should be localized as part of the implementation.
- The same contract pattern also exists in `companies`, and no analogous upstream issue was found during issue-tracker review, so a combined implementation remains acceptable.

## Overview

This spec documents a contract bug in the `customers` module around `PUT /api/customers/people`, with a mirrored risk pattern in `companies`. The detail read API returns profile-specific fields under `profile`, while the write API expects those same fields at the top level. That shape mismatch becomes dangerous because the current update validation strips unknown keys rather than rejecting them, producing a false-positive success response for no-op writes.

The scope is intentionally narrow:

- clarify the current contract
- explain the root cause and non-causes
- define the desired behavior for nested `profile` payloads
- outline the implementation and testing approach
- capture the company-side mirror case and whether it should be fixed in the same change

This spec does not propose a broader redesign of the people API, CRUD factory, or GET response shape.

## Problem Statement

### Reported behavior

Issue `#793` reports that:

1. a client sends `PUT /api/customers/people` with:

```json
{
  "id": "<person-id>",
  "profile": {
    "linkedInUrl": "https://linkedin.example.com/in/<redacted>"
  }
}
```

2. the API returns:

```json
{ "ok": true }
```

3. a follow-up `GET /api/customers/people/{id}` shows no change.

### Why this matters

This is a trust-breaking API contract failure:

- the client believes a write succeeded
- the server has performed no update
- the response does not distinguish "applied", "ignored", or "unsupported shape"

In practice this can hide integration bugs, corrupt sync assumptions, and cause downstream systems to believe profile data is current when it is not.

## Findings

### Local code evidence

`GET /api/customers/people/{id}` returns person profile fields in a nested object:

- [packages/core/src/modules/customers/api/people/[id]/route.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/api/people/[id]/route.ts:662)

That response includes:

- `profile.firstName`
- `profile.lastName`
- `profile.department`
- `profile.linkedInUrl`
- `profile.twitterUrl`
- `profile.companyEntityId`

`PUT /api/customers/people` does not accept a nested `profile` object in its declared schema:

- [packages/core/src/modules/customers/data/validators.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/data/validators.ts:85)
- [packages/core/src/modules/customers/api/people/route.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/api/people/route.ts:315)

The update command only applies top-level parsed fields:

- [packages/core/src/modules/customers/commands/people.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/commands/people.ts:722)

The route returns `{ ok: true }` unconditionally after a successful command invocation:

- [packages/core/src/modules/customers/api/people/route.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/api/people/route.ts:322)

### Two-stage Zod parse behavior

The silent strip behavior is the result of a two-stage parse:

1. The route entry schema (`rawBodySchema = z.object({}).passthrough()`) accepts all keys, including `profile`.
2. The update validator (`personUpdateSchema` / `companyUpdateSchema`) uses default Zod behavior, which **strips** unknown keys.

This means `profile` passes through the first stage but is silently dropped by the second. Neither stage rejects it — stage 1 allows it, stage 2 removes it. The net effect is a no-op write with a success response.

### GitHub evidence

The upstream issue describes the exact no-op success path:

- `open-mercato/open-mercato#793`

The related PR proposes normalizing nested `profile.*` fields before validation:

- `open-mercato/open-mercato#796`

The PR summary states:

- add `normalizePersonPayload`
- lift known nested `profile` fields into the existing flat payload shape
- wire the helper into `POST` and `PUT`
- add regression tests for nested-field lifting and top-level precedence

### Existing local behavior that avoids the bug

The repo’s own frontend mostly sends flat update payloads already:

- [packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx:310)
- [packages/core/src/modules/customers/components/formConfig.tsx](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/components/formConfig.tsx:1578)

So the highest-risk consumers are:

- external API clients
- custom apps/modules that round-trip detail payloads into writes
- sync/import adapters that model updates around the detail response shape

## Challenged Reasoning

This section pressure-tests the current diagnosis.

### Hypothesis A: the update command is broken

Assessment: rejected.

Why:

- the command correctly updates `profile.linkedInUrl` when it receives top-level `linkedInUrl`
- the command already mutates all expected profile fields
- there is integration coverage for top-level profile-only updates in `TC-CRM-024`

Conclusion:

The command path is not the root cause.

### Hypothesis B: the database write succeeds but the detail read is stale

Assessment: rejected.

Why:

- the command only changes `profile.linkedInUrl` when `parsed.linkedInUrl !== undefined`
- if the request sends only `profile.linkedInUrl`, that value never reaches `parsed.linkedInUrl`
- there is no local evidence of a caching layer or stale read on this route that would explain a missing update with a success response

Conclusion:

This is not primarily a stale-read bug.

### Hypothesis C: the validator should already reject unknown keys

Assessment: rejected.

Why:

- the observed behavior is a success response, not a validation error
- the current schema construction does not define `profile`
- current behavior strongly implies unknown keys are stripped before command execution rather than rejected

Conclusion:

Permissive parsing is a required part of the failure mode.

### Hypothesis D: the real bug is only the success response shape

Assessment: partially true, but incomplete.

Why:

- returning `{ ok: true }` for a no-op is harmful
- but the deeper defect is the write contract mismatch and permissive parsing
- changing only the response shape would still leave nested `profile` writes unsupported or ambiguous

Conclusion:

Response semantics are part of the impact, not the whole root cause.

### Hypothesis E: PR `#796` fully resolves the issue

Assessment: likely resolves the reported payload, but may not fully close the silent-loss class.

Why:

- lifting known nested fields fixes the specific reported case
- the PR removes `payload.profile` after lifting supported keys
- unsupported nested keys may still be silently dropped unless the route explicitly rejects them

Conclusion:

PR `#796` is good inspiration, but may need a stricter follow-up.

## Proposed Solution

Adopt a compatibility bridge for the affected update routes:

1. normalize known `profile.*` person fields into the existing flat payload shape before validation for `PUT /api/customers/people`
2. normalize known `profile.*` company fields into the existing flat payload shape before validation for `PUT /api/customers/companies`
3. preserve top-level precedence when both top-level and nested values are present
4. reject unsupported nested `profile` keys with a `400` validation error
5. reject malformed non-object `profile` values with a `400` validation error
6. localize the new validation messages using specific translation keys
7. add focused regression tests for both acceptance and rejection paths

### Translation keys

The following i18n keys should be added for the new validation messages:

| Key | Default (en) | Used when |
|-----|-------------|-----------|
| `customers.people.profile.mustBeObject` | `profile must be an object` | `profile` is present but not an object |
| `customers.people.profile.unsupportedField` | `Unsupported profile field: {{field}}` | `profile` contains a key outside the supported set |
| `customers.companies.profile.mustBeObject` | `profile must be an object` | `profile` is present but not an object |
| `customers.companies.profile.unsupportedField` | `Unsupported profile field: {{field}}` | `profile` contains a key outside the supported set |

### Supported nested keys

The compatibility bridge should only lift fields that already belong to the person write contract:

- `firstName`
- `lastName`
- `preferredName`
- `jobTitle`
- `department`
- `seniority`
- `timezone`
- `linkedInUrl`
- `twitterUrl`
- `companyEntityId`

### Ignored nested keys (round-trip safe)

The GET detail response also returns `id` and `updatedAt` inside the `profile` object. Clients that round-trip the GET response into a PUT will send these as `profile.id` and `profile.updatedAt`. The normalization helper must **silently ignore** these keys rather than treating them as unsupported (which would trigger a 400). They are not lifted to the top level — they are simply removed from `profile` before the unsupported-key check runs.

The same applies to the companies GET detail response, which also returns `id` inside `profile`.

For companies, the compatibility bridge should only lift fields that already belong to the company write contract:

- `legalName`
- `brandName`
- `domain`
- `websiteUrl`
- `industry`
- `sizeBucket`
- `annualRevenue`

### Precedence rule

If both shapes are sent, top-level values win.

Example:

```json
{
  "linkedInUrl": "https://linkedin.example.com/in/top-level",
  "profile": {
    "linkedInUrl": "https://linkedin.example.com/in/nested"
  }
}
```

Resolved input:

```json
{
  "linkedInUrl": "https://linkedin.example.com/in/top-level"
}
```

This matches PR `#796` and avoids surprising overwrites.

### Unsupported nested keys

If `profile` contains keys outside the supported set, the route should fail with `400`.

Example:

```json
{
  "id": "<person-id>",
  "profile": {
    "favoriteColor": "blue"
  }
}
```

Expected behavior:

- do not return `{ ok: true }`
- return a specific validation-style error such as `Unsupported profile field: favoriteColor`

### Malformed `profile` values

If `profile` is present but is not an object, the route should fail with `400`.

Examples:

```json
{
  "id": "<person-id>",
  "profile": "abc"
}
```

```json
{
  "id": "<person-id>",
  "profile": 123
}
```

Expected behavior:

- do not ignore the malformed value
- return a specific validation-style error such as `profile must be an object`

### Why this approach

This keeps the change small and low-risk:

- no data model changes
- no command contract changes
- no GET response changes
- no breaking change for existing flat clients
- compatibility for clients that reuse the nested GET shape
- limited to `PUT` routes rather than broadening create flows
- keeps people and companies behavior aligned inside the same module family

## Rejected Alternatives

### Reject all nested `profile` payloads

Why not:

- technically cleaner as a contract boundary
- but likely breaks clients already relying on the read shape or naive round-tripping
- does not align with the likely intent behind PR `#796`

### Change `GET /api/customers/people/{id}` to flatten profile fields

Why not:

- high backward compatibility risk
- the nested `profile` shape is already part of the detail API contract
- would ripple into UI, API consumers, docs, and specs

### Teach the command layer to accept nested `profile`

Why not:

- the mismatch originates at the API boundary
- command inputs are already coherent and work for flat payloads
- pushing shape normalization lower would broaden surface area unnecessarily

### Return a richer update response indicating changed fields

Why not now:

- potentially useful longer-term
- larger cross-cutting API contract decision
- not required to close this bug safely

## Architecture

### Affected files

Primary (people):

- `packages/core/src/modules/customers/api/people/route.ts`
- new helper beside the route, such as `packages/core/src/modules/customers/api/people/payload.ts`
- tests under `packages/core/src/modules/customers/api/__tests__/`

Primary (companies):

- `packages/core/src/modules/customers/api/companies/route.ts`
- new helper beside the route, such as `packages/core/src/modules/customers/api/companies/payload.ts`
- tests under `packages/core/src/modules/customers/api/__tests__/`

Unchanged by design:

- `packages/core/src/modules/customers/commands/people.ts`
- `packages/core/src/modules/customers/commands/companies.ts`
- `packages/core/src/modules/customers/data/entities.ts`
- database schema

### Execution flow after fix (applies to `PUT` routes only)

1. route receives raw request body
2. route applies `withScopedPayload` (extracts `organization_id` and merges scoped context into the payload)
3. route checks whether `profile`, if present, is an object — returns 400 if not
4. route removes ignored round-trip keys (`id`, `updatedAt`) from `profile`
5. route normalizes supported nested `profile` keys into the flat payload (top-level wins)
6. route checks for remaining unsupported nested `profile` keys — returns 400 if any
7. route splits custom fields
8. route validates with the route-specific flat update schema
9. command executes unchanged
10. route returns existing success response

## Data Models

No entity or database changes are required.

The affected contract is request payload shape only.

## API Contracts

### Current read contract

`GET /api/customers/people/{id}` returns a nested `profile` object.

### Current write contract

`PUT /api/customers/people` and `PUT /api/customers/companies` accept profile fields at the top level.

### Intended write contract after fix

Accepted:

- existing top-level flat payloads
- nested `profile` payloads containing only supported person fields on `PUT /api/customers/people`
- nested `profile` payloads containing only supported company fields on `PUT /api/customers/companies`
- mixed payloads where top-level fields override nested values

Rejected:

- nested `profile` payloads containing unsupported keys
- non-object `profile` values
- malformed values that fail existing field validation

### OpenAPI impact

Two options exist:

1. keep the documented schema flat and treat nested `profile` as compatibility-only behavior
2. document a union-style request shape for compatibility

Decision:

Keep OpenAPI flat and treat nested `profile` support as a compatibility shim rather than a canonical request shape.

Reason:

- the flat shape is the underlying command contract
- documenting both shapes permanently may entrench a compatibility shim as first-class API design

## Implementation Phases

This is a single-phase change. All steps produce a working application.

### Phase 1: Compatibility bridge for `PUT` routes

| Step | Description | Testable outcome |
|------|-------------|-----------------|
| 1 | Create `normalizeProfilePayload` helper in `packages/core/src/modules/customers/api/people/payload.ts` with the supported person field list, ignored key list (`id`, `updatedAt`), and validation logic | Unit tests pass for lifting, precedence, ignored keys, rejection |
| 2 | Create `normalizeCompanyProfilePayload` helper in `packages/core/src/modules/customers/api/companies/payload.ts` with the supported company field list and the same ignored/validation logic | Unit tests pass for company lifting, precedence, ignored keys, rejection |
| 3 | Add translation keys for both people and companies validation messages | Keys resolve in default locale |
| 4 | Wire `normalizeProfilePayload` into `PUT /api/customers/people` route before custom field splitting | Nested `profile.linkedInUrl` PUT succeeds and persists; unsupported keys return 400 |
| 5 | Wire `normalizeCompanyProfilePayload` into `PUT /api/customers/companies` route before custom field splitting | Nested `profile.legalName` PUT succeeds and persists; unsupported keys return 400 |
| 6 | Add integration tests for people: nested success, unsupported key rejection, malformed profile rejection | Integration suite green |
| 7 | Add integration tests for companies: nested success, unsupported key rejection, malformed profile rejection | Integration suite green |
| 8 | Verify build passes (`yarn build`) | Clean build |

## Testing Plan

### Unit tests

Add route-level payload normalization tests covering:

- nested `profile.linkedInUrl` is lifted to top-level
- nested `profile.timezone` is lifted
- top-level value wins over nested value
- non-object `profile` returns a specific error
- unsupported nested `profile` key returns an error

### Integration tests

Add an API regression test covering:

1. create a person
2. `PUT /api/customers/people` with nested `profile.linkedInUrl`
3. assert success
4. `GET /api/customers/people/{id}`
5. assert `profile.linkedInUrl` changed

Add a second integration test:

1. create a person
2. `PUT /api/customers/people` with unsupported nested `profile` key
3. assert `400`
4. verify no change was persisted

Add a third integration test:

1. create a person
2. `PUT /api/customers/people` with `"profile": "abc"`
3. assert `400`
4. verify no change was persisted

Add company integration tests:

- `PUT /api/customers/companies` with `profile.legalName`
- unsupported nested `profile` company key returns `400`
- malformed non-object `profile` returns `400`
- specific validation errors are returned in the current locale contract used by the route layer

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|---|---|---|---|---|
| Accepting nested `profile` may unintentionally bless an undocumented shape forever | Medium | Public API contract | Treat it as compatibility behavior, keep canonical docs flat, add changelog note | Medium |
| Rejecting unsupported nested keys may break clients currently depending on silent ignore behavior | Medium | External API consumers | Release note the validation tightening and keep supported compatibility bridge narrow | Low |
| Rejecting malformed non-object `profile` values may surface hidden client bugs immediately | Low | External API consumers | Specific error messages and release-note callout | Low |
| Over-normalization could lift fields that do not belong to person profile updates | Medium | Customers people API | Whitelist only existing `personUpdateSchema` profile fields | Low |
| Over-normalization could lift fields that do not belong to company profile updates | Medium | Customers companies API | Whitelist only existing `companyUpdateSchema` profile fields | Low |
| Normalization before custom field splitting could interfere with `cf_*` handling | Low | Custom fields | Keep normalization limited to `profile` object and known field names only | Low |
| Fixing only `PUT` but not `POST` preserves inconsistent behavior between create and update | Medium | API surface consistency | Accept as deliberate narrow scope; document follow-up if needed | Medium |
| Localized error messages may require route-specific translation keys and snapshots | Low | Validation/i18n | Add explicit translation keys with stable wording and cover expected text shape in tests where practical | Low |
| Updating OpenAPI to show both shapes could unintentionally broaden compatibility expectations | Low | API docs | Keep OpenAPI flat unless product decision says otherwise | Low |

## Migration & Backward Compatibility

This change is additive for flat clients and compatibility-friendly for nested clients.

Contract review against `BACKWARD_COMPATIBILITY.md`:

- no route URL changes
- no event ID changes
- no type removal
- no schema/database changes
- no import path changes

Potential compatibility concern:

- stricter rejection of unsupported nested keys changes behavior from silent ignore to explicit error
- stricter rejection of malformed non-object `profile` changes behavior from implicit ignore/strip to explicit error

This is acceptable because the current behavior is a bug, but it should still be called out in release notes as validation tightening.

## Final Compliance Report

### Task Router review

Relevant guidance reviewed:

- root `AGENTS.md`
- `packages/core/AGENTS.md` via module development and CRUD route expectations
- `packages/core/src/modules/customers/AGENTS.md`
- `.ai/specs/AGENTS.md`

### Scope check

- focused on `customers` people API contract
- minimal implementation footprint expected
- no architectural sprawl

### Staff engineer review question

Would a staff engineer approve this?

Yes, if the implementation:

- fixes the reported payload safely
- rejects unsupported nested keys instead of silently discarding them
- rejects malformed non-object `profile` values explicitly
- localizes the new validation messages
- adds both unit and integration regression coverage
- keeps OpenAPI flat and the compatibility behavior narrow

## Open Questions

1. If we later extend compatibility to `POST /api/customers/people`, should we reuse the same helper or keep create/update normalization distinct?

### Resolved

2. ~~Do we want people and companies to share a generic nested-profile normalization utility, or keep them route-local to avoid over-abstraction?~~

   **Decision**: Keep them route-local with separate helpers (`normalizeProfilePayload` for people, `normalizeCompanyProfilePayload` for companies). The supported field lists differ per entity, so a shared generic adds indirection without meaningful reuse. If a third entity needs the same pattern, reconsider at that point.

## Follow-up Analysis: Companies

The same contract shape mismatch exists in the `companies` route family.

Detail route:

- `GET /api/customers/companies/{id}` returns nested company profile fields in `profile`
- evidence: [packages/core/src/modules/customers/api/companies/[id]/route.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/api/companies/[id]/route.ts:527)

Write route:

- `PUT /api/customers/companies` parses against flat `companyUpdateSchema`
- evidence: [packages/core/src/modules/customers/data/validators.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/data/validators.ts:104)
- evidence: [packages/core/src/modules/customers/api/companies/route.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/api/companies/route.ts:315)

Command:

- company profile fields are applied only when present at the top level
- evidence in command handling around `legalName`, `brandName`, `websiteUrl`, `industry`, `sizeBucket`, `annualRevenue`
- [packages/core/src/modules/customers/commands/companies.ts](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/commands/companies.ts:572)

Assessment:

- I did not find a matching upstream GitHub issue for `companies` during issue-tracker review
- the code structure repeats the same risk pattern found in `people`
- the local frontend mostly sends flat company updates, so exposure is again highest for external API clients and any round-trip consumer
- because no separate open issue was found, a same-change implementation for both `PUT` routes is acceptable if we proceed with code changes now

## Upstream Issue Cross-Reference

Confirmed upstream issues:

- `#792` `bug: POST /api/customers/people accepts nested profile payload but silently drops profile.linkedInUrl`
- `#793` `bug: PUT /api/customers/people returns ok=true for ignored nested profile updates`

Issue-tracker result for analogous `companies` bug:

- no matching open issue found during search
- no clearly matching closed issue found during search

Decision implication:

- if we implement now, `people` and `companies` can be fixed together for `PUT`
- `POST /api/customers/people` remains out of scope because issue `#792` already exists and should be handled as its own tracked change

## Changelog

### 2026-04-12

- Created spec for issue `#793` documenting the people detail/write contract mismatch, validating the likely root cause against local code, and defining a compatibility-bridge fix with stricter rejection for unsupported nested `profile` keys.
- Updated the spec with implementation decisions: keep OpenAPI flat, treat nested `profile` as a compatibility shim, scope the fix narrowly to `PUT`, use specific validation messages, reject malformed non-object `profile`, and record the analogous risk pattern in `companies`.
- Cross-referenced upstream issues: confirmed `#792` and `#793` for people, found no analogous open issue for companies, and updated scope guidance to allow same-change fixes for both `PUT` routes while keeping `POST` out of scope.
- Spec review: clarified two-stage Zod parse mechanism (passthrough entry then strip on update schema), added ignored round-trip keys (`profile.id`, `profile.updatedAt`), added companies to affected files, added i18n translation keys, added implementation phases, resolved open question #2 (route-local helpers).
