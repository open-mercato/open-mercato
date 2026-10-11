# TC-AGENT-PERF — env-gated coverage (manual / dedicated environment only)

Source spec: `.ai/specs/enterprise/agent-orchestrator/2026-07-06-agent-orchestrator-performance-hardening.md` → "Integration Coverage".

Three rows of the coverage table require restarting the server (and/or a worker fleet) with
forced-low env values. The shared integration environment boots once with production-like
defaults, so these rows CANNOT be exercised as ordinary `__integration__` specs without
faking the condition — which would test nothing. Their **semantics are already proven by
unit tests** (listed per row); this file documents how to verify each end-to-end in a
dedicated environment when needed.

The automated specs in this folder (`TC-AGENT-PERF-001..004.spec.ts`) cover the remaining
rows: default `created_at DESC` list ordering, `metrics/overview` (+ RBAC), caseload server
pagination beyond 100 rows, and org isolation.

---

## 1. INVOKE_AGENT via the dedicated `workflow-invoke-agent` queue (+ drain bridge)

Unit coverage: `packages/core/src/modules/workflows/lib/__tests__/invoke-agent-queue-split.test.ts`
(enqueue targets the new queue; a pre-existing job on `workflow-activities` still processes via
the deprecated bridge branch) and `invoke-agent-retryable.test.ts` (`AgentCapacityError` rethrows
as a retryable job failure instead of failing the step).

Manual verification (requires a real queue backend and worker processes):

```bash
# Server + workers with the async strategy and both workers running
QUEUE_STRATEGY=async \
WORKERS_WORKFLOW_INVOKE_AGENT_CONCURRENCY=5 \
yarn mercato queue worker --all
```

1. Start a workflow containing an `INVOKE_AGENT` step (any definition with the step type;
   `POST /api/workflows/instances`).
2. Observe the job land on the `workflow-invoke-agent` queue (queue depth / worker logs show
   `workflows:workflow-invoke-agent` picking it up) — NOT on `workflow-activities`.
3. The instance parks and later resumes with the agent outcome; fast activities (timers,
   emails) on `workflow-activities` keep processing while the agent job runs.
4. Bridge: enqueue an `invoke_agent` job directly onto `workflow-activities` (simulating a
   job enqueued pre-deploy), confirm the old worker's deprecated branch still completes it.

## 2. `POST /agents/[id]/run` under saturation → 429 + `Retry-After`

Unit coverage: `packages/enterprise/src/modules/agent_orchestrator/__tests__/admission.test.ts`
(admits ≤ caps, FIFO order, per-tenant isolation, nested-run bypass, bounded-wait expiry,
release-on-throw) and `agent-runtime-protection.test.ts` (route mapping of
`AgentCapacityError`).

Manual verification (forced-low caps; restart the server with):

```bash
OM_AGENT_MAX_CONCURRENT_RUNS=1 \
OM_AGENT_MAX_CONCURRENT_RUNS_PER_TENANT=1 \
OM_AGENT_ADMISSION_MAX_WAIT_MS=1000 \
OM_AGENT_ADMISSION_MAX_QUEUE=1 \
yarn dev
```

1. Fire two concurrent `POST /api/agent_orchestrator/agents/<id>/run` playground requests
   (a slow/stub agent keeps the first one holding the only slot).
2. Expected: the N+1th caller past the bounded wait returns **429** with a `Retry-After`
   header (seconds derived from `OM_AGENT_ADMISSION_MAX_WAIT_MS`) and the i18n
   `agent_orchestrator.errors.capacity` message; no `agent_runs` row is created for the
   rejected attempt (the gate acquires before any DB write).
3. A queued caller admitted within the wait window (raise `OM_AGENT_ADMISSION_MAX_WAIT_MS`,
   finish the first run quickly) succeeds normally.
4. Per-tenant isolation: saturate tenant A's slice (`..._PER_TENANT`) and confirm a tenant-B
   run is still admitted while the global cap has headroom.

## 3. In-process run timeout (`OM_AGENT_RUN_TIMEOUT_MS`)

Unit coverage: `packages/enterprise/src/modules/agent_orchestrator/__tests__/agent-runtime-protection.test.ts`
(deadline race fails the run exactly once; no orphaned `running` row; typed
`AgentRunTimeoutError`).

Manual verification (forced-low timeout; restart the server with):

```bash
OM_AGENT_RUN_TIMEOUT_MS=1000 yarn dev
```

1. Run an in-process (non-OpenCode) agent whose execution exceeds 1s (any real LLM call
   qualifies) via the playground route.
2. Expected: the run finishes with `status='error'` and a timeout `error_message`
   (`agent_orchestrator.errors.timeout` surfaced by the route as a 422); querying
   `GET /runs?status=running` shows NO orphaned `running` row for it.
3. The OpenCode path is unaffected (its own `OM_OPENCODE_RUN_TIMEOUT_MS` ceiling, unchanged).

## 4. SSE refetch coalescing

Covered by the component unit test
`packages/enterprise/src/modules/agent_orchestrator/__tests__/use-coalesced-reload.test.tsx`
(a burst of `proposal.created` events triggers ≤1 reload per coalescing interval) — the spec
row explicitly allows component-level coverage. No integration test needed; SSE-driven pages
never reach network-idle, so a browser-level burst test would be inherently flaky.
