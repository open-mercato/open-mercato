# Catalog variant combination claim

**Status:** Proposed prerequisite
**Implementation ownership:** Open Mercato core team members only
**Scope:** Catalog live variant-combination data integrity
**Related:** `.ai/specs/2026-10-27-catalog-variant-generate-missing.md`, `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`

## TLDR

Prevent any command, replay, or direct catalog writer from producing two live variants for the same complete finite option combination. A new internal `option_combination_key` stores stable option-code/choice-code identity separately from display labels. One `claimLiveVariantCombinations` seam acquires the scoped parent/schema locks, canonicalizes and lazily keys every resolvable live null-key row, then claims one or a batch of candidate keys in the same transaction as create, option-value update, variant undo/redo, or product-delete undo; a partial unique index is the database backstop. Legacy incomplete or schema-less variants retain current behavior, while ambiguous or duplicate claim-eligible history fails closed until remediated. The later `catalog.variants.generate_missing` operation must use this same boundary rather than relying on an unlocked read-before-loop.

## Overview

The product editor can create variants manually and can generate every missing option combination. Current create calls are individually transactional, but neither the entity nor the command has a product/combination uniqueness contract. SKU and GTIN uniqueness cannot protect generated rows because generation may omit both. Two generators, or a generator and manual create, can therefore read the same missing set and both commit the same option combination.

This prerequisite is independent of CrudForm section policy. It hardens the catalog command seam first; the catalog adopter later delegates both manual policy create and generation through it.

## Problem Statement

An unlocked sequence of “read current variants → compute missing → call create” is not a claim. Retrying after partial success reduces ordinary duplicates but does not resolve two contenders that read before either insert commits. A process-local mutex would fail across replicas, and nullable SKU/GTIN constraints do not describe option identity.

The invariant must be enforced wherever a variant enters a live claimed state, in the same database transaction as the insert, update, or restoration. That includes create execute/redo, update execute/undo/redo when the effective option values change, and delete undo. Identity cannot depend on mutable display labels because the current UI stores labels in `optionValues` while option and choice `code` fields are the stable schema identities.

## Goals and Non-goals

### Goals

- Define one canonical key for a complete finite option combination.
- Serialize every transition into a complete live combination per scoped parent product through one command-owned claim seam.
- Give direct callers a stable duplicate result and generators an idempotent skip result.
- Preserve each successful create/update/delete command's existing custom-field, index, event, audit, and undo/redo behavior.
- Keep label-only schema edits identity-preserving and block option/choice code edits that would orphan live keys.
- Prove tenant/organization/product isolation and two-contender behavior.

### Non-goals

- Implementing the section-policy façade or `catalog.variants.generate_missing` operation.
- Deduplicating or deleting existing rows.
- Treating incomplete option values, schema-less products, SKU, or GTIN as a combination claim.
- Moving an existing variant between products. Update continues to use its persisted scoped product; an input `productId` does not authorize reassignment.
- Automatically guessing ambiguous historical label-to-choice mappings.
- Adding a relation, dependency, distributed lock, or process-local mutex.

## Proposed Solution

### Canonical complete combination

A pure catalog helper resolves the product's current option schema and returns a claim only when every definition is a single-select with a non-empty finite choice list and the input contains exactly one non-empty current choice value for every option `code`, with no unknown key. It maps the submitted stored value (legacy label or code) to exactly one current choice, orders pairs lexicographically by stable option `code`, and serializes versioned length-prefixed `{ optionCode, choiceCode }` pairs. Display labels never enter the key. Duplicate codes, missing values, unknown keys, multiple/free-form definitions, or ambiguous/unmatched values do not silently produce a key; ordinary validation still applies, but no complete-combination claim is asserted.

The same canonicalizer is used by migration/backfill and every runtime claim. New and successfully mapped historical live rows store the resulting `optionCombinationKey`; `optionValues` remains the display/backward-compatible payload. The product-form option draft carries existing option and choice codes separately from editable labels, and schema conversion reuses those codes instead of slugifying a renamed label. A label-only schema change therefore preserves stable codes and requires no row rewrite. Every schema mutation and replay path—including direct option-schema commands and product-command assignment, replacement, detachment, undo, and redo—takes the affected template write lock. Option/choice code removal or rename, schema replacement, or detachment is rejected while a live variant key depends on the old identity unless a separately reviewed explicit mapping migrates every affected key atomically. The helper is catalog-internal and does not create a new public import path.

