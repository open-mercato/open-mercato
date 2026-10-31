# Focused canonical module locators

Goal: Replace PR #7283 with the canonical module locator/collision implementation and its directly required coverage.

Source doc: `.ai/specs/implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md`

Scope: CLI/shared locator parsing, exact-artifact preflight, enabled-provider collision guards, additive provenance, safe ejection, existing CLI integration coverage, compatible scaffold types, public documentation, and focused OMH-239 guidance/coverage.

Non-goals: General harness evaluator/controller/oracle changes; unrelated routing, context-budget or source-projection repairs; production-readiness changes; historical qualification dumps; unrelated CI fixes. Existing main behavior is preserved.

Plan: Apply only the reviewed locator implementation delta onto current main, retain current generator/facts/OpenAPI behavior, add the minimal module-tool guidance and derived inventory synchronization, validate and independently review, publish this replacement, then close #7283 with the replacement link.

Risks: Main has advanced since the original implementation. npm installation can leave a package installed if later registration validation fails. Harness knowledge qualification may require a supported Linux controller; an unavailable gate must remain explicit without adding general harness repair work. No migration or production dependency is required.

## Progress

PR: #8309

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Focused implementation

- [x] 1.1 Rebuild the canonical locator implementation and CLI coverage on current main. — e5b980998
- [x] 1.2 Retain only required docs, scaffold compatibility and focused OMH-239 guidance/coverage. — cd2dd6b02

### Phase 2: Verification and publication

- [ ] 2.1 Run focused tests and the configured validation gate; document actual limitations.
- [ ] 2.2 Independently review the final scope and compatibility; fix bounded findings.
- [x] 2.3 Publish the replacement PR and close #7283 with a reciprocal link.

## Verification and remaining gates

Runner: local, Node 24.22.2; neither standard compose file has a running app container. The isolated worktree reuses third-party dependencies while binding workspace packages to this checkout.

- Package build: 42/42 pass before generation and 42/42 pass afterward. Generation and i18n sync/usage pass.
- CLI/source validation: 241 focused tests, 292 existing generator-consumer tests and 27 shared parser tests pass; the four suites affected by the additional same-file no-op regression fix pass 125/125. All 21 self-contained CLI integrations pass (TC-INT-007/009: 17; unchanged TC-INT-008: 4).
- The same-file no-op fix restores main's repeated-add behavior without Yarn or source writes. Its added directory/archive positives fail before the fix while the different-file denial controls already pass.
- Create-app guidance, scaffold TypeScript compatibility and source-link inventory: 33/33 pass. Derived inventory has 154 records, 128 source-required records, 33 owners and 130 rendered links.
- Independent final source/scope/compatibility review, including the no-op fix: no remaining source findings. Formal approval is withheld while validation gates remain incomplete.
- Full typecheck fails in unchanged example integration code importing the TypeScript 7 JavaScript compiler API. Full tests fail before assertions in the unchanged web-research-serp suite because its ts-jest runner resolves that unavailable API. Production app build fails because Turbopack rejects the reused dependency symlink outside the worktree. These failures are retained and no unrelated source or toolchain fixes are included.
- A fresh classic scaffold with regular extracted CLI/shared/core/UI package archives passes OMH-239. Its diagnostic complete catalog is 227/240: thirteen other cases exceed their unchanged context ceilings. This is not release certification; external skills were deliberately excluded from this local source smoke. Initial symlink-based diagnostic failures are superseded only as provisioning diagnostics, never represented as qualification passes.
- Supported Linux/Bubblewrap packed-preset/live/full release qualification remains unavailable on this native macOS controller. The new draft does not inherit or claim any passing release proof from #7283. General harness repair scope stays outside this PR.

The replacement implementation is published, and #7283 is closed with its reciprocal link. Steps 2.1 and 2.2 remain open for a passing complete validation gate and final formal review; no merge or readiness claim is made.
