# CRUD sort map boundary

Status: implemented; validation and review recorded on the fix PR for #3827.

## Problem and scope

The query-engine list path resolves client sort names through a route's map but
passes unrecognized names through as ordinary database selectors. Inherited
object properties also count as mappings. A map must bound ordinary requested
selectors, while dynamic custom-field sorting remains supported.

## Implementation

Use own map properties only. When a map exists, an unmapped ordinary requested
field falls back to the route's trusted default sort (or ascending `id`). The
fallback also discards the rejected request's direction. Trusted default and
tiebreak fields can still name database selectors. Routes without a map retain
raw selectors. Existing `cf_` and `cf:` selectors remain supported by the custom
field query path; they do not grant ordinary-column access.

No startup, configuration format, architecture, dependency or database changes.

## Migration & Backward Compatibility

Request and response shapes remain unchanged. Clients sending ordinary names
outside a supplied map now receive the default order. Route authors must add an
explicit own-property alias for each ordinary selectable column. Dynamic custom
fields and routes without maps retain their existing behavior. Keeping the raw
fallback alongside a strict mode would retain the reported boundary bypass.
Human review must acknowledge this security narrowing before merge; this run
does not grant a compatibility waiver.

## Validation

The CRUD route regression suite exercises mapped fields, unmapped fields,
prototype names, custom fields, no-map routes, default ordering and tiebreaks
through real GET handlers and asserts the selectors sent to the query engine.
No new endpoint or UI path is introduced. A live catalog smoke check should
confirm ordinary mapped sorting and custom-field sorting after deployment.

## Changelog

- 2026-11-07: Implemented sort-map enforcement for ordinary client selectors.
