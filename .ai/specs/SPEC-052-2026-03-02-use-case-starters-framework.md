# SPEC-052: Use-Case Starters Framework

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Open Mercato Team |
| **Created** | 2026-03-02 |
| **Related** | SPEC-013 (setup.ts), SPEC-041 (UMES), SPEC-045 (registry pattern), SPEC-051 (Partnership Portal) |

## TLDR
**Key Points:**
- Introduce a first-class "starter" layer so engineers can bootstrap a polished use-case solution instead of a blank tenant.
- Treat starters as composition and initialization profiles, not core forks.
- Preserve UMES and module boundaries: all vertical behavior is delivered via app modules, setup hooks, widgets, enrichers, and events.

**Scope:**
- Starter catalog and manifest contract.
- Starter apply flow via existing initialization CLI (`mercato init`) with idempotent execution.
- Starter lifecycle (install, reapply, upgrade) and compatibility rules.

**Concerns:**
- Avoid creating a parallel extension system that bypasses UMES.
- Avoid template drift between monorepo app and create-app scaffold.

## Overview
Open Mercato needs productized "ready projects" that reduce time-to-first-value for common B2B use cases (for example PRM, field service, marketplace ops). Today, teams start from a generic tenant and manually assemble modules, dictionaries, workflows, and role settings.

This spec defines a framework to package those decisions into reusable starters while keeping the platform architecture intact.

Market reference:
- Established vertical ERP/CRM platforms ship "industry editions" as configuration overlays, not divergent cores.
- Open Mercato adopts that model: additive starter overlays on top of stable platform contracts.

## Problem Statement
Without a starter framework:
- each implementation repeats the same setup work,
- demo and pilot environments are inconsistent across teams,
- reuse is ad hoc and hard to maintain,
- sales-to-delivery handoff has no standard baseline.

The business goal is to turn repeated delivery patterns into reusable assets while keeping core evolution safe.

## Proposed Solution
Implement a Use-Case Starters framework with four layers:
1. Starter definition (manifest).
2. Starter content (modules, setup seeds, workflows, dictionaries, demo data).
3. Starter apply engine (idempotent orchestration).
4. Starter state tracking and upgrade plan.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Starters are additive overlays, not forks | Keeps core upgradeable and protects BC contract surfaces |
| No new runtime extension model | Reuse UMES, events, setup.ts, entity extensions |
| App-level ownership for business-specific behavior | Matches monorepo rule: user-specific features in `apps/mercato/src/modules` |
| Catalog + manifest contract | Enables deterministic bootstrap and automation |
| Explicit install state entity | Supports idempotency, diagnostics, and upgrades |

### What This Spec Explicitly Avoids
- No direct cross-module ORM relationships.
- No mutation of frozen contract surfaces (spot IDs, event IDs, route URLs).
- No starter-only forks of `@open-mercato/core`.
- No use-case-specific KPI ownership logic in the framework; those rules stay in starter child specs (for example MIN attribution governance in `SPEC-053b`).

## User Stories / Use Cases
- An Engineer wants to run `mercato init --starter b2b_prm` so a new local environment is ready with a coherent domain baseline.
- An Engineer wants to re-run starter setup safely after interruption so initialization can resume without duplicate data.
- A Maintainer wants to upgrade a starter from one version to another with explicit migration steps so tenants remain supportable.

## Architecture
### High-Level Components
1. **Starter Catalog Service**
- Discovers available starters and their metadata.
- Validates dependencies and version compatibility.

2. **Starter Apply Engine**
- Applies starter in ordered phases (module enablement, seed defaults, seed examples, post-apply checks).
- Uses existing `setup.ts` hooks and command/event patterns.

3. **Starter State Store**
- Persists which starter and version is installed per tenant/org.
- Records apply status, checksum, and last successful run.

4. **Starter Upgrade Planner**
- Computes compatible upgrade path from one starter version to another.
- Produces migration actions; never applies breaking changes silently.

### Reference Flow
```text
developer runs `mercato init --starter <id> [--starter-profile <profile>]` ->
validate prerequisites -> apply module profile ->
run setup hooks -> run starter seed pack -> run verification checks ->
persist installation state -> expose starter dashboard/status
```

### Starter Definition Contract
```ts
type StarterDefinition = {
  id: string
  title: string
  description: string
  category: 'operations' | 'commerce' | 'services' | 'custom'
  status: 'demo_ready' | 'pilot_ready' | 'production_ready'
  version: string
  requiresModules: Array<{ id: string; from: string }>
  appModules: string[]
  setupProfile: {
    runSeedDefaults: boolean
    runSeedExamples: boolean
  }
  compatibility: {
    minOmVersion: string
    maxOmVersion?: string
  }
}
```

