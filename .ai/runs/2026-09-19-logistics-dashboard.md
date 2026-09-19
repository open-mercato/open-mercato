# Logistics navigation foundation

Source doc: .ai/specs/2026-09-19-app-spec-logistics-dashboard.md
Source branch: cez/2b56ff55 (e7cdf8105), design-only; source documents are not included in this implementation branch.
Status: in-progress
Engine: om-auto-create-pr (steps: 5, --loop: no)

## Goal and scope

Deliver the specification's seven-page logistics navigation foundation in the existing backend shell. Add one app module, the logistics.view feature, default administrator access, five locale dictionaries, and navigation/access tests. Activate it in the existing module configuration and enforce the existing DS rules for its new code.

No transport records, APIs, migrations, operational buttons, fake statistics, GPS, Enterprise dependencies, new auth behavior, or global landing-page changes.

## Implementation Plan

### Phase 1: Module and pages (spec C1)

1.1 Add module metadata, read feature, admin setup, and seven individually guarded page metadata files.
1.2 Build the translated dashboard links and planned-feature pages using Page, PageHeader, PageBody and EmptyState; activate the module and strict DS checks. Add unit coverage.

### Phase 2: Integration coverage and delivery (spec C2)

2.1 Add self-contained integration coverage for navigation, grants/wildcards/revocation, session and organization scope, mobile/keyboard access, and deployment instructions.
2.2 Run generators, targeted checks and the configured validation sequence; perform independent review and fix findings.
2.3 Publish the implementation PR, attach actual UI evidence, normalize labels and report verified results.

## Risks and validation

All new routes and ACL are additive; no existing contract changes. The source spec includes Migration & Backward Compatibility and numbered Phasing & Rollout, with its detailed C1/C2 breakdown linked from the spec. The module uses existing request-time guards; no custom auth/cache is introduced. Optimistic locking is not applicable to static pages without mutable entities.

Runner: local (no running compose app found). Install locked dependencies before checks. Configured gate: yarn build:packages; yarn generate; yarn build:packages; yarn i18n:check-sync; yarn i18n:check-usage; yarn typecheck; yarn test; yarn build:app.

GitHub preflight: gh auth status reports invalid keyring, but direct current-user request returns HTTP 403 API rate-limit exceeded. Initial public searches found no implementation/spec PR for the source path/branch. Early draft publication is deferred until tracker access recovers; no auth store changes. The user explicitly requested continued autonomous work. Verify tracker identity and repeat deduplication before publication.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Module and pages

- [ ] 1.1 Add module metadata, feature, setup and seven guarded page metadata files.
- [ ] 1.2 Build translated pages, activate the module, enforce DS rules and add unit coverage.

### Phase 2: Integration coverage and delivery

- [ ] 2.1 Add integration coverage and deployment instructions.
- [ ] 2.2 Run generators, validation and independent review; resolve findings.
- [ ] 2.3 Publish the PR with UI evidence, labels and verification report.
