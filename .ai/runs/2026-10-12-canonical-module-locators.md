# Canonical module requirements

Goal: Match module requirements by module ID or canonical package/repository origin, preserve one enabled provider per runtime ID throughout installation and generation, and support explicit provider replacement without overwriting local source.

Source doc: `.ai/specs/implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md`

Scope: Additive locator metadata/configuration, distinct npm and GitHub requirement identities, dependency checks in installation and generation, inspected-artifact installation, package-binding preservation, alias enablement, safe ejection, actionable recovery guidance, and the aligned create-mercato-module companion PR.

Plan: Preserve legacy IDs; normalize npm locators to package identities and GitHub aliases to owner/repository identities. Keep version/ref selectors for installation guidance without introducing version constraint validation. Read origin from dependency specifications and optional retained provenance, checking installed manifest identity; repository metadata alone does not establish a GitHub source. Preserve provenance for ejected modules. Inspect npm artifacts without lifecycle scripts, preserve requested selectors and recheck the installed version, inspect local file sources directly, and pin GitHub commits. Reject ID or binding collisions before Yarn, and reject duplicate enabled IDs before every generator writes output. Cover the real CLI/generator flows with focused tests and run the configured gate.

Risks: Short IDs remain intentionally origin-agnostic. An npm package repository field cannot establish GitHub installation provenance. Package aliases do not namespace runtime IDs. Failures after Yarn may leave a dependency installed without completed enablement; failures after registration may leave stale generated output. Neither case is successful completion, and recovery must preserve local source and restore dependency bindings through the package manager. Disabling generated discovery does not remove manual imports or migrate data. Full repository validation may encounter environment failures, which must be recorded without claiming success.

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

Collision policy specification: https://github.com/open-mercato/open-mercato/pull/7289 (`.ai/specs/2026-10-12-module-source-collision-policy.md` on its branch). The October 22 alignment implements its lifecycle-wide ID and binding collision policy, aliases, explicit replacement, optional provenance, and disable semantics. Automatic runtime namespacing, provider data migration, and arbitrary application import rewriting remain outside the supported flow.

## Verification evidence

Runner: local. Focused CLI unit tests: 117 passed. Shared canonical parser: 24 passed. App/scaffold TypeScript compatibility: 6 passed (failure-first TS2353 baseline confirmed). CLI integration: all 8 passed with an exact-file Playwright configuration; the broad repository configuration stalled during discovery and is not reported as passed. Companion generator: 175 passed, 5 environment-gated skips; typecheck, lint and pack passed. Package builds, generation, i18n sync/usage, typecheck and production app build passed. Default yarn test failed twice with Jest worker SIGSEGV in varying CLI suites; no assertion failures remained. The entire CLI suite passed with --runInBand: 112 suites, 2098 tests, 2 snapshots. Independent final source review found no remaining blocker/major. Remaining packages passed separately: 47 Turbo tasks, including core (2243 suites / 20839 tests) and create-app (909 passed / 5 skipped). Companion CI is green. Details are recorded in the PR run summary; the default parallel test gate is not claimed green.

## October 22 collision-policy alignment

### Phase 4: Specification alignment and merge readiness

- [x] 4.1 Inspect the resolved collision policy and route the implementation changes through the CLI's actual install, enable, eject, resolver, and generator entrypoints.
- [x] 4.2 Document exact-artifact preflight, binding consumers, aliases, optional provenance, explicit disable/replacement, and recovery from partial installation or stale generation.
- [ ] 4.3 Complete focused CLI regressions, the configured validation gate, final review, and published-head CI checks; record the new evidence separately from the historical verification above.

Implementation contract:

- npm preflight inspects the requested artifact using `npm pack --ignore-scripts`, selects its shipped module descriptors, and verifies the installed version against the inspected artifact while preserving the requested selector. Local `file:` sources are inspected directly. GitHub preflight resolves the chosen repository/ref to a pinned commit.
- Before Yarn changes a binding, every enabled consumer must retain its canonical origin and module layout. Same-source npm updates and same-repository GitHub updates are supported; switching providers requires disabling the affected entries first.
- Installed aliases resolve through the dependency binding while retaining the canonical package manifest name. They do not create another runtime ID or make two providers with the same ID coexistent.
- Generation rejects duplicate enabled IDs before output writes, including same-source duplicates. A valid single-entry package/local overlay remains supported, and an explicitly empty enabled-module list stays disabled.
- Ejection validates configuration and provenance before copying source, preserves an existing destination, and retains available optional source identity when switching one entry to `@app`.
- npm and GitHub requirements remain distinct; package repository metadata does not add a second origin. Existing provenance-free registrations remain valid. Observable origin/manifest contradictions fail with recovery guidance.
- Disabling removes the entry from generated discovery. Dependency uninstallation, manual imports, local source, database contents, and provider data migration remain operator-owned decisions.

### Standalone harness coverage assessment

OMH-239 already covers creating/publishing a custom module, local preview, a fresh receiving app, preserving app source, optional repository linking, portability, and npm authentication boundaries. Its owner is `.ai/guides/module-tool.md`; its decisions do not exercise alias bindings, distinct npm/GitHub installation origins, duplicate enabled-ID rejection before output writes, binding replacement, or ejection provenance. No equivalent collision/origin evaluation was found in the current catalog. Focused CLI regressions cover these implementation paths; they are not evidence of agent-routing coverage or a fresh live harness release. The existing case and emitted knowledge owners are unchanged by this alignment. Any future harness extension needs the normal failure-first knowledge-change and certified release workflow.
