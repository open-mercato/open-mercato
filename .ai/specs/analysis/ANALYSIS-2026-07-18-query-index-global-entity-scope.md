# Pre-Implementation Analysis: Query-index scope resolution for global entities

## Executive Summary

The specification is ready to implement as a focused core hardening change. It preserves every published event, API, schema, and generated-file contract while closing an unsafe permissive table-resolution path and correcting a global producer that leaks actor scope. One test assertion conflicts with the established physical-delete behavior of `entity_indexes`; the implementation should preserve that behavior and assert the projection row is absent after delete.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| 1 | Internal integration expectation | The source spec expects a soft-deleted projection after feature-toggle delete, but `markDeleted()` physically removes `entity_indexes` rows. | Warning | Keep current deletion semantics; assert no matching projection row after DELETE and record the correction in the copied spec. |

### 13-surface audit

| Surface | Result |
|---|---|
| Auto-discovery conventions | No files or exports are renamed; existing subscriber paths remain unchanged. |
| Public types and interfaces | The descriptor and source-scope union remain internal to `query_index`. |
| Function signatures | No public function signature changes. |
| Import paths | No moved public import path. |
| Event IDs and payloads | `query_index.upsert_one` and `delete_one` IDs and fields remain unchanged; feature-toggle values become correct null/null scope. |
| Widget injection spots | Not applicable; no UI changes. |
| API URLs and schemas | Unchanged. |
| Database schema | Unchanged. |
| DI names | Unchanged. |
| ACL features | Unchanged. |
| Notification type IDs | Unchanged. |
| CLI commands | Unchanged. |
| Generated contracts | No generated file is edited; no discovery convention changes. |

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| None | The source includes scope, architecture, data, compatibility, risk, implementation, unit, and integration coverage sections. | No addition required. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Integration coverage | Delete expects a soft-deleted projection despite established physical deletion. | Assert the projection is absent after DELETE; keep the create/update null-scope assertions. |
| Integration metadata | The feature-toggle integration folder currently declares only `feature_toggles`, while the new DB assertion depends on query indexing. | Add `query_index` to the existing module dependencies if module-gated runs permit it. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|---|---|---|
| Preserve tenant/organization scoping and never trust an arbitrary table | Existing `loadQueryIndexRowScope()` uses permissive `resolveEntityTableName()` and both subscribers convert any error to missing-row scope. | Resolve only registered metadata, distinguish global/row/missing results, and let metadata or SQL failures reach the existing error recorder. |
| Persistent/index side effects must preserve contracts | Feature-toggle command helper derives index scope from the actor. | Use a context-free global identifier helper returning null/null on every lifecycle path. |
| Integration tests are self-cleaning and module-local | Extended `TC-FT-001` reads the shared projection table. | Query only the generated toggle ID; retain API cleanup and remove any residual exact projection row in `finally`. |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Treating unknown metadata as global | A malformed entity ID could bypass scope verification or query an inferred table. | Require registered table metadata and throw `QueryIndexScopeError`; cover unknown metadata. |
| Actor scope leaks into global projection | Global data may be stored as tenant-scoped, creating incorrect coverage and token side effects. | Constant global identifiers plus strict explicit-null global payload validation. |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Delete coverage retains invalid predicates | Global deletes continue issuing invalid-column SQL. | Reuse the resolved descriptor and conditionally add only declared scope predicates. |
| Metadata mapping drift | An unusual property mapping could select an invalid column. | Require exactly one mapped `fieldNames` entry for each declared scope property and fail closed. |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| In-memory metadata lookup per event | Small event-path overhead. | Use already-loaded ORM metadata; global entities remove the current source query. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- None.

### Important Gaps (Should Address)

- Preserve physical projection deletion in the integration test rather than changing `markDeleted()` outside the declared scope.
- Assert a present global payload is literal `null`, not an omitted or `undefined` value normalized by `??`.

### Nice-to-Have Gaps

- None; the existing feature-toggle lifecycle test is the correct fixture family.

## Remediation Plan

### Before Implementation (Must Do)

1. Land the source spec and this analysis, including the physical-delete correction.
2. Create loop artifacts with a resumable task table.

### During Implementation (Add to Spec)

1. Record that all source table and column identifiers derive exclusively from registered MikroORM metadata.
2. Add unit and integration evidence for global, partial-scope, missing-row, mismatch, and unknown-entity behavior.

### Post-Implementation (Follow Up)

1. Run the configured validation gate and review the actual diff against the full checklist.

## Recommendation

Ready to implement. The physical-delete test correction is a non-breaking clarification that preserves current projection storage semantics.
