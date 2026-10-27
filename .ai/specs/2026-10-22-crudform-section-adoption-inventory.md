# CrudForm section adoption inventory and CI gate

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-overrides-framework.md`
**Related:** `.ai/specs/2026-10-27-crudform-section-adoption-link-verification.md`, `.ai/specs/2026-10-09-crudform-section-adoption-rollout.md`, issue #6686

## TLDR

Add one generated, per-JSX-invocation inventory for production `CrudForm` surfaces and an offline static gate that rejects unclassified invocations, malformed evidence references, topology drift, duplicate public ids, and unsupported dynamic alternatives. Before that gate becomes required, a reviewed baseline migration assigns literal keys, finite alternatives, and structurally valid initial work-unit states to every discovered invocation and commits the first clean manifest. Tracker-backed link resolution and its network CI job are a separately deployable dependent capability. This spec is tooling/governance only: it does not make any domain host policy-eligible or implement an adopter.

## Overview

Repository-wide adoption cannot rely on hand-maintained totals or raw-text search. One file may render multiple forms; shared renderers have multiple callers; group sets may vary by runtime mode; enterprise and optional official-module sources may or may not be present in a checkout.

The CLI generator already owns module/source discovery. This capability extends generation with an AST-backed production invocation scanner, authored declarations beside owning modules, a versioned manifest, and deterministic review output.

## Problem Statement

Without a normative inventory, a new grouped form can silently bypass the section-policy program, a renamed group can break a published override, or a dynamic host can be marked ready without enumerating its callers. Mixing this tooling into a domain adopter would make that adopter responsible for unrelated repository governance.

## Goals and Non-goals

### Goals

- Emit one stable record per production JSX `CrudForm` invocation.
- Correlate each invocation with authored finite surface facts and one program work-unit state.
- Fail static generation/CI on unknown, malformed, ambiguous, or incompatible records.
- Keep the committed OSS inventory invariant when enterprise or official-module checkouts appear or disappear.
- Produce deterministic, source-hash-labelled JSON and human-readable review summaries.

### Non-goals

- Implementing runtime section resolution or any domain adapter.
- Inferring domain schemas, side effects, or capabilities from arbitrary source code.
- Editing official-module or enterprise source.
- Requiring optional repositories to be checked out in every CI lane.
- Treating ungrouped forms as section-policy eligible.

## Proposed Solution

Extend the CLI generator with canonical-symbol AST discovery, durable literal invocation keys, authored finite topology/work-unit declarations, deterministic committed artifacts, and offline structural validation. Introduce those checks through an explicit report-only baseline migration and enable static rejection only after the current tree is completely classified. The scanner correlates evidence references but never resolves remote state or infers domain readiness.

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
    workUnit:
      | { state: 'ready'; adopterSpec: string; designReview: ApprovedDesignReview; implementationPr: string }
      | { state: 'planned'; adopterSpec: string; designReview: ApprovedDesignReview; specPr: string }
      | { state: 'deferred'; issue: string; owner: string; revisitBy: string }
      | { state: 'compatibility-only'; rationale: string }
  }[]
}

type ApprovedDesignReview = {
  verdict: 'approved'
  url: string
  reviewedHeadSha: string
}
```

Every production invocation supplies a globally unique string-literal `inventoryKey` prop such as `catalog.product-edit.primary`. `CrudForm` accepts this additive tooling-only prop and does not forward it to the DOM or use it at runtime. `invocationId` is `<scope>:<inventoryKey>` and therefore survives line drift, insertion/reordering of sibling invocations, file moves, and renderer renames. Each finite alternative has the stable work-unit id `<invocationId>#<alternative.id>` and owns its own state/evidence; alternatives rendered by the same JSX call may therefore ship independently. The scanner rejects a missing, computed, empty, or duplicate key or alternative id. A deliberate key rename records the prior id in `legacyInvocationIds`; the generator compares the prior manifest and rejects unaliased disappearance, alias fan-in/fan-out, or an alias claimed by more than one record.

