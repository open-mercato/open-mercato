---
title: "`/_global-error` prerender failures are Next version issues, not app code"
modules: ["create_app","ui"]
areas: ["debugging","testing","architecture"]
topics: ["package-runtime","generated-files","template-sync"]
---

# `/_global-error` prerender failures are Next version issues, not app code

**Context**: `yarn build:app` failed prerendering `/_global-error` with `TypeError: Cannot read properties of null (reading 'useContext')` on Next 16.2.6. Issue #2445 blamed the `useState`/`useEffect` in the scaffolded `src/app/global-error.tsx` and recommended stripping them. Four `.ai/runs/*.md` entries then waved the failure through as "pre-existing".

**Problem**: `/_global-error` is a synthetic route Next generates for itself. In `next/dist/build/webpack/loaders/next-app-loader/index.js` its page is hardcoded to the builtin `next/dist/client/components/builtin/app-error.js` and the root layout is stripped from the segment tree, so the app's own `global-error.tsx` is never in that route — it ships only inside real route entries as the runtime error boundary. Verified against the artifact: `.mercato/next/server/app/_global-error.html` holds Next's builtin "This page couldn't load" markup and none of the app's strings. The recommended fix would have deleted working offline-recovery UX for zero effect, and the real cause disappeared on a Next patch bump.

**Rule**: Bisect the `next` version before touching `global-error.tsx`. More generally, never carry a build failure forward as "pre-existing" without naming what it is pre-existing *to* — a version, a commit, or an upstream issue. An unexplained failure repeated across runs becomes folklore that hides a real regression. Guard the scaffolded production build in `scripts/test-create-app-integration.ts` so the class of regression cannot ship unnoticed.

**Applies to**: `apps/mercato/src/app/global-error.tsx`, `packages/create-app/template/src/app/global-error.tsx`, Next.js upgrades, `.ai/runs/*` validation notes, and any triage that labels a failure "pre-existing".
