# Agent Orchestrator — Waves 2, 3, 4

> **Started:** 2026-06-25 · **Branch:** `feat/agent-orchestrator-mvp`
> **Source:** `.ai/specs/enterprise/agent-orchestrator/next/IMPLEMENTATION-TRACE.md` (Implementation Plan)
> **Module:** `packages/enterprise/src/modules/agent_orchestrator/`
> **Scope decision (user):** the next three ENTIRELY-unstarted waves — Wave 2 (Context P1–P4),
> Wave 3 (Guardrails P3–P4), Wave 4 (Identity P1–P4). Deferred Guardrails P2 (moderation/PII) is NOT in scope.

## Execution model

One subagent per phase, run sequentially (phases share central files: `data/entities.ts`, `acl.ts`,
`setup.ts`, `events.ts`, `di.ts`, `i18n`, `INVOKE_AGENT`). After each phase the orchestrator commits.
Per phase: `yarn workspace @open-mercato/enterprise typecheck` + module tests
(`yarn workspace @open-mercato/enterprise test -- --testPathPattern agent_orchestrator`), fix until green.
Migrations are **hand-authored + snapshot updated only, NOT applied** (`yarn db:migrate` is the maintainer's call).

## Phases

| # | Wave.Phase | Spec / gap doc | Effort | Status | Commit |
|---|-----------|----------------|--------|--------|--------|
| 1 | W2.P1 — ContextModule registry + TDCR + `AgentContextBundle` | context spec §Phase 1 · gap-10 | M | ✅ | `ca89f1e81` — 35 suites/144 tests |
| 2 | W2.P2 — Retrieval source (`searchService` RRF + `query_index`), `retrieve()` | context spec §Phase 2 | M | ✅ | `8c847c6d8` — 36 suites/150 tests; `retrieve()` returns citable `RetrievedSnippet[]` (sourceRef+locator+score, locator REQUIRED) — Wave 3 grounding contract |
| 3 | W2.P3 — Document ingest / OCR extraction pipeline | context spec §Phase 3 · gap-06 | L | ✅ | `<pending>` — 37 suites/157 tests; swappable `DocumentOcrProvider` (default wraps attachments OcrService), facts → bundle provenance w/ locator+confidence. Deferred: async IDP queue worker + standalone table (follow-up behind same interface) |
| 4 | W2.P4 — Redaction + token budget | context spec §Phase 4 | M | ⬜ | |
| 5 | W3.P3 — Prompt-injection / untrusted-content isolation | guardrails spec §Phase 3 · gap-08 | M | ⬜ | |
| 6 | W3.P4 — Grounding (cite-or-abstain) | guardrails spec §Phase 4 · gap-09 | M | ⬜ | |
| 7 | W4.P1 — `User.kind` + `AgentPrincipal` provisioning | identity spec §Phase 1 | M | ⬜ | |
| 8 | W4.P2 — `ActionLog.onBehalfOfUserId` + `runAs` propagation + audit chain | identity spec §Phase 2 | M | ⬜ | |
| 9 | W4.P3 — External OAuth `/token` + `AgentDelegationGrant` + 3-layer no-bypass | identity spec §Phase 3 · gap-16 | L | ⬜ | |
| 10 | W4.P4 — ID-JAG self-registration (`/.well-known` + `/agent/auth`) | identity spec §Phase 4 | M | ⬜ | |

## Notes / decisions

- Stale untracked `packages/core/src/modules/agent_orchestrator/generated/` is a pre-existing generator artifact from
  the enterprise move; leave untouched.
- Migrate/sync-role-acls only discover the enterprise module with
  `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true` (maintainer handoff, not in run scope).