## Discovery and Correlation

1. The OSS command scans `apps/*/src/**`, OSS `packages/*/src/**`, and `packages/create-app/template/src/**`, explicitly excluding `packages/enterprise/**` and `external/official-modules/**` even when those paths exist. Do not follow symlinks. Exclude `node_modules`, `.next`, `dist`, `build`, `coverage`, `generated`, `__tests__`, `__integration__`, `test`, `tests`, `fixtures`, `stories`, and files matching `*.test.*`, `*.spec.*`, `*.stories.*`, or `*.generated.*`. `.ai`, docs Markdown/MDX, and `packages/create-app/agentic/**` are outside production roots.
2. Resolve imports/re-exports through the repository TypeScript project references, workspace exports, and tsconfig aliases. Count JSX identifiers, aliased/default imports, and namespace/member expressions only when their symbol resolves to the canonical `CrudForm` export from `packages/ui/src/backend/CrudForm.tsx`; ignore unrelated local symbols with that name. A wrapper is not itself an invocation unless its implementation contains a resolved canonical `CrudForm`. An unresolved import, dynamic component alias, or unsupported factory that could resolve to canonical `CrudForm` is a hard scanner diagnostic, never a silent omission.
3. Record every resolved `CrudForm` JSX invocation, not one record per file, and require its literal `inventoryKey`.
4. Resolve statically declared groups, canonical host precedence, variant, operation, and caller facts from generated/source declarations.
5. Reusable renderers must publish finite legal alternatives. Independent arrays whose cross-product admits impossible combinations fail generation.
6. Runtime expressions outside declared alternatives produce an `ambiguous` diagnostic and cannot be `ready`.
7. Every finite alternative owns exactly one work unit. Ungrouped or explicit `hostId: null` alternatives must be `compatibility-only`; grouped addressable alternatives in every owner-scoped manifest must be `ready`, `planned`, or `deferred`. One alternative's readiness never upgrades a sibling alternative.
8. Enterprise and official-module topology is never copied into the OSS manifest. Each owning repository/check-out may run the same scanner with an explicit scope/root/output configuration and owns its resulting artifact and readiness gate. The OSS coordination indexes carry only stable repository/owner/spec-or-issue links and report external delivery separately.

The scanner never decides that a host is safe. It only correlates authored facts and reports missing or inconsistent evidence.

## Baseline Migration and Gate Activation

The implementation must not turn on a rejecting generator or required CI check against the unclassified current tree. It uses these ordered states:

1. **Report-only discovery:** land the scanner, schemas, and deterministic diagnostics behind an explicit non-required bootstrap command. It emits no committed manifest and is not wired into `yarn generate` or required CI.
2. **Complete baseline migration:** scan the authoritative merge head; add one literal `inventoryKey` to every discovered production invocation; author every finite caller/variant/operation alternative; and assign each alternative exactly one structurally valid `planned`, `deferred`, or `compatibility-only` state. A `planned` state names its local adopter spec and canonical review/spec PR URLs. A `deferred` state names a canonical issue URL, owner, syntactically valid `revisitBy`, and exact invocation/alternative/host ids in the declaration. This phase cannot use placeholder URLs, owners, dates, or blanket unknown alternatives; the dependent verifier determines whether `revisitBy` is still current.
3. **Initial artifact review:** generate the three owner-scoped artifacts from the fully classified tree, manually reconcile their invocation/alternative totals against the scanner report and historical snapshot, review every added key and state, then commit the deterministic outputs. A second run must be byte-identical.
4. **Static enforcement:** only after the baseline commit is clean, wire the static inventory check into `yarn generate` and make missing keys, alternatives, declarations, or stale generated bytes rejecting.
No compatibility window permits an unclassified production invocation after static enforcement. The bootstrap command and report-only mode are removed or made maintainer-only in the same activation change so they cannot bypass the required gate.

## Static State and Reference Validation

