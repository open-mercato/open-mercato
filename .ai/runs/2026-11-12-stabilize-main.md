# Stabilize main — 2026-11-12

## Goal

Verify main on an isolated stabilization PR, fix any demonstrated CI root causes on this branch, and request automerge only after the full suite and independent final review pass.

## Scope

- Base: `main` at `6c779bc21b760ba8f539e0ac04fec11eb6ae496f`.
- Branch: `stabilize/main-2026-11-12`; target: `main`.
- Inspect CI and preserve the existing same-repository `stabilize/` and `ci-full` overrides, which already force 15 integration shards and full typecheck/unit gates.
- Fix only failures demonstrated by logs and reproductions; add regression coverage for any code fixes.
- Delegate one independent read-only CI audit and one final review, with no overlapping edit scopes.

## Non-goals

No application behavior, public contracts, database schema, dependencies, release changes, or merges to main. Do not add label-event triggers: existing regression coverage deliberately excludes them to protect active and required checks.

## Implementation Plan

### Phase 1: Audit and root-cause fixes

1.1 Audit latest main CI and full-suite selection independently.
1.2 Reproduce and fix demonstrated failures, or record evidence that no code fix is needed.

### Phase 2: Verification

2.1 Run relevant local checks and the configured validation gate where the environment supports it.
2.2 Run this draft PR's full CI suite and resolve failures until every applicable check passes.

### Phase 3: Final review and handoff

3.1 Obtain an independent final review, address actionable findings, publish verification, and promote/apply automerge only after green CI.

## Evidence and risks

- Latest main CI: https://github.com/open-mercato/open-mercato/actions/runs/43059132881 — success, including all 15 integration shards, full test/typecheck, Docker, timezone and document multi-instance checks.
- The requested full-suite override already exists in `.github/workflows/ci.yml`, with regression coverage in `scripts/__tests__/ci-full-label.test.mjs`.
- `ci-full` is evaluated on opened/synchronize/reopened events. Label events deliberately do not schedule replacement CI runs.
- No code defect is established at intake. Avoid speculative changes solely to produce a diff.
- Dependencies are absent in this linked worktree; record any local validation limitations explicitly and use the PR's own full CI as authoritative remote evidence.
- Run identity: `04b1b149-81ce-4155-8e12-77ad648ec3a5`.
- Independent read-only audit `b149257f-51c9-4081-8e79-443b957c8a84`: approve. Verified 24 successful main jobs, including every integration shard, and the intentionally skipped dependency audit. No actionable code defect; its branch diff is empty and its 28 focused tests were independently rerun successfully.
- Runner: local. All 43 focused full-suite/concurrency/coverage/bootstrap regression tests, whitespace checks and the instruction-budget check passed. This documentation-only diff uses the skill's docs-only local validation exception; no configured Markdown lint command exists. Broad application validation runs in this PR's full CI.
- PR verification: https://github.com/open-mercato/open-mercato/pull/9310#issuecomment-6809359725. Initial full PR CI: https://github.com/open-mercato/open-mercato/actions/runs/43117451691.
- Required-checks API returns 404; conservatively require all reported applicable checks to pass.

## Progress

PR: #9310

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Audit and root-cause fixes

- [x] 1.1 Audit latest main CI and full-suite selection independently. — 8a33973c3f
- [x] 1.2 Reproduce and fix demonstrated failures, or record evidence that no code fix is needed. — 8a33973c3f

### Phase 2: Verification

- [x] 2.1 Run relevant local checks and the configured validation gate where the environment supports it. — 8a33973c3f
- [ ] 2.2 Run this draft PR's full CI suite and resolve failures until every applicable check passes.

### Phase 3: Final review and handoff

- [ ] 3.1 Obtain an independent final review, address actionable findings, publish verification, and promote/apply automerge only after green CI.
