# Escape Storybook generated JavaScript literals

## Goal
Resolve coupled code-scanning alerts 199 and 200 in the Storybook variant generator without changing gallery identifiers or runtime components.

Source doc: .ai/specs/2026-09-12-local-design-system-storybook.md

## Scope
Source identities: `code-scanning:open-mercato/open-mercato:199`, `code-scanning:open-mercato/open-mercato:200`; fingerprint `js/bad-code-sanitization:scripts/storybook-generate.mjs:variantId`.
Generate JSX attributes as expressions, escape markup delimiters in emitted JavaScript string literals, and add hostile-input regression coverage. No dependencies, governance files, workflows, public contracts, issues, advisory publication, or alert dismissals.

## Implementation Plan
### Phase 1: Remediation
1.1 Correct generated variant source and test literal round trips and hostile markup.
### Phase 2: Verification and review
2.1 Run targeted security regressions and the configured ordered gate; document real blockers.
2.2 Obtain independent review, publish evidence, and promote only if verification is complete.

## Risks
The checkout has no node_modules. /tmp writes fail with quota exceeded; use a workspace TMPDIR. Full validation may require dependency installation; incomplete verification leaves the PR draft. Existing PRs #8741 and #8717 already cover Mermaid/Hono/ip-address and are excluded. Other Dependabot packages are deferred by this run's one-group scope, not declared fixed.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remediation

- [ ] 1.1 Correct generated variant source and test literal round trips and hostile markup.

### Phase 2: Verification and review

- [ ] 2.1 Run targeted security regressions and the configured ordered gate; document real blockers.
- [ ] 2.2 Obtain independent review, publish evidence, and promote only if verification is complete.
