# Step 3 — Resume execution: lean per-Step loop + checkpoint every 5 resumed Steps

From the resume point forward, apply the **same lean/checkpoint pattern** as
`om-auto-create-pr-loop`. Commits land quickly and quietly; verification, screenshots, and handoff
updates happen in batches at checkpoints. See `../references/run-folder-contract.md` for the file
formats this step writes.

## 3a. Per-Step loop (lean, no per-Step chatter)

One Step = one code commit. Nothing more.

1. **Implement** only the work described by the current Step. Never pull work forward from later Steps.
2. **Tests** — add or update tests for anything that changed behavior. Unit tests are mandatory for code changes; escalate to integration tests for risky flows, permissions, tenant isolation, workflows, or multi-module behavior.
3. **Quick sanity check** — run the minimum needed to confirm the Step compiles and its own new tests pass (typecheck scoped to the package, `yarn test` scoped to the new test file), script-probed (`../references/environment.md` §3). Do NOT record these runs anywhere — checkpoints verify.
4. Re-read the diff and remove scope creep.
5. Grep changed non-test files for raw `em.findOne(` / `em.find(` and replace with `findOneWithDecryption` / `findWithDecryption`.
6. **Flip the Tasks-table row in the same commit.** In `PLAN.md`'s `## Tasks` table, flip the Step's `Status` cell from `todo` to `done` and fill the `Commit` column with the short SHA (amend with `git commit --amend --no-edit` to capture the real SHA before push). No separate docs-flip commit.
7. **Commit** with a clear conventional-commit subject for that single Step.
8. **Push** after every Step so the remote always has the latest state.
9. **Do NOT** write a `step-<X.Y>-checks.md`. **Do NOT** create a `step-<X.Y>-artifacts/` folder. **Do NOT** rewrite `HANDOFF.md` at the per-Step level. **Do NOT** append to `NOTIFY.md` unless the Step produced a blocker, a scope decision, or a subagent delegation.

Do not alter work completed in earlier commits. Do not reorder or rewrite history on the PR branch.
If a Step truly needs more than one commit, split the Step in `PLAN.md` first.

## 3b. Checkpoint pass (every 5 resumed Steps)

A checkpoint fires when any of these is true:

- 5 Steps have landed since the start of this resume (or since the last checkpoint in this resume).
- The next Step would close a Phase and the Phase has ≥3 Steps.
- Every row in the Tasks table is now `done` — the final gate in `step-4-final-gate.md` subsumes this.
- A blocker stops the run mid-Phase.

At a checkpoint, run the following and record them in a single `${RUN_DIR}/checkpoint-<N>-checks.md`
(use the next available `<N>` — increment from the highest existing checkpoint number on the branch):

1. **Targeted validation for every package touched since the last checkpoint** (script-probed, `../references/environment.md` §3):
   - `yarn typecheck` (scoped when feasible).
   - `yarn test` (scoped to affected packages).
   - `yarn i18n:check-sync` and `yarn i18n:check-usage` **if present** and any locale file or user-facing string changed in the window.
   - `yarn generate`, `yarn build:packages`, and `yarn db:generate` **when present** and module structure, entities, or generated files changed.
2. **UI verification (conditional)** — if any Step in the window touched UI (frontend/backend/portal pages, widgets, `*.tsx`, UI components, navigation injection):
   - Run the smallest set of integration tests under `.ai/qa/tests/` covering the touched areas (prefer folder-scoped selection, e.g. `yarn test:integration .ai/qa/tests/admin/customers`, `.ai/qa/tests/api`, over the full Playwright suite).
   - If no existing file covers the touched area, fall back to Playwright MCP tools to drive a minimal smoke path.
   - Create `${RUN_DIR}/checkpoint-<N>-artifacts/` and save `playwright.log` + at least one `screenshot-<short-desc>.png` per touched area. Reference filenames from `checkpoint-<N>-checks.md`.
   - **UI checks MUST NOT block development.** If the dev env cannot start, Playwright cannot connect, or required fixtures do not exist, skip the UI portion and record the reason in both `checkpoint-<N>-checks.md` and `NOTIFY.md`. The checkpoint otherwise proceeds.
3. **Write `checkpoint-<N>-checks.md`** listing: checkpoint index, the Steps it covers (id range + SHA range), touched packages, every check run with pass/fail/skip + reason, and links to any artifacts.
4. **Rewrite `HANDOFF.md`** from scratch with the new state (next concrete action = the first remaining `todo` Step).
5. **Append one NOTIFY entry** for the checkpoint: UTC timestamp, checkpoint index, Step range, one-line summary, any decisions/problems.
6. **Commit** the checkpoint files (`checkpoint-<N>-checks.md`, `checkpoint-<N>-artifacts/` if any, `HANDOFF.md`, `NOTIFY.md`) as a single commit: `docs(runs): checkpoint N — steps X.Y..X.Z verified`. Push.

If the checkpoint fails, halt dispatch, rewrite `HANDOFF.md` naming the failure, append a NOTIFY
blocker entry, fix forward with new Steps appended to the Tasks table, and re-run the checkpoint
before continuing.

## 3c. Subagent parallelism (optional, capped at 2)

- You MAY run up to **two** subagents concurrently — for example one implementing the next Step while a second reviews the just-landed commit via `om-code-review`. Never exceed two.
- **Conflict avoidance is the top priority.** Two agents MUST NOT edit the same files in the same window. If conflicts are likely, serialize.
- Prefer serial execution whenever the gain is marginal. Parallelism is a tool, not a default.
- Record any subagent delegation in `NOTIFY.md` with timestamps.

## 3d. Executor-dispatch pattern (multi-Step resumes)

When a single resume is expected to land **multiple `todo` Steps in one pass**, the main session
SHOULD act as a **dispatcher** and spawn one **executor subagent per Step** (foreground `Agent`
tool call, `subagent_type: "general-purpose"`). The executor implements exactly that Step end-to-end
(one code commit + Tasks-row flip + push); the main session then runs the post-executor
verification and dispatches the next Step.

The full executor prompt template, the verification the main session MUST run after each executor,
the checkpoint cadence, and the safety stops all live in `../subagents/executor.md`. **Load it
before dispatching.** Key constraints:

- Dispatch MUST live in the main session — subagents cannot spawn executors (no `Agent` tool).
- Dispatch is **sequential** (one executor at a time); the cap-at-2 rule in §3c only covers the rare implementer+reviewer pairing.
- Do NOT use executor dispatch for a single-Step or docs-only resume — drive those directly via the §3a loop.
- The main session owns the `in-progress` lock throughout (claimed in `step-1`, released in `step-5`); executors never claim/release it or post PR comments.

When every row in the Tasks table is `done`, proceed to `step-4-final-gate.md`.
