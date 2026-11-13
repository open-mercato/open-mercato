# Authenticated RLS concurrency — actual execution
Recorded: 2026-11-13T17:37:03.970Z
Revision: 2541f22ba5da6426472c145cd54fc7d1edb1169b; RLS: enabled, FORCE canary; DB_POOL_MAX=40.
Real /api/customers/people requests; 100 persisted non-superadmin staff users split evenly across two disposable tenants. Simultaneous HTTP requests may queue for database access. HTTP concurrency does not prove simultaneous SQL execution.
| Users | Peak HTTP | Requests | p50 ms | p95 ms | Errors | Isolation violations | Rows unchanged |
|---:|---:|---:|---:|---:|---:|---:|---|
| 20 | 20 | 200 | 179.59 | 1043.32 | 0 | 0 | true |
| 30 | 30 | 300 | 245.11 | 636.71 | 0 | 0 | true |
| 50 | 50 | 500 | 418.86 | 978.79 | 0 | 0 | true |
| 100 | 100 | 1000 | 1107.88 | 2941.81 | 0 | 0 | true |
Observed backendConnections is a post-level snapshot across all pools using the fixture role, including independent event/search pools; it is not the primary ORM pool size or peak active SQL count.
Latency covers the full HTTP response body; privileged persisted-row verification is excluded. Errors include unexpected status, malformed response, timeout and transport failure. Isolation violations count foreign-read contents, unexpected record IDs in own reads or accepted foreign writes; own deletion/name oracle failures count as errors. No tokens, database URLs or request bodies are included.