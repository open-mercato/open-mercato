# Execution Plan — Agent platform capabilities, wave 5

- **Date:** 2026-10-28
- **Slug:** agent-platform-wave-5
- **Source specs:**
  - `.ai/specs/2026-10-21-agent-platform-capabilities-roadmap.md` (umbrella, wave 5)
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md` (Phases 3–5)
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md` (Phases 2–4)
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-run-observability-full-fidelity.md` (Phases 3–4)
  - `.ai/specs/2026-10-21-chat-run-tracing-and-citations.md` (Phases 3–4)
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-eval-reports-and-reproducible-regression.md` (Phases 3–5; EVAL-Q2 YAML approved)
- **Research (verified code facts, step scope, defaults, risks):** `research-integrity-identity-eval.md`, `research-observability-chat.md` in this folder
- **Base branch:** `main` (open-mercato/open-mercato), **stacked on** `feat/agent-platform-wave-4` (PR #8061 at `2d407b96f`; #7794/#8011/#8018/#8061 unmerged). Reviewers look only at commits after `2d407b96f`.
- **Branch:** `feat/agent-platform-wave-5`
- **User decision (2026-10-28):** all of wave 5 in ONE PR (not split).

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Declare the abstain_or_review integrity rule | dispatch | done | 40a4c30cf |
| 1 | 1.2 | Evaluate abstain_or_review after grounding | dispatch:capable | done | a053ff428 |
| 1 | 1.3 | Hold auto-approval on integrity warnings that request it | dispatch | done | e77d6648f |
| 1 | 1.4 | Emit agent_orchestrator.run.review_requested | dispatch:cheap | done | 5a120d46d |
| 1 | 1.5 | Declare and screen untrusted agent inputs | dispatch | done | 51d6d2985 |
| 1 | 1.6 | Delimit untrusted input fields in the model prompt | dispatch:capable | done | 0b44572cf |
| 1 | 1.7 | Return the integrity summary and raw output key from the run APIs | dispatch | done | 750310a24 |
| 1 | 1.8 | Show integrity rules and holds in the trace, caseload and agent UI | dispatch | done | b33b20205 |
| 1 | 1.9 | Add the guardrail_check eval scorer | dispatch | done | ffd559b5d |
| 1 | 1.9-review-fix | Keep ScorerRunView.guardrailChecks optional | inline | done | 482c0737e |
| 1 | 1.10 | Run the output pipeline in the OpenCode runner | dispatch:capable | done | b992db30f |
| 1 | 1.11 | Cover integrity review and untrusted inputs with integration tests | dispatch | done | eccc2fef7 |
| 1 | 1.11-review-fix | Wrap guardrail check rows in narrow cards | inline | done | d51ea26f5 |
| 2 | 2.1 | Close the agent identity route and tenant-scope follow-ups | dispatch:cheap | done | pending |
| 2 | 2.2 | Declare agent principals and sync them | dispatch:capable | done | pending |
| 2 | 2.3 | Run principal sync in setup and the CLI | dispatch | done | pending |
| 2 | 2.4 | Bind runAs centrally in the agent runtime | dispatch:capable | done | pending |
| 2 | 2.5 | Show the agent principal on the agents API and detail page | dispatch | done | pending |
| 2 | 2.6 | Add intersectFeatureGrants to shared | dispatch:cheap | todo | — |
| 2 | 2.7 | Resolve the effective tool ACL with an intersect mode | dispatch:capable | todo | — |
| 2 | 2.8 | Record tools denied by the principal | dispatch | todo | — |
| 2 | 2.9 | Carry audit correlation into action logs | dispatch:capable | todo | — |
| 2 | 2.10 | Stamp run and proposal correlation on agent and effector writes | dispatch | todo | — |
| 2 | 2.11 | List a run's actions and show them on the trace page | dispatch | todo | — |
| 2 | 2.12 | Cover principals and run actions with integration tests | dispatch | todo | — |
| 3 | 3.1 | Add the trace content namespace and tri-state artifact reads | dispatch:cheap | todo | — |
| 3 | 3.2 | Build redacted and capped LLM request and response artifacts | dispatch:capable | todo | — |
| 3 | 3.3 | Offload LLM content at the full capture level | dispatch:capable | todo | — |
| 3 | 3.4 | Offload the packed context payload | dispatch:capable | todo | — |
| 3 | 3.5 | Serve content artifacts with view_content, 410 and access logs | dispatch | todo | — |
| 3 | 3.6 | Add the trace content retention worker | dispatch | todo | — |
| 3 | 3.7 | Cover content capture with integration tests and docs | dispatch | todo | — |
| 4 | 4.1 | Accept llm and manifest fields on trace ingest | dispatch:capable | todo | — |
| 4 | 4.2 | Emit OpenCode per-message llm spans | dispatch:capable | todo | — |
| 4 | 4.3 | Report tool knowledge and retrieval over MCP | dispatch:capable | todo | — |
| 4 | 4.4 | Add the run compare API | dispatch:capable | todo | — |
| 4 | 4.5 | Add Request and Response tabs to model calls | dispatch:capable | todo | — |
| 4 | 4.6 | Add the run compare dialog and run-level copy | dispatch | todo | — |
| 4 | 4.7 | Cover compare and trace tabs with integration tests | dispatch | todo | — |
| 5 | 5.1 | Add the chat run ACL features and query validators | dispatch:cheap | todo | — |
| 5 | 5.2 | Add the chat runs API | dispatch:capable | todo | — |
| 5 | 5.3 | Add the chat runs list and detail pages | dispatch | todo | — |
| 5 | 5.4 | Link chat messages to their run trace | dispatch | todo | — |
| 5 | 5.5 | Cover the chat runs API and pages with integration tests | dispatch | todo | — |
| 6 | 6.1 | Add emitCitations and carry citations in tool output | dispatch:capable | todo | — |
| 6 | 6.2 | Add the citation resolver registry and citations UI part | dispatch | todo | — |
| 6 | 6.3 | Persist run citations and show Sources | dispatch | todo | — |
| 6 | 6.4 | Cover citations with integration tests and docs | dispatch | todo | — |
| 7 | 7.1 | Define the eval-set file format | dispatch | todo | — |
| 7 | 7.2 | Read and write eval sets as YAML | dispatch:cheap | todo | — |
| 7 | 7.3 | Start eval runs from a file manifest | dispatch:capable | todo | — |
| 7 | 7.4 | Add CLI --cases and eval-set export and validate | dispatch | todo | — |
| 7 | 7.5 | Add eval-set import and export APIs | dispatch:capable | todo | — |
| 7 | 7.6 | Add the tool replay seam to ai-assistant | dispatch:capable | todo | — |
| 7 | 7.7 | Forward modelSettings and eval callSettings | dispatch | todo | — |
| 7 | 7.8 | Record and replay tool fixtures in eval runs | dispatch:capable | todo | — |
| 7 | 7.9 | Fill the eval report environment block | dispatch | todo | — |
| 7 | 7.10 | Add the rubric library and rubricRef | dispatch | todo | — |
| 7 | 7.11 | Document the eval CI recipe | dispatch:cheap | todo | — |
| 7 | 7.12 | Cover eval-set import, export and settings with integration tests | dispatch | todo | — |
| 8 | 8.1 | Update the roadmap and upgrade notes for wave 5 | inline | todo | — |

## Goal

Finish the agent platform roadmap's depth-and-parity wave: integrity review routing and untrusted-input defenses with surfaces; declarative agent principals, least-privilege tool ACL and run-to-action audit correlation; full prompt/response content capture with retention, compare and per-message OpenCode spans; chat run trace UI with citations; and portable file eval sets with tool record/replay, call settings and rubrics.

## Scope

- **agent_orchestrator (enterprise):** Integrity P3–P5, Identity P2–P4, Observability P3–P4, Eval P3–P5. No AO DDL (squash-only).
- **ai-assistant (OSS):** chat runs API/pages/links (Chat P3), citations (Chat P4), MCP tool observation hook (O4.3), tool replay seam (E4.1). No ai-assistant migration (tables exist).
- **ui (OSS):** citation registry + part, chat links.
- **shared:** `intersectFeatureGrants`, `CommandRuntimeContext.auditCorrelation`.
- **core:** `audit_logs` `correlation_keys` projection column + GIN index (migration + snapshot), workflows executor correlation stamping, guard-test registrations.
- **New dependency:** `yaml` in `@open-mercato/enterprise` (EVAL-Q2 approved).

## Non-goals

- OTel P2 (content events, protobuf), DocStructure P4 (wave 6).
- A scripted LLM provider; scripted-model fixtures; "Sync principal" button; file-agent frontmatter for `principal`/`integrity`/`untrustedInputs`/rubrics; per-entry-point traces filter.
- Fixing #7794's CI/conflicts.

## Code facts

See the two research files (verified on `2d407b96f`). Key cross-cutting rules for executors:
- New AO commands → add to `packages/core/src/__tests__/optimistic-lock-command-coverage.test.ts`; new ACL features → titles in `packages/core/src/modules/auth/i18n/*.json` (`auth.acl.features.*`, 5 locales) and `setup.ts` grants.
- Server-side permission checks via `authorizeFeatures`; i18n in en/pl/de/es/ko (AO caps English-identical values); DS tokens only; no `any`.
- `yarn generate` rewrites `generated/file-agents.generated.ts` import style — revert unless intended.

## Implementation Plan

### Phase 1 — Integrity P3–P5
#### 1.1 Declare the abstain_or_review integrity rule
- Implements **I3.1** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 1.2 Evaluate abstain_or_review after grounding
- Implements **I3.2** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 1.3 Hold auto-approval on integrity warnings that request it
- Implements **I3.3** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 1.4 Emit agent_orchestrator.run.review_requested
- Implements **I3.4** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 1.5 Declare and screen untrusted agent inputs
- Implements **I4.1** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 1.6 Delimit untrusted input fields in the model prompt
- Implements **I4.2** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 1.7 Return the integrity summary and raw output key from the run APIs
- Implements **I5.1** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 1.8 Show integrity rules and holds in the trace, caseload and agent UI
- Implements **I5.2** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 1.9 Add the guardrail_check eval scorer
- Implements **I5.3** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 1.9-review-fix Keep ScorerRunView.guardrailChecks optional
- `lib/eval/types.ts` is importable through the package's `./*` export, so a new required field would break external run-view builders; the field is optional and the scorer treats it as `[]`.

#### 1.10 Run the output pipeline in the OpenCode runner
- Implements **I5.4** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 1.11 Cover integrity review and untrusted inputs with integration tests
- Implements **I5.5** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).

