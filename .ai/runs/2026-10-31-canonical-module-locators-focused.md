# Focused canonical module locators

Goal: Replace PR #7283 with the canonical module locator/collision implementation and its directly required coverage.

Source doc: `.ai/specs/implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md`

Scope: CLI/shared locator parsing, exact-artifact preflight, enabled-provider collision guards, additive provenance, safe ejection, existing CLI integration coverage, compatible scaffold types, public documentation, and focused OMH-239 guidance/coverage.

Non-goals: General harness evaluator/controller/oracle changes; unrelated routing, context-budget or source-projection repairs; production-readiness changes; historical qualification dumps; unrelated CI fixes. Existing main behavior is preserved.

Plan: Apply only the reviewed locator implementation delta onto current main, retain current generator/facts/OpenAPI behavior, add the minimal module-tool guidance and derived inventory synchronization, validate and independently review, publish this replacement, then close #7283 with the replacement link.

Risks: Main has advanced since the original implementation. npm installation can leave a package installed if later registration validation fails. Harness knowledge qualification may require a supported Linux controller; an unavailable gate must remain explicit without adding general harness repair work. No migration or production dependency is required.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Focused implementation

- [ ] 1.1 Rebuild the canonical locator implementation and CLI coverage on current main.
- [ ] 1.2 Retain only required docs, scaffold compatibility and focused OMH-239 guidance/coverage.

### Phase 2: Verification and publication

- [ ] 2.1 Run focused tests and the configured validation gate; document actual limitations.
- [ ] 2.2 Independently review the final scope and compatibility; fix bounded findings.
- [ ] 2.3 Publish the replacement PR and close #7283 with a reciprocal link.