- Repository spec paths must exist, stay within `.ai/specs/` or the current owner repository's enterprise-spec directory, contain `TLDR`, `Overview`, `Problem Statement`, `Proposed Solution`, `Architecture`, `Data Models`, `API Contracts`, `Risks & Impact Review`, a complete approved `Final Compliance Report`, and `Changelog`, and name the work unit's exact invocation, alternative, host, and surface ids.
- Review, PR, issue, and external coordination references must have canonical provider URL syntax and required non-empty owner/repository/id fields. Static validation rejects placeholders, malformed URLs, malformed `YYYY-MM-DD` dates, duplicate evidence ownership, and work-unit/spec identifier mismatches visible in the repository. Expiry relative to the current UTC check date is owned by the dependent network verifier.
- The offline inventory does not claim that a URL resolves, a review is approving/current, a PR is open/merged/ancestral, an issue is open/assigned, or a remote marker exists. Those network-backed semantics and required job belong exclusively to `.ai/specs/2026-10-27-crudform-section-adoption-link-verification.md`.
- External coordination references contain no commercial/runtime topology. Their remote delivery status never enters the committed OSS manifest.

## Generated Artifacts

- committed `.ai/generated/crud-form-section-adoption/manifest.json` with `schemaVersion: 1`, `scope: 'oss'`, `sourceTreeHash`, OSS records, and deterministic alternative-work-unit state counts;
- committed `.ai/generated/crud-form-section-adoption/review.md` grouped by added/removed/moved/topology-changed/stable-id-changed/work-state-changed records;
- committed `.ai/generated/crud-form-section-adoption/completion.json` with schema version, the matching `sourceTreeHash`, OSS work-unit state counts, exact non-ready `invocationId#alternative.id` values, and external owner/repository/evidence references containing no invocation topology or remote status;
- no React values, schemas, functions, tenant data, resource ids, credentials, or policy tokens.

Artifacts use UTF-8, LF, two-space JSON indentation, one terminal newline, fixed schema field order, records sorted by `invocationId`, set-like arrays lexicographically sorted, and semantically ordered arrays (including `orderedSectionIds`) preserved. `sourceTreeHash` is SHA-256 over normalized relative path plus bytes of OSS scanned/declaration inputs only, so working-tree changes are represented without embedding a self-referential commit hash. No committed artifact contains the current commit SHA, build timestamp, check URL, optional-checkout presence, or other run-variant value. `yarn generate` writes all three committed paths and produces identical bytes whether optional enterprise/official-module roots are absent or present; owner-scope commands write only to their owning repository and are never invoked by OSS `yarn generate`. A second run at unchanged inputs must be byte-identical before and after committing those outputs. No additional public typed registry is introduced by this capability.

## Architecture

| Area | Responsibility |
|---|---|
| CLI generator | Scope-explicit AST scan, stable invocation identity, deterministic owner-local output |
| owning modules | Authored finite surface and work-unit declarations |
| validator | Correlation, duplicate/drift/state/link checks, completion query |
| static CI | Run generation, clean-second-run diff, reject structural drift, publish review report |
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
| New grouped alternative lacks work unit | Blocking unclassified diagnostic naming `invocationId#alternative.id` |
| Deferred date is missing or malformed | Blocking static state-shape diagnostic; current-date expiry is outside this capability |
| Enterprise/official source absent from OSS checkout | OSS bytes remain unchanged; no record or presence flag is guessed |
| Optional source appears in OSS checkout | OSS scanner ignores it; only an explicit owner-scope command may produce an owner-repository artifact |
| Second generation differs | Determinism failure |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Scanner misses a production invocation | High | AST fixtures, source-root allowlist, negative raw-text tests, merge-head count review | Novel render indirection may require parser evolution |
| Stable ids churn on refactor | High | Literal durable key plus one-to-one legacy alias mapping | Intentional key changes require review |
| Optional repo creates false completion or leaks commercial facts | High | OSS roots exclude optional sources; owner-local artifacts plus link-only external reporting | Portfolio reporting still depends on external owner data |
| Manifest becomes a domain policy engine | High | Facts-only/non-goals boundary and package test | New fact types need deliberate review |
| Required static gate is enabled before the existing tree is classified | High | Report-only discovery, complete baseline migration, reviewed deterministic manifest, then static activation | Baseline authors must resolve every ambiguous renderer and malformed evidence reference before activation |

