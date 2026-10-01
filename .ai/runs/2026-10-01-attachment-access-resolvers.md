# Attachment Access Resolvers

Source doc: .ai/specs/2026-10-01-attachment-access-resolvers.md (design PR https://github.com/open-mercato/open-mercato/pull/6828; materialized for implementation, not duplicated in this branch)
Issue: https://github.com/open-mercato/open-mercato/issues/6726
Engine: om-auto-create-pr (steps: 9, --loop: no)
Status: in-progress

## Goal

Let owning modules narrow host attachment access, using Documents as a real adopter, and preserve its protection when its resolver is disabled or unavailable.

## Scope

Add validated resolver discovery, baseline-first deny-wins evaluation, durable named-provider requirements, existing Documents data backfill, complete host/service enforcement and actual Documents ACL adoption. Preserve existing signatures, storage validation and unrelated owners. Do not change other module policies, add UI/dependencies, apply developer database migrations or merge/approve QA.

## Implementation Plan

### Phase 1: Contract and durable protection

1.1 Add structural types, validated registry, matching/target normalization and generator plugin with deterministic discovery/bootstrap tests.
1.2 Add requirements column, migration/snapshot, trusted union helper and partition synchronization; test disabled-provider backfill, legacy JSON and repeated/concurrent union.
1.3 Add runner/live subject projection, immutable snapshots, isolated request caches, budgets and diagnostics; preserve baseline regressions.

### Phase 2: Host and real adopter

2.1 Enforce original/derived bytes and public read/link services before storage/cache, with protected cache headers.
2.2 Enforce metadata visibility/count/facets and locked original/destination/delete authorization before writes, preserving guards/side effects.
2.3 Register Documents using its real permission/capability/active-role services and test multiple owners, scope and revocation.

### Phase 3: Validation and handoff

3.1 Add self-contained live coverage for every host path and export rejection; capture real browser recipient/unshared evidence.
3.2 Run configured ordered local gate, test:scripts, template/i18n checks and fix actionable failures.
3.3 Review #6820 overlap and the implementation, publish upgrade/BC evidence, normalize labels and release the claim for CI/review handoff.

## Risks and Constraints

- Named human Emergency Security Exception acknowledgment is required before merge; no automated review substitutes for it.
- PR #6820 owns strict storage validation in overlapping handlers/public exports. Preserve wrappers and resolve-before-delete order during conflict review.
- Library candidate scanning has exact authorized counts and bounded timeout; verify no hidden counts/tags/labels/content leak.
- Runtime tooling is isolated managed ephemeral CLI, never developer/shared DB. Tests and same-worktree builds are sequential.
- Full gate uses local runner. Known Homebrew create-app libuv issue may require a scoped bundled-Node rerun; bundled Node broad Jest has native V8 crashes and is not the default.
- Installed shared review renderer/schema is absent. Post transparent nonapproving evidence and keep INCOMPLETE/draft where required; do not invent formal output or change automation.
- Independent design review was performed by parent because fresh-agent capacity was unavailable; no nested agents.

## Progress

PR: #6829

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Contract and durable protection

- [x] 1.1 Add types, registry, matching and generator discovery — b5e9c9f6b5
- [ ] 1.2 Persist and backfill required owner policies
- [ ] 1.3 Implement fail-closed runner and subject projection

### Phase 2: Host and real adopter

- [ ] 2.1 Enforce byte routes and public read/link services
- [ ] 2.2 Enforce metadata and atomic mutation authorization
- [ ] 2.3 Adopt Documents permissions through the resolver

### Phase 3: Validation and handoff

- [ ] 3.1 Add live path coverage and browser evidence
- [ ] 3.2 Complete configured validation and supplementary checks
- [ ] 3.3 Review and publish evidence with release handoff
