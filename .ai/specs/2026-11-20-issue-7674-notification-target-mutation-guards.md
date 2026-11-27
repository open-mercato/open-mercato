# Notification action target mutation guards (#7674)

Status: Implemented, pending review and QA.

## Behavior

Before claiming a command-backed notification action, run the shared custom-route mutation guard for its target. Keep the recipient and tenant lookup, outer notification guard, and required-feature authorization. The target guard receives the authenticated scope, original request headers, the stored source ID, and the command input.

By default, the target resource kind is the stored source type with colons replaced by dots and the operation is update. Confirmed in-tree producers use `staff:leave_request` and `workflows:user_task`. A server-registered action can declare `mutationGuard` when its target kind or operation differs. Update and delete actions require a stored source ID.

A refusal returns the guard's response status and body and leaves the notification pending. Accepted payload transformations reach the command with the stored source ID pinned. Target success callbacks run after the command succeeds. A failed command releases the existing provisional claim and skips the callbacks.

## Migration & Backward Compatibility

The command action endpoint keeps its URL and request shape. The service request context and registered action metadata gain optional fields. Existing staff and workflow notifications need no data changes.

The previous command dispatch behavior is a STABLE API contract. Dispatch without target validation is the vulnerability, so preserving that path through a bridge would leave it reachable. Command actions with unresolved targets return `notification_action_forbidden`. The upgrade notes cover affected clients and custom producers. A named maintainer must approve the Emergency Security Exception before merge.

## Verification

- In-process route and service coverage exercises guard denial, authorization ordering, wildcard grants, trusted source ID, request headers, payload updates, callbacks, retry, and concurrent execution.
- Service coverage exercises registered guard metadata and missing targets.
- The live API regression verifies that an existing record lock prevents a staff leave decision through either endpoint and that notification approval succeeds after release.

## Changelog

- 2026-11-27 — Apply target mutation guards before notification command dispatch.
