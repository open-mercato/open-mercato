# Combine 1782 stack (#1866–#1871) into a single PR stacked on #1858

Date: 2026-05-12
Slug: ai-agents-1782-combined-on-1858
Owner: pkarw
Run kind: `auto-create-pr` (re-stack / consolidation, **not** new feature work)

## Goal

Take the five-PR linear stack on top of `feat/ai-agents-phase-1780-4b`:

- #1866 — Phase 1782-0..2 — agentic loop config + per-call overrides + native SDK callback
- #1867 — Phase 1782-3..4 — operator budgets + LoopTrace + dispatcher loopBudget + `allowRuntimeOverride` rename
- #1868 — Phase 1782-5 — opt-in `ToolLoopAgent` execution engine
- #1869 — Phase 1782-6 — token usage tracking + retention worker + Usage tab
- #1871 — customers.deal_analyzer agentic-loop demo + end-to-end proof

and re-stack them, as a single PR, on top of PR #1858's branch `feat/ai-agents-phase-1780-1` (which now contains phases 1780-1 through 1780-6). The five source PRs are then closed (superseded). Once PR #1858 lands on `develop`, the user will rebase this combined PR onto `develop`.

## Why a stacked PR (not against `develop`)

PR #1858 is in CI and cannot be merged to `develop` yet. The 1782 stack was originally based on `feat/ai-agents-phase-1780-4b` (an ancestor of `feat/ai-agents-phase-1780-1`). Without this re-stack, the user cannot exercise the 1782 work in isolation against the latest 1780-1 state. This PR provides a single, mergeable consolidation that follows the natural cherry-pickable rebase path.

> The standard `auto-create-pr` rule "base branch is always `develop`" is intentionally overridden here per user request. This run is a re-stack of already-reviewed PRs, not a fresh feature.

## Scope

- Re-stack the 49 commits in `origin/feat/ai-agents-phase-1780-4b..origin/feat/ai-agents-deal-analyzer-demo` onto `origin/feat/ai-agents-phase-1780-1` via `git rebase --onto`.
- Resolve conflicts that arise because `feat/ai-agents-phase-1780-1` contains phases 1780-5 and 1780-6 (env-driven + tenant-editable provider/model allowlist) that the 1782 stack does not know about, plus migration-snapshot regen and `ai_tenant_model_allowlists` work.
- Run the full validation gate against the rebased branch.
- Close PRs #1866, #1867, #1868, #1869, #1871 with a comment pointing at the combined PR.

## Non-goals

- No new feature work. No behavior changes beyond what the source PRs already introduced.
- Do **not** delete the source branches — they may still be wanted for history/archaeology.
- No attempt to merge the combined PR into `develop` directly; the merge target is `feat/ai-agents-phase-1780-1`.
- No `auto-review-pr` autofix pass — every source PR was already reviewed/merged-queue-ready. Re-running review here would be redundant work and would just generate review noise on the stacked PR.

## Risks

- **Conflicts in `ai-agent-runtime`, agent-runtime tests, locale files, migration snapshot, and tenant model allowlist code.** Phase 1780-6 introduced tenant-editable allowlists and Phase 1780-5 introduced env allowlists; the 1782 stack touches the same agent-runtime + settings + i18n surfaces. Resolution strategy: keep both, prefer 1780-1's allowlist code as the base (since it's already in CI) and re-apply 1782 changes on top.
- **Migration ordering.** PR #1858 has migrations for `ai_tenant_model_allowlists`. The 1782 stack adds migrations for loop overrides and token usage tables. Both must coexist; snapshot regeneration may be needed at the end.
- **Test churn from rebase.** Some 1782 unit tests reference agent-runtime internals that may have shifted in 1780-1. Fix per-conflict; document in PR body.
- **Combined PR is large (49 commits + conflict resolution commits).** Acceptable because it preserves authored history.
- This PR's base will need to be rebased onto `develop` after #1858 lands; the user is aware.

