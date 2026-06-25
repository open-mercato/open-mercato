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
| 3 | W2.P3 — Document ingest / OCR extraction pipeline | context spec §Phase 3 · gap-06 | L | ✅ | `441352215` — 37 suites/157 tests; swappable `DocumentOcrProvider` (default wraps attachments OcrService), facts → bundle provenance w/ locator+confidence. Deferred: async IDP queue worker + standalone table (follow-up behind same interface) |
| 4 | W2.P4 — Redaction + token budget | context spec §Phase 4 | M | ✅ | `1c89bb516` — 38 suites/165 tests; redact-before-pack (field_encryption+pii) → `redactionApplied`, budget invariant on optional tier (floor-wins-over-cap per P1 test). **Wave 2 complete.** |
| 5 | W3.P3 — Prompt-injection / untrusted-content isolation | guardrails spec §Phase 3 · gap-08 | M | ✅ | `439778ad3` — 39 suites/175 tests; heuristic injection detector (checkInput) + always-on tool-scope backstop (ai_assistant allowlist + read-only mutation policy), pointer-only evidence, no migration. Model-judge layer-3 dark-launched per spec §5. |
| 6 | W3.P4 — Grounding (cite-or-abstain) | guardrails spec §Phase 4 · gap-09 | M | ✅ | `a67f10684` — 40 suites/182 tests; deterministic cite-or-abstain over bundle citable sources, new `AgentGuardrailSet` table + content-hash versioning synced in setup.ts. Migration `…20260625040000` NOT applied. LLM-faithfulness warn tier deferred. **Wave 3 complete.** |
| 7 | W4.P1 — `User.kind` + `AgentPrincipal` provisioning | identity spec §Phase 1 | M | ✅ | `39803f955` — enterprise 41 suites/189 tests; auth 526 tests pass. Additive `User.kind` (NOT NULL default 'human', auth migration `…20260625050000`) + `AgentPrincipal` entity/table + idempotent provisioning (non-interactive agent User, scoped Role). credentialMode internal\|oauth_client\|authmd. Migrations NOT applied. |
| 8 | W4.P2 — `ActionLog.onBehalfOfUserId` + `runAs` propagation + audit chain | identity spec §Phase 2 | M | ✅ | `173c3e0f7` — enterprise 43 suites/199, shared commands 15/121, audit_logs 9/53. Additive `ActionLog.onBehalfOfUserId`(nullable+idx)+`'agent'` source; `runAs` on `CommandRuntimeContext` stamps actor=agent/onBehalfOf=human via existing Command path; `/audit/by-instigator/:humanUserId` route+UI. Migration `audit_logs/…20260625120000` NOT applied. P3 hooks off `ctx.runAs`. |
| 9 | W4.P3 — External OAuth `/token` + `AgentDelegationGrant` + 3-layer no-bypass | identity spec §Phase 3 · gap-16 | L | ✅ | `39b7f098a` — enterprise 46 suites/221 tests; OAuth client-credentials /token (signAudienceJwt + api_keys precedent, server-derived scope/org), AgentDelegationGrant + optimistic-locked /revoke, fail-closed flush-time no-bypass subscriber (AsyncLocalStorage agent-actor + audited-command scopes, both runtimes) + propose-only + release-gate test. New `agent_delegation_grants` table NOT applied. Module-confined (no core/shared edits). |
| 10 | W4.P4 — ID-JAG self-registration (`/.well-known` + `/agent/auth`) | identity spec §Phase 4 | M | ✅ | `5cada5341` — enterprise 48 suites/239 tests; ID-JAG (RFC 7523 JWT-bearer) self-registration: `/.well-known` discovery + `/agent/auth` (verify issuer+aud+sig via shared verifyJwt → idempotent authmd principal+grant on issuer/subject/audience seam cols → shared mint core). No migration, no generated churn, reuses P3 services. **Wave 4 complete — all 3 waves done.** |

## Outcome (2026-06-25)

All 10 phases complete — one commit each (`ca89f1e81` → `5cada5341`). Module test suite grew from
33 suites/133 tests (start of run) to **48 suites / 239 tests**, all passing; enterprise + shared typecheck
clean; core has no new errors (only the known pre-existing orphan, below). Waves 2, 3, 4 all done.

Commits: P1 `ca89f1e81` · P2 `8c847c6d8` · P3 `441352215` · P4 `1c89bb516` · GuardP3 `439778ad3` ·
GuardP4 `a67f10684` · IdP1 `39803f955` · IdP2 `173c3e0f7` · IdP3 `39b7f098a` · IdP4 `5cada5341`.

### Maintainer handoff (outside this run's scope)
- **Apply migrations** (NOT applied this run). New/changed tables: `agent_context_bundles` (`…020000`),
  `agent_guardrail_sets` (`…040000`), `agent_principals` (`…050000`), `agent_delegation_grants` (`…060000`)
  in enterprise; `auth.users.kind` (auth `…050000`); `audit_logs.action_logs.on_behalf_of_user_id` +
  index (audit_logs `…120000`). Use `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true
  yarn workspace @open-mercato/app db:migrate` (root `yarn db:migrate` strips the env via turbo).
- **Sync ACLs** — new features `agent_orchestrator.context.read`, `identity.read`, `identity.manage`,
  `identity.tokens` (+ guardrail.* already synced). Regenerate the registry WITH the enterprise flags, then
  `… mercato auth sync-role-acls` (same gotcha as the prior run — sync reads the generated registry).
- **Env for external-agent auth**: set `AGENT_ID_JAG_ISSUERS` (trusted issuer registry) to enable the P4
  ID-JAG `/agent/auth` path; empty = fail-closed (no external self-registration).

### Deferred (flagged, not in this run's scope)
- Context P3 async IDP queue worker + standalone extractions table (follow-up behind `DocumentOcrProvider`).
- Guardrails injection model-judge layer-3 (dark-launched) + grounding LLM-faithfulness warn tier.
- Wave 0 leftovers F1 (S3 offload), F3 (partitioning), and Guardrails P2 (moderation/PII) — all still deferred.

## Notes / decisions

- Stale untracked `packages/core/src/modules/agent_orchestrator/generated/` is a pre-existing generator artifact from
  the enterprise move; leave untouched.
- Migrate/sync-role-acls only discover the enterprise module with
  `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true` (maintainer handoff, not in run scope).
