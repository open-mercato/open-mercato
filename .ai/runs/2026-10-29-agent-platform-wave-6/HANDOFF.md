# Handoff — 2026-10-29-agent-platform-wave-6

**Last updated:** 2026-10-30T10:40:53Z
**Branch:** feat/agent-platform-wave-6 (stacked on feat/agent-platform-wave-5)
**PR:** https://github.com/open-mercato/open-mercato/pull/8251 (draft; claimed)
**Current phase/step:** Phase 3 Step 3.3 (first `todo` row)
**Last commit:** cf8fc9019 — test(agent_orchestrator): accept content export in TC-AGENT-OTEL-001 when the deployment allows it

## What just happened
- Steps 1.1–3.2 landed (OTel content export, OTLP protobuf, export integration, tenant endpoint vetting/pinning); checkpoint 1 green (see checkpoint-1-checks.md).

## Next concrete action
- Steps 3.3 (per-run destination), 3.4 (settings destination picker), 3.5 (OTEL-003/004 integration), 3.6 (docs + env mirrors), then Phase 4 (section search).

## Blockers / open questions
- none. User preferences: auto-continue (no 20-Step pauses), checkpoints every 10+ Steps.

## Environment caveats
- Worktree `.ai/tmp/rebase-chain/wave-6`; push remote `upstream`.
- Ephemeral apps rewrite `generated/file-agents.generated.ts` and `.ai/qa/email-capture.jsonl` — revert before commits; executors must stop their ephemeral apps.
- Integration: `test:integration:ephemeral:start` + `yarn test:integration --grep` with `BASE_URL`/`DATABASE_URL` from `.ai/qa/ephemeral-env.json`; AO needs `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true JWT_SECRET=om-ephemeral-integration-jwt-secret`; OTel delivery specs need `OM_AGENT_OTEL_EXPORT=on OM_AGENT_OTEL_EXPORT_ENDPOINT=http://127.0.0.1:4319/v1/traces OM_AGENT_OTEL_EXPORT_DELAY_MS=0 OM_AGENT_OTEL_TRACE_URL_TEMPLATE='http://127.0.0.1:16686/trace/{traceId}'` (+ `OM_AGENT_OTEL_EXPORT_CONTENT=allow`, `OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS=allow`, `OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS=127.0.0.1` for the new cases). Full-suite parity needs CI flags (SECURITY, SSO, `OM_OPTIMISTIC_LOCK=all`, `SELF_SERVICE_ONBOARDING_ENABLED=true`, push stub).
- Executors write `pending` in the Commit column; the main session fills SHAs at checkpoints.

## Worktree
- Path: .ai/tmp/rebase-chain/wave-6
- Created this run: yes
