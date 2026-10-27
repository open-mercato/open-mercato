# Encrypted custom fields at plaintext search boundaries

## Goal

Close #7894: keep encrypted custom-field values out of fulltext documents and vector fallback text while preserving hashed-token inputs.

## Scope

Use the existing search indexer, strategy boundaries, custom-field definitions and DI. Add optional JSON-safe exclusion metadata to IndexableRecord; preserve existing field values for token indexing. Include all single, bulk, ID-loaded and queued indexing paths through their real call sites.

Source doc: .ai/specs/2026-07-24-search-architecture-clarification-and-evolution.md

## Implementation Plan

### Phase 1: Resolve and carry exclusions

Reuse the narrow encrypted-custom-field resolver API proposed in related PR #7874, without including its callback/build-context changes. Resolve exclusions once per entity per indexing call and fail closed for custom fields on lookup failure.

### Phase 2: Enforce the plaintext boundaries

Filter fulltext documents before any driver and generic vector fallback text before embedding. Preserve token strategy inputs. Add red/green regression proofs through actual indexer/service/strategy boundaries and update compatibility/reindex documentation.

### Phase 3: Review and handoff

Publish the implementation, resolve conflicts against the actual latest base, obtain independent code review with autofix, and inspect current-head CI under the repository's GitHub-checks-first rules.

## Risks

- Related PR #7874 is unmerged. This fix remains independent and reuses its narrow resolver shape to reduce later conflicts, without claiming its build-context protection.
- Previously indexed plaintext requires a fulltext/vector reindex after upgrade; existing external copies cannot be recalled.
- Raw SearchService clients omitting the additive metadata retain their existing explicit field-policy contract.
- Required CI and external maintainer approval remain merge gates.

## Non-goals

No changes to buildSource/callback context sanitization (#7874), search defaults, provider configuration, queue payloads, database schema or UI. No production dependencies.

## Progress

PR: #8043

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Resolve and carry exclusions

- [x] 1.1 Add typed resolver and DI wiring with fail-closed exclusion metadata across indexing paths. — 68313cc4e

### Phase 2: Enforce the plaintext boundaries

- [x] 2.1 Filter fulltext and vector fallback fields while retaining token values. — 68313cc4e
- [x] 2.2 Add regression coverage and operator/compatibility documentation. — 68313cc4e

### Phase 3: Review and handoff

- [x] 3.1 Publish implementation and resolve latest-base conflicts. — 68313cc4e; latest origin/main 7b5ad7492, already incorporated
- [ ] 3.2 Complete independent review/autofix and record current-head validation.

## Validation evidence

Runner: local; prescribed Compose probes found no running app. Narrow fallback
for the new unreported source diff used the existing read-only tooling and the
worktree's own Jest configuration/module mapping; no package install was needed.

- Three new suites: 17/17 checks passed.
- Restoring the original fulltext/vector strategy files causes 10/11 boundary
  assertions to fail; restoring the fix passes all 11.
- Full search package: 44 suites / 422 tests passed.
- `git diff --check` passed.
- No live external backend, embedding API, database or browser was contacted.
- Broad builds/typechecking and the repository gate are delegated to exact-head
  GitHub CI. Pending CI is not a pass.
