# PR D — Dry-run, isolation flags, step-through, Code view stage 2 (spec §8.1, §8.2, §2.2)

Branch: `feat/workflows-dryrun-codeview`, off `feat/agent-orchestrator-mvp` (contains PRs A, B, C).
Brief: `BRIEFING-phase5.md` §8.1/§8.2 + "Code view stage 2". Owned by this executor only —
`PLAN.md` (PR A), `TASKS.md` (PR B) and `TASKS-C.md` (PR C) are not edited here.

## Tasks

| Step | Title | Status | Commit |
|------|-------|--------|--------|
| D.1 | `INVOKE_AGENT` gets a `mock` — the one built-in that could not dry-run | todo | |
| D.2 | `WorkflowInstance.isDryRun` + mocked-effector execution + the isolation guarantees | todo | |
| D.3 | Start fixtures + step-through | todo | |
| D.4 | Code view stage 2 — two-way sync + issue-to-node squiggles | todo | |

## Binding constraints

- One item = one commit; scoped tests each time; `yarn generate` after module-file changes.
- No `any`, no bare `.sort()`, no arbitrary Tailwind, no hardcoded status colours, status never
  colour-only, i18n ×4, `pageSize` ≤ 100.
- Migrations: entity → `yarn db:generate` → keep only the intended SQL → update the snapshot.
  **Never `yarn db:migrate`.**
- Step-through stays an INSTANCE-level `PAUSED` between steps (briefing G2) — never a new step
  status, so the step state machine is untouched.

## Bugs / wrong premises found

(filled in as they are found)
