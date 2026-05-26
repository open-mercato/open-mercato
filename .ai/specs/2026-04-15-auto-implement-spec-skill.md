# auto-implement-spec Skill

## TLDR
**Key Points:**
- New orchestrator skill that takes an existing spec from `.ai/specs/` and drives it to completion across multiple sessions by dispatching `auto-create-pr` (new phases) and `auto-continue-pr` (unfinished phases).
- Developer repeats `/auto-implement-spec <spec-path>` until all phases are done. One command, no need to remember PR numbers or decide where to cut.

**Scope:**
- New skill file: `.ai/skills/auto-implement-spec/SKILL.md`
- Registration in `.ai/skills/README.md` and root `AGENTS.md` Task Router

**Concerns:**
- Must not break or duplicate existing `implement-spec` (interactive) or `auto-create-pr` (autonomous executor)

---

## Overview

The auto-* skill family (`auto-create-pr`, `auto-continue-pr`, `auto-fix-github`, `auto-review-pr`) provides autonomous agent execution with worktree isolation, PR delivery, and resumability. However, there is no auto-* skill for the most common OM workflow: **implementing an existing spec from `.ai/specs/`**.

Today a developer with a large spec (e.g. WMS with 5 phases, 13 entities) faces a gap:
- `implement-spec` works interactively but has no PR delivery, no worktree isolation, no resumability
- `auto-create-pr` has all of that but expects a free-form brief and creates a new execution plan — it doesn't consume existing specs

