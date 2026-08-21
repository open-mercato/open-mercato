# OpenCode security parity and model-use evidence

> **Status:** Implemented
> **Scope:** Enterprise, `agent_orchestrator`

## TLDR

The hardened Agent Orchestrator profile now accepts OpenCode agents only through the same content-safety, tool-scope, proposal approval, and mandatory-trace controls used by native agents. Every resolved provider/model pair is recorded per tenant and can be exported with deployment-configured processing location and retention information.

## Problem statement

SEC-006 rejected OpenCode in hardened mode because its trace and guardrail path was weaker than the native path. Model/provider identifiers were also spread across run and trace records, without a tenant-scoped compliance registry or export.

## Proposed solution

- Remove the hardened OpenCode rejection after adding equivalent controls.
- Scan OpenCode business input, captured tool results, and final structured output through the shared provider-independent service.
- Run the existing output schema and tool-scope guardrails against captured OpenCode tool calls.
- Persist the OpenCode trace synchronously before a hardened run can complete or create a proposal.
- Continue to route all OpenCode domain changes through proposal disposition, with the hardened profile forcing human review.
- Add append-only `AgentModelUsage` evidence for the actual provider/model resolved for native and OpenCode runs.
- Snapshot provider processing location and retention text from `OM_AI_PROVIDER_COMPLIANCE_JSON` at use time.
- Add tenant- and organization-scoped JSON/CSV export at `GET /api/agent_orchestrator/model-usage`.

## Architecture

Both runners record a run first, then register model use. The native runner receives the exact resolved provider/model through an additive callback from the MIT object-agent runtime. The OpenCode runner prefers provider/model metadata returned by the completed assistant message and falls back to the file-agent definition only when OpenCode does not expose that metadata. In hardened mode, trace persistence is an awaited prerequisite to `runs.complete` and proposal creation.

## Data models

`agent_model_usages` is append-only and tenant/organization scoped. One row represents one provider/model pair used by one run. It stores:

- `agent_run_id`, `agent_id`, and runtime;
- provider and model identifiers;
- processing location and retention-policy snapshots;
- evidence timestamp.

The uniqueness key is `(agent_run_id, provider_id, model_id)`.

## API contracts

`GET /api/agent_orchestrator/model-usage` requires `agent_orchestrator.trace.view` and returns an aggregated registry. `?format=csv` returns the same rows as a downloadable CSV. The response contains counts and first/last use timestamps, never prompts, outputs, or credentials.

## Integration coverage

- OpenCode runner tests cover hardened dispatch, required trace before completion, input/output/tool-result blocking, and proposal-only persistence.
- Model-use service tests cover scoped recording, metadata snapshots, deduplication, and aggregation.
- API integration coverage checks authentication, RBAC, JSON output, and CSV export.
- Shared content-safety tests cover prompt injection, data poisoning, and model inversion.

## Risks and impact review

| Failure scenario | Severity | Mitigation | Residual risk |
|---|---:|---|---|
| OpenCode trace storage unavailable | High | Hardened run fails before proposal creation | Run must be retried after storage recovery |
| Provider metadata missing | Medium | Export marks location/retention as `not_configured` | Operator must complete deployment metadata |
| Captured tool name cannot be mapped | High | Tool-scope guardrail blocks the run | New built-in OpenCode tools require an explicit mapping |
| Model-use evidence write fails | High | Hardened run fails before completion or proposal creation | Standard profile may continue with best-effort evidence |

## Migration and backward compatibility

The new table and route are additive. The OpenCode error class remains exported for compatibility even though parity now permits hardened dispatch. Standard-profile behavior remains unchanged. The migration is additive and does not alter existing run rows.

## Changelog

- **2026-08-21:** Added hardened OpenCode parity, required traces, tenant model-use evidence, and JSON/CSV export.
