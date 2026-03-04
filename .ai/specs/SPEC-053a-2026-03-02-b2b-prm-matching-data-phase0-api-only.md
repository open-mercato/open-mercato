# SPEC-053a: B2B PRM Matching Data Foundation (API-Only)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Open Mercato Team |
| **Created** | 2026-03-02 |
| **Parent** | [SPEC-053](./SPEC-053-2026-03-02-b2b-prm-starter.md) |
| **Related** | SPEC-053b (Operations), entities module, dictionaries module |

## TLDR
**Key Points:**
- Build the partner matching data foundation without backend/frontend code changes.
- Use only existing OM APIs (`/api/entities/*`, `/api/dictionaries/*`, `/api/customers/*`).
- Prepare normalized partner profile and case-study datasets for later RFP matching and scoring.
- Treat this as a POC prerequisite workstream, not a separate customer-facing phase.

**Scope:**
- Controlled dictionaries and strict select buckets.
- Custom fields for `customers:customer_company_profile`.
- Custom entity `user:case_study` with structured project evidence.

**Concerns:**
- Data quality consistency and taxonomy governance.
- Avoid schema drift between dictionaries and custom field definitions.

## Overview
This workstream creates the foundational data substrate needed for partner matching.

Business goal:
- make partner capabilities comparable,
- standardize evidence from case studies,
- enable future matching/scoring engines with high-signal structured data.

Implementation constraint:
- API-only rollout; no runtime code changes in this workstream.

Market reference:
- Leading partner ecosystems rely on structured partner profiles and evidence catalogs before automating scoring.
- OM adopts the same sequencing: data quality first, ranking automation later.

## Problem Statement
Without a standardized data model:
- matching is subjective and inconsistent,
- RFP shortlisting quality is low,
- profile data cannot be reliably aggregated or filtered,
- future scoring automation becomes unstable.

## Proposed Solution
Use existing entities/dictionaries APIs to configure:
1. dictionary-backed capability taxonomies,
2. strict bucketed attributes for normalized comparisons,
3. case-study custom entity with matching metadata,
4. default-value policy and completeness checks.

### In Scope
- dictionary creation and seeded entries,
- custom field definitions on company profile and case-study entity,
- API ingestion/backfill scripts for existing records,
- completeness and quality checks.

### Out of Scope
- new module code or runtime routes,
- new UI features,
- matching algorithm execution,
- KPI computation logic (`WIC/WIP/MIN`), including MIN source ownership and attribution rules (defined in `SPEC-053b`).

## User Stories / Use Cases
### 1. Data Foundation & Quality
- **As an Agency Business Developer**, I want to describe my agency's capabilities strongly typed dropdowns (Industries, Services, Tech) so that the portal understands my exact strengths without parsing free text.
- **As an Agency Business Developer**, I want to submit a structured case study detailing project duration, budget, and tech stack so that I have verifiable proof of my agency's capabilities for future RFPs.
- **As a Partnership Manager**, I want normalized case-study data so RFP fit review can be evidence-based.

### 2. Infrastructure & Rollout
- **As an Engineer**, I want API-only bootstrap so this phase can run quickly and safely in existing tenants.
- **As a Maintainer**, I want repeatable taxonomy rollout and quality checks across environments.
## Architecture
### Data Structure
- Profile extension target: `customers:customer_company_profile`
- Evidence entity: `user:case_study`
- Taxonomy source: `dictionaries` module + strict select buckets

### Access and Permissions
- manage definitions/entities: `entities.definitions.manage`
- manage dictionaries/entries: `dictionaries.manage`
- read definitions/options: `entities.definitions.view`

### Transaction and Undo Contract
- dictionary and definition writes are idempotent upserts by stable keys.
- backfill runs use checkpointed batches and resumable idempotency.
- rollback strategy:
  - remove/deactivate created definitions by key when needed,
  - preserve record audit history; no destructive truncation.

## Data Models
### Company Profile Fields (`customers:customer_company_profile`)
| Key | Kind | Multi | Default | Grid |
|---|---|---:|---|---|
| `positioning_summary` | multiline | no | `""` | hidden |
| `services` | dictionary | yes | `[]` | visible |
| `industries` | dictionary | yes | `[]` | visible |
| `tech_capabilities` | dictionary | yes | `[]` | visible |
| `delivery_models` | select | yes | `["hybrid"]` | visible |
| `compliance_tags` | dictionary | yes | `[]` | visible |
| `team_size_bucket` | select | no | `"unknown"` | visible |
| `min_project_size_bucket` | select | no | `"unknown"` | visible |
| `hourly_rate_bucket` | select | no | `"unknown"` | hidden |
| `regions` | dictionary | yes | `[]` | hidden |
| `languages` | dictionary | yes | `[]` | hidden |
| `clutch_url` | text | no | `""` | hidden |
| `profile_confidence` | integer | no | `3` | hidden |

