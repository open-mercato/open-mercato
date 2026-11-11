## UI QA evidence — FAIL; live coverage PARTIAL

**QA head:** c892221c4492f910b959cd95c43a581f7c2f653e

**Verdict:** two component-level defects reproduced at the exact requested head; review verdict **changes**. Live complex QA is **PARTIAL** because no app became ready. This is evidence only and grants no QA approval.

### Reproduced findings

1. **[P2] Mobile host task is falsely described as finished** — [packages/core/src/modules/workflows/backend/tasks/[id]/page.tsx:494](https://github.com/open-mercato/open-mercato/blob/c892221c4492f910b959cd95c43a581f7c2f653e/packages/core/src/modules/workflows/backend/tasks/[id]/page.tsx#L494). With status=PENDING, canComplete=true and completion={surface:'host',href:'/backend/workflows'}, the page suppresses the form by passing false as MobileTaskForm.isCompletable. That component's false branch (components/mobile/MobileTaskForm.tsx:251) renders 'This task has already been completed or cancelled and cannot be modified.' The task is still active; the nearby host notice offers completion. Separate form suppression from lifecycle state.

1. **[P2] Portal consumer ignores the completion-surface declaration** — [packages/core/src/modules/workflows/api/tasks/serialize.ts:119](https://github.com/open-mercato/open-mercato/blob/c892221c4492f910b959cd95c43a581f7c2f653e/packages/core/src/modules/workflows/api/tasks/serialize.ts#L119). The shared serializer now returns completion to portal task APIs, but frontend/[orgSlug]/portal/tasks/[id]/page.tsx:171 still gates PortalTaskForm only on canComplete. Given a PENDING host task with canComplete=true it renders 'Complete task' and omits the host href. This is a valid declaration for a customer-assigned task (no authoring audience restriction). Apply the declaration in portal rendering or explicitly constrain/document the supported audience; backend-only gating leaves a generic completion surface available.

Reproductions live only in the local artifacts directory: mobile-reproducer.test.tsx and portal-reproducer.test.tsx; no source changed. Both tests assert the observed broken output, so their PASS confirms the findings. Initial artifact-harness module-resolution and button-label mistakes were corrected; final reproduction run passed2/2. These are component tests with mocked data, not browser screenshots or end-to-end failures.

### Scenario results

| # | Action | Expected | Observed | Result |
|---|---|---|---|---|
| 1 | Mobile task detail, PENDING host task with canComplete=true (component reproduction) | Host notice without generic completion or terminal-task warning | Host notice plus workflows.tasks.detail.cannotComplete; English copy says already completed/cancelled. page.tsx passes offerCoreCompletion=false to MobileTaskForm, which treats false as terminal. | FAIL |
| 2 | Portal task detail consumer, PENDING host completion with canComplete=true (component reproduction) | Suppress generic completion and expose declared host route | Real portal component renders generic Complete task button and no link to declared host; it ignores completion returned by shared serializer. | FAIL |
| 3 | Desktop host/core controls and persisted API projections | Behavior described in scenario-plan.md | Not exercised: No ready application; TC-WF-077 reviewed but NOT run. | NOT_EXERCISED |
| 4 | Work Inbox menu, row links, claim-next UI and lifecycle | Behavior described in scenario-plan.md | Not exercised: No ready application. | NOT_EXERCISED |
| 5 | Studio Code/Advanced save, reload, full-record comparison and second-user stale write | Behavior described in scenario-plan.md | Not exercised: No ready application; unit round-trip tests passed, UI not exercised. | NOT_EXERCISED |
| 6 | Assignment, reminder and deadline subscriber/worker delivery; notification removed-action replay | Behavior described in scenario-plan.md | Not exercised: No ready application; assignment/SLA unit coverage is not live queue coverage. | NOT_EXERCISED |
| 7 | Actual delivered email href and host navigation | Behavior described in scenario-plan.md | Not exercised: No ready application or mailbox; stored-href unit assertions do not prove delivery. | NOT_EXERCISED |
| 8 | Host without href, injected host UI, unresolved/unsafe href fallback, ten-attempt race/loading checks | Behavior described in scenario-plan.md | Not exercised: No ready application; pure schema/interpolation unit tests passed. | NOT_EXERCISED |
| 9 | Own tenant-bound negative roles/users, direct hidden-action requests, cross-tenant isolation | Behavior described in scenario-plan.md | Not exercised: No ready application; existing permission API unit tests are not independent live fixtures. | NOT_EXERCISED |
| 10 | English/Polish screens, mobile app, default/empty/loading/error/no-permission/long content states, cold/warm loads,10-second post-save settle | Behavior described in scenario-plan.md | Not exercised: No ready application; three new keys exist in all five locales but translated runtime rendering unverified. | NOT_EXERCISED |
| 11 | Portal API/customer assignment to real host flow | Behavior described in scenario-plan.md | Not exercised: Portal component reproducer uses an API response fixture; no live customer session. | NOT_EXERCISED |
| 12 | Completion/cancel/repeat/reload regressions and schema migration with existing rows | Behavior described in scenario-plan.md | Not exercised: Disposable initialization/migrations succeeded, but no live task lifecycle or existing-row migration experiment. | NOT_EXERCISED |

### Environment blocker

Used the isolated linked worktree, detached at the exact PR head. Runner: local (no compose app container); Node24.22.2, Playwright1.61.1, Docker29.1.3. The Chromium doctor and SQLite native smoke succeeded. Dependency installation succeeded with optional native-build warnings (make unavailable); the SQLite probe proves that warning alone did not block runtime.

Priority sibling #9309 first attempted single-worker Turbopack and stopped at9.31GiB owned RSS; its explicit build-slot release was respected. This run did not repeat that configuration. One distinct production **Webpack** alternative was selected via installed Next's IS_WEBPACK_TEST=1 environment path (node_modules/next/dist/lib/bundler.js:125), through ignored om-prepare-test-env scripts wrapping the repository CLI. No production configuration/source changed.

Own disposable PostgreSQL initialized including migrations in53s. The CLI's build:packages/generate/build:packages stages completed in11s/13s/1s. The app build exited1 before readiness, reporting 'Build failed because of webpack errors' at .mercato/generated/bootstrap-registrations.generated.mjs:2799 (React useEffect import; trace bootstrap-common.ts → bootstrap-api.ts → app/api/[...slug]/route.ts). This build failure is an environment/alternative-bundler blocker, not attributed to the PR without a baseline comparison. Peak owned RSS was7,317,315,584bytes (6.81GiB), below9GiB; total bootstrap bounded to1500s. The normal app build script itself sets8192MiB V8 heap, so the outer3072 value is not a reliable app heap cap. No further attempts or generated-file edits.

### Commands and automated coverage

- timeout 300 corepack yarn install --immutable — succeeded with warnings.
- timeout 300 corepack yarn jest --config packages/core/jest.config.cjs --runInBand --runTestsByPath [six changed test paths below] —6 suites/140 tests passed.
- timeout 300 corepack yarn jest --config packages/core/jest.config.cjs --runInBand --runTestsByPath [four consumer test paths below] —4 suites/108 tests passed.
- timeout 180 corepack yarn jest --config $CEZ_ARTIFACTS_DIR/jest-repro.config.cjs --runInBand —2 suites/2 observation tests passed (both defects confirmed).
- timeout 1520 python3 $CEZ_ARTIFACTS_DIR/bounded-bootstrap.py → sh .ai/scripts/test-env-up.sh → yarn test:integration:ephemeral:start --force-rebuild — app build exited1.
- timeout 30 sh .ai/scripts/test-env-down.sh — own teardown completed.
- Translation key presence check —3 new keys exist in en/pl/es/de/ko; runtime locale layout unverified.

Changed test paths (under packages/core/src/modules/workflows): lib/__tests__/{task-completion,task-quick-action,user-task-config,work-inbox-provider}.test.ts; subscribers/__tests__/task-assigned-notification.test.ts; backend/tasks/__tests__/taskDetailPage.test.tsx.
Consumer test paths: api/__tests__/{tasks.route,portalTasks.route}.test.ts; frontend/__tests__/portal-tasks-pages.test.tsx; lib/__tests__/task-sla.test.ts.

Parent independently reran the same248 existing tests and2 artifact observation tests on this exact head, with clean tracked source.

### Existing integration and consumer coverage

TC-WF-077 ships with the PR and was read in full; **not executed in this run**. It covers host/core task detail API, inbox href projection, notification href/actions and desktop task-page suppression. The report does not inherit its author's claimed pass. TC-WF-021 and040–049 are identified regression targets, also not run. No new follow-up issue opened because an integration test already exists.

Consumer search (consumer-search.txt) found shared serializer callers in backend task list/detail/reassign/unclaim and portal list/detail/complete; pure completion helper callers in step-handler, inbox, task quick-actions and task lifecycle notifications. Selected extra consumer tests cover task APIs, portal APIs/pages and SLA; portal rendering exposed finding2.

### Not exercised / next QA

Every NOT_EXERCISED row above remains a required live check. In particular, live permissions/tenant isolation require own narrow users/roles and a second actor; unavailable runtime is not an inapplicability waiver. API-setup/data fixtures in component tests do not prove UI save, caching or transport behavior. Monetary/stock reconciliation is inapplicable to this presentation-only change; no amount input was encountered.

Fix the two findings, extend integration coverage to mobile and customer portal, then rerun the matrix in scenario-plan.md in a working exact-head disposable runtime. Add real app PNGs only after that run.

### Screenshots, labels and cleanup

**Screenshots: none.** No ready app existed. No placeholder, component-rendered or capability PNG is presented as real product evidence, and **screenshots label is withheld**. No qa-approved, qa-self-verified, qa-failed, pipeline transition, merge or PR-branch push.

Own disposable runtime stopped through om-prepare-test-env teardown. No owned bootstrap/application/browser processes remained; the CLI removed its PostgreSQL/Ryuk containers. The foreign om-security container was left untouched. git diff and git status were clean; HEAD remained the tested commit. Claim release and final verified label/ref state are recorded in the completion comment/cleanup.json.

PR: #9299 (link: https://github.com/open-mercato/open-mercato/pull/9299)
