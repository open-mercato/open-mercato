# Canonical module requirements

Goal: Match module requirements by module ID or canonical package/repository origin and reject colliding module names before registration/ejection.

Source doc: `.ai/specs/implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md`

Scope: Additive locator metadata/configuration, npm and GitHub requirement normalization, dependency checks in installation and generation, actionable install hints, aligned create-mercato-module companion PR.

Plan: Preserve legacy IDs; normalize npm locators to package identities and GitHub aliases to owner/repository identities. Keep version/ref selectors for installation guidance without introducing version constraint validation. Read origin from enabled configuration and installed manifests; preserve it for ejected modules. Fail before source/config mutation on collisions. Cover the real CLI/generator flows with focused tests and run the configured gate.

Risks: Short IDs remain intentionally origin-agnostic. Repository metadata with a directory cannot stand for a dedicated module repository. Installing a package may leave it installed after dependency preflight fails; never report successful enablement in that case. Full repository validation may encounter environment failures, which must be recorded without claiming success.

## Progress

PR: #7283

### Phase 1: Canonical identity

- [x] 1.1 Add shared normalization and optional locator metadata/configuration. — 312ad6a3ba
- [x] 1.2 Resolve canonical requirements in all generator validation and ordering paths. — 312ad6a3ba (all three validation paths; existing generators have no dependency topological ordering)

### Phase 2: Installation and alignment

- [x] 2.1 Add origin-aware preflight, install guidance and collision protection. — 312ad6a3ba, 55c2e1ca3d
- [x] 2.2 Align create-mercato-module and open companion PR if needed. — companion PR https://github.com/open-mercato/create-mercato-module/pull/6, commit 10d2157

### Phase 3: Verification

- [x] 3.1 Run focused unit/integration coverage and configured validation gate. — configured test command encountered worker SIGSEGV; complete CLI passed serially (112 suites, 2098 tests), supplementary remaining-package verification recorded below.
- [x] 3.2 Review changes, publish evidence and update PR. — independent final source review: no remaining blocker/major; final provenance/discovery fixes 14680ab6c2.

## Related deliverables

Independent collision policy specification: https://github.com/open-mercato/open-mercato/pull/7289. It covers future lifecycle-wide collision policy and package aliases without expanding this implementation into automatic runtime namespacing.

## Verification evidence

Runner: local. Focused CLI unit tests: 117 passed. Shared canonical parser: 24 passed. App/scaffold TypeScript compatibility: 6 passed (failure-first TS2353 baseline confirmed). CLI integration: all 8 passed with an exact-file Playwright configuration; the broad repository configuration stalled during discovery and is not reported as passed. Companion generator: 175 passed, 5 environment-gated skips; typecheck, lint and pack passed. Package builds, generation, i18n sync/usage, typecheck and production app build passed. Default yarn test failed twice with Jest worker SIGSEGV in varying CLI suites; no assertion failures remained. The entire CLI suite passed with --runInBand: 112 suites, 2098 tests, 2 snapshots. Independent final source review found no remaining blocker/major. Remaining packages passed separately: 47 Turbo tasks, including core (2243 suites / 20839 tests) and create-app (909 passed / 5 skipped). Companion CI is green. Details are recorded in the PR run summary; the default parallel test gate is not claimed green.
