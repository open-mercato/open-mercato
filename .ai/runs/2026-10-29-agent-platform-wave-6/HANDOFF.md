# Handoff — 2026-10-29-agent-platform-wave-6

**Last updated:** 2026-10-30T13:07:02Z
**Branch:** feat/agent-platform-wave-6 (stacked on feat/agent-platform-wave-5)
**PR:** https://github.com/open-mercato/open-mercato/pull/8251 (ready; `do-not-merge`; lock released)
**Current phase/step:** complete — every Tasks row done; final gate passed
**Last commit:** 3161b7e1f — review fix for strict OTLP header validation (+ final-gate record)

## What just happened
- Steps 1.1–4.6 landed; checkpoints 1 and 2 green (see checkpoint-*-checks.md).

## Next concrete action
- None for this run. The whole stack (#7794 → #8251) conflicts with `main` again (28 commits ahead; ai-assistant MCP/pending-action files, attachments entities/validators) and needs a re-sync before CI can run the full suite.
- Follow-ups from the review: skip enqueue for `destination: deployment` without an endpoint; batch the attachments shouldIndex partition lookup; tool call ids on native/OpenCode tool spans; purge-vs-toggle-off orphan race.

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
