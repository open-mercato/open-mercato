# Login Suspense Fallback

## Overview

- Goal: replace the blank `/login` Suspense fallback with an accessible design-system loading indicator in both the monorepo app and the create-app template.
- Source PR: #4368 by @tomaioo identified the missing loading feedback. This run independently rewrites the implementation because that PR is blocked by the contributor CLA, while retaining explicit credit in the replacement PR.
- Smallest safe scope: the two mirrored login route files, their focused route tests, and an upstream template-parity unit test.
- Non-goals: changing login/authentication behavior, altering route contracts, modifying the shared `Spinner` primitive, adding dependencies, or changing unrelated template drift.

## Scope

- `apps/mercato/src/app/login/page.tsx`
- `apps/mercato/src/app/__tests__/login-direct-route.test.tsx`
- `packages/create-app/template/src/app/login/page.tsx`
- `packages/create-app/template/src/app/__tests__/login-direct-route.test.tsx`
- `packages/create-app/src/lib/template-login-route.test.ts`
- `apps/mercato/src/__tests__/storage-s3-routes.test.ts` (test-only isolation required by the full validation gate after a base-branch i18n change)

## Implementation Plan

### Phase 1: Accessible mirrored fallback

1. Replace the null fallback with the shared accessible `Spinner` centered in the login viewport.
2. Mirror the route and route-level unit coverage into the create-app template.

### Phase 2: Regression and delivery verification

1. Add an upstream create-app unit test that locks monorepo/template login-route parity.
2. Run targeted tests, the configured validation gate, design-system review, compatibility review, and automated PR review.
3. Open a superseding PR with explicit credit to @tomaioo and link/close #4368 after the replacement is ready.

## Risks

- A client-only shared primitive could affect static rendering; typecheck and production builds cover the import boundary.
- The template can drift from the monorepo route; byte-identical parity is protected by the new upstream unit test and `yarn template:sync`.
- The replacement must not copy the unsigned contributor commit into its history; implementation commits are authored independently and attribution is recorded in PR prose.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Accessible mirrored fallback

- [x] 1.1 Replace the null fallback with the shared accessible `Spinner` centered in the login viewport — 34edecb96
- [x] 1.2 Mirror the route and route-level unit coverage into the create-app template — 34edecb96

### Phase 2: Regression and delivery verification

- [x] 2.1 Add an upstream create-app unit test that locks monorepo/template login-route parity — ab5a27fec
- [x] Post-validation fix: isolate localized storage route tests from the global module registry — 7a998e24a
- [x] 2.2 Run targeted tests, the configured validation gate, design-system review, compatibility review, and automated PR review — 875a03648
- [x] 2.3 Open a superseding PR with explicit credit to @tomaioo and link/close #4368 after the replacement is ready — PR #4920

PR: #4920

## Validation Notes

- Local runner selected because Docker is unavailable in the current WSL environment.
- The configured validation gate passed in order through `yarn build:app`.
- `yarn template:sync`, `yarn check:client-boundaries`, and the design-system health check passed.
- `yarn test:create-app` and `yarn test:create-app:integration` both stopped at the Docker-backed Verdaccio bootstrap before exercising branch code; GitHub's ephemeral standalone matrix is the remaining authoritative check for the PR head.
