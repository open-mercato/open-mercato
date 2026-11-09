# Planner availability replace: reject windows whose end is not after start

## TLDR
`POST /api/planner/availability-weekly` and `POST /api/planner/availability-date-specific` replace a subject's hours by soft-deleting the matching rules and then creating one rule per window. A window whose end is not after its start (or whose time is out of range, such as `24:00`) was skipped after the delete, so the call returned `200` while the old hours disappeared. The window schemas now reject such windows, so the request fails with the documented `400` before anything is written.

## Scope
Planner `data/validators.ts` window schemas used by `plannerAvailabilityWeeklyReplaceSchema` and `plannerAvailabilityDateSpecificReplaceSchema`. No command, route, entity, event, permission or UI change.

## Proposed Solution
- Window `start` and `end` must match `HH:MM` with hours `00`-`23` and minutes `00`-`59`.
- Each window must have `end` strictly after `start`; the issue is reported on `windows[i].end`.
- Both commands already parse their input before opening the transaction, and both routes parse it before any write, so invalid input never reaches the delete step. The routes' existing error handling returns the translated `400` body.
- The command-level `start >= end` skip stays as a safety net for a date-specific window that the zone's DST gap inverts on that date.

## Data Models and API Contracts
No entity or migration change. Request shape is unchanged; status `400` is already listed in both routes' OpenAPI. Response shape is unchanged.

## Migration & Backward Compatibility
- Surface: `data/validators.ts` zod schema exports (STABLE, "MUST NOT remove or narrow"). `plannerAvailabilityWeeklyReplaceSchema` and `plannerAvailabilityDateSpecificReplaceSchema` now reject windows with `end <= start` and times outside `00:00`-`23:59`.
- Why no deprecation bridge: the input that is now rejected never produced a rule. Its only effect was deleting the subject's existing hours while reporting success, so keeping it for a minor release would keep losing data. The availability editor already refuses these windows before saving, so the change only reaches direct API callers.
- Callers: split an overnight window into two windows on consecutive days, and send `23:59` instead of `24:00`. Date-specific requests with `kind: 'unavailability'` ignore windows; send `[]` there.
- Existing data is not affected and needs no repair. Hours already lost through this path are not restored.
- Needs a maintainer's explicit sign-off as a narrowing of a STABLE surface.

## Integration Coverage
| Surface | Scenario | Evidence |
| --- | --- | --- |
| `POST /api/planner/availability-weekly` | Equal and inverted window on a rule set with one weekly rule | `400`, rule still listed (TC-PLAN-007) |
| `POST /api/planner/availability-date-specific` | Equal and inverted window on a date with one rule | `400`, rule still listed (TC-PLAN-007) |

Unit coverage: `commands/__tests__/availability-replace-inverted-window.test.ts` and `data/__tests__/validators.test.ts`.

## Changelog
- 2026-11-10: initial version.