## Implementation Plan

### Phase 1: Worktree + plan setup

- 1.1 Create worktree off `origin/feat/ai-agents-phase-1780-1` on branch `feat/ai-agents-1782-combined-on-1858`.
- 1.2 Land this execution plan as the first commit and push.

### Phase 2: Re-stack the 1782 commits

- 2.1 Run `git rebase --onto origin/feat/ai-agents-phase-1780-1 origin/feat/ai-agents-phase-1780-4b origin/feat/ai-agents-deal-analyzer-demo` from the new branch (after fast-forwarding the branch tip to `origin/feat/ai-agents-deal-analyzer-demo`'s commits via a one-shot setup — see step 2.2).
- 2.2 Concrete sequence: from the new branch already on `feat/ai-agents-phase-1780-1`, `git reset --hard origin/feat/ai-agents-deal-analyzer-demo`, then `git rebase --onto origin/feat/ai-agents-phase-1780-1 origin/feat/ai-agents-phase-1780-4b`. (Equivalent to the one-liner but easier to reason about.)
- 2.3 Resolve conflicts commit-by-commit. Expected conflict areas: `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime*`, settings/route handlers, locale JSON, `migrations/.snapshot-open-mercato.json`, `apps/mercato/src/modules.ts` (unlikely but possible).
- 2.4 If snapshot drift remains after rebase, regenerate via `yarn db:generate` and keep only the consolidated migration snapshot.

### Phase 3: Full validation gate

- 3.1 `yarn install --mode=skip-build` (or plain `yarn install`).
- 3.2 `yarn generate`.
- 3.3 `yarn build:packages`.
- 3.4 `yarn i18n:check-sync` and `yarn i18n:check-usage`.
- 3.5 `yarn typecheck`.
- 3.6 `yarn test` (full unit suite).
- 3.7 `yarn build:app`.

### Phase 4: PR creation + supersede

- 4.1 Push the rebased branch.
- 4.2 Open PR with `--base feat/ai-agents-phase-1780-1`; body lists the five source PRs and explains the stack.
- 4.3 Label `review` + `feature`; add `needs-qa` because Phase 1782 includes UI (Usage tab, Loop panel, deal_analyzer page) and the demo touches customer-facing flows.
- 4.4 Close #1866, #1867, #1868, #1869, #1871 with a "superseded by" comment.
- 4.5 Post the comprehensive `auto-create-pr` summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Worktree + plan setup

- [x] 1.1 Create worktree off `feat/ai-agents-phase-1780-1` on branch `feat/ai-agents-1782-combined-on-1858`
- [ ] 1.2 Commit and push this execution plan

### Phase 2: Re-stack the 1782 commits

- [ ] 2.1 Reset new branch to `origin/feat/ai-agents-deal-analyzer-demo`
- [ ] 2.2 `git rebase --onto origin/feat/ai-agents-phase-1780-1 origin/feat/ai-agents-phase-1780-4b`
- [ ] 2.3 Resolve all rebase conflicts
- [ ] 2.4 Regenerate migration snapshot if needed

### Phase 3: Full validation gate

- [ ] 3.1 yarn install
- [ ] 3.2 yarn generate
- [ ] 3.3 yarn build:packages
- [ ] 3.4 yarn i18n:check-sync + yarn i18n:check-usage
- [ ] 3.5 yarn typecheck
- [ ] 3.6 yarn test
- [ ] 3.7 yarn build:app

### Phase 4: PR creation + supersede

- [ ] 4.1 Push branch
- [ ] 4.2 Open PR with base `feat/ai-agents-phase-1780-1`
- [ ] 4.3 Apply labels (`review`, `feature`, `needs-qa`) with rationale comments
- [ ] 4.4 Close #1866/#1867/#1868/#1869/#1871 as superseded
- [ ] 4.5 Post comprehensive summary comment