### Transaction-held claim

`claimLiveVariantCombinations` accepts one candidate or a batch and performs the following on the caller's forked transaction manager for every transition into a live complete finite combination:

1. validate command input and caller scope without mutating; create uses the requested product, while update and replay use the variant snapshot's persisted product and never reassign it from payload data;
2. begin the write transaction;
3. load the product by `id`, `tenantId`, and `organizationId` with `LockMode.PESSIMISTIC_WRITE` and `refresh: true`;
4. when the product references an option-schema template, load that tenant/organization-scoped template with `PESSIMISTIC_READ` and `refresh: true`; every direct or product-command schema mutation/replay acquires `PESSIMISTIC_WRITE` on the same row, so canonicalization cannot race a definition or assignment change;
5. canonicalize all incoming candidates against the locked product/schema snapshot; an update from a complete to a genuinely incomplete/non-finite combination clears its old key in this transaction;
6. load only live null-key variants for that exact tenant/organization/product, canonicalize every claim-eligible row, and leave only genuinely schema-less/structurally incomplete rows outside the claim set;
7. fail with typed `409 variant_combination_claim_unresolved` when a claim-eligible null-key row is ambiguous/unmappable or two derived rows resolve to the same key; query existing non-null rows once for the union of derived and candidate keys, then reject any conflict owned by another variant or duplicate within the candidate batch;
8. assign every derived historical key with a scoped internal write that preserves `updated_at`, assign each candidate's code-backed key, and flush before the domain mutation so a resolvable null never means available; the unique index guarantees existing non-null keys are already singular, while schema mutation barriers keep their codes valid;
9. insert, update, or restore the variants and enforce the existing single-default/media/price phases under the same transaction; the partial unique index is the final arbiter if an allowlisted direct writer races;
10. after commit, run the command's existing custom-field, query-index, CRUD-event, audit, and undo seams exactly once.

Every live-state transition uses this parent/schema-row boundary: create execute/redo; update execute and command-bus redo when effective `optionValues` change; update undo when the before-snapshot combination differs; delete undo; and the batch variant restoration performed by `catalog.products.delete` undo. Variant-command and `ProductDeleteVariantSnapshot` snapshots include the internal code-backed key. A restoration validates every captured option/choice code against the locked current schema and then claims that key; a legacy snapshot without a key is canonicalized from its option values only when the mapping is unique, otherwise it fails unresolved. Product-delete undo restores/flushes its product and owned schema inside the existing transaction, then passes the entire variant snapshot batch through this seam before any variant or price is restored. A batch conflict rolls back the product, schema, variants, prices, custom fields, and side effects together. It never derives a different identity merely because a display label changed. A conflict returns the typed 409 without changing the row or replaying custom-field/index/event/audit effects; the replay log remains failed/retryable under existing command-bus semantics. Delete execute and create undo release index participation by removing/soft-deleting the row and require no claim. The lock is scoped by persisted product, so unrelated products do not contend. No unlocked pre-check authorizes insertion, update, or restoration.

The current non-command construction paths are catalog example seeding and dashboards analytics seeding. Catalog example seeding canonicalizes complete finite seeded variants and writes their keys in its seed transaction; schema-less/incomplete examples remain null. Dashboards analytics seeding creates the default variant for a non-configurable, schema-less product and intentionally leaves its key null. A repository-wide source-invariant test enumerates every `CatalogProductVariant` construction/restoration site across all packages and fails when a new site neither delegates to the claim seam nor is the explicitly tested migration/backfill, keyed catalog seed, or schema-less dashboards seed path.

The stable duplicate outcome is HTTP/command error `409` with code `variant_combination_exists`, product id, and no cross-scope detail. The unresolved-history outcome is HTTP/command error `409` with code `variant_combination_claim_unresolved`, product id, and no row identity. A direct/manual create or update receives the applicable conflict. A higher-level generate-missing operation may catch only `variant_combination_exists`, record the already-existing variant id found under the same scope, recompute its remaining set, and continue. It must abort on unresolved history and must not convert permission, validation, scope, transaction, custom-field, event, index, or audit failures into skips.

