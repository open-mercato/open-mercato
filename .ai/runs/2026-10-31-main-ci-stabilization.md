# Main CI Stabilization

Source doc: `.ai/specs/briefs/2026-08-09-dependabot-cooldown-ci-gate.md`

## Goal

Restore the main branch's snapshot-release health by ensuring standalone consumers install the same reviewed TipTap peer graph that the monorepo validates, without weakening the five-day third-party package quarantine.

## Scope

- Diagnose the failing main-branch workflows and record the causal dependency path.
- Pin the Documents package's tightly coupled TipTap runtime family to one aged patch version, use the audited `happy-dom` patch directly for server-side conversion, and keep unrelated transitive TipTap trees independent.
- Add regression coverage that rejects ranged published TipTap versions and incompatible effective peer resolutions in the lockfile.
- Run the configured validation gate, verify PR checks, and obtain an independent final review.

## Non-goals

- Disabling or reducing `npmMinimalAgeGate`.
- Adding a standing third-party `npmPreapprovedPackages` exception.
- Changing Documents runtime behavior, public APIs, or the snapshot release architecture.
- Applying unrelated dependency updates exposed by a fresh install.

## Implementation Plan

### Phase 1: Diagnose the failing release path

1. Confirm the failing main workflows, isolate the standalone dependency-resolution failure, and select the smallest security-preserving fix.

### Phase 2: Stabilize the published dependency graph

1. Pin the Documents TipTap runtime family and root resolution to the reviewed, peer-aligned `3.32.0` graph, then regenerate the lockfile.
2. Add a regression test that keeps the published TipTap family exact and internally aligned.
3. Remove the unsafe unscoped core resolution, align the HTML DOM peer, and make the guard validate effective lockfile peers.
4. Replace the vulnerable HTML DOM peer with the audited patch and remove the unnecessary TipTap HTML wrapper whose aged peer range rejects it.

### Phase 3: Verify and review

1. Run the configured validation gate and the relevant standalone/package checks, fixing any regressions.
2. Verify the PR's CI checks and obtain the required independent final-review verdict.

## Risks

- Exact pins trade automatic TipTap patch uptake for reproducible, peer-aligned standalone installs; future bumps must intentionally update the family together.
- Independent review rejected the initial unscoped `@tiptap/core` resolution because it rewrote Hocuspocus's separate `3.32.2` tree; the corrected graph keeps the published Documents family exact while allowing each transitive TipTap tree to satisfy its own exact peers.
- Hosted audit rejected `happy-dom@20.8.9`; TipTap 3.32.2 proves the server conversion runtime is unchanged with 21.0.4, so Documents now owns that small conversion adapter directly and no longer depends on stale third-party peer metadata.
- The snapshot workflow publishes before standalone validation, so this fix can prove the consumer path only through the PR gate and the next main snapshot after merge.
- Dependency installation emitted existing peer warnings and optional native-build warnings; the immutable install completed successfully and this run will not absorb unrelated dependency cleanup.

## Progress

PR: #8349

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose the failing release path

- [x] 1.1 Confirm the failing main workflows, isolate the standalone dependency-resolution failure, and select the smallest security-preserving fix. — 4a145663ae

### Phase 2: Stabilize the published dependency graph

- [x] 2.1 Pin the Documents TipTap runtime family and root resolution to the reviewed, peer-aligned `3.32.0` graph, then regenerate the lockfile. — 4a145663ae
- [x] 2.2 Add a regression test that keeps the published TipTap family exact and internally aligned. — 6f8e279a12
- [x] 2.3 Remove the unsafe unscoped core resolution, align the HTML DOM peer, and make the guard validate effective lockfile peers. — cb18363259
- [x] 2.4 Replace the vulnerable HTML DOM peer with the audited patch and remove the unnecessary TipTap HTML wrapper whose aged peer range rejects it. — bdb3add629, 4cafcb28dc

### Phase 3: Verify and review

- [x] 3.1 Run the configured validation gate and the relevant standalone/package checks, fixing any regressions. — 4cafcb28dc
- [ ] 3.2 Verify the PR's CI checks and obtain the required independent final-review verdict.