#### 1.11-review-fix Wrap guardrail check rows in narrow cards
- Found in the checkpoint-1 screenshot: in the three-column trace layout the output-integrity row squeezed the kind label to one character and pushed the result badge out of the card. Rows now wrap; the label keeps a minimum width.

### Phase 2 — Identity P2–P4
#### 2.1 Close the agent identity route and tenant-scope follow-ups
- Implements **D2.1** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.2 Declare agent principals and sync them
- Implements **D2.2** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.3 Run principal sync in setup and the CLI
- Implements **D2.3** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.4 Bind runAs centrally in the agent runtime
- Implements **D2.4** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.5 Show the agent principal on the agents API and detail page
- Implements **D2.5** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.6 Add intersectFeatureGrants to shared
- Implements **D3.1** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.7 Resolve the effective tool ACL with an intersect mode
- Implements **D3.2** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.8 Record tools denied by the principal
- Implements **D3.3** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.9 Carry audit correlation into action logs
- Implements **D4.1** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.10 Stamp run and proposal correlation on agent and effector writes
- Implements **D4.2** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.11 List a run's actions and show them on the trace page
- Implements **D4.3** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 2.12 Cover principals and run actions with integration tests
- Implements **D4.4** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).

### Phase 3 — Observability P3
#### 3.1 Add the trace content namespace and tri-state artifact reads
- Implements **O3.1** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 3.2 Build redacted and capped LLM request and response artifacts
- Implements **O3.2** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 3.3 Offload LLM content at the full capture level
- Implements **O3.3** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 3.4 Offload the packed context payload
- Implements **O3.4** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 3.5 Serve content artifacts with view_content, 410 and access logs
- Implements **O3.5** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 3.6 Add the trace content retention worker
- Implements **O3.6** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 3.7 Cover content capture with integration tests and docs
- Implements **O3.7** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).

