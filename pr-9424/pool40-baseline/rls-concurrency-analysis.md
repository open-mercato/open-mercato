# Authenticated RLS concurrency — actual execution
Recorded: 2026-11-13T17:51:00.371Z
Revision: bf633ea9329915e36d37f44a5e0ce2ffd87f8841; RLS: disabled, pre-PR application; DB_POOL_MAX=40.
Real /api/customers/people requests; 100 persisted non-superadmin staff users split evenly across two disposable tenants. Simultaneous HTTP requests may queue for database access. HTTP concurrency does not prove simultaneous SQL execution.
| Users | Peak HTTP | Requests | p50 ms | p95 ms | Errors | Isolation violations | Rows unchanged |
|---:|---:|---:|---:|---:|---:|---:|---|
| 20 | 20 | 200 | 148.38 | 1122.21 | 0 | 0 | true |
| 30 | 30 | 300 | 174.55 | 364.66 | 0 | 0 | true |
| 50 | 50 | 500 | 285.12 | 633.88 | 0 | 0 | true |
| 100 | 100 | 1000 | 503.06 | 1134.66 | 0 | 0 | true |
Observed backendConnections is a post-level snapshot across all pools using the fixture role, including independent event/search pools; it is not the primary ORM pool size or peak active SQL count.
Latency covers the full HTTP response body; privileged persisted-row verification is excluded. Errors include unexpected status, malformed response, timeout and transport failure. Isolation violations count foreign-read contents, unexpected record IDs in own reads or accepted foreign writes; own deletion/name oracle failures count as errors. No tokens, database URLs or request bodies are included.