# PR D — Dry-run, isolation flags, step-through, Code view stage 2 (spec §8.1, §8.2, §2.2)

Branch: `feat/workflows-dryrun-codeview`, off `feat/agent-orchestrator-mvp` (contains PRs A, B, C).
Brief: `BRIEFING-phase5.md` §8.1/§8.2 + "Code view stage 2". Owned by this executor only —
`PLAN.md` (PR A), `TASKS.md` (PR B) and `TASKS-C.md` (PR C) are not edited here.

## Tasks

| Step | Title | Status | Commit |
|------|-------|--------|--------|
| D.1 | `INVOKE_AGENT` gets a `mock` — the one built-in that could not dry-run | done | `5d63aeb33` |
| D.2 | `WorkflowInstance.isDryRun` + mocked-effector execution + the isolation guarantees | done | `21310f145` |
| D.3 | Start fixtures + step-through | done | `eedcc8191` |
| D.4 | Code view stage 2 — two-way sync + issue-to-node squiggles | done | `cdf085aaa` |

## Validation

Runner: **local** (no compose `app` container running).

| Command | Result |
|---|---|
| `yarn build:packages` · `yarn generate` | pass |
| `yarn typecheck` | pass (22/22) |
| `yarn i18n:check-sync` | pass |
| `yarn lint` | 0 errors (12 pre-existing warnings in `@open-mercato/app`) |
| `yarn workspace @open-mercato/core test --testPathPatterns='modules/(workflows\|business_rules)'` | 254 suites / 3412 tests pass |
| `yarn workspace @open-mercato/enterprise test --testPathPatterns='metric'` | 3 suites / 17 tests pass |
| `yarn build:app` | pass |

**Pre-existing failures, verified against the base commit `005804cf2` in a throwaway
worktree and untouched by this PR:**

- `@open-mercato/enterprise` — `agent_orchestrator/__tests__/{agent-source-files,
  agent-token-usage,webSearchEgress.integration}` (3 suites / 7 tests). Same three PR C
  recorded.
- `create-mercato-app` — the scaffolded-script assertion (`'yarn mercato test:integration'`
  vs `'mercato test:integration'`). Reproduced identically at the base commit; this PR
  touches nothing under `packages/create-app` or `apps/`.

Integration specs `TC-WF-057` (dry-run isolation) and `TC-WF-062` (Code view stage 2) are
WRITTEN, not run — no app is running in this worktree, and the brief forbids running
Playwright.

## Binding constraints

- One item = one commit; scoped tests each time; `yarn generate` after module-file changes.
- No `any`, no bare `.sort()`, no arbitrary Tailwind, no hardcoded status colours, status never
  colour-only, i18n ×4, `pageSize` ≤ 100.
- Migrations: entity → `yarn db:generate` → keep only the intended SQL → update the snapshot.
  **Never `yarn db:migrate`.**
- Step-through stays an INSTANCE-level `PAUSED` between steps (briefing G2) — never a new step
  status, so the step state machine is untouched.

## Bugs / wrong premises found

1. **The spec's §8.2(c) premise is false.** It says a dry run *"keeps ACTION-type business rules
   un-triggerable (conditions are evaluate-only on this path today; the dry-runner asserts it stays
   that way)"*. They are not evaluate-only: `executeSingleRule`
   (`business_rules/lib/rule-engine.ts`) runs `actionExecutor.executeActions` unconditionally, and
   the engine's own `dryRun` flag only suppresses the execution LOG — an existing test passes
   `dryRun: true` and asserts actions ran. A workflow transition's `preConditions`/`postConditions`
   therefore fire real ACTION-type rules. Fixed by adding an additive `skipActions` to the rule
   engine and passing it from the dry-run path, with tests proving actions do not run and that
   omitting the flag is byte-identical.
2. **`ExecutionContext.dryRun` was a declared-but-never-read flag** in `lib/workflow-executor.ts` —
   a trap, since a reader would assume dry-run was already wired. Marked `@deprecated` and inert,
   with the reason a per-call flag cannot work (it does not survive a park/resume).
3. **Forcing the sync path is not enough to avoid a deadlock.** `executeActivity` echoes the
   AUTHORED `async` flag on its result, and `transition-handler` parks the token in
   `WAITING_FOR_ACTIVITIES` when any result says `async`. A dry run running an authored-async
   activity inline would park forever waiting for a job it deliberately never enqueued. Caught by a
   test; fixed by correcting the flag on the inline path.
4. **`Alert variant="error"` does not exist** — the primitive's legacy variant union is
   `default | destructive | success | warning | info`. Caught by typecheck, not by eye.
5. **jsdom has no `structuredClone`, which dagre needs.** Any jsdom test that applies a definition
   through `definitionToGraph` with auto-layout hits it. Polyfilled in the affected test rather than
   worked around in the editor — and the Code view's validation seam now passes
   `autoLayout: false`, which is the right thing independently: validity must not depend on a layout
   engine.
6. **Agent KPI leak (pre-existing).** `metricRollupService` floors `AgentRun` counts to
   `source: 'runtime'` — with a comment explaining exactly why — but the `AgentProposal` counts
   beside them had no floor, so `approveUnchangedRate` was a ratio over two different populations
   and every eval replay's proposals skewed it. Floored to the same runtime run ids; regression test
   added. Its fixture was also missing the NOT NULL `runId`.
