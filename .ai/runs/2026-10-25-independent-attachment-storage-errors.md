# Independent attachment storage failures

Issue: #7941. Implementation PR: #7975. Prerequisite: #6820. The branch includes the unmerged prerequisite so the follow-up can be reviewed against `main`; merge must wait for that prerequisite, CI, human review and QA approval.

## Root cause

Warranty portal deletion removes attachment metadata before resolving storage and swallows configuration failures. Downloads short-circuit missing partitions as 500. Documents already localizes typed `CrudHttpError` bodies, but `attachmentService.readScoped` short-circuits missing partitions as 500 and catches all read failures as 404. OpenCode staging preserves factory rejection, but its runner replaces it with `OpenCodeRunFailedError`, losing the storage code/reason at the request and workflow boundary.

## Progress

- [x] Triage issue, check claims/duplicates, inspect prerequisite and compatibility rules.
- [x] Merge prerequisite into isolated branch and claim #7941.
- [x] Protect warranty deletion/replacement before metadata/provider effects and localize strict failures.
- [x] Cover documents' actual handler and service for strict missing/invalid partitions, preserving authorization and legacy errors.
- [x] Preserve typed staging failures through the runner and map request/job boundaries.
- [x] Run real-handler regressions, negative controls and the available validation gate; record deferred checks and limits.
- [x] Obtain independent review, publish the dependent PR and document formal-review/QA limitations.

## Validation

Use self-contained handler fixtures and real storage factories with fake providers. Verify redaction, translation, no construction/read/delete/removal on invalid configuration, shared-object release behavior, scope/auth rejection and legacy compatibility. No database migration or new production dependency.

Runner: local Windows, with a fresh immutable dependency installation. Focused suites pass 174 assertions: 136 core, 11 documents and 27 enterprise. Restoring the unfixed production code produces 29 assertion failures (17 core, 4 documents, 8 enterprise); the restored enterprise suite passes again. These fixtures execute actual handlers, services, factories and the runner, with no running database, provider, browser or LLM claim. Explicit in-memory Jest discovery was needed in the Windows worktree; the broad test command reported no suites for multiple packages.

| Ordered local gate | Result |
| --- | --- |
| First `yarn build:packages` | 40 tasks passed |
| `yarn generate` | Passed; 662 API paths generated |
| Second `yarn build:packages` | 40 tasks passed |
| `yarn i18n:check-sync` | Passed |
| `yarn i18n:check-usage` | Stopped at its 600-second deadline while scanning; no completed result |
| `yarn typecheck` | 40 tasks passed |
| `yarn test` | Broad local run stopped after current-head CI became available; use the 174 explicit local assertions and CI for coverage |
| `yarn build:app` | Deferred to current-head CI |

The repository's review policy prefers GitHub checks and forbids local substitutes while required CI is pending. The initial published source passed lint, design lint, guards and CodeQL; tests, app/container validation and native integration were pending when reported. No full local gate or final CI success is claimed.

Independent read-only review of the caller fix approved with no Medium or higher findings and 46 additional selected assertions. It did not re-review prerequisite #6820. Formal `om-auto-review-pr` execution is unavailable because the installed files contain only self-referencing repo-local extensions. Docker and a reusable test environment are absent, so browser/native QA is unavailable locally. Keep `review` and `needs-qa`; this authoring run supplies neither GitHub approval nor `qa-approved`.