## Architecture

| Area | Change |
|---|---|
| catalog variant entity/migrations | Nullable internal key, deterministic backfill support, live-row partial unique index |
| catalog variant command helper | Code-backed canonical function plus one scoped single/batch `claimLiveVariantCombinations` transition seam |
| catalog product-form option helper | Preserve immutable option/choice codes separately from editable labels; keep current displayed/stored labels |
| `catalog.variants.create` execute/redo | Parent/schema locks, in-transaction claim/revalidation, stable duplicate result |
| `catalog.variants.update` execute/undo/redo | Recompute and claim whenever effective option values enter/change a complete combination; persisted product remains authoritative |
| `catalog.variants.delete` undo | Recompute and claim before restoring a deleted complete-combination row |
| `catalog.products.delete` undo | Snapshot the key and batch-claim all child variants before restoring any variant/price; legacy snapshots canonicalize or fail closed |
| catalog example seed | Persist canonical keys for complete finite seeded variants; source-invariant test prevents unclassified direct writers |
| dashboards analytics seed | Preserve the intentional null key for the default variant of a non-configurable schema-less product; classify and test this cross-module direct writer explicitly |
| option-schema/product schema mutations and replay | Scoped schema-row `PESSIMISTIC_WRITE`; label edits allowed, referenced code/assignment changes rejected or explicitly migrated |
| direct variant API | Existing route/metadata/feature/command delegation; additive documented 409 |
| future generate operation | Delegates each candidate through the same command claim; never trusts its precomputed missing set |
| tests | Backfill/canonicalization, schema renames, isolation, historical conflicts, execute/undo/redo contenders, side-effect counts |

The claim stays in the catalog module and uses the existing DI-provided entity manager. It adds no cross-module relationship or cache.

## Data Models

Add nullable internal `CatalogProductVariant.optionCombinationKey` mapped to `option_combination_key` (`text`, default `null`, never emitted by ordinary variant API serializers). The canonical key is derived from stable option/choice codes; `optionValues` remains unchanged for backward-compatible display/request behavior.

Add optional `optionCombinationKey?: string | null` to the internal variant command snapshot and `ProductDeleteVariantSnapshot`. Fresh snapshots always populate it; existing action-log payloads without the field remain valid and follow the locked legacy canonicalization path. Migration and runtime lazy-key writes are internal derivation only: they preserve the row's existing `updated_at`, emit no CRUD/index/audit event, and do not create a false optimistic-lock conflict.

Ship this in migration-safe stages:

1. add the nullable column and deploy key-aware dual writes/snapshots/restoration to every inventoried writer while duplicate enforcement and generation remain disabled;
2. once every application/worker replica runs the key-aware build, run deterministic scoped backfill/preflight; unambiguous complete live rows receive keys, while duplicate keys, unmatched legacy labels, or ambiguous labels are marked claim-eligible unresolved, produce a fail-closed remediation report, and remain null;
3. after a second clean preflight proves no old writer or unresolved row remains in the deployment scope, add a unique partial index over `(tenant_id, organization_id, product_id, option_combination_key)` where `deleted_at IS NULL AND option_combination_key IS NOT NULL`, then enable command enforcement/capability use. Runtime enforcement still canonicalizes and transactionally keys every resolvable live null-key row and fails on every unresolved/duplicate claim-eligible row per locked product, so legacy replay, seeding, or later drift cannot make null mean available.

The entity snapshot and generated, scoped migrations ship together and are reviewed for only the intended column/backfill/index changes. Removal/soft delete clears live-index participation; every restoration follows the same claim rules. Truly schema-less or structurally incomplete rows stay null and outside the claim contract; a complete-looking row that cannot map uniquely is unresolved rather than silently exempt. No direct relationship is added.

## API Contracts

Existing variant create/update request and success shapes remain unchanged. The affected route/OpenAPI documentation adds:

- HTTP `409` `{ error: 'variant_combination_exists', code: 'variant_combination_exists', productId: string }` for a complete finite combination already represented by a different live scoped variant;
- HTTP `409` `{ error: 'variant_combination_claim_unresolved', code: 'variant_combination_claim_unresolved', productId: string }` when unresolved claim-eligible history prevents a safe availability decision;
- existing SKU/GTIN conflicts and all auth/scope/validation failures unchanged;
- no variant id from another tenant, organization, or product in the error body.

