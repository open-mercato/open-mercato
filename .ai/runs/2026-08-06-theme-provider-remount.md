# Fix: ThemeProvider remounts the whole app subtree after hydration

## Goal

Stop `ThemeProvider` from changing the rendered element type after mount, so React re-renders the application subtree instead of unmounting and remounting it — which today discards every component's local state ~200 ms after each page load.

## Context

Diagnosed and measured while QA-ing PR #4170; the defect itself lives on `develop`. Full write-up in issue #5037:

- Diagnosis: https://github.com/open-mercato/open-mercato/issues/5037#issuecomment-5201390829
- A/B measurement: https://github.com/open-mercato/open-mercato/issues/5037#issuecomment-5201543832

`packages/ui/src/theme/ThemeProvider.tsx` returns `<>{children}</>` until `mounted` flips in its first effect, then returns `<ThemeContext.Provider>{children}</ThemeContext.Provider>`. The element type at that position changes, so React tears the subtree down. In `apps/mercato/src/components/AppProviders.tsx` that subtree is `QueryProvider` → `FrontendLayout` → the page.

Measured on `develop` @ `c95a715a0`, two full rebuilds of the same commit, 3 cold loads each:

| Page | Before | After |
|---|---|---|
| `/backend` `/api/` requests | 38 · 38 · 38 | 33 · 33 · 33 |
| `/backend` duplicate requests | 15 · 15 · 15 | 10 · 10 · 10 |
| layout remounts | 1 | 0 |
| time to quiet | 543 · 512 · 494 ms | 490 · 392 · 435 ms (within noise) |

User-visible consequence on `/login`: credentials typed before the remount are discarded and the server answers `400 "Invalid email or password"` for a submit that carried empty fields.

## Scope

- `packages/ui/src/theme/ThemeProvider.tsx` — remove the early return.
- `packages/ui/src/theme/__tests__/` — unit coverage that the subtree is not remounted and the context still resolves.
- `packages/core/src/modules/auth/__integration__/` — a login spec that submits with no artificial settle.

## Non-goals

- `useRegisteredComponent` — my first hypothesis, disproven; it is not involved and stays untouched.
- The remaining 10 duplicate `/api/` requests per dashboard load — a different cause, not addressed here.
- `ComponentOverridesBootstrap` in PR #4170 — the same anti-pattern one level higher in the provider tree, but that file only exists on that branch. Flagged for its author: https://github.com/open-mercato/open-mercato/pull/4170#issuecomment-5201603934
- A FOUC regression test — already covered by `packages/create-app/src/lib/root-layout-theme-script.test.ts`, which asserts both root layouts render `THEME_INIT_SCRIPT` as a render-blocking inline script, never through `next/script`, and before `<AppProviders>`. No new test needed.

## Risks

- The removed branch was commented "Prevent flash of wrong theme during hydration". The actual protection is `THEME_INIT_SCRIPT`, applied synchronously before first paint by the root layout (see the Non-goals note). Risk accepted; the existing test guards it.
- Consumers calling `useTheme()` outside the provider already get safe defaults from the hook, so always rendering the provider cannot break them.

## Implementation Plan

### Phase 1: Fix and unit coverage

1.1 Remove the `if (!mounted)` early return so the element type is stable across the mount flip.
1.2 Unit test: a child that counts its own mounts stays at 1 across the provider's effect flush (2 before the fix).
1.3 Unit test: `useTheme()` still reports the resolved theme and `setTheme` still works after mount.

### Phase 2: Integration coverage

2.1 Integration spec: load `/login`, fill both fields with no artificial settle, submit, assert the request carries the typed email and the response redirects to `/backend`.

### Phase 3: Validation

3.1 Run the full configured validation gate and fix anything it surfaces.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and unit coverage

- [x] 1.1 Remove the early return in ThemeProvider — 70bf15a3f
- [x] 1.2 Unit test: subtree is not remounted — 70bf15a3f
- [x] 1.3 Unit test: theme context still resolves after mount — 70bf15a3f

### Phase 2: Integration coverage

- [x] 2.1 Integration spec: login submitted with no settle — 973e44a17

### Phase 3: Validation

- [x] 3.1 Full validation gate green
