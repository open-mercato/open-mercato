# Fix: `useRegisteredComponent` returns a new component identity on every re-resolution

## Goal

Make the component handed back by `useRegisteredComponent` keep one identity for its whole lifetime, so a late override registration or a resolved feature grant makes the subtree **re-render** instead of unmounting and remounting — which today discards every input's state below the hook.

## Context

Issue #5037. The user-visible symptom in that issue (credentials typed into `/login` wiped ~200 ms after load, `POST /api/auth/login` sent with empty fields, wrong `Invalid email or password`) was traced to `ThemeProvider` and fixed by #5055, which also shipped `packages/core/src/modules/auth/__integration__/TC-AUTH-5037.spec.ts` as the no-settle login regression test.

What #5055 explicitly left untouched — and what this run addresses — is the second copy of the same anti-pattern, named in the issue body and re-requested afterwards:

`packages/ui/src/backend/injection/useRegisteredComponent.tsx` builds the resolved component inside a `React.useMemo` and **returns it**. Every dependency change produces a brand-new function, so React sees a different element type at that position and tears the subtree down. Two dependencies change routinely *after* first paint:

- `useOverrideUserFeatures()` — `[]` until `POST /api/auth/feature-check` resolves, then the granted list;
- `useOverrideRegistryRevision()` — the provider's `overrides` array, whose identity changes when client registries populate.

Both fire even when the resolution result is unchanged (no override targets this component id), so the remount is pure loss: the resolved component is literally the same one, and the state below it is gone anyway. `PayPage` (11 hook calls around a payment form), the detail sections (`NotesSection`, `AttachmentsSection`, `CustomDataSection`, …), the customer detail tabs and the MFA screens all sit on this hook.

## Scope

- `packages/ui/src/backend/injection/useRegisteredComponent.tsx` — return a stable wrapper that resolves the registry inside its own render.
- `packages/ui/src/backend/__tests__/useRegisteredComponent.identity.test.tsx` — regression coverage for identity stability and for the behaviours that must survive it.

## Non-goals

- `ThemeProvider` — already fixed by #5055; not touched.
- The hook's signature, the `section:*` handle ids, and the override semantics (`replace` / `wrapper` / `props`) — contract surfaces per `BACKWARD_COMPATIBILITY.md`, all preserved.
- Making the hook react to a `registerComponent` call that lands with no accompanying re-render. The registry has no subscription for component entries (only overrides carry a revision through the provider), so a late *component* registration is still picked up on the next render, exactly as before.

## Behaviour that must NOT change

`packages/enterprise/src/modules/security/components/mfa-ui-registry.tsx` passes a **per-provider** component id (`buildMfaProviderComponentHandles(provider.type).setup`, `.list`, `.details`, `.challenge`). Switching MFA provider changes the id, and today that swaps the identity and therefore resets the setup/challenge form. Making identity stable *across id changes* would leak one provider's half-filled form into another. The fix therefore keys the stable identity on `componentId`: same id → same identity forever; different id → a new one, exactly as today. Covered by a test.

## Risks

- The stable wrapper calls `useOverrideUserFeatures()` / `useOverrideRegistryRevision()` in its own render rather than the host's. Both are plain contexts and work under `renderToString`, so the hydration-parity test (`applies provider overrides during the first render`) still holds.
- `fallbackRef.current` is written during render. It is a derived cache, deterministic from the arguments, so a discarded concurrent render simply writes the same value again. No consumer passes an inline component as the fallback (checked across all 13 call sites), so the memo inside the wrapper stays stable.

## Implementation Plan

### Phase 1: Fix

1.1 Extract the resolution into a pure `resolvePlan(componentId, fallback, userFeatures)` returning the original, the wrapped component, the props transforms and the active replacement override.
1.2 Return a wrapper created once per `componentId` that memoizes the plan on `[fallback, overrideRevision, userFeatures]` and renders it, keeping the error boundary, the dev-only props-schema validation and the fallback path intact.