The internal duplicate error carries the matching scoped variant id for trusted generate-missing handling, but the public response does not expose it. The future generator returns its own documented created/skipped result and may consume that id only after its own authorization and scope checks. Replay and undo restoration return the same public/internal conflict family and never treat a duplicate or unresolved scope as a successful transition.

## UI/UX

The existing product option editor looks and behaves the same, but its in-memory draft preserves immutable option/choice codes while labels are edited. New options/choices receive a code once when created; subsequent label edits do not regenerate it. Variant `optionValues` continue to use the existing display-label payload, and existing callers surface claim conflicts through their current localized error mechanism. The later catalog adopter owns generator progress and policy-form behavior.

## Frontend Architecture Contract

The existing product create/edit route roots and client boundaries remain unchanged. The only frontend change is typed data plumbing in the existing catalog product-form helper and its current option editor: add optional stable code fields to the local draft, preserve them during schema-to-draft-to-schema conversion, and generate codes once for new draft entries. No provider, browser import, render-time request, dynamic island, route-root ownership, or hydration behavior changes. Focused helper tests assert label edits retain codes and displayed/stored labels, and `yarn check:client-boundaries` plus the configured build gate must remain unchanged.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Same stable codes submitted via labels/codes or different object order | One code-backed key; second complete create gets 409 |
| Choice display label changes | Key unchanged; existing row remains claimable |
| Existing command snapshot replayed after a label rename | Captured codes validate and claim successfully; the old display label does not create a new identity |
| Referenced option/choice code rename or removal | Reject while live keys exist unless an explicit locked mapping migrates every affected key |
| Product schema replacement or detachment with live keyed variants | Reject unless one locked transaction maps every affected key to the replacement identity |
| Missing/unknown/duplicate option id | Existing validation result; no partial claim |
| Schema-less or non-finite option input | Current create behavior; no combination claim |
| Existing historical duplicate/ambiguous/unmatched complete rows | Preserve rows; mark product unresolved; block complete create/update/replay with sanitized 409 until remediation |
| Resolvable live null-key historical/legacy-restored row | Lazily assign its key under the product/schema locks before comparing a candidate; it can never be skipped by the partial index |
| Two creates for one product/combination | Parent lock serializes; exactly one commit and one duplicate result |
| Creates for different products | No shared row lock; both may proceed |
| Wrong tenant/org/product | Scoped not-found behavior; no existence leak |
| Winner fails before commit | Transaction rolls back; waiter rechecks and may create |
| Winner commits but post-commit side effect fails | Variant remains claimed; retry gets duplicate rather than another row |
| Create → undo → competing create → redo | Competing row owns the key; redo returns typed 409, restores nothing, and emits no replay side effects |
| Update A → undo → competing update/create claims A's old key | Undo returns typed 409, leaves the current row unchanged, and emits no undo side effects |
| Delete → competing create claims deleted key → undo | Undo returns typed 409, leaves the row deleted, and restores no prices/custom fields |
| Product delete → competing product/variant state → product undo | Batch claim all child snapshots; any conflict rolls back the complete product/schema/children restoration and emits no restore side effects |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Concurrent duplicate variants | Critical | Shared parent lock plus in-transaction canonical live-row check | No claim for incomplete/non-finite combinations by design |
| Cross-scope existence leak | Critical | Tenant/org/product predicates and minimal public 409 | Trusted internal generator sees id only after authorization |
| Existing callers relied on complete duplicates | High | Two-stage preflight/remediation, stable 409, release/upgrade note, historical rows preserved and fail closed | Affected products cannot create/update/restore complete combinations until remediated |
| Product-level lock contention | Medium | Lock only during scoped claim and mutation; unrelated products independent | A hot product serializes claimed variant transitions |
| Canonicalization races or drifts from schema validators | High | Code-backed key, locked schema snapshot, matching update/delete write lock, one helper, and golden tests | New option kinds require helper coverage |
| Direct writer or undo/redo bypasses live claim | Critical | Every live-state transition shares the claim seam; catalog seeds are keyed when claim-eligible, the schema-less dashboards seed is an explicit null-key exception, and repository-wide source-invariant coverage plus the partial unique index backstop new writers | Failed replay requires operator conflict resolution before retry |