Rollback disables the static CI requirement while retaining the last schema/reader compatibility. After publication, deleting manifest fields or documented paths requires a deprecation bridge; rollback cannot silently remove a consumed contract.

## Migration & Backward Compatibility

The initial manifest and tooling-only `CrudForm.inventoryKey` prop are additive. Existing runtime forms are unchanged. The baseline migration is mandatory migration work, not an exception to the final contract: it adds keys and declarations to every current invocation before enforcement, commits the first complete artifact set, and records review evidence. Once published, schema version, record ids, alternative/work-unit ids, public stable ids, and documented artifact paths are protected. Invocation-key renames use `legacyInvocationIds` for at least one minor release when external tooling consumes the old id; alternative-id changes follow the same deprecation/alias protocol rather than silently moving readiness evidence. File moves alone do not change identity.

## Phasing

1. Report-only AST discovery, schemas, and deterministic diagnostics with no required gate.
2. Complete current-tree key/declaration/state migration and reviewed initial artifacts.
3. Work-state/reference-shape validator, completion query, and clean static enforcement.
4. Isolated owner-scope lanes and documentation; the dependent link-verification spec may activate its network job afterward.

No phase marks a domain host ready without that host's own adopter spec and a structurally valid implementation-evidence reference; the dependent verifier proves remote delivery state.

## Implementation Plan

1. Add the report-only scanner and manifest schemas with fixtures for canonical/aliased/default/namespace/re-exported imports, unrelated same-name symbols, unresolved/dynamic aliases, multiple invocations/file, nested renderers, exclusions, symlinks, conditional groups, caller alternatives, insertion/reorder/file moves, key aliases, ignored optional roots, and explicit owner-scope roots. Do not wire it into `yarn generate` or required CI yet.
2. Run report-only discovery at the authoritative merge head and produce the reviewed baseline worklist. Add `CrudForm.inventoryKey` as a tooling-only non-DOM prop to every current invocation; author all finite alternatives and exact facts; add canonical, structurally complete spec/review/PR or owner/issue references required for every initial state.
3. Define the versioned manifest schema and validate authored declarations without importing UI/domain runtime code into shared packages. Implement deterministic correlation, duplicate/stable-id drift, explicit-scope/root/output isolation, and state diagnostics; fixtures prove optional checkout presence cannot change OSS bytes.
4. Generate the initial JSON, Markdown diff, and completion summary from the now-complete baseline. Reconcile source/record/grouped/alternative/state counts, review every key/state/link, commit the outputs, and assert a byte-identical second generation.
5. Implement static reference URL shape, local spec path/full-compliance-report, identifier, owner, date, and duplicate-evidence checks. Do not import tracker clients or read the network.
6. Add root scripts `yarn crud-form-sections:inventory` and `yarn crud-form-sections:inventory:check`. Only after steps 2-5 pass on the complete baseline, wire generation into `yarn generate` and make the static check rejecting.
7. Remove or maintainer-restrict report-only bootstrap mode, then run both exact scripts, `yarn workspace @open-mercato/cli test`, `yarn workspace @open-mercato/cli build`, `yarn workspace @open-mercato/cli typecheck`, `yarn generate` twice with byte comparison, `git diff --check`, and every configured validation command, recording exit statuses/artifacts and static-gate activation provenance.

## Integration Coverage

