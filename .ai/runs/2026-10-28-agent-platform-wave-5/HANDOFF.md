# Handoff — 2026-10-28-agent-platform-wave-5

**Last updated:** 2026-10-30T09:19:29Z
**Branch:** feat/agent-platform-wave-5
**PR:** https://github.com/open-mercato/open-mercato/pull/8099 (ready; `do-not-merge` at the user's request; lock released)
**Current phase/step:** complete — every Tasks row done; final gate passed
**Last commit:** 1d42639dd — docs: note that agentPrincipalService.resolve skips disabled principals

## What just happened
- 2026-10-29: branch brought up to date with `main` through the wave chain; checkpoint 4 green.
- 2026-10-29/30: Phase 5 (Chat P3, 5.1–5.5) and Phase 6 (Chat P4, 6.1–6.4) landed; wave-4 head merged in (TC-AI-RUN-TRACE-016 fix); checkpoint 5 green (see checkpoint-5-checks.md).

## Next concrete action
- None for this run. Merge order: #7794 → #8011 → #8018 → #8061 → #8099, each after review + QA (`needs-qa`) and lifting `do-not-merge`.
- Follow-ups from the review (minor): content-retention rescans the oldest 10k rows; non-transactional principal provisioning; org-visible conversation run access; workflow proposalId trust; replayed tools skip requiredFeatures; two catches without reportError; eval-set export file mode; unbounded \$in in agent-run-access.
- Wave 6 (OTel P2 + DocStructure P4) is planned separately and stacks on this branch.

## Blockers / open questions
- none. User preferences: auto-continue, checkpoints every 10+ Steps.
- Step 4.6 added an additive `createdBefore` filter to `GET /api/agent_orchestrator/runs` — mention in the PR.
- Content-capture integration cases need a storage integration; run them where `storage_s3` is configured before release.

## Environment caveats
- Worktree moved: `.ai/tmp/rebase-chain/wave-5` (the original worktree now holds a demo branch).
- Ephemeral apps rewrite `generated/file-agents.generated.ts` and `.ai/qa/email-capture.jsonl` — revert before commits. Make sure executors stop their ephemeral apps (`.ai/qa/ephemeral-env.json`).
- Running `yarn test:integration` against an already-started ephemeral app needs `BASE_URL` and `DATABASE_URL` from `.ai/qa/ephemeral-env.json` (else it targets localhost:3000). If `npx playwright install` is blocked by another project's `ms-playwright/__dirlock`, start the app with `test:integration:ephemeral:start` and run the specs that way.
- AO integration needs `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true JWT_SECRET=om-ephemeral-integration-jwt-secret OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS=0`; run with `yarn test:integration:ephemeral --no-reuse-env --filter '<regex>'`.
- Executors write `pending` in the Commit column; the main session fills SHAs at checkpoints.

## Worktree
- Path: .ai/tmp/rebase-chain/wave-5
