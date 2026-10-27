# Notify — 2026-10-27-agent-platform-wave-4

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-27T16:59:59Z — run started
- Brief: agent platform wave 4 — Observability P2 (per-step gen_ai params/usage/cost, capture policy, om.capture) + OTel P1 (opt-in replay exporter to OTLP/HTTP JSON).
- External skill URLs: none
- Stacked on feat/agent-platform-wave-3 (11031e1e6) because #7794, #8011 and #8018 are unmerged.
- Decision: `full` capture is accepted by the policy but records metadata only until Observability P3 (`om.content.status = "disabled"`).
- Decision: OTel export has no job-id dedupe (the queue supports only `delayMs`); at-least-once with deterministic ids.

## 2026-10-27T17:14:38Z — checkpoint 1
- Steps 1.1..1.4 (+1.3-review-fix) verified: typecheck, AO jest 2048/2048, ai-assistant jest 2182/2182.
- Decision: additive `callerManaged?` on `AiAgentModelCallStartEvent` marks the caller-callback branch as `reconstructed`; SDK-synthesized object calls are `exact`.
- Delegations so far: executors for 1.1, 1.2 (cheap tier), 1.3, 1.4.

## 2026-10-27T17:36:39Z — checkpoint 2
- Draft PR #8061 opened and claimed after the user pushed the branch.
- Steps 2.1..2.5 verified: typecheck, AO jest 2111/2111, core guards, build:app --force.
- UI browser check deferred to checkpoint 3 (Step 3.3 writes the spec that captures the screenshots).
- Delegations: executors for 2.1, 2.2, 2.3 (cheap tier), 2.4, 2.5.

## 2026-10-27T17:56:10Z — checkpoint 3
- Steps 3.1..3.3 verified: typecheck, AO jest 2104 (+1 suite re-run alone after a worker SIGSEGV), TC-AGENT-TRACE-005 2 passed / 1 skipped (no LLM).
- Screenshots in checkpoint-3-artifacts/. Observability P2 complete.
- Delegations: executors for 3.1, 3.2, 3.3 (3.3 ran the spec against the ephemeral app started by the main session).

## 2026-10-27T18:17:02Z — checkpoint 4
- Steps 4.1..4.5 verified: typecheck, AO jest 2235/2235. No UI in this window.
- Delegations: executors for 4.1, 4.2 (cheap tier), 4.3, 4.4, 4.5.

## 2026-10-27T19:02:58Z — Step 4.11 finding (escalate)
- Tenant OTel export settings changes reach the export subscriber and worker only after the module-config cache TTL (60 s). `ModuleConfigService.setValue` refreshes the cache entry under the request's tenant cache scope (`tenant:<id>:`), while the subscriber/worker read it in the global cache scope (`tenant:global:`), so a tenant opt-out still exports runs for up to 60 s (reproduced on the ephemeral app; same pattern applies to other AO module-config reads off the request path). Fix belongs in core `configs/lib/module-config-service.ts` (scope cache ops by `scope.tenantId`) or in AO reads via `runWithCacheTenant` — not done here (cross-package, ask first). TC-AGENT-OTEL-002 waits out the TTL after each settings change; drop the waits once fixed.
- The test-span 429 cannot be exercised in the ephemeral app (`OM_INTEGRATION_TEST` disables rate limiting); TC-AGENT-OTEL-001 accepts 200 with a note, unit test covers 429.
- TC-AGENT-OTEL-003 (CLI dry-run) is a unit test in `__tests__/otel-export-backfill.test.ts` through the real `cli.ts` command: no integration spec shells out to the CLI.

## 2026-10-27T19:33:38Z — decision: module-config cache fix in core
- TC-AGENT-OTEL-002 found that background workers read module-config cache entries under `tenant:global:` while routes write under `tenant:<id>:` (stale up to 60 s). The user chose to fix it in core `configs` in this PR (row 4.11-review-fix).

## 2026-10-27T19:43:17Z — checkpoint 5
- Steps 4.6..4.11-review-fix verified: build, typecheck, AO jest 2341/2341, core 101/101, integration 5 passed / 1 skipped on a rebuilt app with the OTel exporter env.
- Cache-scope fix confirmed end-to-end (TC-AGENT-OTEL-002 without TTL waits).
- Delegations: executors for 4.6..4.11 and 4.11-review-fix (4.10 cheap tier).

## 2026-10-27T21:10:39Z — final gate
- Validation gate green after 5.2-review-fix (core guard registrations); integration 2954 passed, 12 failed (all pre-existing, load-only or flaky — classified in final-gate-checks.md), 3 flaky; DS lint clean.
