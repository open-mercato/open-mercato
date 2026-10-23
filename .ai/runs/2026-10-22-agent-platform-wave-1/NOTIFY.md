# Notify — 2026-10-22-agent-platform-wave-1

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-22T11:19:34Z — run started
- Brief: implement wave 1 of the agent platform roadmap (MCP P1–P3 incl. approval mode, chat-tracing P1, identity P0, eval P1, document structure P1–P2) as one PR against open-mercato/open-mercato main.
- External skill URLs: none

## 2026-10-22T11:19:34Z — decisions
- Target repo/base changed by the user from the demo fork's develop to open-mercato/open-mercato main.
- Only generic specs go upstream: client/POC/fork references removed before the first commit.
- Identity Phase 1 is deferred to ship with Identity Phase 5 and MCP Phase 4 (ID-Q3 decision), so it is not in this wave.
- Triage found pending actions are not owner-scoped today; Step 3.4 fixes it (security behaviour change).

## 2026-10-22T11:19:34Z — subagent delegation
- Two read-only Explore agents verified spec code facts against upstream main (MCP P1–P3; chat P1, identity P0, eval P1, document P1–P2).

## 2026-10-22T14:34:48Z — checkpoint 1
- Steps 0.1..1.5 verified: ai-assistant jest 1629/1629, build:packages, generate (no drift), typecheck 39/39. UI pass skipped (no UI in window).
- Decision: invalid `--mutation-mode` is rejected by the CLI and an invalid `OM_MCP_MUTATION_MODE` logs a startup WARN, so a typo cannot silently disable approval.
- Decision: PLAN.md Commit cells are corrected to final SHAs at each checkpoint.
- Blocker (process): pushes to the PR branch are denied by the local permission policy; user pushes manually.

## 2026-10-22T14:34:48Z — subagent delegation
- Steps 1.1–1.5 implemented by sequential executor subagents (default tier).

## 2026-10-22T14:45:08Z — checkpoint 2
- Steps 2.1..2.3 verified: ai-assistant jest 1659/1659, audit_logs jest 153/153, build:packages, typecheck 39/39. UI pass skipped (no UI in window).
- Decision: dev/stdio MCP servers mint a fresh correlation id per call; HTTP and /tools/execute honour `x-correlation-id`.

## 2026-10-22T15:09:22Z — checkpoint 3
- Steps 3.1..3.5 verified: ai-assistant jest 1755/1755, build:packages, generate, i18n sync, app typecheck run directly (exit 0).
- Finding: turbo `yarn typecheck` cache-hits on package source changes; checkpoints now run the app typecheck directly. Checkpoint 2's turbo typecheck claim is superseded.
- Decision: added `approver_features_denied`; `auditCorrelation` is handler-context only because `main` has no command-audit hook.
- Decision: MCP/tools-api agent runs without a DI container are forced read-only (cannot queue approvals).

## 2026-10-22T16:17:40Z — checkpoint 4
- Steps 3.6..3.9 verified: jest 1806/1806, build, generate, direct app typecheck, i18n sync/usage, Playwright TC-AI-MCP 6 passed + 1 deny-only skipped (deny run: 1 passed), screenshot captured.
- Decision: approve/reject live on the page (not `MutationPreviewCard`'s own buttons) so writes go through `useGuardedMutation`; `GET /ai/actions/:id` additively returns `channel` + `requester`.
- Decision: deny/approval Playwright specs are gated on the app's `OM_MCP_MUTATION_MODE`.
- Known gap recorded: `get_pending_action` viewer identity for session-bound server API keys.

## 2026-10-22T16:18:16Z — safety checkpoint (paused for review)
- 18 consecutive Steps landed (0.1, 1.1–1.5, 2.1–2.3, 3.1–3.9); the MCP spec Phases 1–3 are complete and verified.
- Paused before Phase 4 (identity Phase 0) per the ~20-Step safety checkpoint, for user review and push.
- Resume: `om-auto-continue-pr-loop 7794` from Step 4.1.

## 2026-10-22T21:13:47Z — run resumed
- User asked to continue after the safety checkpoint; lock reclaimed; resumed at Step 4.1.

## 2026-10-22T21:13:47Z — checkpoint 5
- Steps 4.1..4.3 verified: agent_orchestrator jest 1453/1453, enterprise tsc 0 errors, build, app typecheck. UI skipped (none).
- Finding: the pass/warn guardrail throw happened outside the runner try, leaving runs stuck in `running`; fixed alongside the wrapping.
- Decision: `AgentRun` is on the runtime-audit allowlist (trace ingest updates it); artifacts go through `withAuditedCommand`.

## 2026-10-22T21:24:52Z — checkpoint 6
- Steps 5.1..5.4 verified: build, ai-assistant jest 1842/1842, agent_orchestrator jest 1457/1457, enterprise tsc 0 errors, app typecheck. UI skipped (none).
- Note: AO native durations fall back to step timing (runner uses runAiAgentObject, not the per-run timing map).

## 2026-10-22T22:03:41Z — checkpoint 7
- Steps 6.1..6.5 verified: generate, build, agent_orchestrator jest 1533/1533, enterprise tsc 0, app typecheck, i18n sync.
- Skipped UI pass: enterprise orchestrator cannot be registered in the ephemeral app even with OM_ENABLE_ENTERPRISE_MODULES(+_AGENTS)=true; TC-AGENT-EVAL-REPORT-001/002 committed but not run locally.

## 2026-10-22T22:30:16Z — checkpoint 8
- Steps 7.1..7.5 verified: attachments jest 360/360, core tsc 0, build, app typecheck. UI skipped (none).
- Review item: jszip used by the DOCX test is not a declared devDependency of packages/core.

## 2026-10-22T22:30:16Z — safety checkpoint (paused for review)
- 17 Steps since resume (4.1–7.5); Phase 8 (8 Steps, migration + worker + API) would exceed the ~20-Step window. Paused at the Phase 7 boundary.
- Resume: `om-auto-continue-pr-loop 7794` from Step 8.1.

## 2026-10-23T08:49:20Z — run resumed
- User asked to continue; lock reclaimed; resumed at Step 8.1.

## 2026-10-23T08:49:20Z — checkpoint 9
- Steps 8.1..8.5 (+8.4-review-fix) verified: attachments jest 434/434, core tsc 0, build, i18n sync, UI probe + screenshot on the ephemeral app.
- Decision (review fix): failed re-extractions keep the previous good extraction live.
- Note: checkpoints must rebuild packages before starting the ephemeral app (stale dist broke the first start).

## 2026-10-23T10:59:09Z — final gate
- Validation gate green after Step 8.8-gate-fix (3 guard failures caused by this branch fixed); two Jest worker SIGSEGVs in untouched packages passed on rerun.
- Full integration: 2700 passed / 10 failed / 4 flaky; all 10 failures reproduced on a clean upstream-main baseline (pre-existing).
- DS pass: 0 lint findings; one intentional residual (notification renderer classes match existing renderers).