### Phase 4 — Observability P4
#### 4.1 Accept llm and manifest fields on trace ingest
- Implements **O4.1** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 4.2 Emit OpenCode per-message llm spans
- Implements **O4.2** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 4.3 Report tool knowledge and retrieval over MCP
- Implements **O4.3** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 4.4 Add the run compare API
- Implements **O4.4** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 4.5 Add Request and Response tabs to model calls
- Implements **O4.5** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 4.6 Add the run compare dialog and run-level copy
- Implements **O4.6** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 4.7 Cover compare and trace tabs with integration tests
- Implements **O4.7** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).

### Phase 5 — Chat P3
#### 5.1 Add the chat run ACL features and query validators
- Implements **C3.1** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 5.2 Add the chat runs API
- Implements **C3.2** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 5.3 Add the chat runs list and detail pages
- Implements **C3.3** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 5.4 Link chat messages to their run trace
- Implements **C3.4** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 5.5 Cover the chat runs API and pages with integration tests
- Implements **C3.5** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).

### Phase 6 — Chat P4
#### 6.1 Add emitCitations and carry citations in tool output
- Implements **C4.1** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 6.2 Add the citation resolver registry and citations UI part
- Implements **C4.2** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 6.3 Persist run citations and show Sources
- Implements **C4.3** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 6.4 Cover citations with integration tests and docs
- Implements **C4.4** in `research-observability-chat.md` (scope bullets, code facts, defaults and risks there are binding for this Step).

