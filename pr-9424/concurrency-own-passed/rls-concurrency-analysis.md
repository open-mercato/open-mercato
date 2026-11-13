# Authenticated RLS concurrency — actual execution
Recorded: 2026-11-13T15:27:42.322Z
Real /api/customers/people requests; 100 persisted non-superadmin staff users split evenly across two disposable tenants. Restricted runtime DB_POOL_MAX=1; simultaneous HTTP requests queue for database access. This is not an adapter off/on benchmark or proof of simultaneous SQL execution.
| Users | Peak HTTP | Requests | p50 ms | p95 ms | Errors | Isolation violations | Rows unchanged |
|---:|---:|---:|---:|---:|---:|---:|---|
| 20 | 20 | 200 | 307.84 | 1107.48 | 0 | 0 | true |
| 30 | 30 | 300 | 443.06 | 1012.60 | 0 | 0 | true |
| 50 | 50 | 500 | 685.36 | 1528.33 | 0 | 0 | true |
| 100 | 100 | 1000 | 1440.26 | 3450.57 | 0 | 0 | true |
Latency covers the full HTTP response body; privileged persisted-row verification is excluded. Errors include unexpected status, malformed response, timeout and transport failure. Isolation violations count foreign-read contents, unexpected record IDs in own reads or accepted foreign writes; own deletion/name oracle failures count as errors. No tokens, database URLs or request bodies are included.