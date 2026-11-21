# Cache deal closure stats

Source doc: .ai/specs/2026-11-21-deal-stats-cache.md

Deliver #3666 by reusing the existing tenant-scoped CRUD cache after the route has authorized the deal. The implementation uses a 60-second TTL and verifies write-driven eviction against a warmed response.

## Implementation plan

### Phase 1: Cache closed-deal stats

1.1 Implement the scoped route cache and its unit coverage.

1.2 Add the API integration test for a real cache hit and invalidation after a peer deal closes.

1.3 Regenerate route artifacts and run the configured validation and review gates.

## Risks

Calendar rollover and authorization scope affect reuse of an entry. Unit coverage exercises both. A cache miss racing with a write can briefly repopulate stale data before the 60-second TTL elapses.

## Progress

PR: #10225

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Cache closed-deal stats

- [x] 1.1 Implement the scoped route cache and its unit coverage. — 8e1bbc7c4d, 17880d7c40
- [x] 1.2 Add the API integration test for a real cache hit and invalidation after a peer deal closes. — e39d9eaacb
- [ ] 1.3 Regenerate route artifacts and run the configured validation and review gates.
