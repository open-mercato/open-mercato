# Fix /start page hydration mismatch on API base URL

## Overview

**Goal**: Eliminate the React hydration error on `/start` caused by the "Current API base URL" code chip rendering a different URL on the server than on the client.

**Root cause**: `StartPageContent` is a `'use client'` component but calls `resolveApiDocsBaseUrl()` directly. That helper falls back to `process.env.APP_URL`, which is a **server-only** env var. During SSR the server resolves e.g. `http://localhost:3002/api` (from `APP_URL`), while the client bundle — where `APP_URL` is undefined and only `NEXT_PUBLIC_*` vars are inlined — falls back to the `http://localhost:3000` default. React detects the text mismatch and regenerates the tree:

```
+  http://localhost:3000/api   (client)
-  http://localhost:3002/api   (server)
```

**Fix**: Resolve the API base URL on the server (in the `StartPage` server component) and pass it to `StartPageContent` as an `apiBaseUrl` prop. Remove the client-side `resolveApiDocsBaseUrl()` call. Apply identically to the `create-app` template copy, which is byte-for-byte the same component.

**Affected files**:
- `apps/mercato/src/components/StartPageContent.tsx`
- `apps/mercato/src/app/start/page.tsx`
- `packages/create-app/template/src/components/StartPageContent.tsx`
- `packages/create-app/template/src/app/start/page.tsx`
- New test: `apps/mercato/src/components/__tests__/StartPageContent.test.tsx`

**Non-goals**:
- No change to `resolveApiDocsBaseUrl()` semantics (its env-var precedence and the existing unit tests stay as-is; it remains correct for server components and API routes).
- No change to the other server-side callers (`api_docs` backend/frontend pages, `/api/docs/*` routes).
- No redesign of the start page.

## Risks

- The `StartPageContent` prop interface gains a required `apiBaseUrl: string`. This component lives in app boilerplate (`apps/mercato/src/` and the create-app template), not in a published package contract surface, and both copies plus their only call sites are updated in the same change. Apps scaffolded from older templates own their local copy and are unaffected.
- Low blast radius otherwise: display-only string on a starter page.

## Implementation Plan

### Phase 1: Server-resolve the API base URL

- 1.1 `apps/mercato`: add `apiBaseUrl` prop to `StartPageContent`, drop the client-side `resolveApiDocsBaseUrl()` call; resolve it in `apps/mercato/src/app/start/page.tsx` and pass it down.
- 1.2 `packages/create-app/template`: apply the identical change to the template copies so freshly scaffolded apps don't ship the bug.

### Phase 2: Tests

- 2.1 Add `StartPageContent` unit test (jsdom) asserting the rendered API base URL comes from the `apiBaseUrl` prop, so the component can no longer read env-dependent values at render time.

### Phase 3: Validation and PR

- 3.1 Full validation gate (`build:packages`, `generate`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `test`, `build:app`), code review + BC self-review, open PR with labels.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Server-resolve the API base URL

- [x] 1.1 apps/mercato: pass server-resolved apiBaseUrl into StartPageContent — 280a7e6de
- [x] 1.2 create-app template: mirror the same fix — 280a7e6de

### Phase 2: Tests

- [x] 2.1 Unit test: StartPageContent renders the apiBaseUrl prop — cb27ff8ce

### Phase 3: Validation and PR

- [ ] 3.1 Full validation gate, self-review, PR opened
