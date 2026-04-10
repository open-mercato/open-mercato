# HackOn Contribution Coordinator v1

## TLDR

Build a terminal-first, coordinator-driven contribution system for the Open Mercato HackOn Bounty Hunting track.

The v1 implementation should live in the control-plane repo as a new `mercato hackon ...` CLI surface under `packages/cli`, reuse the existing worktree-friendly dev runtime and ephemeral integration runner, use Codex with GPT-5.4 for implementer/reviewer execution, use GitHub PR comments as the canonical agent discussion channel, and persist lightweight workflow state in `.ai/contributions/`.

This is intentionally a pragmatic hackathon system, not a new platform service.

## Overview

The target operating model is:

- one coordinator owns queueing, qualification, dispatch, policy, and final readiness decisions
- green-lane tasks (`docs`, `tests`, `simple_bugs`) may run in parallel
- one experimental lane runs at most one item by default
- every active task gets its own git worktree and branch
- draft PR is the default artifact
- GitHub PR comments and review threads are the canonical inter-agent collaboration surface
- human involvement is delayed until final review, policy exceptions, and HackOn portal submission

The repo already contains several useful primitives:

- [scripts/dev-ephemeral.ts](../../scripts/dev-ephemeral.ts) for worktree-friendly local runtime
- [packages/cli/src/lib/testing/integration.ts](../../packages/cli/src/lib/testing/integration.ts) for ephemeral app/test orchestration
- [packages/cli/src/mercato.ts](../../packages/cli/src/mercato.ts) for the operator CLI entrypoint
- [packages/ai-assistant](../../packages/ai-assistant) for MCP and tool infrastructure
- [.github/workflows/qa-deploy.yml](../../.github/workflows/qa-deploy.yml) and [.github/workflows/qa-stop-on-merge.yml](../../.github/workflows/qa-stop-on-merge.yml) for stable machine-readable PR comment marker patterns

The missing piece is a dedicated contribution coordinator that ties these primitives together around HackOn-specific policy.

## Problem Statement

Competing effectively in the Open Mercato HackOn Bounty Hunting track requires shipping many safe, high-quality PRs with minimal operator bottlenecks.

Today the repo has:

- issue tracking
- PR templates
- worktree-friendly runtime support
- ephemeral integration testing support
- MCP infrastructure

But it does not have:

- a queueing and qualification system
- lane-based dispatch
- task-specific worktree management
- draft-PR orchestration
- PR review automation around Codex roles
- portal submission tracking
- judge lifecycle tracking
- policy controls such as `auto_ready_mode`

Without a dedicated coordinator, the operator becomes the bottleneck for issue selection, branch setup, local gates, PR narration, review loop handling, and HackOn bookkeeping.

## Proposed Solution

Implement a small control plane inside `packages/cli` under a new command family:

```bash
yarn mercato hackon <command>
```

The coordinator remains terminal-first and stateless at runtime, with lightweight persisted state in `.ai/contributions/`.

### Components to Keep

Keep and reuse the following existing components:

- `yarn dev:ephemeral` for isolated local app runtime
- `mercato test:integration`, `mercato test:ephemeral`, and related ephemeral test flows
- current contribution target branch of `develop`
- current PR template structure
- existing GitHub MCP integration paths when available
- existing PR marker comment pattern design

### New Components

- `packages/cli/src/lib/hackon/*` for control-plane logic
- `.ai/contributions/config.json` for operator policy and identity settings
- `.ai/contributions/state.json` for task and PR lifecycle state
- `.ai/contributions/prompts/*.md` for coordinator, implementer, reviewer, and qualification prompts
- `.ai/contributions/README.md` for operator instructions

### Core Workflow