### Commands & Events
- Commands:
  - `starters.install.apply`
  - `starters.install.reapply`
  - `starters.install.upgrade`
- Events:
  - `starters.install.applied`
  - `starters.install.failed`
  - `starters.install.upgraded`

### Transaction and Undo Contract
- `apply`: executed as checkpointed phases; each phase is idempotent and committed atomically.
- `reapply`: same orchestration as apply, skips completed checkpoints.
- `upgrade`: must include explicit migration steps per starter version; if a step fails, no subsequent step runs.
- Undo policy:
  - structural defaults are forward-only and re-runnable,
  - example/demo data must be tagged with starter installation metadata to allow targeted cleanup if requested,
  - destructive rollback is out of automatic scope for phase 1 and requires explicit migration scripts.

### Non-Negotiable Architecture Guardrails
1. Starter modules extend host surfaces only through UMES and documented contracts.
2. Starter data writes remain tenant/org scoped.
3. Starter apply is fully idempotent and restart-safe.
4. Starter upgrades use explicit migration plans and changelog entries.

## Data Models
### StarterInstallation (singular, table: `starter_installations`)
- `id`: uuid
- `starter_id`: text
- `starter_version`: text
- `status`: text (`pending`, `applied`, `failed`, `upgrading`)
- `tenant_id`: uuid
- `organization_id`: uuid
- `applied_at`: timestamptz
- `applied_by_user_id`: uuid nullable
- `checksum`: text nullable
- `details_json`: jsonb nullable
- `created_at`: timestamptz
- `updated_at`: timestamptz

Indexes:
- `(tenant_id, organization_id, starter_id)` unique
- `(tenant_id, organization_id, status)`

No existing table changes are required in this phase.

## API Contracts
### Phase 1 Contract
- No new mandatory HTTP API is required for starter selection in MVP.
- Starter orchestration is CLI-first via `mercato init`.

### Optional Later Contract (Phase 3+)
- `GET /api/starters`
- `GET /api/starters/current`
- `POST /api/starters/apply`
- `POST /api/starters/reapply`
- `POST /api/starters/upgrade`

If/when these APIs are added, all routes must export `openApi`, and all write routes must validate input with zod schemas.

### CLI Contracts
- `mercato init --starter <starter_id>`
- `mercato init --starter <starter_id> --starter-profile <profile_id>`
- Existing `--no-examples` remains supported and takes precedence over example profile seeds.

Example:
```bash
yarn initialize -- --starter b2b_prm --starter-profile demo_agency
```

CLI result contract:
- success exit code: `0`
- validation/configuration failure: non-zero with actionable message
- interrupted apply: non-zero with checkpoint marker persisted for safe re-run
- each failure path must avoid leaking secrets

Validation and security expectations:
- CLI input options are validated by zod schemas before orchestration.
- Starter execution runs in authenticated tenant/org context only.
- Starter definitions must not expose secrets in logs or error output.

## UI/UX
Phase-1 UX is CLI-only:
1. Developer selects starter using `mercato init` flags.
2. Runtime app UX starts after seeded starter data is installed.

Future phases may add optional UI for starter catalog/status, but it is explicitly out of scope for initial rollout.

## Configuration
Environment and runtime knobs:
- `OM_STARTERS_ENABLED` (default `true`)
- `OM_STARTER_APPLY_TIMEOUT_MS` (default `300000`)
- `OM_STARTER_ALLOW_REAPPLY` (default `true`)

## Migration & Compatibility
Backward compatibility strategy:
- additive new APIs and entities only,
- no route removals, no event renames, no spot ID changes,
- starter contract versioned via semantic versioning,
- deprecation protocol applied for starter manifest schema changes.

## Implementation Plan
### Phase 1: Framework Foundation
1. Add starter definition types in shared package.
2. Implement starter catalog discovery.
3. Add `starter_installations` entity and service.

### Phase 2: Apply Engine
1. Implement starter apply orchestrator with idempotent checkpoints.
2. Extend existing `mercato init` with `--starter` and `--starter-profile` options.
3. Wire starter execution to existing `setup.ts` and `--no-examples` lifecycle.

### Phase 3: Upgrade/Verification
1. Implement starter upgrade planner and compatibility checks.
2. Add post-apply verification contract.
3. Optionally expose verification and catalog/status via UI/API.

