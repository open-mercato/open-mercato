# CrudForm section adoption inventory and CI gate

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`
**Related:** `.ai/specs/2026-10-09-crudform-section-adoption-rollout.md`, issue #6686

## TLDR

Add one generated, per-JSX-invocation inventory for production `CrudForm` surfaces and a CI gate that rejects unclassified invocations, stale work-unit links, topology drift, duplicate public ids, and unsupported dynamic alternatives. This is tooling/governance only: it does not make any domain host policy-eligible or implement an adopter.

## Overview

Repository-wide adoption cannot rely on hand-maintained totals or raw-text search. One file may render multiple forms; shared renderers have multiple callers; group sets may vary by runtime mode; enterprise and optional official-module sources may or may not be present in a checkout.

The CLI generator already owns module/source discovery. This capability extends generation with an AST-backed production invocation scanner, authored declarations beside owning modules, a versioned manifest, and deterministic review output.

## Problem Statement

Without a normative inventory, a new grouped form can silently bypass the section-policy program, a renamed group can break a published override, or a dynamic host can be marked ready without enumerating its callers. Mixing this tooling into a domain adopter would make that adopter responsible for unrelated repository governance.

## Goals and Non-goals

### Goals

- Emit one stable record per production JSX `CrudForm` invocation.
- Correlate each invocation with authored finite surface facts and one program work-unit state.
- Fail generation/CI on unknown, stale, ambiguous, or incompatible records.
- Include enterprise and official-module sources when present while preserving repository/license ownership.
- Produce deterministic, SHA-labelled JSON and human-readable review summaries.

### Non-goals

- Implementing runtime section resolution or any domain adapter.
- Inferring domain schemas, side effects, or capabilities from arbitrary source code.
- Editing official-module or enterprise source.
- Requiring optional repositories to be checked out in every CI lane.
- Treating ungrouped forms as section-policy eligible.

## Proposed Solution

Extend the CLI generator with canonical-symbol AST discovery, durable literal invocation keys, authored finite topology/work-unit declarations, deterministic committed artifacts, and separate static versus network validation. The scanner correlates evidence but never infers domain readiness.

## Normative Record Contract

```ts
type CrudFormSectionAdoptionRecord = {
  invocationId: string
  invocationKey: string
  legacyInvocationIds?: readonly string[]
  sourceFile: string
  sourceAnchor: string
  scope: 'oss' | 'enterprise' | 'official-module'
  grouped: boolean
  resolvedHostId: string | null
  alternatives: readonly {
    id: string
    hostId: string | null
    formVariant: string
    formOperation: 'create' | 'update'
    orderedSectionIds: readonly string[]
    ownershipFactIds: readonly string[]
    mutationSurfaceIds: readonly string[]
    dependencyFactIds: readonly string[]
    callerIds: readonly string[]
  }[]
  workUnit:
    | { state: 'ready'; adopterSpec: string; implementationPr: string }
    | { state: 'planned'; adopterSpec: string; specPr: string }
    | { state: 'deferred'; issue: string; owner: string; revisitBy: string }
    | { state: 'compatibility-only'; rationale: string }
    | { state: 'external'; repository: string; specOrIssue: string }
}
```

Every production invocation supplies a globally unique string-literal `inventoryKey` prop such as `catalog.product-edit.primary`. `CrudForm` accepts this additive tooling-only prop and does not forward it to the DOM or use it at runtime. `invocationId` is `<scope>:<inventoryKey>` and therefore survives line drift, insertion/reordering of sibling invocations, file moves, and renderer renames. The scanner rejects a missing, computed, empty, or duplicate key. A deliberate key rename records the prior id in `legacyInvocationIds`; the generator compares the prior manifest and rejects unaliased disappearance, alias fan-in/fan-out, or an alias claimed by more than one record.

## Discovery and Correlation

1. Scan `apps/*/src/**`, `packages/*/src/**`, and `packages/create-app/template/src/**`; when initialized, also scan `external/official-modules/packages/*/src/**`. Do not follow symlinks. Exclude `node_modules`, `.next`, `dist`, `build`, `coverage`, `generated`, `__tests__`, `__integration__`, `test`, `tests`, `fixtures`, `stories`, and files matching `*.test.*`, `*.spec.*`, `*.stories.*`, or `*.generated.*`. `.ai`, docs Markdown/MDX, and `packages/create-app/agentic/**` are outside production roots.
2. Resolve imports/re-exports through the repository TypeScript project references, workspace exports, and tsconfig aliases. Count JSX identifiers, aliased/default imports, and namespace/member expressions only when their symbol resolves to the canonical `CrudForm` export from `packages/ui/src/backend/CrudForm.tsx`; ignore unrelated local symbols with that name. A wrapper is not itself an invocation unless its implementation contains a resolved canonical `CrudForm`. An unresolved import, dynamic component alias, or unsupported factory that could resolve to canonical `CrudForm` is a hard scanner diagnostic, never a silent omission.
3. Record every resolved `CrudForm` JSX invocation, not one record per file, and require its literal `inventoryKey`.
4. Resolve statically declared groups, canonical host precedence, variant, operation, and caller facts from generated/source declarations.
5. Reusable renderers must publish finite legal alternatives. Independent arrays whose cross-product admits impossible combinations fail generation.
6. Runtime expressions outside declared alternatives produce an `ambiguous` diagnostic and cannot be `ready`.
7. Ungrouped invocations must be `compatibility-only`; grouped OSS invocations must be `ready`, `planned`, or `deferred`.
8. Enterprise and official-module invocations must be `external` unless their owning implementation checkout supplies a ready declaration linked to its own reviewed spec/PR.

The scanner never decides that a host is safe. It only correlates authored facts and reports missing or inconsistent evidence.

## Link and State Validation

- Repository spec paths must exist, stay within `.ai/specs/` or `.ai/specs/enterprise/`, contain `TLDR`, `Overview`, `Problem Statement`, `Proposed Solution`, `Architecture`, `Data Models`, `API Contracts`, `Risks & Impact Review`, `Final Compliance Report`, and `Changelog`, and name the record's exact invocation/host/surface ids.
- PR links must be canonical repository pull-request URLs. A `ready.implementationPr` is valid when either (a) it is the current pull request, its base equals the tracker-configured base, the provider-reported PR head equals the event's `pull_request.head.sha` (not GitHub's synthetic merge `GITHUB_SHA`), and its body contains `CrudForm-Adoption-Records: <comma-separated invocationId values>` including this record, or (b) it is merged to the configured base, its merge SHA is an ancestor of `manifest.auditedGitSha`, and it contains the same exact marker. This permits the implementation PR to become ready without a second transition PR while causally tying evidence to the record.
- `planned.specPr` may be an open approved-design PR or a merged spec PR; it must change/name the referenced adopter spec and contain the record marker. It becomes invalid if closed unmerged or if the spec no longer exists.
- Deferred issue links must be open, assigned to one canonical tracker login, and include the invocation/host ids; `revisitBy` is a `YYYY-MM-DD` UTC date that is not earlier than the check date.
- External records require an explicit repository plus resolving spec/issue URL/path. External delivery status is reported but does not gate OSS technical completion.
- A closed/rejected/missing link, expired deferral, or record/spec mismatch fails the gate.

Tracker/provider, repository, configured base, credentials, and identity come only from `.ai/agentic.config.json` plus its installed tracker descriptor. The network verifier performs at most three reads per unique URL, honoring provider rate-limit/reset headers and retrying only 429/5xx with bounded 1s then 2s backoff. Permission/404, invalid state, or exhausted unavailability produces a sanitized diagnostic. Local/offline `yarn generate` never performs network I/O and records link status `unverified`; the required network-enabled `crud-form-section-adoption-links` CI job is fail-closed on invalid, unavailable, or unverified links and blocks merge.

## Generated Artifacts

- committed `.ai/generated/crud-form-section-adoption/manifest.json` with `schemaVersion: 1`, `auditedGitSha`, `sourceTreeHash`, `sourcePresence: { oss: true, enterprise: boolean, officialModules: boolean }`, records, and deterministic state/scope counts;
- committed `.ai/generated/crud-form-section-adoption/review.md` grouped by added/removed/moved/topology-changed/stable-id-changed/work-state-changed records;
- committed `.ai/generated/crud-form-section-adoption/completion.json` with schema version, audited hashes, OSS state counts, exact non-ready record ids, and external owner/link statuses;
- no React values, schemas, functions, tenant data, resource ids, credentials, or policy tokens.

Artifacts use UTF-8, LF, two-space JSON indentation, one terminal newline, fixed schema field order, records sorted by `invocationId`, set-like arrays lexicographically sorted, and semantically ordered arrays (including `orderedSectionIds`) preserved. `auditedGitSha` is the current commit; `sourceTreeHash` is SHA-256 over normalized relative path plus bytes of all scanned/declaration inputs, so working-tree changes are represented without a self-referential commit hash. `yarn generate` writes all three paths and a second run at unchanged inputs must be byte-identical. No additional public typed registry is introduced by this capability.

## Architecture

| Area | Responsibility |
|---|---|
| CLI generator | AST scan, stable invocation identity, source-presence flags, deterministic output |
| owning modules | Authored finite surface and work-unit declarations |
| validator | Correlation, duplicate/drift/state/link checks, completion query |
| CI | Run generation, clean-second-run diff, network-enabled link verification, publish review report |
| program index | Consume completion summary; never implement a host |

## Data Models

No runtime database model. The versioned manifest schema and any committed generated registry are build-time public contracts. Schema evolution is additive/versioned; removing or renaming fields follows `BACKWARD_COMPATIBILITY.md` and updates all consumers in the same release.

## API Contracts

No runtime HTTP, command, or event API changes. The generator command, manifest schema/version, documented artifact paths, and diagnostic codes are the tooling contracts and receive compatibility coverage.

## UI/UX

No product UI. Developer diagnostics include `invocationId`, file/anchor, alternative id, failing fact/link, expected state, and one remediation command. They never dump source bodies or tokens.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Two `CrudForm`s in one renderer | Two unique literal-key records; insertion/reorder leaves ids unchanged |
| Renderer moves files | Same key/id plus explicit source-path move review item |
| Invocation key changes | Requires one-to-one `legacyInvocationIds` mapping; ambiguity blocks |
| Conditional ordered groups | Exact declared alternatives or blocking ambiguity |
| Unknown caller reaches reusable renderer | Blocking caller-coverage diagnostic |
| Duplicate host/variant/operation/section id | Blocking collision with both sources |
| New grouped invocation lacks work unit | Blocking unclassified diagnostic |
| Deferred date expires | Blocking stale-deferral diagnostic |
| Enterprise/official source absent | Presence flag false; no guessed records/readiness |
| Optional source appears | Records generated and required to carry external/owner evidence |
| Tracker unavailable | Static checks run locally; required network job fails closed after bounded retries |
| Second generation differs | Determinism failure |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Scanner misses a production invocation | High | AST fixtures, source-root allowlist, negative raw-text tests, merge-head count review | Novel render indirection may require parser evolution |
| Stable ids churn on refactor | High | Literal durable key plus one-to-one legacy alias mapping | Intentional key changes require review |
| Optional repo creates false completion | High | Presence flags and external ownership states | Portfolio reporting still depends on external owner data |
| Network failure blocks all generation | Medium | Local generation stays offline; bounded network job is separate | Required network CI can block merge during provider outage |
| Manifest becomes a domain policy engine | High | Facts-only/non-goals boundary and package test | New fact types need deliberate review |

Rollback disables the CI requirement while retaining the last schema/reader compatibility. After publication, deleting manifest fields or documented paths requires a deprecation bridge; rollback cannot silently remove a consumed contract.

## Migration & Backward Compatibility

The initial manifest and tooling-only `CrudForm.inventoryKey` prop are additive. Existing runtime forms are unchanged. Once published, schema version, record ids, public stable ids, and documented artifact paths are protected. Invocation-key renames use `legacyInvocationIds` for at least one minor release when external tooling consumes the old id; file moves alone do not change identity.

## Phasing

1. AST discovery and deterministic invocation ids.
2. Authored finite declarations and correlation diagnostics.
3. Work-state/link validator and completion query.
4. CI/report integration, optional-source lanes, documentation.

No phase marks a domain host ready without that host's own adopter spec and merged implementation evidence.

## Implementation Plan

1. Add `CrudForm.inventoryKey` as a tooling-only non-DOM prop and scanner fixtures for canonical/aliased/default/namespace/re-exported imports, unrelated same-name symbols, unresolved/dynamic aliases, multiple invocations/file, nested renderers, exclusions, symlinks, conditional groups, caller alternatives, insertion/reorder/file moves, key aliases, and optional source roots.
2. Define the versioned manifest schema and validate authored declarations without importing UI/domain runtime code into shared packages.
3. Implement deterministic correlation, duplicate/stable-id drift, source-presence, and state diagnostics.
4. Implement static link shape/path/mandatory-heading checks and the bounded fail-closed network verifier, including current-PR/merged-ancestor readiness and exact `CrudForm-Adoption-Records` evidence.
5. Generate JSON, Markdown diff, and completion summary; assert byte-identical second generation.
6. Add root scripts `yarn crud-form-sections:inventory`, `yarn crud-form-sections:inventory:check`, and `yarn crud-form-sections:inventory:check-links`; wire the first into `yarn generate` and the third into required network-enabled job `crud-form-section-adoption-links`.
7. Run the three exact scripts, `yarn workspace @open-mercato/cli test`, `yarn workspace @open-mercato/cli build`, `yarn workspace @open-mercato/cli typecheck`, `yarn generate` twice with byte comparison, `git diff --check`, and every configured validation command, recording exit statuses/artifacts.

## Integration Coverage

- Scanner: every source/AST exclusion and multi-invocation/dynamic/caller fixture above.
- Correlation: exact finite alternatives, unknown caller, duplicate facts, moved/deleted source, topology/id drift.
- State/link: every state, expired deferral, missing spec heading, wrong host, merged/open/closed PR, external owner, tracker unavailable.
- CI: clean second generation, dirty generated diff, optional enterprise/official roots present and absent, published review artifacts.

## Acceptance Criteria

1. Every production `CrudForm` JSX invocation in each present source scope produces one deterministic record.
2. Missing/computed/duplicate/renamed-without-alias keys, unknown/moved/deleted invocation, topology/id drift, ambiguous alternative, missing fact, invalid state, or stale link fails with exact source context.
3. Optional enterprise/official sources are represented only when present and never guessed ready.
4. Static generation does not depend on network; the separate required link check distinguishes unavailable from invalid.
5. The three exact committed artifacts are byte-identical on a second generation at the same commit and source-tree hash.
6. No domain host becomes eligible and no runtime behavior changes in this capability.
7. The three root inventory scripts, required `crud-form-section-adoption-links` job, focused CLI test/build/typecheck, twice-generation, diff, and configured validation gates pass.

## Final Compliance Report

| Area | Status | Evidence required before implementation PR approval |
|---|---|---|
| Scope cohesion | Ready | Inventory/CI only; zero domain adoption |
| Determinism | Ready | Same-SHA second-generation byte equality |
| Coverage | Ready | AST/source/caller/optional-root fixture matrix |
| Compatibility | Ready | Versioned schema and explicit move/id drift report |
| External scope | Ready | Presence flags plus owner links, no source edits |
| Ownership | Ready | Core-team-only implementation and review |

## Changelog

- **2026-10-22:** Split the per-invocation scanner, versioned manifest, work-state validation, drift reporting, and CI gate from the non-implementing rollout index and all domain adopters.