### Phase 7 — Eval P3–P5
#### 7.1 Define the eval-set file format
- Implements **E3.1** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.2 Read and write eval sets as YAML
- Implements **E3.2** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.3 Start eval runs from a file manifest
- Implements **E3.3** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.4 Add CLI --cases and eval-set export and validate
- Implements **E3.4** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.5 Add eval-set import and export APIs
- Implements **E3.5** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.6 Add the tool replay seam to ai-assistant
- Implements **E4.1** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.7 Forward modelSettings and eval callSettings
- Implements **E4.2** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.8 Record and replay tool fixtures in eval runs
- Implements **E4.3** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.9 Fill the eval report environment block
- Implements **E4.4** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.10 Add the rubric library and rubricRef
- Implements **E5.1** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.11 Document the eval CI recipe
- Implements **E5.2** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).
#### 7.12 Cover eval-set import, export and settings with integration tests
- Implements **E5.3** in `research-integrity-identity-eval.md` (scope bullets, code facts, defaults and risks there are binding for this Step).

### Phase 8 — Close
#### 8.1 Update the roadmap and upgrade notes for wave 5
- Roadmap (`.ai/specs/2026-10-21-agent-platform-capabilities-roadmap.md`) wave-5 changelog; `UPGRADE_NOTES.md` wave-5 entry (new ACL features + `yarn mercato auth sync-role-acls`, `yaml` dependency, audit_logs migration + `create index concurrently` guidance, OAuth routes public, attribution change for agents with principals, `run.review_requested`, held auto-approvals, trace content quota); confirm every new env var is in `apps/mercato/.env.example` + the create-app template; each of the five specs has a 2026-10-28 changelog entry with its deviations.

## Risks

- **Size:** 59 Steps in one PR (user decision). The safety checkpoint after ~20 consecutive Steps stops for user review; review only commits after `2d407b96f`.
- **Behavior changes:** held auto-approvals (I3.3), attribution for agents with principals (D2.4), OAuth routes public (D2.1), definition hash change for agents declaring untrusted inputs (I4.2).
- **Core touches:** audit_logs migration (GIN index lock on large tables), workflows executor stamping, command bus.
- **Validation limits:** no LLM provider and no storage in the ephemeral app → model- and storage-dependent integration cases skip; ingest-based fixtures are the deterministic path.

## External References

None (`--skill-url` not used).
