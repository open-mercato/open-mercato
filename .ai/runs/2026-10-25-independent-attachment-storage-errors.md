# Independent attachment storage failures

Issue: #7941. Prerequisite: #6820. The branch includes the unmerged prerequisite so the follow-up can be reviewed against `main`; merge must wait for that prerequisite and fresh CI/QA evidence.

## Root cause

Warranty portal deletion removes attachment metadata before resolving storage and swallows configuration failures. Downloads short-circuit missing partitions as 500. Documents already localizes typed `CrudHttpError` bodies, but `attachmentService.readScoped` short-circuits missing partitions as 500 and catches all read failures as 404. OpenCode staging preserves factory rejection, but its runner replaces it with `OpenCodeRunFailedError`, losing the storage code/reason at the request and workflow boundary.

## Progress

- [x] Triage issue, check claims/duplicates, inspect prerequisite and compatibility rules.
- [x] Merge prerequisite into isolated branch and claim #7941.
- [x] Protect warranty deletion/replacement before metadata/provider effects and localize strict failures.
- [x] Cover documents' actual handler and service for strict missing/invalid partitions, preserving authorization and legacy errors.
- [x] Preserve typed staging failures through the runner and map request/job boundaries.
- [ ] Run real-handler regressions, negative controls, relevant package checks and configured validation gate where available.
- [ ] Review final diff, publish dependent PR, perform review/QA workflow, release locks and report.

## Validation

Use self-contained handler fixtures and real storage factories with fake providers. Verify redaction, translation, no construction/read/delete/removal on invalid configuration, shared-object release behavior, scope/auth rejection and legacy compatibility. No database migration or new production dependency.

Runner: local (Docker is unavailable). Initial focused checks against this checkout passed 134 core, 11 documents and 27 enterprise assertions using dependencies from the prior checkout with the same lockfile. A fresh immutable installation, final regression checks, negative controls and the configured gate are pending. These are handler/factory integration fixtures, not a running database or browser test.
