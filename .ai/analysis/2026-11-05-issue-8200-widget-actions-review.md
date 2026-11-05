# Issue 8200: contributed row action correction

The parent identified a regression in the original feature implementation: when a widget contributes a row action to `data-table:audit_logs.actions.list:row-actions`, DataTable merges built-ins only from the returned element’s `items` array. The plain controls div exposed none, so the contributed menu replaced Undo/Redo.

The audit-local `AuditLogRowActions` adapter exposes typed action items with stable `undo` and `redo` IDs and renders the existing icon controls when no widget contributes actions. DataTable performs its existing merge and placement handling. Only permitted, eligible, enabled native operations enter the merged menu: shared `RowActions` has no disabled-item contract. Older redo remains disabled in the no-widget icon layout and unavailable in a contributed menu. No shared UI, API, permissions, schema or audit write contract changed.

The consumer tests now use the actual widget registry, loader, DataTable and RowActions. They cover eligible done/undone action coexistence and stable-ID placement, exact native and contributed handler dispatch, sticky action cells, click isolation, denied operations, older redo eligibility, pending-operation protection and the existing no-widget behavior.

## Focused regression evidence

Runner: local, qualified official Node 24.19.0 and pinned Yarn 4.17.1, using the task-owned independent clone and task-private short TMPDIR/TMP/TEMP. Both runs used the same test assertions and the following native command, sequentially, each with a 300-second process bound:

```sh
yarn workspace @open-mercato/core test --runInBand src/modules/audit_logs/components/__tests__/AuditLogsActions.rowClick.test.tsx
```

- Previous component from `c1e3763958dd6e0d6118101c972f79bc1c0d41df`: exit 1 in 8.836s; 3 failed / 9 passed. All three failures could not find the built-in menu action (eligible done, eligible undone and pending-undo scenarios). This reproduces the parent’s source finding.
- Corrected component: exit 0 in 2.036s; 1 suite / 12 tests passed (Jest 1.175s).
- Test SHA256 in both runs: `06e388f85a374ad7a76194ffffdd0e815e4870c043e1ceee640a068ad37979d4`.
- Previous component SHA256: `f0255c8da59095f8e0eb9ad54b8dfefc4355aa1b46d24f313e58b1d1f303625f`.
- Corrected component SHA256: `79e6fc4535763525bb8daa20f4173cf48ae8b0043ac1572061a5b9c1bc53bc23`.
- The clone’s committed baseline was `d43b6f9b3ebf7cc6ad707da3a1823ee5e1f81089`; its original component was verified byte-identical to c1e3763. Only the component and regression file were overlaid. The corrected source was restored after the sequence. Lockfile SHA256 remained `5fdecd1c962ca8de95f899b7022499c060e0d93f860960c7e9b29addc88db858`.
- Owned launcher/test processes were absent after completion. Logs and process metadata are preserved outside the Git worktree.

Independent read-only source review found no blocking defect. Its suggested pending-operation coverage was added before these runs. `git diff --check` passed. This focused result does not replace the configured gate, which must be rerun on the corrected candidate. The original full-suite failures and prior browser evidence remain separately documented in the November 4 review. Fresh full-gate and applicable browser verification, implementation PR publication and post-publication review remain outstanding.

