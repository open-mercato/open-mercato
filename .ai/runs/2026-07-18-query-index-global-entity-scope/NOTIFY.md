# Notifications — query-index-global-entity-scope

- 2026-07-18: Run initialized from the supplied implementation-ready specification.
- 2026-07-18: Landed strict registered entity-ID and ORM-metadata scope resolution, global feature-toggle producer correction, and focused unit/integration regression coverage in `b57d4c804`.
- 2026-07-18: Fixed the discovered MikroORM v7 metadata-Map compatibility gap and confirmed `TC-FT-001` end-to-end against a managed ephemeral app.
- 2026-07-18: Full local validation and independent review passed. The repository-wide managed integration suite is blocked before test execution by stale sibling worktree discovery; this will be called out on the draft PR.
- 2026-07-18: Opened draft PR #4285. The upstream GitHub API token is read-only, so label/assignee automation requires a maintainer handoff.
- 2026-07-22: Reproduced the CI `TC-FT-008` failure, fixed global-list query scope plus the documented direct-query search-token behavior in `9ca4d60cb`, and pushed it to PR #4285. Shared query regression, typecheck, and all 22 feature-toggle integration tests pass; draft remains pending required CI.
