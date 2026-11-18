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
- [ ] 2.1 Split process infrastructure from scoped encryption, search and event dispatch.
- [ ] 2.2 Move query-index bridge subscription setup to generation ownership.
- [ ] 2.3 Audit and migrate first-party module and app/template registrars.

### Phase 3: Entry points and qualification
- [ ] 3.1 Wire startup, independent execution contexts and standalone parity.
- [ ] 3.2 Add and run self-contained request, caller, tenant and worker integration coverage.
- [ ] 3.3 Complete validation, independent review, workload evidence and documented rollout decision.

### Validation evidence
- Phase 1: 30 shared lifecycle tests and 9 worker handler tests passed (local runner).
- First package build: all 42 package tasks passed using worktree-local workspace links.