`auto-implement-spec` bridges this gap as a thin orchestrator. It reads the spec, checks readiness, builds state from GitHub PRs, and dispatches the right auto-* skill for the next phase. It owns no implementation logic itself.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Orchestrator only — no implementation logic | Reuse `auto-create-pr` and `auto-continue-pr` as-is. One thing to maintain. |
| One PR per spec phase | Natural boundary. Phases are designed to be independently testable and deployable. |
| Dispatch via `Agent` tool, worktree managed by `auto-create-pr` | `auto-create-pr` already manages its own worktree isolation. No need to duplicate that with `isolation: "worktree"` on the Agent call. |
| Parallel dispatch for independent phases | If Phase 3 and Phase 4 have no dependency, dispatch both as parallel `Agent` calls in a single message. Each invokes `auto-create-pr` which creates its own worktree independently. |
| `implement-spec` stays unchanged | Different use case: interactive, developer-in-the-loop. Not deprecated. |
| State tracked via GitHub PRs | No new state files. Use GitHub as source of truth — match PRs to phases via `Tracking plan:` + `Source spec:` in PR body. |
| No `--phase` argument | Skill auto-detects which phase is next. Developer shouldn't need to know phase numbers. |
| Execution plans go to `.ai/runs/` | Architectural specs stay clean in `.ai/specs/`. Execution plans (progress checklists) are a separate artifact in `.ai/runs/` (see PR #1531). |

## Problem Statement

1. **Developer doesn't know what to give `auto-create-pr`** — it expects a free-form brief, but the spec already exists with all the details. Developer must manually extract and reformulate phase scope into a brief. This is error-prone and feels redundant.

2. **No single command to drive a spec to completion** — developer must manually track which phases have PRs, which PRs are merged, which are in progress, and invoke the right skill (`auto-create-pr` vs `auto-continue-pr`) with the right arguments each time.

3. **`implement-spec` lacks autonomous delivery** — it implements code but doesn't create PRs, doesn't use worktree isolation, and can't be resumed across sessions.

## Proposed Solution

A new skill `auto-implement-spec` that:

1. **Takes an existing spec path as input** (required)
2. **Runs a readiness check** before coding — validates the next phase has enough detail to implement
3. **Scans GitHub for existing PRs** linked to this spec to build phase state
4. **Dispatches the right action** per phase:
   - Phase not started → `auto-create-pr` via `Agent` (manages its own worktree)
   - Phase has open PR, incomplete → `auto-continue-pr` via `Agent` (manages its own worktree)
   - Phase PR merged → skip
   - All phases done → report completion
5. **Parallelizes independent phases** — if multiple not-started phases have no dependency on each other, dispatches them as parallel `Agent` calls, each on its own worktree
6. **Reports result + next step** — what was dispatched, what finished, what's next

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Merge `auto-create-pr` into `implement-spec` | Breaks interactive use case. Two different developer workflows. |
| Make `auto-create-pr` accept `--spec` flag | Overloads its purpose. It's an executor, not an orchestrator. |
| Implement all phases in one session | Unrealistic for large specs. Sessions have context/time limits. |

## User Stories / Use Cases

- **Developer** wants to **type one command repeatedly** so that **a multi-phase spec gets fully implemented without manual orchestration**
- **Developer** wants to **know if a spec phase is ready for implementation** so that **the agent doesn't waste 20 minutes on incomplete input**
- **Developer** wants to **resume after a session break** so that **work continues from where it stopped without remembering PR numbers**
- **Developer** wants **independent phases to run in parallel** so that **a 5-phase spec doesn't take 5 sequential sessions when phases 2-4 are independent**

## Architecture

```
Developer
    │
    │  /auto-implement-spec .ai/specs/wms.md
    │
    ▼
auto-implement-spec (this skill)
    │
    ├─ 1. Read spec, identify phases + dependency graph
    │
    ├─ 2. Scan GitHub PRs for this spec
    │     └─ gh pr list --state all + match by "Source spec:" in body
    │
    ├─ 3. Build phase state map
    │     Phase 1: merged (PR #1530)
    │     Phase 2: merged (PR #1535)
    │     Phase 3: not started (depends on Phase 1 ✓)
    │     Phase 4: not started (depends on Phase 1 ✓, independent of Phase 3)
    │     Phase 5: not started (depends on Phase 3 + Phase 4)
    │
    ├─ 4. Readiness check on dispatchable phases
    │     └─ Phase has steps defined? → OK
    │     └─ Entities/API referenced exist in spec? → OK
    │     └─ Dependencies met? → OK
    │     └─ Phase too large? → WARN, ask developer
    │     └─ Missing critical details? → STOP, report what's missing
    │
    ├─ 5. Dispatch (parallel when possible)
    │     └─ Phase 3 + Phase 4 independent → dispatch BOTH as parallel Agents
    │
    │     Agent({                              Agent({
    │       prompt: "/auto-create-pr            prompt: "/auto-create-pr
    │         <phase 3 brief>"                    <phase 4 brief>"
    │     })                                   })
    │       ↓                                    ↓
    │     auto-create-pr → worktree → PR      auto-create-pr → worktree → PR
    │
    └─ 6. Report result + next step
          "Phase 3 PR #1540 opened. Phase 4 PR #1541 opened.
           1 phase remaining (Phase 5, depends on 3+4).
           Run /auto-implement-spec .ai/specs/wms.md to continue."
```

### Parallel dispatch strategy

The skill analyzes the dependency graph between phases. Dependencies are inferred from the spec:
- Explicit: phase text says "builds on Phase N" or "requires entities from Phase N"
- Implicit: phase references entities/API defined in an earlier phase

Dispatch rules:
- **Sequential**: phase depends on an unfinished earlier phase → wait
- **Parallel**: multiple phases have all dependencies met and are not started → dispatch all as parallel `Agent` calls with `isolation: "worktree"`
- **Continue**: phase has an open, incomplete PR → single `Agent` call to resume

Each parallel agent invokes `auto-create-pr` or `auto-continue-pr` which manages its own worktree internally. They produce separate PRs. Multiple `Agent` calls in a single message run in parallel.

**Why this works**: `auto-create-pr` already creates an isolated worktree, implements, and cleans up. Dispatching two agents in one message means two `auto-create-pr` runs in parallel, each with its own worktree. No conflicts, no shared state. No changes to `auto-create-pr` needed.

### How phase-to-PR matching works

When `auto-create-pr` is dispatched by this skill, the structured brief includes a marker that ends up in the execution plan and PR body:

```
Source spec: .ai/specs/wms.md
Phase: 3
```

On subsequent invocations, `auto-implement-spec` finds PRs via:

```bash
gh pr list --state all --search "Source spec: .ai/specs/wms.md" --json number,title,body,state
```

Then parses the `Phase:` line from each PR body to map phases to PRs. `--state all` catches merged PRs too.

### How readiness check works

Before dispatching `auto-create-pr` for a new phase, the skill validates:

1. **Phase exists in the spec** with named steps
2. **Entities referenced in the phase are defined** in the spec's Data Models section (if applicable)
3. **API endpoints referenced in the phase are defined** in the spec's API Contracts section (if applicable)
4. **Dependencies from earlier phases are met** — earlier phases have merged PRs (or merged+approved)
5. **Phase scope is bounded** — heuristic: if a phase references more than ~10 entities or ~15 API endpoints, warn the developer and ask whether to proceed or split

If validation fails, the skill reports specifically what's missing and stops. Developer fixes the spec and re-runs.

When the "too large" warning fires, the skill suggests a split but lets the developer decide. It does NOT block — the developer may have good reasons to keep a large phase together.

### How the brief is constructed for auto-create-pr

Instead of a free-form brief, `auto-implement-spec` constructs a structured brief from the spec:

```
Implement Phase {N}: {phase name} from spec {spec-path}.

## Context
{spec's TLDR section}

## Phase scope
{copy of the phase from the spec's Implementation Plan}

## Relevant data models
{entities referenced in this phase, copied from spec's Data Models section}

## Relevant API contracts
{endpoints referenced in this phase, copied from spec's API Contracts section}

## Constraints
- This is phase {N} of {total}. Earlier phases: {list merged PRs}.
- Base branch: develop
- Source spec: {spec-path}
- Phase: {N}
```

This gives `auto-create-pr` everything it needs without the developer writing anything. The execution plan created by `auto-create-pr` goes to `.ai/runs/`, keeping `.ai/specs/` clean.

## Data Models
N/A — docs-only change.

## API Contracts
N/A — docs-only change.

## UI/UX
N/A — CLI skill, no UI.

## Migration & Compatibility
- No database changes
- No breaking changes to existing skills
- `implement-spec` remains unchanged — different use case (interactive)
- `auto-create-pr` remains unchanged — consumed as-is
- `auto-continue-pr` remains unchanged — consumed as-is
- Purely additive: one new skill folder + README/AGENTS.md registration

## Implementation Plan

### Phase 1: Skill file
1. Create `.ai/skills/auto-implement-spec/SKILL.md` with full workflow
2. Register in `.ai/skills/README.md`
3. Register in root `AGENTS.md` Task Router

### Phase 2: Validation
1. Smoke test: invoke skill against an existing spec, verify it reads phases and builds state correctly
2. Verify readiness check catches incomplete phases
3. Verify PR matching works with `auto-create-pr` PRs

## Risks & Impact Review

### Risk: Brief construction loses nuance
- **Scenario**: Structured brief extracted from spec misses inter-phase context that a human would include
- **Severity**: Medium
- **Affected area**: Implementation quality of dispatched `auto-create-pr`
- **Mitigation**: Brief includes full phase text + referenced data models + API contracts from spec. Developer reviews PRs before merge.
- **Residual risk**: Edge cases where cross-phase context is needed. Acceptable — developer can add notes to the spec's phase description.

### Risk: PR matching breaks with non-standard PR bodies
- **Scenario**: Someone manually edits a PR body and removes the `Source spec:` or `Phase:` line
- **Severity**: Low
- **Affected area**: Phase state detection
- **Mitigation**: Fall back to title-based matching (`Phase {N}` in PR title). If no match found, treat as not started.
- **Residual risk**: Duplicate PRs for same phase. Acceptable — developer merges the right one.

### Risk: Phase dependency check is too strict
- **Scenario**: Phase 3 depends on Phase 2, but Phase 2 PR is approved and about to merge. Skill blocks.
- **Severity**: Low
- **Affected area**: Developer workflow
- **Mitigation**: Check for both merged AND approved PRs as "done". Open+approved = treat as done.
- **Residual risk**: Race condition if approved PR gets changes-requested. Acceptable — caught by validation gate.

### Risk: auto-create-pr session timeout mid-phase
- **Scenario**: `auto-create-pr` times out before finishing the phase
- **Severity**: Low
- **Affected area**: Developer needs to re-run
- **Mitigation**: This is the designed flow — developer runs `/auto-implement-spec` again, skill detects the open PR and dispatches `auto-continue-pr`. No manual intervention needed beyond re-running the command.
- **Residual risk**: None — this is the happy path for resumability.

### Risk: Parallel phases touch the same files
- **Scenario**: Phase 3 and Phase 4 are dispatched in parallel but both modify the same file (e.g. `modules.ts`, shared config)
- **Severity**: Medium
- **Affected area**: Merge conflicts between parallel PRs
- **Mitigation**: Each agent works on its own worktree, so no runtime conflict. Merge conflicts surface when the second PR is merged — standard git workflow, reviewer resolves. The skill should prefer sequential dispatch when phases reference overlapping files.
- **Residual risk**: Some merge conflicts are unavoidable with parallel work. Acceptable — same as human parallel development.

### Risk: Dependency inference is wrong
- **Scenario**: Skill thinks Phase 3 and Phase 4 are independent but Phase 4 actually needs entities created by Phase 3
- **Severity**: Medium
- **Affected area**: Phase 4 build fails or produces incorrect code
- **Mitigation**: Conservative default — if dependency is ambiguous, dispatch sequentially. Phase 4's validation gate catches build failures. Developer can re-run after Phase 3 merges.
- **Residual risk**: Wasted agent time on a failed parallel run. Acceptable — caught early by validation gate.

## Final Compliance Report — 2026-04-15

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Spec-first for non-trivial tasks | Compliant | This is the spec |
| root AGENTS.md | Task Router registration | Compliant | Included in Phase 1 |
| .ai/specs/AGENTS.md | Spec naming convention | Compliant | `{date}-{title}.md`, no SPEC- prefix |
| .ai/specs/AGENTS.md | No execution artifacts in .ai/specs/ | Compliant | Execution plans go to `.ai/runs/` via `auto-create-pr` |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| No code changes, docs only | Pass | Skill file + registration only |
| Existing skills unchanged | Pass | No modifications to auto-create-pr, auto-continue-pr, implement-spec |
| Backward compatible | Pass | Purely additive |
| Architecture matches proposed solution | Pass | Orchestrator dispatches to existing auto-* skills |

### Verdict
**Fully compliant** — ready for implementation.

## Changelog
### 2026-04-15
- Initial specification
- Updated after review: removed superpowers dependencies (om-cto, Extension Mode Decision), removed --phase flag (auto-detect), added session timeout risk, clarified "too large" warning behavior, aligned with .ai/runs/ separation (PR #1531)
- Added parallel dispatch: dispatch independent phases as parallel `Agent` calls, each invoking `auto-create-pr` which manages its own worktree. No `isolation: "worktree"` needed — reuse existing worktree management in auto-create-pr. Added dependency graph analysis, parallel dispatch strategy, and risks for parallel execution.
