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
Yarn immutable installation completed. /tmp has a write quota failure; long temporary paths break tsx sockets, and fixture directories inside the monorepo break standalone detection. Final runner: local, TMPDIR=/var/tmp/cez80-80ce7be1 and TURBO_ENV_MODE=loose. Seven configured gate commands pass; yarn test timed out after 300 seconds with 46/50 tasks successful. Full test completion and an independent approve verdict remain required; keep PR #8747 draft. Existing PRs #8741 and #8717 already cover Mermaid/Hono/ip-address and are excluded. Other Dependabot packages are deferred by this run's one-group scope, not declared fixed.

## Verification evidence

Implementation: 31abee1a54. Nine hostile-input regressions pass; all nine fail against the original source. Independent reviewer compiled 148 entries / 876 variants and tested 13 additional adversarial inputs with no code findings. Review verdict is changes requested for validation: https://github.com/open-mercato/open-mercato/pull/8747#issuecomment-6651275066

Final gate, in configured order: timeout 300 yarn build:packages (0); timeout 300 yarn generate (0); timeout 300 yarn build:packages (0); timeout 300 yarn i18n:check-sync (0); timeout 300 yarn i18n:check-usage (0); timeout 300 yarn typecheck (0); timeout 300 yarn test (124, 46/50 tasks successful); timeout 600 yarn build:app (0). All used the final runner environment above. Template sync, Storybook generation/check, Node syntax and diff whitespace checks pass. Optional catalogue evidence test skips its absent Figma manifest. No full local gate pass claimed.

Rechecked latest main and open alerts/PRs before reporting: main still has alerts199/200; only matching Storybook remediation PR is #8747. Scanned42 dependency alerts:22 overlap #8717/#8741;20 deferred (#541,#509,#508,#497,#492,#485,#480,#479,#478,#477,#413,#398,#378,#318,#310,#308,#301,#298,#284,#220). No alerts dismissed or declared fixed on main; no issues created.

Resume: om-auto-continue-pr 8747. First remaining step2.1: complete the full suite with an adequate timeout, then obtain independent approval for step2.2. The current run releases its claim and does not wait for CI or promote the draft.

## Progress
PR: #8747

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remediation

- [x] 1.1 Correct generated variant source and test literal round trips and hostile markup. — 9c2b5fa619

### Phase 2: Verification and review

- [ ] 2.1 Run targeted security regressions and the configured ordered gate; document real blockers.
- [ ] 2.2 Obtain independent review, publish evidence, and promote only if verification is complete.