1. Coordinator syncs or qualifies issues.
2. Coordinator assigns a lane and risk zone.
3. Coordinator creates a task-specific worktree and branch.
4. Implementer runs in that worktree through `codex exec` using GPT-5.4.
5. Local gates run and results are recorded.
6. Coordinator opens a draft PR from fork to upstream.
7. Reviewer runs through `codex exec` and comments in GitHub.
8. Implementer responds with follow-up commits.
9. Coordinator decides whether the PR needs more work, human review, or portal submission.
10. Human submits the PR URL manually to HackOn.
11. Coordinator records portal and judge lifecycle state.

## Architecture

### High-Level Design

The v1 architecture is intentionally simple:

- CLI coordinator as the primary operator surface
- repo-local JSON files as the source of truth
- one worktree per active task
- one Codex execution per implementer/reviewer action
- GitHub PRs and comments as the canonical collaboration artifact

No new database, queue service, browser dashboard, or long-running daemon is required in v1.

### Control-Plane Modules

The coordinator subsystem should be split into focused modules:

- `config.ts` for loading and validating operator config
- `state.ts` for task/PR persistence
- `queue.ts` for issue intake and lane views
- `qualify.ts` for qualification and duplicate risk scoring
- `worktrees.ts` for branch and worktree lifecycle
- `gates.ts` for local gate execution and baseline comparison
- `codex.ts` for non-interactive Codex execution wrappers
- `github.ts` for GitHub provider abstraction
- `portal.ts` for HackOn portal submission bookkeeping
- `judge.ts` for post-submission lifecycle tracking

### Existing Components Reused by the Architecture

- `scripts/dev-ephemeral.ts` remains the preferred worktree-safe local runtime
- `packages/cli/src/lib/testing/integration.ts` remains the preferred ephemeral gate runner
- `packages/ai-assistant` remains optional infrastructure for future in-app views, not the v1 control plane

### Docs, Prompts, and CLI Changes

The implementation should add:

- a new spec in `.ai/specs/`
- a new operator guide in `.ai/contributions/README.md`
- prompt files for coordinator, implementer, reviewer, and qualification runs
- new CLI help text in `packages/cli/src/mercato.ts`
- new `AGENTS.md` guidance only if implementation reveals coordinator-specific rules worth preserving

## Data Models

No database schema changes are required.

The v1 system uses repo-local JSON state.

### Config Schema Draft

```json
{
  "version": 1,
  "profile": "hackon_open_mercato_bounty",
  "github": {
    "operatorUsername": "hackon-registered-user",
    "gitAuthorName": "Operator Name",
    "gitAuthorEmail": "operator@example.com",
    "upstreamOwner": "open-mercato",
    "upstreamRepo": "open-mercato",
    "upstreamRemote": "origin",
    "forkOwner": "operator-user",
    "forkRemote": "fork",
    "baseBranch": "develop",
    "commentPrefixes": {
      "coordinator": "[coordinator-agent]",
      "implementer": "[implementer-agent]",
      "reviewer": "[reviewer-agent]"
    }
  },
  "codex": {
    "model": "gpt-5.4",
    "sandbox": "workspace-write",
    "approvalPolicy": "on-request",
    "useSubagentsWhenAvailable": true
  },
  "worktrees": {
    "rootDir": "../open-mercato-worktrees",
    "branchTemplate": "hackon/{lane}/{issueNumber}-{slug}"
  },
  "lanes": {
    "docs": { "maxActive": 1 },
    "tests": { "maxActive": 1 },
    "simple_bugs": { "maxActive": 1 },
    "experimental": { "maxActive": 1 }
  },
  "policy": {
    "autoReadyMode": "off",
    "forbiddenPaths": [],
    "changedFileLimit": { "docs": 20, "tests": 25, "simple_bugs": 15, "experimental": 40 },
    "diffLineLimit": { "docs": 600, "tests": 800, "simple_bugs": 500, "experimental": 1200 },
    "formatter": { "mode": "if_configured", "command": null },
    "lintCommand": "yarn lint",
    "typecheckCommand": "yarn typecheck",
    "baselineTestCommand": "yarn test"
  }
}
```

### State Schema Draft

Each task record should include:

- task id
- linked issue number
- lane
- risk zone
- duplicate risk
- state
- branch name
- worktree path
- PR metadata
- review metadata
- portal metadata
- judge metadata
- blocker metadata

### State Machine Draft

Primary states:

- `discovered`
- `qualified`
- `worktree_ready`
- `implementing`
- `gates_failed`
- `gates_passed`
- `draft_pr_open`
- `under_review`
- `changes_requested`
- `ready_for_decision`
- `human_review_required`
- `awaiting_portal_submission`
- `portal_submitted`
- `judge_pending`
- `judge_approved`
- `judge_adjusted`
- `judge_rejected`
- `blocked`
- `duplicate_closed`
- `abandoned`

Required transition shape:

```text
discovered -> qualified | duplicate_closed | blocked
qualified -> worktree_ready -> implementing
implementing -> gates_passed | gates_failed
gates_passed -> draft_pr_open -> under_review
under_review -> changes_requested -> implementing
under_review -> ready_for_decision
ready_for_decision -> human_review_required | awaiting_portal_submission | implementing
awaiting_portal_submission -> portal_submitted -> judge_pending
judge_pending -> judge_approved | judge_adjusted | judge_rejected
```

## API Contracts

There are no new HTTP APIs in v1.

The primary contracts are CLI commands, JSON state shapes, and GitHub comment formats.

### CLI Contract Draft

```bash
mercato hackon init
mercato hackon sync
mercato hackon queue
mercato hackon qualify <issue-number>
mercato hackon start <task-id>
mercato hackon gate <task-id>
mercato hackon pr open <task-id>
mercato hackon pr sync <task-id>
mercato hackon ready <task-id>
mercato hackon portal confirm <task-id>
mercato hackon judge update <task-id>
mercato hackon close <task-id>
mercato hackon doctor
```

### GitHub Comment Contract

All agent-generated human-visible comments must start with one of:

- `[implementer-agent]`
- `[reviewer-agent]`
- `[coordinator-agent]`

Coordinator may additionally include machine-readable marker comments, following the same stability rule already used by QA workflows:

```html
<!-- hackon-task state=awaiting_portal_submission task=HKO-001 pr=123 -->
```

Marker format must be treated as a contract and changed rarely.

## Configuration

### GitHub Identity Rules

The system must enforce a single-account v1 model:

- one configured GitHub username
- one configured git author identity
- one fork remote
- one upstream remote
- one PR author identity

No multi-account orchestration is supported in v1.

### `auto_ready_mode`

Supported values:

- `off`
- `safe_only`
- `expanded`

Rules:

- default is `off`
- `safe_only` is limited to tightly bounded docs/test work
- `expanded` may include a narrow subset of simple bug fixes
- never auto-ready:
  - experimental lane items
  - red-zone items
  - disputed PRs
  - PRs with unresolved comments
  - PRs requiring policy exceptions

## Alternatives Considered

### Dedicated web app control plane

Rejected for v1 because it adds unnecessary implementation and operational surface during a live hackathon.

### Database-backed workflow state

Rejected for v1 because repo-local JSON is simpler, inspectable, and easier to recover manually.

### In-app AI assistant as the primary operator surface

Rejected for v1 because the target operating model is terminal-first and the existing AI assistant is oriented around platform tools rather than contribution coordination.

### `gh` CLI as the only GitHub integration path

Rejected because `gh` may not be installed in the operator environment. GitHub MCP should be primary, with a raw REST fallback when a token is available.

## Implementation Approach

### Phase 1 — Spec and Skeleton

- create this spec
- add `.ai/contributions/README.md`
- add prompt templates under `.ai/contributions/prompts/`
- add config/state file loading and validation
- add `.gitignore` entries for runtime state files

### Phase 2 — Qualification and Worktrees

- add issue sync and queue listing
- add qualification flow
- add duplicate-risk scoring
- add contribution grouping support for split PRs
- add worktree and branch lifecycle helpers

### Phase 3 — Implementer and Gate Loop

