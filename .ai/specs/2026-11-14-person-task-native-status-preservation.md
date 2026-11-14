# Preserve native task status on person profiles

## TLDR

Person profiles must display and preserve native task statuses when unified interactions are disabled. Renaming a canceled, in-progress or waiting task must not change its status to planned.

## Overview and problem

The merged task reader includes native interactions, but its compatibility projection exposed only a done boolean. The profile reconstructed every other status as planned, enabled canceled checkboxes and sent title edits through the binary todos adapter. The adapter correctly maps false to planned for its legacy contract; it cannot represent rich native status.

## Proposed solution and architecture

Keep the merged reader and its existing 403-only legacy fallback. Add optional `todoStatus` to canonical task projections and its OpenAPI response schema. The profile retains that value, falling back to the existing boolean when older servers or legacy providers omit it.

For a canonical-source task whose current status is neither planned nor done, use the existing dictionary-backed interaction editor and existing `PUT /api/customers/interactions` endpoint. Map only supplied title/body/schedule/priority/custom fields and retain the loaded optimistic-lock version. Existing adapter and external-provider planned/done writes keep their existing endpoint and boolean payload. Existing server permissions, mutation guards, command effects and tenant/organization scope remain authoritative.

## Data models and API contracts

No persistence or migration changes. `todoStatus?: string | null` is additive on the merged task response and existing exported row type. `todoIsDone` remains unchanged. No new write API, grant, command, event, module boundary or dependency is introduced.

## Migration & Backward Compatibility

Existing clients ignore the optional field. New clients fall back to the boolean for older responses. The binary todos adapter retains its request/response behavior. Rich native writes use an already-published canonical endpoint and its existing authorization; a denied canonical mutation must remain denied, with no downgrade to the binary adapter.

## Risks & Impact Review

| Failure | Mitigation | Residual risk |
| --- | --- | --- |
| Rich status reduced to planned | Exact status projection and canonical write; canceled/waiting/in_progress regression cases | Full browser and current-head CI remain required |
| Legacy role/provider regression | Keep existing default/provider endpoint, read fallback and payload tests | Existing authorization remains enforced |
| Stale task overwrite | Retain loaded version through scoped request headers | Missing legacy server versions retain established behavior |

## Integration coverage

`TC-CRM-090-task-profile-navigation.spec.ts` creates its own person and native tasks. For canceled/in_progress/waiting with unified mode off: assert merged GET status, canceled checkbox state, title-only dialog save through canonical PUT, whole-record preservation apart from title/version, reload persistence and screenshot. Existing navigation/reload cases cover both interaction modes. Hook/component/mapper regressions cover exact status, endpoint selection, old boolean/provider behavior and version forwarding.

## Final compliance report

Same customers module; additive response only; existing guards, scoped commands and version headers retained. No hand-edited generated output. Focused tests, generation, type checks and fresh hosted CI are recorded in the PR review; complex QA is a separate gate.

## Changelog

- 2026-11-14: Documented the compatibility-mode native status repair and exact regression coverage.
