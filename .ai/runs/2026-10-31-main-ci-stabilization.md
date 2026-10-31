# Main CI Stabilization

Source doc: `.ai/specs/briefs/2026-08-09-dependabot-cooldown-ci-gate.md`

## Goal

Restore the main branch's snapshot-release health by ensuring standalone consumers install the same reviewed TipTap peer graph that the monorepo validates, without weakening the five-day third-party package quarantine.

## Scope

- Diagnose the failing main-branch workflows and record the causal dependency path.
- Pin the Documents package's tightly coupled TipTap runtime family to one aged, tested patch version and align the root resolution and lockfile.
- Add regression coverage that rejects ranged or mixed TipTap runtime versions in the published package manifest.
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

1. Pin the Documents TipTap runtime family and root resolution to the tested `3.30.6` peer graph, then regenerate the lockfile.
2. Add a regression test that keeps the published TipTap family exact and internally aligned.

### Phase 3: Verify and review

1. Run the configured validation gate and the relevant standalone/package checks, fixing any regressions.
2. Verify the PR's CI checks and obtain the required independent final-review verdict.

## Risks

- Exact pins trade automatic TipTap patch uptake for reproducible, peer-aligned standalone installs; future bumps must intentionally update the family together.
- The snapshot workflow publishes before standalone validation, so this fix can prove the consumer path only through the PR gate and the next main snapshot after merge.
- Dependency installation emitted existing peer warnings and optional native-build warnings; the immutable install completed successfully and this run will not absorb unrelated dependency cleanup.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose the failing release path

- [ ] 1.1 Confirm the failing main workflows, isolate the standalone dependency-resolution failure, and select the smallest security-preserving fix.

### Phase 2: Stabilize the published dependency graph

- [ ] 2.1 Pin the Documents TipTap runtime family and root resolution to the tested `3.30.6` peer graph, then regenerate the lockfile.
- [ ] 2.2 Add a regression test that keeps the published TipTap family exact and internally aligned.

### Phase 3: Verify and review

- [ ] 3.1 Run the configured validation gate and the relevant standalone/package checks, fixing any regressions.
- [ ] 3.2 Verify the PR's CI checks and obtain the required independent final-review verdict.