- add Codex execution wrapper using `codex exec` with GPT-5.4
- add task context generation
- add local gate runner
- add baseline capture and comparison
- add draft PR creation

### Phase 4 — Review and Decision Loop

- add reviewer Codex execution
- add PR comment and review synchronization
- add readiness decision logic
- add `awaiting_portal_submission`

### Phase 5 — Portal and Judge Lifecycle

- add portal confirmation bookkeeping
- add judge lifecycle updates
- add grouped contribution summaries
- add `auto_ready_mode`

### Phase 6 — Hardening

- add GitHub REST fallback
- add unit and CLI tests
- add docs updates
- capture coordinator-specific lessons if new pitfalls emerge

## Migration Path

This feature is additive.

There is no existing contribution coordinator to migrate. Existing repo contribution workflows continue to work unchanged.

If operators adopt the system incrementally, they may:

1. initialize config
2. qualify a subset of issues
3. run only worktree and gate automation first
4. adopt PR/review automation next
5. adopt portal/judge tracking last

## Success Metrics

The v1 system is successful if it enables:

- consistent qualification of candidate issues
- repeatable one-worktree-per-task execution
- safe draft PR generation with required metadata
- minimal human time spent on setup, branching, and bookkeeping
- explicit tracking of portal submission and judge outcomes
- reliable fallback behavior when a dependency such as Docker or GitHub MCP is unavailable

## Open Questions

- Should grouped split PRs use a human-readable group slug, an opaque id, or both?
- Should `safe_only` auto-ready require explicit lane allowlists per task, not just lane type?
- Should the coordinator post all machine-readable state to GitHub comments, or only milestone states?
- Should the review loop prefer PR review comments only, or also allow top-level reviewer comments for non-code-specific concerns?

## Risks & Impact Review

1. Parallel build artifact collisions
- Severity: High
- Affected area: local gates and worktree concurrency
- Context: [2026-03-25-safe-build-dev-coexistence.md](2026-03-25-safe-build-dev-coexistence.md) is still draft
- Mitigation: keep concurrency conservative in v1 and serialize risky build-heavy tasks when necessary
- Residual risk: some package build collisions may still occur until partition isolation is implemented

2. GitHub integration fragility
- Severity: Medium
- Affected area: PR/comment automation
- Mitigation: use GitHub MCP as primary and raw REST with `GITHUB_PERSONAL_ACCESS_TOKEN` as fallback
- Residual risk: manual intervention may still be required on authentication or rate-limit failures

3. Duplicate issue selection
- Severity: Medium
- Affected area: HackOn scoring efficiency
- Mitigation: conservative duplicate-risk scoring and explicit coordinator blocking on high-confidence duplicates
- Residual risk: medium-confidence duplicates may still slip through

4. Formatter gate ambiguity
- Severity: Medium
- Affected area: local gates
- Mitigation: treat formatter as `if_configured` in v1 because the repo currently has no root formatter contract
- Residual risk: formatting expectations may remain partially manual until a formatter contract is added

5. Over-automation of readiness
- Severity: High
- Affected area: PR quality and HackOn scoring
- Mitigation: keep `auto_ready_mode` defaulted to `off`; never auto-ready experimental, red-zone, disputed, or unresolved-review items
- Residual risk: overly permissive future config could still create low-quality ready PRs if not reviewed carefully

## Final Compliance Report

- Simplicity First: v1 stays CLI-first, repo-local, and additive
- Minimal Impact: existing dev, test, PR, and MCP surfaces remain valid
- Safety: one worktree per task, explicit blockers, conservative auto-ready defaults
- Backward Compatibility: no existing public API, route, schema, or workflow contract is removed
- Operator Fit: aligned with HackOn requirements, fork-based workflow, manual portal submission, and judge-driven scoring

## Changelog

### 2026-04-10

- Initial specification for a coordinator-driven HackOn contribution system
- Captured v1 architecture, config schema, state machine, worktree lifecycle, PR workflow, portal lifecycle, and phased implementation plan
