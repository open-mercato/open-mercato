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

- [ ] 1.1 Replace the null fallback with the shared accessible `Spinner` centered in the login viewport
- [ ] 1.2 Mirror the route and route-level unit coverage into the create-app template

### Phase 2: Regression and delivery verification

- [ ] 2.1 Add an upstream create-app unit test that locks monorepo/template login-route parity
- [ ] 2.2 Run targeted tests, the configured validation gate, design-system review, compatibility review, and automated PR review
- [ ] 2.3 Open a superseding PR with explicit credit to @tomaioo and link/close #4368 after the replacement is ready
