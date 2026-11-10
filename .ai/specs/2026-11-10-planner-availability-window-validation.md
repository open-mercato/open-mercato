# Planner availability replace: reject windows whose end is not after start

## TLDR
`POST /api/planner/availability-weekly` and `POST /api/planner/availability-date-specific` replace a subject's hours by soft-deleting the matching rules and then creating one rule per window. A window that could not be resolved (a time outside `00:00`-`23:59`, such as `24:00`) or whose resolved end was not after its start was skipped after the delete, so the call returned `200` while the old hours disappeared. Both commands now resolve every window before the transaction and refuse the request with `400` if any window is invalid.

## Problem and proposed solution
Both commands `parse` the input, open a transaction, delete the matching rules, then `return` from the per-window loop when a window resolves to `null` or `start >= end` (`commands/availability-weekly.ts`, `commands/availability-date-specific.ts`). The fix moves that resolution ahead of `em.transactional`: weekly windows through `zonedWeeklyAnchor`, date-specific windows through `toDateForDay` for every requested date. If any window is invalid the command throws `CrudHttpError(400, { error })` with the translated `planner.availability.errors.invalidWindow`; otherwise the transaction creates rules from the already resolved windows. Because the check uses resolved instants, it also covers a date-specific window that a DST gap collapses or inverts on that date. Date-specific requests with `kind: 'unavailability'` ignore their windows, as before, and are not checked. The `data/validators.ts` schemas are unchanged.

## Migration & Backward Compatibility
- Surface: the two routes' behaviour (API routes, STABLE). URL, request and response shapes are unchanged and `400` is already documented in both routes' OpenAPI. Requests with an invalid window now get `400` with a specific translated `error` instead of `200`.
- No warn-first bridge: an invalid window never produced a rule; its only effect was deleting the hours it was meant to replace while reporting success, so a bridge release would keep losing data. Requests mixing valid and invalid windows, which saved the valid ones, are now refused as a whole; requests whose invalid window met no existing rules, a no-op before, also get `400`, and so does an availability request with windows that lists an impossible date such as `2026-02-30`, which was skipped before.
- Callers: split an overnight window into two windows on consecutive days and send `23:59` instead of `24:00` (the last minute of the day can't be expressed, as in the editor). The availability editor already refuses inverted and out-of-range windows and sends `windows: []` for unavailability, so those cases only reach direct API callers. The editor does not know DST transitions, so a date-specific window inside a DST gap can still come from it; it now gets this `400` instead of deleting that day's hours. Redo of an action log recorded before this change with such a window now fails instead of deleting hours.
- Existing data is not repaired. Hours already lost through this path are not restored.

## Risks and architecture
- An integrator relying on `24:00` as end of day now gets `400` instead of losing hours silently; the upgrade note tells them to send `23:59`.
- An invalid window now short-circuits before the optimistic-lock check, so a request that is both stale and invalid gets `400` rather than `409`. Neither writes anything.
- No entity, migration, schema, response-shape, event or ACL change; no new coupling, DI registration or dependency.

## Final compliance review
Tenant and organization scoping, optimistic locking, undo snapshots and command events are unchanged. The error text is translated in all planner locales and passes through the routes' existing `CrudHttpError` handling. Unit tests cover both commands (equal, inverted and out-of-range windows plus a valid-window control each, and a DST-gap window and an unavailability control for date-specific); TC-PLAN-007 covers both routes against a rule set it creates and deletes.

## Changelog
- 2026-11-10: initial version.

- 2026-11-10: complex Polish browser QA exposed missing schedule-editor heading/dialog and weekday translations. Add the missing keys in all five shipped locales and translate the weekday used in the editor scope label; refusal/transaction behavior is unchanged.

- 2026-11-10: complex viewer-role QA found enabled schedule controls despite server-side403 refusal. The schedule detail caller now passes the server-resolved planner.manage_availability result to the editor's existing readOnly prop, failing closed while permission is unknown. API authorization and successful manager behavior remain unchanged. TC-PLAN-007 also creates dedicated viewer and wildcard-manager roles/users, verifies disabled/enabled schedule controls and direct viewer403, and removes its fixtures.

- 2026-11-10: shared resource/staff callers without module-specific dialog titles now fall back to the existing translated planner title keys. Explicit English/Polish QA verifies create/edit actions for planner, resources and staff; defined module overrides remain preferred.
