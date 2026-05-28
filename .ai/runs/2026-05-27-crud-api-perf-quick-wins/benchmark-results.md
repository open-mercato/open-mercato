# benchmark: CRUD perf quick wins (issue #2044)
# 1000 iterations × 50 items, in-memory simulation

| Scenario                                      |    p50 |    p95 |    p99 |   mean |
|-----------------------------------------------|--------|--------|--------|--------|
| Phase 1 — legacy: per-row INSERT, blocking     |   25.04 |   25.11 |   25.46 |   25.06 |
| Phase 1 — batched INSERT, blocking             |    0.50 |    0.50 |    0.51 |    0.50 |
| Phase 1 — batched INSERT, fire-and-forget      |    0.00 |    0.00 |    0.01 |    0.00 |
| Phase 2 — CF defs: uncached                    |    3.00 |    3.01 |    3.01 |    3.00 |
| Phase 2 — CF defs: cache hit                   |    0.00 |    0.00 |    0.00 |    0.00 |
| Phase 3 — RBAC: two getGrantedFeatures()       |   10.01 |   10.02 |   10.04 |   10.01 |
| Phase 3 — RBAC: memoized once-per-request      |    5.00 |    5.01 |    5.02 |    5.01 |

Phase 1 (access logs): p50 25.04ms → 0.00ms (Δ 25.04ms, 100.0% faster)
Phase 2 (CF defs):     p50 3.00ms → 0.00ms (Δ 3.00ms, cache hit)
Phase 3 (RBAC memo):   p50 10.01ms → 5.00ms (Δ 5.00ms, 50.0% faster)
