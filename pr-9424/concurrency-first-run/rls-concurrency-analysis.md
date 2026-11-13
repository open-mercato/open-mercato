# Authenticated RLS concurrency — actual execution
Recorded: 2026-11-13T15:00:23.999Z
Real /api/customers/people requests; 100 persisted non-superadmin staff users split evenly across two disposable tenants. Restricted runtime DB_POOL_MAX=1; simultaneous HTTP requests queue for database access. This is not an adapter off/on benchmark or proof of simultaneous SQL execution.
| Users | Peak HTTP | Requests | p50 ms | p95 ms | Errors | Isolation violations | Rows unchanged |
|---:|---:|---:|---:|---:|---:|---:|---|
| 20 | 20 | 80 | 208.24 | 1166.39 | 0 | 0 | true |
| 30 | 30 | 120 | 240.31 | 389.76 | 0 | 0 | true |
| 50 | 50 | 200 | 362.80 | 634.57 | 0 | 0 | true |
| 100 | 100 | 400 | 688.54 | 1299.57 | 0 | 0 | true |
Latency covers the full HTTP response body. Errors include unexpected status, malformed response, timeout and transport failure. Isolation violations count invalid read contents or accepted foreign writes. No tokens, database URLs or request bodies are included.