### Phase 2: Regression coverage

2.1 Identity survives the feature grant resolving after first paint — child mount counter stays at 1, typed value survives (fails before the fix: counter 2, value lost).
2.2 Identity survives a late override registration — same assertions (fails before the fix).
2.3 A replacement registered late is still applied — the override mechanism keeps working.
2.4 A different `componentId` still remounts — the MFA per-provider semantics are preserved.

### Phase 3: Validation

3.1 Run the configured validation gate and fix anything it surfaces.
3.2 UI QA with before/after screenshots; PR carries `needs-qa`.

## Progress

- [x] 1.1 Pure `resolvePlan` extracted
- [x] 1.2 Stable per-`componentId` wrapper returned by the hook
- [x] 2.1 Feature-grant identity test (verified red on `develop`'s hook, green with the fix)
- [x] 2.2 Late-override identity test (verified red on `develop`'s hook, green with the fix)
- [x] 2.3 Late replacement still applied
- [x] 2.4 Different `componentId` still remounts
- [x] 1.3 Wrapper-override composition memoized per (wrapper, base) pair, with its own regression test
- [x] 3.1 Validation gate — `build:packages`, `generate`, both i18n checks, `typecheck`, `lint`, `build:app` green; tests green per package for everything this change reaches (13 598 across `ui`/`core`/`enterprise`/`checkout`/`shared`). The whole-repo `turbo run test` sweep failed a different unrelated package on each of three attempts (`telemetry`, `scheduler`, `create-mercato-app`), each passing on its own straight afterwards — local contention, left to CI.
- [x] 3.2 UI QA + screenshots — before/after ephemeral builds with the enterprise security override live: https://github.com/open-mercato/open-mercato/pull/5187#issuecomment-5251429011
- [x] 4.1 Merged current `develop` (2026-08-13), resolved the conflict down to the two changes `develop` lacks, added a sixth test documenting the inline-fallback limit — see "Rebase on `develop`" below
- [x] 4.2 Post-merge gate — `build:packages` ✅, `generate` ✅ (no drift), `build:packages` again ✅, `i18n:check-sync` ✅, `i18n:check-usage` ✅ (advisory only), `typecheck` ✅ 22/22, `lint` ✅ 0 errors, `build:app` ✅. Tests per package for everything this change reaches: `ui` 1867/230 suites · `core` 9583/1232 · `shared` 1854/174 · `enterprise` 478/59. The first `build:app` attempt failed with module-not-found errors out of `packages/core/dist/generated-shims/` — a runner mistake, not a regression: the gate lists `build:packages` twice, before *and* after `generate`, and the second run had been skipped.

## Rebase on `develop` — 2026-08-13

Merging the current `develop` into this branch produced a conflict in the one file this PR changes, and the reason matters more than the conflict: **`develop` now carries the core of this fix already.** `1be52595d` ("fix(ui): refresh mounted component overrides"), landed via #5217, extracted `resolveComponent(...)` and moved resolution inside a stable `Registered` component keyed on `[componentId, fallback]` — the same shape as Phase 1 here, reached independently while this PR waited.

Rather than carry a large diff that mostly restates `develop`, the conflict was resolved by taking `develop`'s file and re-applying only what it does not have:

1. **Wrapper-override composition memoized per (wrapper, base) pair** (`applyWrapper`). `develop` still calls `wrapper(acc)` on every plan recomputation, and a wrapper override returns a fresh component each time — so a wrapped subtree, which is exactly what the enterprise `security` module puts on `section:auth.login.form`, still remounts on every registry bump. The wrapper test is red against `develop` and green here; that was re-verified on this branch by reverting the single call.
2. **Identity held in a ref keyed on `componentId`** instead of `React.useMemo(..., [componentId, fallback])`. `useMemo` is a cache React is permitted to discard, and identity here is a correctness requirement, not an optimisation; keying on `componentId` alone also stops a host that rebuilds its `fallback` inline from swapping the component the hook hands back.

The renames this PR had introduced (`resolvePlan`, `ResolutionPlan`, `emptyPlan`, `createRegisteredComponent`, import reordering) were dropped — they were cosmetic, and dropping them shrinks the diff against `develop` to the two behavioural changes above.

**Honest limit, now covered by a test.** A host that creates its `fallback` inside its own render body *and* resolves an id with no registered component still remounts: the fallback itself is the rendered element type, and only the host can stabilise it. A sixth test asserts that remount and explains why, so the boundary is documented rather than assumed.

## Outcome

The measurable win is not on `/login`, and the QA comment says so plainly: with the security wrapper override arriving after the first render, the resolved component genuinely changes there, so one remount survives in both builds. The change is proven by the unit tests instead — two of them fail against `develop`'s hook. The late-override delivery that causes the remaining `/login` remount is filed separately as #5194.

## Review pass — 2026-08-22

`develop` was merged in again (the branch was 377 commits behind; the merge was clean, and `develop` had not touched `useRegisteredComponent.tsx`, `component-registry.ts` or `ComponentOverrideProvider.tsx` since the 2026-08-13 rebase, so the behavioural change is unaffected by the advance). The code review on 2026-08-14 requested changes on a single Minor finding plus two nits and a test-coverage suggestion. All of them are now addressed:

1. **The `wrapper` override's purity requirement is documented** (the Minor, and the only blocking finding). Memoizing composition per `(wrapper, base)` pair turns an implementation detail into a contract on code written outside this repository: a wrapper is now invoked once per pair and its result is reused for the registry's lifetime, so a wrapper that reads a feature flag, locale, tenant config or the clock *at composition time* would freeze that value — on the server, across requests and tenants. A JSDoc block on the `wrapper` member of `ComponentOverride` (`packages/shared/src/modules/widgets/component-registry.ts`) now states the invocation contract and the resulting MUST, and `apps/docs/docs/framework/widget-injection.md` gains a "`wrapper` overrides must be pure" subsection with a correct/incorrect example.

   The review also suggested a matching sentence on the `packages/core/AGENTS.md` "Use wrapper/props-transform modes when possible" bullet. That was written and then reverted: `yarn agents:check-budget` fails on it. The `packages/core` instruction chain is already 40 155 bytes over the 32 768-byte agent budget, and the checker's rule for an over-budget chain is that it may only shrink — the 140-byte addition took it further over. The docs-site subsection carries the same guidance to the same audience (module authors, including third-party ones) at no instruction-budget cost, and the JSDoc is what an implementer's editor surfaces at the point of use.

2. **The four `as unknown as object` casts in `applyWrapper` are gone** (nit). `ComponentType<TProps>` and the wrapper's function type are both assignable to `object`, so the assertions were doing nothing; `yarn typecheck` passes 22/22 without them, which is the proof the review asked for.

3. **The composition cache's own contract is now asserted** (the test-coverage gap). A seventh test registers a wrapper whose body increments a counter, renders, then re-renders the provider twice with a fresh array holding the same wrapper, and asserts the counter stayed at `1`. Verified red the same way as the others: reverting the single `applyWrapper(wrapper, acc)` call back to `wrapper(acc)` fails it with `Received: 3` (and takes the existing wrapper-identity test down with it, `Received: 2`).

4. **The ref-writes-during-render nit was explicitly not a change request** and is left as is, with the reasoning already in the code comment and the risk note above.

Gate on the merged head: `build:packages` ✅ · `generate` ✅ (no drift) · `build:packages` ✅ · `i18n:check-sync` ✅ · `i18n:check-usage` ✅ · `typecheck` ✅ 22/22 · `agents:check-budget` ✅ · tests for every package this change reaches — `@open-mercato/ui` ✅ 1911/233 suites, `@open-mercato/shared` ✅ 1980 (5 skipped), `@open-mercato/enterprise` ✅ 503/61.
