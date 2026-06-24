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
| 6 | F2 — `AgentMetricRollup` + scheduler + worker | M | ☐ | |
| 7 | F9 — `llm_judge` assertion management | M | ☐ | |
| 8 | Guardrails P1 — output-schema + tool-scope | M | ☐ | |

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
