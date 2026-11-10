# Issue #9148

Verification: source at the parent fork still returns unrestricted for a custom entity registered in a sibling organization and performs an unscoped fallback lookup. Issue/PR/commit searches found no existing fix. No live reproduction has been run.

Summary: Custom-entity restrictions are lost when classification uses a different organization than record queries.

Root cause: `classifyRecordsEntity` uses a most-specific registration flag while GET can read multiple organizations; its final `{ entityId }` lookup also crosses tenants. The existing ACL gate correctly honors the classification but cannot recover a lost flag.

Files to change:
- `packages/core/src/modules/entities/lib/entityClassification.ts` — resolve live tenant/global restrictions before organization overlays; scope historical fallback.
- `packages/core/src/modules/entities/lib/__tests__/entityClassification.test.ts` — sibling, overlay, global, lifecycle and cross-tenant isolation regressions.
- `packages/core/src/modules/entities/api/__tests__/records.acl.test.ts` — exercise the real classifier plus route ACL for read/export and mutations, all-organization selection, authorized callers and wrong-tenant registration.

- `packages/core/src/modules/entities/api/__tests__/records.crud.test.ts` — retain the existing tenant-isolation assertion with the new tenant/global predicate.

Approach: Preserve ORM precedence and existing exported signatures. Require the existing per-entity feature whenever any live tenant registration or instance-global registration is restricted. An unrestricted overlay or declaration cannot weaken a live restriction. Retain historical custom classification only inside the caller tenant. Use existing RBAC enforcement and record scoping.

Risks: Intentional tightening applies to restricted entities across organizations. Unrestricted entities and privileged grants remain supported. No schema, dependency, startup, configuration or architecture changes.

Plan: implement and demonstrate regression failures on the original classifier; run targeted tests and bounded configured gate; open a ready PR with claim handoff; review using GitHub checks first, release owned claims and report limits to parent.

## Regression evidence

- `yarn jest --config packages/core/jest.config.cjs packages/core/src/modules/entities/lib/__tests__/entityClassification.test.ts packages/core/src/modules/entities/api/__tests__/records.acl.test.ts --runInBand`: 34 passed.
- The same two suites against the original classifier, mapped through a temporary Jest configuration: 12 failed, 22 passed. This reproduces sibling/all-organization read/export and mutation bypasses and the foreign-tenant fallback.
- `yarn jest --config packages/core/jest.config.cjs packages/core/src/modules/entities --runInBand`: 46 suites passed, 440 tests passed, 19 existing skips.
- Configured gate runner: local (no running compose app). Package builds (both), generation and typecheck passed. Translation checks passed when retried with a shorter temporary directory after a local IPC socket-path failure. Full workspace tests and app build were stopped at their 120-second bounds; the app compiled successfully before its TypeScript phase reached the bound. Template parity passed.

Compatibility: exported symbols/signatures, API paths and shapes, ACL feature ids and DB schema are unchanged. The correction enforces the existing restricted-entity ACL across organizations; no migration or new configuration is required. The shared classifier's workflow consumer inherits the corrected restriction without a separate change.

Parent review found and fixed two consumer regressions: the enterprise typecheck inferred the union-shaped scope predicate as the entity type (TS2345/TS2339), now explicitly parameterized with the entity instance type; workflow task-access tests assumed a single lookup, now exercise tenant/global predicates and assert both the restriction query and scoped lookup remain deduplicated across a page. Added a sibling-restriction workflow regression. No workflow production code changed. Parent rerun: 48 suites, 476 tests passed with 19 existing skips across entities, the workflow consumer and catalog.
