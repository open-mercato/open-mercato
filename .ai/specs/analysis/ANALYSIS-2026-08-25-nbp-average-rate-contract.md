# Pre-Implementation Analysis: Explicit NBP Average-Rate Contract

## Executive Summary

The specification is implementation-ready and its core scope was explicitly confirmed. It extends the currencies module without replacing existing table-C `NBP` behavior; the only prerequisite is to keep the source spec itself in the PR because it is currently untracked outside this worktree.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| 1 | Stable public types, signatures, API, and schema | `RateType`, selector options, REST enum/field, and the entity schema change public behavior. | Warning | Keep additions optional/nullable, preserve `NBP` source semantics and existing unique key, document in `UPGRADE_NOTES.md`. |

### Missing BC Section

None. The source spec has a Migration & Compatibility section and a compatibility matrix.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| None | — | The source has the required product, architecture, API, UI, risk, phasing, testing, compliance, and changelog sections. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Source control | The source file is untracked outside the implementation worktree. | Add the spec to the PR and append implementation-status evidence. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|---|---|---|
| Custom write routes use mutation guards | Fetch-rates route | Convert metadata to per-method form and run the canonical guard lifecycle before writes. |
| Entity migrations use generated SQL and synchronized snapshots | ExchangeRate provenance column | Run `yarn db:generate`, retain only the currencies migration, and verify the snapshot. |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Partial/ambiguous A/B ingestion | Incorrect official rate or provenance | Validate both responses and duplicate currencies before a single provider transaction. |
| Scope omission in selected reads/writes | Cross-organization data exposure | Make provider/type predicates additive to tenant and organization filters; cover with tests. |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| New enum member in downstream exhaustive handlers | Consumers may mislabel `average` | Keep opt-in visibility and document the additive enum. |
| Same-date concurrent ingestion | Transient unique-key error | Retain database uniqueness and per-provider atomic transactions. |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| New UI labels drift between locales | Inconsistent operator experience | Update and test all five existing currencies locales. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- None.

### Important Gaps (Should Address)

- Add the source spec to the branch and record implementation completion.

### Nice-to-Have Gaps

- None; no new cache, event, worker, or encryption map is needed for public NBP table numbers.

## Remediation Plan

### Before Implementation (Must Do)

1. Preserve all existing table-C `NBP` behavior and public method call shapes.

### During Implementation (Add to Spec)

1. Record phase completion and validation evidence after implementation.

### Post-Implementation (Follow Up)

1. Verify CI and retain the migration-before-app deployment note in upgrade documentation.

## Recommendation

Ready to implement.
