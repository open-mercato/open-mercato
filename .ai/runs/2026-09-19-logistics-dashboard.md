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

GitHub: GraphQL identity and PR operations work; REST reads are rate-limited. Implementation PR #6242 is on the author fork because upstream access is read-only. No specification PR exists; the source design branch remains separate.

## Progress

PR: #6242

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Module and pages

- [x] 1.1 Add module metadata, feature, setup and seven guarded page metadata files. — db7d52547
- [x] 1.2 Build translated pages, activate the module, enforce DS rules and add unit coverage. — db7d52547

### Phase 2: Integration coverage and delivery

- [x] 2.1 Add integration coverage and deployment instructions. — 8d12cd7d3; template parity c6421b465
- [ ] 2.2 Run generators, validation and independent review; resolve findings.
- [ ] 2.3 Publish the PR with UI evidence, labels and verification report.

## Verification and handoff

Implementation source is complete at c6421b465. All 48 logistics unit tests and all 24 live Playwright scenarios passed (59.1 seconds; no failures, skips or flaky tests). Independent source review found no remaining findings after access/navigation coverage fixes. Desktop, mobile (390×844) and Polish screenshots were visually inspected and published in the evidence comment below. No source edits were needed after live verification.

Configured gate, local runner:

| Command | Result |
| --- | --- |
| yarn build:packages | Pass, 38 tasks |
| yarn generate | Pass; seven logistics routes, existing OpenAPI JSON import-attribute fallback warning |
| yarn build:packages | Pass, 38 tasks after generation |
| yarn i18n:check-sync | Pass |
| yarn i18n:check-usage | Pass, existing advisories |
| yarn typecheck | Pass, 38 tasks |
| yarn test | Fail; create-mercato-app: 727 pass, 20 fail, 143 skip; 45/46 tasks succeeded |
| yarn build:app | Pass |

Strict module/template DS lint, template synchronization, and seven focused docs notification-registry tests also passed. The docs assertion now uses the native path separator. Existing Windows Jest root normalization causes several broad package runs to discover no tests, so those are not counted as executed coverage. Actual logistics coverage used:

```sh
node node_modules/jest/bin/jest.js --config apps/mercato/jest.config.cjs --runInBand --testMatch '**/src/modules/logistics/__tests__/**/*.test.tsx'
```

Browser verification used the managed `yarn test:integration:ephemeral logistics` command with `OM_INTEGRATION_MODULES=logistics`, screenshot capture, and a fresh random process-local JWT_SECRET. Production auth correctly rejected the inherited placeholder signing secret on the first attempts; no auth policy was weakened. The module filter avoids slow all-repository Playwright discovery. Only disposable database data was initialized; the CLI cleaned up its runtime. Generated email capture was restored, and no credentials/logs were committed.

Remaining completion blockers:

- The full repository test gate is not green. One unchanged, platform-independent failure is the release-date mismatch between CHANGELOG.md (2026-09-18) and UPGRADE_NOTES.md (2026-09-17); other failures involve existing Windows path/junction/spawn assumptions. The review verdict therefore remains request changes despite a clean logistics source review. Release/pipeline behavior was not changed to force a pass.
- Upstream read-only permissions prevent assignment and labels. No claim lock was acquired. The requested label rationale is posted; a maintainer must apply feature, needs-qa, priority-medium, risk-high and the appropriate pipeline state after the gate resolves. No QA approval labels were applied.
- The contributor agreement remains pending, preview permission checks rejected deployment, and GitHub does not provide green validation checks for this head. Do not sign an agreement or alter access controls on the user's behalf.

Steps 2.2 and 2.3 remain unchecked because the required gate and ready/label state have not been reached. Resume with `om-auto-continue-pr 6242` after the repository gate and access prerequisites are resolved. The PR is intentionally draft, not complete or merge-ready.

PR: https://github.com/open-mercato/open-mercato/pull/6242
Review: https://github.com/open-mercato/open-mercato/pull/6242#issuecomment-5740669783
UI evidence: https://github.com/open-mercato/open-mercato/pull/6242#issuecomment-5740718258
Evidence branch: https://github.com/waclawek/open-mercato/tree/qa-evidence-pr-6242/pr-6242
Source doc: .ai/specs/2026-09-19-app-spec-logistics-dashboard.md (cez/2b56ff55, e7cdf8105; not committed into this implementation)