### Recommended Visible Grid Columns
`services`, `industries`, `tech_capabilities`, `delivery_models`, `compliance_tags`, `team_size_bucket`, `min_project_size_bucket`

### Case Study Fields (`user:case_study`)
| Key | Kind | Multi | Default | List |
|---|---|---:|---|---|
| `title` | text | no | `""` | yes |
| `summary` | multiline | no | `""` | no |
| `provider_company` | relation (`customers:customer_entity`) | no | `null` | yes |
| `provider_company_name` | text | no | `""` | yes |
| `technologies` | dictionary | yes | `[]` | yes |
| `industry` | dictionary | yes | `[]` | yes |
| `project_type` | select | no | `"unknown"` | yes |
| `duration_bucket` | select | no | `"unknown"` | yes |
| `duration_weeks` | integer | no | `null` | no |
| `budget_known` | boolean | no | `false` | yes |
| `budget_bucket` | select | no | `"unknown"` | yes |
| `budget_min_usd` | float | no | `null` | no |
| `budget_max_usd` | float | no | `null` | no |
| `delivery_models` | select | yes | `[]` | yes |
| `compliance_tags` | dictionary | yes | `[]` | yes |
| `outcome_kpis` | multiline | no | `""` | no |
| `source_url` | text | no | `""` | no |
| `related_deals` | relation (`customers:customer_deal`) | yes | `[]` | no |
| `confidence_score` | integer | no | `3` | yes |
| `is_public_reference` | boolean | no | `false` | yes |
| `completed_year` | integer | no | `null` | yes |

## API Contracts
### Conventions
- Use existing APIs only.
- Envelope and errors follow platform standards.
- list routes use `pageSize <= 100`.
- writes must be authenticated and feature-guarded.

### Dictionaries
- `POST /api/dictionaries`
- `POST /api/dictionaries/{dictionaryId}/entries`
- `GET /api/dictionaries`

Representative request:
```json
{
  "key": "services",
  "name": "Services",
  "description": "Matching services taxonomy"
}
```

### Custom Entity
- `POST /api/entities/entities`
- `GET /api/entities/entities`

Representative create:
```json
{
  "entityId": "user:case_study",
  "label": "Case Studies",
  "labelField": "title",
  "showInSidebar": true
}
```

### Custom Field Definitions
- `POST /api/entities/definitions.batch`
- `GET /api/entities/definitions.manage?entityId=...`

Representative field definition:
```json
{
  "entityId": "customers:customer_company_profile",
  "definitions": [
    {
      "key": "services",
      "kind": "dictionary",
      "configJson": {
        "label": "Services",
        "multi": true,
        "dictionaryId": "<uuid-services>",
        "dictionaryInlineCreate": true,
        "formEditable": true,
        "listVisible": true,
        "priority": 10
      }
    }
  ]
}
```

### Record Writes/Reads
- `POST /api/entities/records`
- `PATCH /api/entities/records`
- `GET /api/entities/records`

Notes:
- Canonical mapping contract (required for all ingestion/backfill scripts):
  - custom field payload keys use `cf_<definition_key>` (for example `cf_services`, `cf_project_type`) across `POST` and `PATCH`,
  - read validation expects the same `cf_<definition_key>` keys; scripts must fail fast when a required key is missing,
  - fallback key strategies are not allowed in this workstream (single deterministic mapping only).

## Taxonomy Baseline (Foundation v1)
### Dictionary Catalogs
- `services`
- `industries`
- `tech_capabilities`
- `compliance_tags`
- `regions`
- `languages`

### Strict Select Buckets (Frozen in `v1`)
Versioned source of truth:
- `.ai/specs/assets/spec-053a-taxonomy-v1.json`

| Bucket | Allowed values (exact) |
|---|---|
| `team_size_bucket` | `unknown`, `1_9`, `10_49`, `50_199`, `200_plus` |
| `min_project_size_bucket` | `unknown`, `lt_10k`, `10k_50k`, `50k_200k`, `200k_plus` |
| `hourly_rate_bucket` | `unknown`, `lt_25`, `25_50`, `50_100`, `100_150`, `150_plus` |
| `project_type` | `unknown`, `product_engineering`, `staff_augmentation`, `ai_automation`, `integration`, `audit` |
| `duration_bucket` | `unknown`, `lt_1m`, `1_3m`, `3_6m`, `6_12m`, `12m_plus` |
| `budget_bucket` | `unknown`, `lt_25k`, `25k_100k`, `100k_250k`, `250k_1m`, `1m_plus` |

## Default Value Policy
- unknown strict-select -> `"unknown"`
- unknown multi-select -> `[]`
- unknown text -> `""`
- unknown numeric -> `null`
- unknown boolean -> `false`
- confidence baseline -> `3`

