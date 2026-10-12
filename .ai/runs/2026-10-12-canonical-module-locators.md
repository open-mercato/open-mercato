# Canonical module requirements

Goal: Match module requirements by module ID or canonical package/repository origin and reject colliding module names before registration/ejection.

Source doc: `.ai/specs/implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md`

Scope: Additive locator metadata/configuration, npm and GitHub requirement normalization, dependency checks in installation and generation, actionable install hints, aligned create-mercato-module companion PR.

Plan: Preserve legacy IDs; normalize npm locators to package identities and GitHub aliases to owner/repository identities. Keep version/ref selectors for installation guidance without introducing version constraint validation. Read origin from enabled configuration and installed manifests; preserve it for ejected modules. Fail before source/config mutation on collisions. Cover the real CLI/generator flows with focused tests and run the configured gate.

Risks: Short IDs remain intentionally origin-agnostic. Repository metadata with a directory cannot stand for a dedicated module repository. Installing a package may leave it installed after dependency preflight fails; never report successful enablement in that case. Full repository validation may encounter environment failures, which must be recorded without claiming success.

## Progress

PR: #7283

### Phase 1: Canonical identity

- [ ] 1.1 Add shared normalization and optional locator metadata/configuration.
- [ ] 1.2 Resolve canonical requirements in all generator validation and ordering paths.

### Phase 2: Installation and alignment

- [ ] 2.1 Add origin-aware preflight, install guidance and collision protection.
- [ ] 2.2 Align create-mercato-module and open companion PR if needed.

### Phase 3: Verification

- [ ] 3.1 Run focused unit/integration coverage and configured validation gate.
- [ ] 3.2 Review changes, publish evidence and update PR.
