# Migrate PR #4298 to develop

## Goal

Rebase the app-level DI override diagnostics from PR #4298 onto the current `develop` branch, apply all requested review changes, and replace the obsolete `main`-targeting PR with a validated PR that can be reviewed and merged normally.

## Scope

- Preserve the current explicit `registerAppDiRegistrar` path on `develop`.
- Port the fallback `@/di` diagnostics so a genuinely absent optional hook stays quiet at warning level while real module-load and `register()` failures are visible.
- Match the optional hook specifier exactly so nested alias failures such as `@/di/helpers` are not misclassified as an absent hook.
- Emit fallback load and registration warnings at most once per process, with separate guards for the two failure classes.
- Add focused regression coverage for successful registration, async registration, genuine absence, nested load failures, and repeated load/register failures.
- Open the replacement PR against `develop`; close PR #4298 only after the replacement is established and cross-linked.

## Non-goals

- Do not redesign the explicit app bootstrap registration mechanism.
- Do not change DI registration keys, exported function signatures, or module override precedence.
- Do not modify the companion optimistic-locking fix tracked separately in PR #4274.
- Do not change unrelated bootstrap-cache or request-container behavior.

## Implementation Plan

### Phase 1: Migrate the contribution

1. Port PR #4298's app-level DI fallback diagnostics and tests onto current `develop`, resolving drift around the explicit app registrar without regressing it.

### Phase 2: Apply requested review changes

1. Add exact optional-hook absence detection plus independent process-scoped load/register warning guards, and extend regression tests to cover nested alias misses and repeated failures.

### Phase 3: Verify and supersede

1. Run targeted shared-package checks and the configured full validation gate, complete the authoritative review/autofix pass, finalize the replacement PR, and close PR #4298 as superseded.

## Risks

- Module-not-found messages differ between CommonJS, ESM, Jest, and Next.js; tests cover the supported quoted `Cannot find module/package '@/di'` forms and explicitly reject nested specifiers.
- Process-scoped guards must survive duplicate module loading without leaking into tests; global state is reset only through the existing test-only cache-reset helper.
- The original PR targets `main` and conflicts with `develop`; the migration preserves current `develop` behavior instead of replaying the old file wholesale.
- GitHub's authoritative `prepare`, `test`, and `lint` jobs passed the replacement head. A supplementary local full-suite run reproduced only the unrelated `develop` sales-test regression tracked by #4824; the focused shared suites and all other local gates passed.
- The replacement preserves the original commit authorship and explicit PR-body credit. GitHub currently reports its contributor CLA check as pending, so branch protection will continue to hold the merge until that external check resolves.

## Progress

PR: #4827

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Migrate the contribution

- [x] 1.1 Port PR #4298's app-level DI fallback diagnostics and tests onto current `develop`, resolving drift around the explicit app registrar without regressing it. — 65ab761aa

### Phase 2: Apply requested review changes

- [x] 2.1 Add exact optional-hook absence detection plus independent process-scoped load/register warning guards, and extend regression tests to cover nested alias misses and repeated failures. — 596f89ec1

### Phase 3: Verify and supersede

- [x] 3.1 Run targeted shared-package checks and the configured full validation gate, complete the authoritative review/autofix pass, finalize the replacement PR, and close PR #4298 as superseded. — 220fafbfe
