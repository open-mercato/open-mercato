# Production Docker Images Without the Turbopack Build Cache

## TLDR

`next build` with Turbopack (the Next.js 16 default) leaves its persistent build cache in `<distDir>/cache/turbopack`. The production `Dockerfile` copies the whole `apps/mercato/.mercato/next` distDir into the `runner` stage, so every production image ships that cache although the running server never reads it. On `develop` at `b4938566b` the cache is about 1.4 GB of a 2.2 GB distDir. Deleting `cache/turbopack` in the same `RUN` step as the build removes it from the image, with no change to runtime behavior.

## Overview

- Scope: the root `Dockerfile` (`builder` → `runner`) and the standalone app template `packages/create-app/template/Dockerfile`, which has the same build/copy pattern.
- Out of scope: the `dev`/`dev-build` stages, `docker/preview/Dockerfile` (its runner does not copy the builder's distDir), local development, and other `cache/*` subdirectories.

## Problem Statement

Next.js writes `cache/turbopack` during `next build` so that a later build in the same directory can reuse work. A fresh Docker build never has a previous build in the image, and the `runner` stage only serves the existing output with `next start`. The cache therefore only adds weight to the production image:

| Measurement (root `Dockerfile`, `develop` at `b4938566b`, `linux/amd64`) | Today | With the cache removed |
|---|---|---|
| `COPY --from=builder … .mercato/next` layer (`docker history`) | 2.4 GB | 876 MB |
| `du -sh /app/apps/mercato/.mercato/next` in the image | 2.2 GB | 835 MB |
| `docker image inspect --format '{{.Size}}'` | 7.90 GB | 5.16 GB |

A larger image means more registry storage and slower push, pull and cold-start deployment.

## Proposed Solution

In each affected builder stage, remove the Turbopack cache in the same `RUN` instruction as the build, so no layer ever contains it:

```dockerfile
# Dockerfile (builder stage)
RUN yarn build && rm -rf apps/mercato/.mercato/next/cache/turbopack

# packages/create-app/template/Dockerfile (builder stage)
RUN NODE_ENV=production yarn build && rm -rf .mercato/next/cache/turbopack
```

Only `cache/turbopack` is removed. Other `cache/*` content that Next.js may read at runtime (for example a prerender fetch cache) is left as it is today. `rm -rf` succeeds when the directory is absent, for example on a webpack build.

## Architecture

There are no new components. The change affects one build step per Dockerfile:

1. `builder`: `yarn build` produces `<distDir>` including `cache/turbopack`, and the same `RUN` deletes `cache/turbopack`.
2. `runner`: the existing `COPY --from=builder …/.mercato/next …` copies the distDir, which no longer contains the cache.
3. Runtime: `next start` reads `server/`, `static/`, manifests and `BUILD_ID` as before. It does not read `cache/turbopack`.

Rejected alternatives:

- **A separate `RUN rm` step:** the runner image shrinks as well, but the builder layer keeps the cache and the extra instruction adds no value.
- **BuildKit cache mount (`RUN --mount=type=cache,target=…/cache/turbopack yarn build`):** keeps the cache out of the image and can speed up rebuilds on a persistent builder, but it depends on builder-host state and does nothing on ephemeral CI runners. It can be added later on top of this change.
- **Copying only selected distDir entries into `runner`:** this ties the Dockerfile to Next.js internal layout, which is brittle across Next.js upgrades.

## Data Models

Not applicable: the change does not touch persistence or entities.

## API Contracts

Not applicable: no routes, events, generated files or public types change.

## UI/UX

Not applicable: no manually exercisable UI surface changes.

## Configuration

No new environment variables or flags. `distDir` remains `.mercato/next`.

## Contribution Design Contract

| Boundary | Contract | Evidence | Visibility | Status |
| --- | --- | --- | --- | --- |
| `runtime_trace` | `yarn build` → `<distDir>` → same-step removal of `cache/turbopack` → `runner` `COPY` of the distDir → `next start` serves `server/`, `static/` and manifests. No runtime code path reads `cache/turbopack`. | Built image starts, migrations and the existing entrypoint run, and `/login` returns 200 on the candidate image. | `public-text` | `covered` |
| `authority_ownership` | `next build` owns the distDir. The Dockerfile only deletes the build-reuse cache subdirectory and changes no other generated or manual file. | Dockerfile guard test (Verification Map). | `public-test/code` | `covered` |
| `transformation_order` | The removal runs after `yarn build` succeeds (`&&`) and before the `runner` `COPY`. A failed build fails the step as today and is not masked. | Dockerfile guard test asserts that the removal is chained to the build command. | `public-test/code` | `covered` |
| `boundedness` | The change only lowers image size. No limit, page size or payload bound is introduced or changed. | Size comparison in the Verification Map. | `public-text` | `not-applicable: no runtime limits involved; the change only removes bytes from the image` |
| `compatibility` | Runtime output, entrypoints, environment and `distDir` are unchanged. Existing images keep working, and rollback is a revert of one line per Dockerfile. Standalone apps generated before this change keep their current Dockerfile until they adopt the template update. | Candidate image boot check and existing Dockerfile tests. | `public-text` | `covered` |
| `security_scope` | No tenant, auth, secret or network behavior changes. The image contains less build residue. | Diff review: only the two `RUN` lines and the test change. | `public-text` | `not-applicable: no authorization, secret or data-scope surface is touched` |
| `verification_map` | Every requirement maps to a verifier below. | Verification Map. | `public-text` | `covered` |

## Verification Map

| Requirement | Boundary | Verifier | Expected observation | Visibility |
| --- | --- | --- | --- | --- |
| Root `Dockerfile` removes `apps/mercato/.mercato/next/cache/turbopack` in the build step | `authority_ownership`, `transformation_order` | New assertion in `scripts/__tests__/dockerfile-runtime-copy.test.mjs` (`yarn test:scripts`) | Test passes on the candidate and fails without the change | `public-test/code` |
| Template Dockerfile removes `.mercato/next/cache/turbopack` in the build step | `authority_ownership`, `transformation_order` | Same test file, assertion against `packages/create-app/template/Dockerfile` | Test passes on the candidate and fails without the change | `public-test/code` |
| Production image no longer contains the cache | `runtime_trace` | `docker build` of the candidate and `docker run --rm --entrypoint sh <image> -c 'test ! -e /app/apps/mercato/.mercato/next/cache/turbopack'` | Exit 0. The `.mercato/next` layer is smaller than the baseline built from the same base commit | `public-text` |
| Runtime behavior unchanged | `runtime_trace`, `compatibility` | Start the candidate image with the existing compose setup and request `/login` | Container healthy, `/login` returns 200 | `public-text` |

## Implementation Approach

1. Add `&& rm -rf apps/mercato/.mercato/next/cache/turbopack` to the root `Dockerfile` builder `RUN yarn build`.
2. Add `&& rm -rf .mercato/next/cache/turbopack` to the template builder `RUN NODE_ENV=production yarn build`.
3. Extend `scripts/__tests__/dockerfile-runtime-copy.test.mjs` with assertions for both Dockerfiles.
4. Build baseline and candidate images from the same base commit, then compare sizes and run the boot check.

## Migration Path

None. Rebuilding an image applies the change, and existing images and deployments are unaffected.

## Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| A future Next.js version reads `cache/turbopack` at runtime | Low | Production server start | The boot check would fail; today the cache is build-reuse state written by `next build` | Low |
| Docker builds that relied on the cache being in the image for later in-image rebuilds | Low | Custom downstream Dockerfiles that build `FROM` the runner and rebuild | No supported flow rebuilds inside the runner image | Low |
| Template users miss the improvement | Low | Standalone apps | Applies to newly generated apps; existing apps can copy the one-line change | Low |

## Success Metrics

- The production image built from `develop` no longer contains `.mercato/next/cache/turbopack`.
- The `.mercato/next` layer shrinks by about the size of that cache (about 1.4 GB on `develop` at `b4938566b`).

## Open Questions

None.

## Final Compliance Report

- No contract surface from `BACKWARD_COMPATIBILITY.md` changes.
- No module, entity, API, event, ACL or generated-file change.

## Changelog

### 2026-10-06
- Initial specification.