### Testing Strategy
- Unit: manifest validation, compatibility resolver, apply state machine.
- Integration: apply starter on clean tenant and on existing tenant.
- Regression: ensure no changes to existing module discovery contracts.

## Performance, Cache & Scale
### Query and Index Strategy
- `starter_installations` read path is point lookup by `(tenant_id, organization_id, starter_id)`.
- status dashboards use `(tenant_id, organization_id, status)` index.

### Large-Scale Behavior
- Apply/reapply execution uses single-flight locking per `(tenant_id, organization_id, starter_id)` to prevent duplicate concurrent runs.
- Operations touching large seed sets must batch writes and use workers when expected volume exceeds 1000 rows.

### Cache Strategy
- Phase 1 is DB-first and can run without cache.
- If starter catalog/status APIs are introduced later:
  - cache keys must be tenant-scoped,
  - writes to starter installation state invalidate `starters:catalog:<tenant>:<org>` and `starters:current:<tenant>:<org>` tags,
  - cache miss fallback is direct DB query.

### Pagination
- Any future list endpoint under `/api/starters` must enforce `pageSize <= 100`.

## Risks & Impact Review
### Data Integrity Failures
#### Partial starter apply leaves inconsistent setup
- **Scenario**: apply fails after module enablement but before seed completion.
- **Severity**: High
- **Affected area**: onboarding reliability, demo environments
- **Mitigation**: checkpointed apply pipeline + idempotent seed hooks + resumable reapply
- **Residual risk**: manual cleanup may still be needed for custom demo records

### Cascading Failures & Side Effects
#### Starter introduces undocumented side effects in core flows
- **Scenario**: starter logic bypasses commands/events and writes directly to core entities.
- **Severity**: High
- **Affected area**: core module behavior, upgrade safety
- **Mitigation**: enforce command/event and UMES-only integration in review checklist
- **Residual risk**: review misses are possible without strong test coverage

### Tenant & Data Isolation Risks
#### Cross-tenant starter status leakage
- **Scenario**: starter installation reads (CLI service or future API) use unscoped rows.
- **Severity**: Critical
- **Affected area**: security and tenant isolation
- **Mitigation**: strict `tenant_id` + `organization_id` filters in all reads/writes
- **Residual risk**: minimal with integration tests and query guards

### Migration & Deployment Risks
#### Starter schema drift between versions
- **Scenario**: starter v2 expects dictionaries/fields absent in v1 installs.
- **Severity**: Medium
- **Affected area**: upgrade path
- **Mitigation**: explicit upgrade planner + compatibility matrix + versioned migrations
- **Residual risk**: higher complexity for long-lived tenants

### Operational Risks
#### Reapply storms on large tenants
- **Scenario**: repeated apply operations flood seed and indexing jobs.
- **Severity**: Medium
- **Affected area**: queue load, API latency
- **Mitigation**: apply throttling and single-flight lock per tenant/org/starter
- **Residual risk**: temporary backlog in peak windows

## Final Compliance Report — 2026-03-02
### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/onboarding/AGENTS.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Starters use FK IDs and extension contracts |
| root AGENTS.md | Keep modules self-contained and reusable via shared utilities | Compliant | Starter logic stays in app modules and shared contracts |
| root AGENTS.md | API routes must preserve tenant isolation | Compliant | Any future starter APIs are scoped by tenant/org; CLI path already scoped |
| packages/core/AGENTS.md | API routes must export `openApi` | N/A (Phase 1) | CLI-first rollout introduces no mandatory new APIs |
| packages/core/AGENTS.md | Use setup.ts hooks for initialization | Compliant | Apply engine orchestrates existing hook lifecycle |
| BACKWARD_COMPATIBILITY.md | Contract-surface changes must be additive | Compliant | Introduces additive APIs/entities only |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Installation table maps to status APIs |
| API contracts match UI/UX | Pass | CLI contracts align with CLI-first UX; UI/API catalog deferred |
| Risks cover write operations | Pass | Apply, reapply, upgrade risks documented |
| Commands defined for all mutations | Pass | apply/reapply/upgrade command contract defined |
| Cache strategy covers all read APIs | Pass | DB-first now; future cache/invalidation contract defined |
| Migration path defined | Pass | Versioned upgrade planner included |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved for implementation.

## Changelog
### 2026-03-02
- Initial specification for Use-Case Starters framework.
- Defined architecture guardrails to keep UMES and module contracts intact.
- Clarified that `openApi` applies to all starter API routes (not write-only routes).
- Clarified that use-case KPI ownership/attribution rules are defined in child starter specs, not in the framework spec.

### Review — 2026-03-02
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
