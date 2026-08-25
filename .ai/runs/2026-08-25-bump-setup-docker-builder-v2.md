# Migrate PR #5560 (setup-docker-builder v1 → v2) to `develop`

Engine: om-auto-create-pr (steps: 5, --loop: no)

## Goal

Land Dependabot's `useblacksmith/setup-docker-builder` v1 → v2 bump on the repository's
configured base branch `develop` instead of `main`, then close the original PR
[#5560](https://github.com/open-mercato/open-mercato/pull/5560) pointing at the replacement.

## Scope

- Cherry-pick Dependabot's commit `8750ed8` onto a branch cut from `origin/develop`, preserving
  the original authorship so the bump is still credited to `dependabot[bot]`.
- Complete the v2 migration: v2.0.0 made `cache-key` a **required** action input
  (`useblacksmith/setup-docker-builder` release v2.0.0, "add required cache-key input, native GC,
  and server-driven config for v2"). Dependabot's diff only changes the tag, so both call sites
  need an explicit `cache-key`.
- Close #5560 with a comment linking the replacement PR.

## Non-goals

- No change to `useblacksmith/build-push-action@v2` or any other action version.
- No restructuring of the `docker-build` job (it keeps one builder setup for its three Dockerfile
  builds; splitting it into per-Dockerfile builders is out of scope).
- No change to app code, packages, migrations, or locales — the diff is confined to
  `.github/workflows/`.

## Implementation Plan

### Phase 1: Port the bump onto `develop`

1.1 Cherry-pick `8750ed8` onto `feat/bump-setup-docker-builder-v2` (cut from `origin/develop`).
1.2 Add the required `cache-key` input at both call sites:
    - `.github/workflows/ci.yml` → `docker-build` job (one builder, three Dockerfiles) → job-scoped key.
    - `.github/workflows/qa-deploy.yml` → preview image build → `docker/preview/Dockerfile`.

### Phase 2: Verify and hand over

2.1 Verify no `setup-docker-builder@v1` reference remains and both workflow files still parse as YAML.
2.2 Open the replacement PR against `develop`, apply pipeline labels.
2.3 Close #5560 with a comment linking the replacement.

## Risks

- **Cache-key choice.** `ci.yml`'s `docker-build` job builds three Dockerfiles behind a single
  builder setup, so it gets one job-scoped key (`ci-docker-build`). That matches today's v1
  behaviour, where the sticky disk key defaults to the repository name and all three builds already
  share one cache. Per-Dockerfile isolation would require three separate builder setups — deliberately
  out of scope.
- **Verification is CI-only.** The diff touches no application source, so the configured
  `validation.commands` gate (build/typecheck/test/build:app) cannot exercise it; the real proof is
  the `docker-build` job running on this PR. `qa-deploy.yml` is `workflow_dispatch`-only and is not
  exercised by PR CI — its bump carries the same review reasoning as the `ci.yml` one.

## Progress

### Phase 1: Port the bump onto `develop`

- [ ] 1.1 Cherry-pick Dependabot's commit onto a branch cut from `origin/develop`
- [ ] 1.2 Add the required `cache-key` input at both call sites

### Phase 2: Verify and hand over

- [ ] 2.1 Verify no v1 reference remains and the workflow YAML parses
- [ ] 2.2 Open the replacement PR against `develop` and apply labels
- [ ] 2.3 Close #5560 with a pointer to the replacement
