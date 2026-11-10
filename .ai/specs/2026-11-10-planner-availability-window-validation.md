# Planner availability replace: reject windows whose end is not after start

## TLDR
`POST /api/planner/availability-weekly` and `POST /api/planner/availability-date-specific` replace a subject's hours by soft-deleting the matching rules and then creating one rule per window. A window whose end is not after its start, or whose time is outside `00:00`-`23:59` (such as `24:00`), was skipped after the delete, so the call returned `200` while the old hours disappeared. The replace schemas now reject such windows, so the request fails with the documented `400` before anything is written.

## Problem and proposed solution
Both commands run `parse` before opening the transaction, then delete, then `return` from the per-window loop when a window cannot be resolved or `start >= end` (`commands/availability-weekly.ts`, `commands/availability-date-specific.ts`). The window schemas only checked the `\d{2}:\d{2}` shape. The fix adds one refinement in `data/validators.ts`, applied to `plannerAvailabilityWeeklyReplaceSchema` and to `plannerAvailabilityDateSpecificReplaceSchema` when the request creates availability: each window needs `HH:MM` times within `00:00`-`23:59` and `end` strictly after `start`. The issue is reported on `windows[i].start` or `windows[i].end` with the key `planner.availability.errors.invalidWindow`. Date-specific requests that resolve to `kind: 'unavailability'` keep ignoring their windows, as the command does. No command, route, entity, event, permission or UI change.

## Migration & Backward Compatibility
- Surface: `data/validators.ts` zod schema exports (STABLE, "MUST NOT remove or narrow"). The two replace schemas now reject the windows described above; the response shape and the documented `400` are unchanged.
- No deprecation bridge: the rejected input never produced a rule. Its only effect was deleting the subject's existing hours while reporting success, so a bridge release would keep losing data. Unavailability requests, where windows were ignored and nothing was lost, are not narrowed. The availability editor already refuses these windows and sends `windows: []` for unavailability, so only direct API callers are affected.
- Callers: split an overnight window into two windows on consecutive days, and send `23:59` instead of `24:00`. Redo of an action log recorded before this change with such a window now fails validation instead of deleting hours.
- Existing data is not repaired. Hours already lost through this path are not restored.
- Needs a maintainer's explicit sign-off as a narrowing of a STABLE surface.

## Risks and architecture
- An integrator relying on `24:00` as end of day now gets `400` instead of losing the hours silently; the upgrade note tells them to send `23:59`.
- Residual: a date-specific window that a DST gap inverts on that date (for example `02:30`-`03:00` on a spring-forward day) passes the schema, and the command still skips it after the delete. The window lies inside hours that do not exist that day; resolving it needs the zone in the command and is left out of this change.
- The schemas have no callers besides the two planner routes and commands. No new data, coupling, DI registration or dependency.

## Final compliance review
Tenant and organization scoping, optimistic locking, undo snapshots and command events are unchanged. The new key is translated in all planner locales. Unit tests cover both commands (equal, inverted and out-of-range windows, plus a valid-window control) and the schemas (issue paths and the unavailability control); TC-PLAN-007 covers both routes against a rule set it creates and deletes.

## Changelog
- 2026-11-10: initial version.