## Implementation Plan
### Task 1: Taxonomy Freeze
1. Lock strict bucket enums to the values listed in this spec and publish them in `.ai/specs/assets/spec-053a-taxonomy-v1.json`.
2. Treat taxonomy file updates as versioned changes (`v2`, `v3`, ...); no in-place edits to `v1` after rollout.
3. Add preflight check that rejects non-enum values before any write operation starts.

### Task 2: Dictionary Provisioning
1. Create required dictionaries.
2. Seed initial entries.

### Task 3: Company Profile Definitions
1. Upsert profile fields via `definitions.batch`.
2. Validate `listVisible` and priorities.

### Task 4: Case Study Entity + Definitions
1. Create `user:case_study`.
2. Upsert case-study field definitions.

### Task 5: Backfill + Quality Checks
1. Run ingestion for default values and normalization.
2. Generate quality report:
  - case studies per provider,
  - `% with technologies`,
  - `% with budget bucket`,
  - `% with duration bucket`.

## Performance, Cache & Scale
### Write Strategy
- Use batch upserts for definitions and records.
- Backfill in chunks to avoid API saturation.

### Read Strategy
- Entity list and records retrieval use paginated reads.
- Quality report should use bounded windows and optional background execution for large tenants.

### Cache Strategy
- Not required for foundation workstream API-only bootstrap.
- If quality dashboards are added later, cache keys must be tenant/org scoped and invalidated on record updates.

## Risks & Impact Review
### Data Integrity Failures
#### Dictionary-definition mismatch
- **Scenario**: custom field references missing `dictionaryId`.
- **Severity**: High
- **Affected area**: form rendering, filtering, ingest stability
- **Mitigation**: strict task order (dictionary provisioning before field upsert) and preflight validation
- **Residual risk**: low after pipeline checks

#### Null-heavy backfill output
- **Scenario**: historical records remain sparse and low-signal.
- **Severity**: Medium
- **Affected area**: matching quality and shortlist confidence
- **Mitigation**: default value policy + completeness report + remediation cycle
- **Residual risk**: medium for legacy free-text data

### Cascading Failures & Side Effects
#### Invalid relation mappings
- **Scenario**: `provider_company` or `related_deals` references stale IDs.
- **Severity**: Medium
- **Affected area**: case-study navigation and analytics joins
- **Mitigation**: relation-option validation and skip/report strategy for invalid references
- **Residual risk**: low with nightly quality checks

### Tenant & Data Isolation Risks
#### Cross-tenant dictionary leak
- **Scenario**: definitions or dictionaries loaded without tenant/org scope.
- **Severity**: Critical
- **Affected area**: data isolation and privacy
- **Mitigation**: strict scoped API usage and integration tests for org boundaries
- **Residual risk**: low if test gate is enforced

### Migration & Deployment Risks
#### Taxonomy evolution drift
- **Scenario**: new values introduced ad hoc without governance.
- **Severity**: Medium
- **Affected area**: comparability and reporting consistency
- **Mitigation**: taxonomy freeze policy and controlled change process with changelog
- **Residual risk**: medium in multi-team rollouts

### Operational Risks
#### API rate pressure during backfill
- **Scenario**: large ingestion run causes throttling and retries.
- **Severity**: Medium
- **Affected area**: run duration and operator workload
- **Mitigation**: chunked execution, retry with backoff, resumable checkpoints
- **Residual risk**: temporary backfill slowdowns

## Final Compliance Report — 2026-03-02
### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | API-only metadata configuration, no cross-module ORM links |
| root AGENTS.md | Tenant/org scoping required | Compliant | Foundation workstream uses scoped APIs and scoped entity records |
| root AGENTS.md | Validate input with zod | Compliant | Existing APIs enforce platform validation contracts |
| packages/core/AGENTS.md | API routes must export `openApi` | N/A | No new routes introduced in this phase |
| BACKWARD_COMPATIBILITY.md | Additive-only schema impact | Compliant | Configuration of custom fields/entities only |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | fields map directly to entities/dictionaries APIs |
| API contracts match implementation plan | Pass | tasks align with exact endpoints |
| Risks cover write operations | Pass | dictionary/definition/record writes covered |
| Commands defined for all mutations | N/A | API-only configuration phase (no new command surface) |
| Cache strategy covers read APIs | Pass | no mandatory cache in the foundation workstream; future rule documented |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved for prerequisite foundation execution.

## Changelog
### 2026-03-02
- Initial detailed API-only matching data foundation contract extracted for `b2b_prm`.
- Added normalized profile and case-study field schema with rollout and quality controls.
- Locked strict select bucket enums and deterministic `cf_<definition_key>` record mapping contract.
- Clarified positioning as a prerequisite data foundation workstream (not standalone product phase).
- Clarified that MIN ownership/attribution governance is out of scope here and owned by `SPEC-053b`.

### Review — 2026-03-02
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
