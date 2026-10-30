# Agent Orchestrator — Waves 0–2 (foundational subset)

> **Started:** 2026-06-24 · **Branch:** `feat/agent-orchestrator-mvp`
> **Source:** `.ai/specs/enterprise/agent-orchestrator/next/IMPLEMENTATION-TRACE.md` (Implementation Plan)
> **Module:** `packages/enterprise/src/modules/agent_orchestrator/`
> **Scope decision (user):** foundational subset first — F4, F5, F8, F6, F7, F2, F9, Guardrails P1.
> Defer the L-effort items: **F1** (S3 offload), **F3** (partitioning — risk-high, deferred per user),
> **Context P1–P4**, **Guardrails P2–P4**. Stop and report after the subset.

## Execution model

One subagent per phase. After each: `yarn workspace @open-mercato/enterprise typecheck`
(or scoped) + module tests (`yarn workspace @open-mercato/enterprise test -- --testPathPattern agent_orchestrator`),
fix, then **commit**. Migrations are **generated/hand-authored only, NOT applied** (`yarn db:migrate` is the maintainer's call).

Baseline before run: 26 suites / 111 tests pass.

## Progress

| # | Phase | Effort | Status | Commit |
|---|-------|--------|--------|--------|
| 1 | F4 — `/runs` ACL gate rollout safety | S | ✅ | runs-acl-rollout.test.ts + DEMO.md runbook note (27 suites/112 tests) |
| 2 | F5 — module `encryption.ts` + decryption reads | S | ✅ | encryption.ts (4 entities) + 5 reads → findWithDecryption + encryption.test.ts (28 suites/117 tests) |
| 3 | F8 — runner stamps `runtime`+`externalRunId` | S | ✅ | createRun threads runtime/externalRunId; opencode=session.id, in-process stamps runtime; run-runtime-stamping.test.ts (29 suites/119 tests) |
| 4 | F6 — dispose→correction hook test | S | ✅ | dispose-correction-hook.test.ts (4 cases, mutation-verified non-vacuous; 30 suites/123 tests) |
| 5 | F7 — i18n flatten + de/es/pl | M | ✅ (already done) | en.json already flat; de/es/pl fully translated (387 keys each, only legit loanwords identical to EN); `i18n:check-sync` + `check-values` clean for agent_orchestrator. No change needed. (Only `workflows` has a sync issue — out of scope.) |
| 6 | F2 — `AgentMetricRollup` + scheduler + worker | M | ✅ | entity+migration+snapshot, metricRollupService (canonical windows, bucketed idempotency), worker, 300s scheduler in setup, metrics route prefers rollup w/ live fallback; metric-rollup.test.ts (31 suites/125 tests). Overview page repoint = TODO follow-up. |
| 7 | F9 — `llm_judge` assertion management | M | ✅ | CRUD route (4 verbs gated eval.manage, optimistic lock) + backend page (i18n ×4, check-sync green) + seeded disabled llm_judge_helpfulness example + create→enable→judge test (32 suites/129 tests) |
| 8 | Guardrails P1 — output-schema + tool-scope | M | ✅ | AgentGuardrailCheck entity + guard_results col (migration+snapshot), guardrail.tripped event, guardrail.read/manage ACL, GuardrailService (checkOutput schema+tool_scope; checkInput stub), read route, runtime post-call wiring (block fails, pass non-disruptive), guardrails-output.test.ts (33 suites/133 tests) |

## Outcome (2026-06-25)

All 8 foundational-subset phases complete — one commit each (F4 `418b0e27b` → Guardrails P1 `3357fdaed`).
Final module state: **33 suites / 133 tests pass** (baseline 26/111), enterprise `typecheck` clean,
`i18n:check-sync` green for agent_orchestrator. F7 needed no code (already done).

### Maintainer handoff (actions outside this run's scope)
- **Apply migrations** — ✅ DONE 2026-06-25. `Migration20260625000000` (F2 `agent_metric_rollups`) +
  `Migration20260625010000` (Guardrails P1 `agent_guardrail_checks` + `agent_proposals.guard_results`) applied;
  re-run reports `no pending`. NOTE: the migrate CLI only discovers the enterprise module when run with
  `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true` AND via
  `yarn workspace @open-mercato/app db:migrate` (the root `yarn db:migrate` goes through turbo, which strips those
  env vars). Enabling enterprise also caught up `record_locks` (4 migrations applied).
- **Sync ACLs** — ✅ DONE 2026-06-25. Granted `guardrail.read` (employee/operator/engineer + superadmin/admin wildcards),
  `guardrail.manage` (engineer), and `trace.*`/`eval.*` per setup.ts. GOTCHA: `sync-role-acls` reads the **generated
  module registry** (`tryGetModules()`), not the env-aware resolver `migrate` uses — so the enterprise module was invisible
  until the registry was regenerated WITH the flags: `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true yarn workspace @open-mercato/app generate`,
  then the same-flagged `... mercato auth sync-role-acls`. (Regen also enabled record_locks/system_status_overlays/agent_examples
  in this checkout's registry; reverts on a no-flag `yarn generate`.)
- **Pre-existing orphan**: stale untracked `packages/core/src/modules/agent_orchestrator/generated/` (leftover from the
  enterprise move) breaks full-repo `yarn typecheck`. Left untouched (deletion denied / not in scope) — safe to remove.
- Pre-existing unstaged `docker/opencode/...` deletions remain (from the move) — left untouched.

## Deferred (flagged for follow-up)

- **F1** Encrypted S3 artifact offload (needs F5; first `storageService` consumer — validate proxy flow).
- **F3** Span/tool-call partitioning + tiered retention (risk-high, irreversible drop+recreate; confirm no env has live span data first).
- **Guardrails P2–P4** (moderation/PII, injection isolation, grounding — P3/P4 need Context `retrieve()`).
- **Context P1–P4** (TDCR, retrieval, doc-ingest OCR, redaction/budget).
- **F10** cockpit guard-results panel — unblocked once Guardrails P1 lands; can be a quick follow-up.

## Notes / decisions

- Stale untracked `packages/core/src/modules/agent_orchestrator/generated/` is a generator artifact from the
  pre-move location; leave untouched (not part of this work).
- Pre-existing unstaged `docker/opencode/...` deletions are from the enterprise move; leave untouched.