Rollback before stage 3 may stop backfill and leave the nullable additive column unused. After index/enforcement publication, operational rollback may disable duplicate rejection/generation behind a documented emergency compatibility switch for one release, but it must keep every writer's key dual-write/clear behavior, lazy null-key remediation, snapshot compatibility, and the column/index intact. Deploying a pre-key writer build is forbidden until a separately reviewed down-migration/compatibility plan exists. Rollback never deletes existing variants or changes key encoding; physical removal follows the deprecation protocol.

## Migration & Backward Compatibility

The additive column, optional internal snapshot fields, backfill, and partial unique index use reviewed migrations plus the catalog snapshot. Existing serialized action logs remain readable because absent snapshot keys take the locked legacy path. Existing duplicates remain intact and are never collapsed automatically. Claim-eligible unresolved rows block stage-3 index/enforcement enablement for their deployment scope and continue to block complete-combination mutations for their product at runtime until an operator maps or removes them; they cannot be declared outside the contract merely by retaining a null key. Only genuinely schema-less or structurally incomplete rows are exempt. Label-only renames need no data rewrite because keys use stable codes. Referenced code changes require an explicit mapping migration or are rejected.

The request and success shapes, command id, route, events, audit labels, and import paths remain compatible. A temporary opt-out, if maintainers approve one for rollout, must be explicit, fail loudly in diagnostics, and cannot be used by `catalog.variants.generate_missing`.

## Phasing and Implementation Plan

1. Add code-backed canonicalization plus stable-code product-form drafts with exhaustive label/code, option-order, label-edit round-trip, ambiguous-label, and schema-code tests.
2. Add the nullable entity column, first migration/snapshot, key-aware dual writes across the complete writer inventory, deterministic backfill/preflight report, replica-version rollout barrier, and upgrade note.
3. Add one single/batch `claimLiveVariantCombinations` seam and route create execute/redo, option-value update execute/redo, update undo, delete undo, and product-delete undo child restoration through it on one transaction manager; capture the key in both variant snapshot types, lazily key every resolvable live null row, retain the persisted product on update/replay, and keep claim plus insert/update/restore, default enforcement, media aggregation, and price restoration atomic. Route direct option-schema and product-command schema assignment/replacement/detachment execute/undo/redo through matching template write locks, rejecting referenced identity changes without an atomic mapping.
4. After every replica is key-aware and clean preflight evidence is repeated, add the partial unique-index migration/snapshot, stable internal/public duplicate error mapping, and OpenAPI response; only then enable generator/capability use.
5. Key complete finite catalog example seeds, assert the dashboards analytics seed remains a schema-less null-key exception, and add a repository-wide source-invariant test covering every construction/restoration site across all packages. Add barrier tests for two direct creates, direct/generator-style callers in both winning orders, label rename versus create, rejected code rename/schema detachment, schema-mutation undo/redo, resolvable and unresolved historical null-key rows, create→undo→competing create→redo, update→undo versus a competing claimant, delete→competing create→undo, product-delete undo batch conflict/rollback, legacy product snapshot restoration, rollback/waiter success, different-product parallelism, and post-commit side-effect retry.
6. Run migration SQL/snapshot review, focused catalog command/API/undo-redo tests, core build/typecheck, `git diff --check`, and the configured validation gate.

## Integration Coverage

- direct variant API: complete create, duplicate 409, auth/feature/scope, schema-less/incomplete behavior, existing SKU/GTIN behavior;
- product-form helper: existing schema codes survive label edits and round trips, new codes are allocated once, and `optionValues` retain current display payloads;
- command: code-backed canonical option identity, current-schema refresh, persisted-product authority, snapshot-key validation after label edits, eager migration plus runtime lazy-key backfill, and exact variant/product-delete execute/undo/redo transaction and side-effect ordering;
- concurrency: barrier-controlled same-product same-key contenders, same-product different-key contenders, different-product contenders, label/code/schema-assignment mutation and replay versus create, create→undo→competing create→redo, update→undo versus a competing claimant, delete→competing create→undo, winner rollback, winner post-commit failure;
- future generator contract fixture: typed duplicate is the only skippable outcome and resolves only a scoped matching id;
- backward compatibility: request/success/event/audit/undo/redo golden traces, current and legacy variant/product-delete snapshots, label rename, staged dual-write/backfill/index rollout, replica-version barrier, snapshot, repeated preflight, keyed catalog seed behavior, schema-less dashboards analytics seed null-key behavior, repository-wide source-invariant coverage, rollback floor, and upgrade-note evidence.

