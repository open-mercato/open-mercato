---
title: "Realtime detail refreshes must preserve drafts and reject stale responses"
modules: ["warranty_claims", "ui", "events"]
areas: ["backend-ui", "testing"]
topics: ["events", "realtime", "request-ordering", "testing"]
---

# Realtime detail refreshes must preserve drafts and reject stale responses

**Context**: Issue #7847 exposed a portal claim tracker that did not consume its existing customer-visible status and comment events. Adding subscriptions also introduced overlapping refresh requests.

**Failure modes**: Reusing the initial loading view during an event refresh removes the comment form from the DOM, interrupting typing and focus. Two rapid events can also finish their requests in reverse order, allowing an older status or timeline snapshot to overwrite the newest result.

**Rule**: Refresh an already displayed detail view in the background while retaining its controlled drafts and mounted inputs. Filter events by the intended audience event ID and current record. Track request generations separately for detail and timeline reads, applying only the newest response and suppressing stale detail errors and loading finalizers.

**Verification**: Dispatch actual portal DOM events in component tests. Defer responses to check that the draft remains mounted, focused, and editable, then resolve two refreshes newest-first to prove the older response cannot replace the latest state. Cover unrelated events and subscription cleanup as well.