The separate design spec PR [#8673](https://github.com/open-mercato/open-mercato/pull/8673) is now merged. The implementation branch excludes the old autosave’s separate spec addition.

## Corrected candidate validation

Candidate: `6766182d1d8d2114e3f752769865894b2b6e5b69`. The independent prepared clone was synchronized to this exact commit before the hook and ordered gate. Runner: local, official Node 24.19.0, Yarn 4.17.1, with the same short private temporary directory workaround. Source and lockfile stayed unchanged throughout the gate.

The canonical worktree's generated hook shims and installed dependency state were absent. An explicit `sh -e .husky/pre-commit` there failed before checks with Yarn's missing node_modules state error (exit 1, 0.424s). The same tracked hook in the prepared clone passed in 1.598s: translations, template parity and dependency synchronization. No hook or repository configuration was bypassed or changed. The parent independently reran the exact 12-case row-action suite successfully (Jest 1.934s; wall time 5.094s).

| Configured command, in order | Result | Wall time |
| --- | --- | --- |
| `yarn build:packages` | Passed; 42/42 tasks, 41 cached | 7.975s |
| `yarn generate` | Passed; no tracked changes | 6.275s |
| `yarn build:packages` | Passed; 42/42 cached tasks | 0.491s |
| `yarn i18n:check-sync` | Passed; 70 modules synchronized | 0.787s |
| `yarn i18n:check-usage` | Passed; 8,121 unused-key advisories | 144.298s |
| `yarn typecheck` | Passed; 42 workspaces, none cached | 30.002s |
| `yarn test` | Failed, exit 129; docs build exhausted its heap | 69.236s |
| `yarn build:app` | Not run after the failed test gate | — |

The full test command had a 7,200-second bound and finished normally with a failure, not a timeout. Turbo reported 25 successful tasks out of 49, four cached, before `open-mercato-docs#test` failed. Docusaurus reported `Allocation failed - JavaScript heap out of memory`, with garbage collection near 1 GiB. Incoming `NODE_OPTIONS` was absent; the candidate's root test script itself sets `--max-old-space-size=1024`. That script and the docs test script are unchanged from baseline `e5774a7`. This establishes the observed failure and unchanged scripts, not a separately executed baseline failure. Owned processes had exited after collection; no app build, browser run or unchanged retry followed.

Read-only investigation found an existing merged upstream correction: [PR #8654](https://github.com/open-mercato/open-mercato/pull/8654), commit `2727c6f7a6780f7b0f7ddcad8badc81ab10abcc3`, gives the docs build a 2 GiB heap while retaining the root test policy. The candidate predates that commit. Adoption of the merged upstream change requires parent scope/base coordination; no root or docs source edits were added to this feature and no validation policy was relaxed.

A final independent review of the complete candidate found no additional source issues. Its overall verdict remains blocked on validation, rather than approval to publish. The prior native browser pass predates the widget correction; fresh applicable UI verification and the implementation publication/review chain remain outstanding. Raw logs and environment/process metadata are retained outside the publication worktree.


## Validation after merging current main

The parent coordinated a normal merge of canonical main `8687fc8e2f6fb15690b3460ca0c67b8b7ba7ee3d`, producing `923acf465b584d62903f75de4a7858a570dccb07`. This incorporates the already-merged docs heap allowance and other upstream validation repairs without authoring out-of-scope changes. The implementation diff against this pinned main remains 14 scoped files; the design spec is inherited from main. Audit source is identical to the previously reviewed correction. Independent semantic review found no new source concerns; DataTable action merging is unchanged, while upstream sticky-header geometry still warrants fresh browser verification.

Local runner: the same official Node 24.19.0, Yarn 4.17.1 and short private temporary-directory workaround. `yarn install --immutable` passed in 7.275s for the updated lockfile. The normal merge commit ran its translation/template/dependency hooks successfully in 1.976s. No hooks, worker limits, memory policy, assertions, caches or source files were bypassed or changed. The merged candidate's row-action command from the focused evidence above passed all 12 tests in 2.925s (Jest 1.810s).

| Configured command, in order | Result | Wall time |
| --- | --- | --- |
| `yarn build:packages` | Passed | 59.167s |
| `yarn generate` | Passed | 9.179s |
| `yarn build:packages` | Passed | 0.620s |
| `yarn i18n:check-sync` | Passed | 0.786s |
| `yarn i18n:check-usage` | Passed; 8,122 unused-key advisories | 150.013s |
| `yarn typecheck` | Passed; 42 workspaces, none cached | 17.604s |
| `yarn test` — first attempt | Failed, exit 1; native Jest worker crash | 70.073s |
| `yarn test` — one authorized rerun | Failed, exit 1; two native Jest worker crashes | 255.089s |
| `yarn build:app` | Not run after the failed gate | — |

The first full attempt reported 323 passing UI suites / 2,919 passing tests, but `ScheduleToolbar.test.tsx` failed to run when worker 13102 exited with SIGSEGV. Its matched operating-system crash report identifies `EXC_BAD_ACCESS` in V8's `ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers` during garbage collection. This identifies the native crash location, not its cause or a product defect.

The parent authorized one bounded diagnostic, followed by exactly one full rerun only if the diagnostic passed:

```sh
yarn workspace @open-mercato/ui test src/backend/schedule/__tests__/ScheduleToolbar.test.tsx
```

The diagnostic used the package's existing default workers and unchanged assertions. It passed 10 tests in 1.759s (Jest 0.942s); cleanup was verified before the full rerun. It does not establish a cause or replace the full gate.

The full rerun passed all 324 UI suites / 2,929 tests. Docs built successfully and passed all 24 tests. Core reported 2,690 passing suites and 27,070 passing tests, with 15 suites / 241 tests skipped under the existing configuration. Two core suites failed to run because workers exited with SIGSEGV: `directory/api/organizations/__tests__/tenant-scope-guard.test.ts` (53281) and `design_system/gallery/__tests__/schedule.test.tsx` (56663). Both matched operating-system reports have the same V8 visitor/garbage-collection fault location. No assertion failure was identified. Turbo reported 49 successful tasks out of 51; create-app was interrupted when core failed, so its completion is not claimed.

Both full attempts used unchanged commit `923acf46` and lockfile SHA256 `fbb8a9f0330defb7ba4df41b0b513ecf670a04b71a558e1a6b5f79473b1f22f5`. The failing suite paths have no implementation diff against pinned main; a separate full baseline execution was not performed. All owned processes exited and the foreground results were collected. No further retries, platform provisioning, app build or browser run followed the repeated crash.

The feature remains blocked at the configured validation gate. Fresh UI evidence, implementation PR publication and post-publication review remain unexecuted. The prior passing UI run is historical evidence only. No root cause, gate waiver, QA approval or publication readiness is claimed.