- Scanner: every source/AST exclusion and multi-invocation/dynamic/caller fixture above.
- Baseline: every discovered current invocation has a literal key, every legal finite alternative has one valid initial state/evidence link, historical-versus-current totals are reconciled, the first manifest receives explicit review, and no rejecting hook exists before the complete baseline passes.
- Correlation: exact finite alternatives, unknown caller, duplicate facts, moved/deleted source, topology/id drift.
- State/reference: every state, malformed deferral date/reference, incomplete local compliance report, malformed canonical URLs, wrong host/spec identifiers, duplicate evidence ownership, and external owner/reference shapes.
- Static CI: clean second generation before and after committing generated outputs, dirty generated diff, identical OSS bytes with optional enterprise/official roots present and absent, isolated owner-scope output, and published deterministic review artifacts.

## Acceptance Criteria

1. Every production OSS `CrudForm` JSX invocation produces one deterministic OSS record, and every finite alternative produces one independently stateful work unit; optional scopes produce records only in their owner-run artifacts.
2. Missing/computed/duplicate/renamed-without-alias keys, unknown/moved/deleted invocation, topology/id drift, ambiguous alternative, missing fact, invalid state shape, or malformed reference fails with exact source context.
3. Optional enterprise/official source presence never changes committed OSS artifacts; OSS coordination retains only owner/repository/evidence links, and owner-run artifacts never write into the OSS tree.
4. Static generation has no tracker client, credential, or network dependency; remote validity is neither inferred nor serialized.
5. The three exact committed artifacts are byte-identical on a second generation at the same commit and source-tree hash.
6. No domain host becomes eligible and no runtime behavior changes in this capability.
7. Report-only discovery, complete baseline keys/alternatives/states/references, initial artifact review, and byte-identical regeneration finish before static enforcement.
8. Both root inventory scripts, focused CLI test/build/typecheck, twice-generation, diff, and configured validation gates pass after static activation.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `.ai/docs/official-modules.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root generator rules | Generated files come from generators and remain deterministic | Compliant | Source-only hash, fixed ordering, clean second run, and no commit/time/check-url fields are normative |
| CLI guide | Discovery is explicit, testable, and does not silently ignore unresolved canonical symbols | Compliant | Canonical-symbol AST fixtures, hard diagnostics, and exact scripts are listed |
| official-modules guide | Optional repo work/outputs remain owner-repository concerns | Compliant | OSS scanning excludes optional roots byte-for-byte; only owner/repository/evidence links cross the boundary |
| `.ai/specs/AGENTS.md` | Readiness records require complete spec and evidence references | Compliant | Static validation checks local compliance and canonical evidence shape; the dependent verifier resolves remote state |
| `BACKWARD_COMPATIBILITY.md` | Version generated schema, ids, commands, and artifact paths | Compliant | Schema/version and alias/deprecation requirements are explicit |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Record schema matches generated artifacts | Pass | OSS manifest carries invocation topology plus per-alternative work units; completion carries work-unit state plus link-only external status |
| Link rules represent required review evidence | Pass | Approval metadata is typed and shape-validated; the dependent verifier alone proves exact-head remote approval |
| Determinism holds across commit/checkout state | Pass | No self-referential SHA or optional-checkout presence enters committed bytes |
| Risks cover scanner/state/static-reference failures | Pass | Missed symbols, id drift, optional leakage, malformed references, and premature activation are covered |
| Baseline migration can satisfy the static gate | Pass | Report-only discovery precedes complete key/alternative/state/reference authoring, reviewed initial artifacts, and static enforcement |
| Runtime API/UI impact | N/A | Tooling/governance only |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Changelog

- **2026-10-27:** Split tracker-backed link resolution into its own dependent spec; added the mandatory report-only baseline migration and ordered static activation; removed self-referential/run-variant provenance, isolated optional scopes into owner-repository artifacts, moved readiness/evidence references to each finite alternative work unit, and completed the mandatory compliance report.
- **2026-10-22:** Split the per-invocation scanner, versioned manifest, work-state validation, drift reporting, and CI gate from the non-implementing rollout index and all domain adopters.