## Acceptance Criteria

1. Every transition into a complete live combination—create execute/redo, option-value update execute/redo, update undo, delete undo, and product-delete undo batch restoration—acquires the scoped persisted parent and referenced schema rows and checks/claims the code-backed key in the same transaction as insert/update/restore; every direct or product-command schema definition/assignment mutation and replay uses the matching template write lock.
2. Canonical identity is stable across input ordering and display-label changes; referenced code edits are rejected or explicitly migrated, and direct/generated/execute/undo/redo paths share the key.
3. Two contenders, create→undo→competing-create→redo, update→undo with a competing claimant, and delete→competing-create→undo each produce at most one live keyed variant and a stable conflict with no duplicate replay side effects.
4. Incomplete/schema-less variants retain current behavior; every resolvable live null-key row is keyed inside the locked claim transaction, while existing historical duplicates/unmappable labels are preserved, reported, block stage-3 index/enforcement enablement for their scope, and fail closed for complete-combination mutations on their product until remediation.
5. Scope failures expose no foreign product or variant identity.
6. Existing request/success, command, event, audit, query-index, custom-field, undo, and redo contracts remain compatible except for the documented additive duplicate 409.
7. Both migrations/snapshot, OpenAPI, upgrade note, keyed catalog seed, explicit schema-less dashboards seed exception, complete repository-wide direct-writer inventory test, key-aware replica barrier, repeated clean preflight evidence, focused tests, and configured validation pass.
8. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/shared/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root data/security rules | Scope every read/write and preserve command side effects | Compliant | Parent and variant queries carry tenant/org/product scope; successful create delegates existing post-commit seams once |
| core command rules | Use DI entity manager and atomic flush/transaction patterns | Compliant | One transaction manager owns each single/batch live-state transition's locks, lazy keying, claim, insert/update/restore, default enforcement, media aggregation, and price restoration |
| catalog guide | Preserve option schemas and catalog command/event patterns | Compliant | No schema deletion or event/id change; canonicalization uses the current schema |
| `.ai/specs/AGENTS.md` | One independently deployable capability with integration coverage | Compliant | Only live variant-combination integrity is included; section-policy generation is a dependent adopter |
| `BACKWARD_COMPATIBILITY.md` | Preserve stable request/success surfaces and document intentional behavior tightening | Compliant | Additive column/409, staged dual-write/backfill/index rollout, upgrade note, preflight, and historical-row preservation are required |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Internal code-backed key and partial unique index support stable claim identity without changing public option values |
| API contracts match UI/UX | Pass | UI behavior stays fixed while stable codes survive label edits; direct APIs gain documented localized duplicate/unresolved 409 behavior |
| Risks cover all write paths | Pass | Direct, generated, variant replay, product-delete replay, keyed catalog seed, schema-less dashboards seed, rollback, post-commit, historical, and cross-scope paths are covered |
| Commands defined for all mutations | Pass | Existing variant commands and product-delete undo share one claim seam whenever they enter a live claimed state; catalog and dashboards seed writers are explicitly classified, tested, and inventoried repository-wide |
| Cache strategy covers all read APIs | N/A | No cache/read API change |
| Frontend architecture contract is measurable | Pass | Existing route roots/boundaries stay fixed; only typed stable-code plumbing and focused helper tests change |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready as the catalog section adopter's independently deployable data-integrity prerequisite.

## Changelog

- **2026-10-27:** Split complete option-combination concurrency enforcement from catalog section-policy adoption; defined persisted code-backed identity, eager and lazy backfill, fail-closed historical remediation, staged dual-write/backfill/index rollout, a shared single/batch claim seam for every variant/product-delete live-state transition, keyed seeding/direct-writer coverage, stable duplicate behavior, schema-rename rules, and contender/undo-redo tests.
