# Process DI root and isolated caller scopes — #8989

## Goal
Eliminate repeated process registration/bootstrap work while preserving isolated caller EntityManagers, auth, services and event dispatch.

Source doc: .ai/specs/2026-11-18-process-root-request-scopes.md
Status: in-progress
Engine: om-auto-create-pr (steps: 8, --loop: no)

## Scope
Implement the separately published service-lifetime design. Stack on #9628 for execution-local event context. Do not incorporate #9717's shared EntityManager approach. Preserve all existing registrar APIs, fallback for unaudited modules/app hooks, override order, encryption/RBAC, CLI/jobs and standalone parity. No database changes, search-result changes, new production dependencies or unrelated CI repairs.

## Implementation plan
Phase 1 adds and proves lifecycle primitives. Phase 2 migrates bootstrap, events, query-index setup and first-party registrations. Phase 3 wires entry points and verifies API behavior, isolation and bounded setup work. All changes stay opt-in until live qualification supports default activation.

## Risks
Captured mutable services, shared identity maps, subscriber duplication, incomplete HMR generations, legacy registrar ordering, and premature streaming disposal are explicit test targets. Current main has a known communication-channel attachment-test failure, independent of this work; report inherited failures honestly. No performance claim without enabled/disabled evidence. Missing integration infrastructure blocks completion rather than weakening coverage.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Lifecycle primitives
- [x] 1.1 Add audited registrar/scoped-factory helpers and generation lifecycle tests.
- [x] 1.2 Integrate process root and isolated caller builder with compatibility regression tests.

### Phase 2: Bootstrap and registrations
- [x] 2.1 Split process infrastructure from scoped encryption, search and event dispatch.
- [x] 2.2 Move query-index bridge subscription setup to generation ownership.
- [x] 2.3 Audit and migrate first-party module and app/template registrars.

### Phase 3: Entry points and qualification
- [x] 3.1 Wire startup, independent execution contexts and standalone parity.
- [ ] 3.2 Add and run self-contained request, caller, tenant and worker integration coverage.
- [ ] 3.3 Complete validation, independent review, workload evidence and documented rollout decision.

### Validation evidence
- Phase 1: 30 shared lifecycle tests and 9 worker handler tests passed (local runner).
- First package build: all 42 package tasks passed using worktree-local workspace links.
- Phase 2: scoped event suites 179 tests, search focused suites 14, registrar isolation 2, module activation/preflight 8, channel validation 1, workspace capacity 2; all passed locally. Full unit suite remains in progress.
- Build/generate/build, template parity, translation checks and full typecheck (42 tasks) passed.
- Independent review fixed caller-local event listener leakage, unknown-domain query-index bridging and nested caller-singleton identity/disposal. Focused re-review reports no residual blockers; events180, bootstrap7, query-index20 and DI31 tests pass. Final typecheck42/42 passes.
- Real enabled-path integration: five cases pass (person/company partial edits, concurrent tenant/org reads, real PostgreSQL unit-of-work isolation, cold/warm DI workload). Twenty generation-cold callers initialize one root and run 63 registrars; the next 100 run none; all 120 EntityManagers are distinct. ORM/imports were already warm, so this is not a process-start benchmark.
- Live qualification found and fixed the unmarked generated-value registrar used by CLI/workers. Focused dynamic-loader4, lifecycle16 and cache4 tests pass; full typecheck42/42 passes again.
- Configured unit gate is not green. Exact base 4ee923350e independently reproduces all seven communication-channel attachment failures and the MDX focus loop. Other worker-crash/dependency/mock failures passed focused rechecks; 2,857 core suites and 1,251 create-app tests passed in the broad run.
