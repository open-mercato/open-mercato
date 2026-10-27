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

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Resolve and carry exclusions

- [ ] 1.1 Add typed resolver and DI wiring with fail-closed exclusion metadata across indexing paths.

### Phase 2: Enforce the plaintext boundaries

- [ ] 2.1 Filter fulltext and vector fallback fields while retaining token values.
- [ ] 2.2 Add regression coverage and operator/compatibility documentation.

### Phase 3: Review and handoff

- [ ] 3.1 Publish implementation and resolve latest-base conflicts.
- [ ] 3.2 Complete independent review/autofix and record current-head validation.
