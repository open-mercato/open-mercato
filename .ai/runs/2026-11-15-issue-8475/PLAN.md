# Issue #8475 implementation plan

Source doc: .ai/specs/2026-11-15-configured-integration-role-credentials.md
Spec PR: #9560

## Progress
- [x] Confirm issue ownership, no implementation PR and additive compatibility with existing init variables.
- [x] Publish separate design-only spec PR.
- [x] Resolve configured admin/employee fields through existing env lookup and document module-load timing/defaults.
- [x] Add resolution and native API-login regressions; all 67 helper tests pass.
- [x] Verify negative control: old helper fails six of nine new assertions.
- [x] Execute configured local gate; record limits rather than claim green.
- [ ] Obtain green CI and independent review on implementation PR.

## Validation
Local runner. Package builds, generation and i18n sync/usage pass.
Typecheck fails on existing ComboboxInput duplicate id declarations; root tests fail in web-research adapter TypeScript/Jest tooling.
App build rejects shared node_modules symlink. The live TC-CACC-CREATE-ORG-001 scenario was not executed; controlled native login request regressions passed, and its product assertions remain unchanged.
