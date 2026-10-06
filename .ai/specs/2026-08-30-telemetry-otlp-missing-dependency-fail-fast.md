# Fail Fast When an Explicit OTLP Backend Is Unavailable

## 📝 TLDR

Keep the OpenTelemetry SDK packages optional, but reject telemetry bootstrap when an operator explicitly selects a built-in OTLP backend and those packages cannot load. This replaces the misleading console fallback with an actionable configuration failure while preserving the absolute-off, explicit-console, unknown-backend, and registered-custom-provider paths.

This is the runtime-hardening companion to `.ai/specs/2026-08-30-telemetry-docker-topology.md`. A fresh-context cohesion review found that it is independently deployable from Docker topology wiring, so the two behaviors have separate design contracts even when issue #5783 coordinates them into one delivery.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirmation |
|---|----------|-----------------|-----------|--------------|
| Q1 | Should the OTEL packages move to regular dependencies, or remain optional with a fail-fast contract for explicitly selected OTLP backends? | Keep every `@opentelemetry/*` package in `optionalDependencies` and fail only when a built-in OTLP backend was explicitly selected but its provider import cannot load. | `packages/telemetry/AGENTS.md` requires optional placement and default-unloaded hosts; a scoped runtime error preserves that architecture while making contradictory operator configuration truthful. | ok |

No public API, schema, dependency version, or dependency category changes. The chosen failure is limited to an explicit configuration that cannot satisfy its requested backend, so no assumption requires human confirmation.

## 📝 Overview

`packages/telemetry/src/init.ts` resolves built-in `otlp`, `signoz`, and `newrelic` aliases by dynamically importing `provider/otlp-provider.ts`. That file is the package's sole importer of the optional OpenTelemetry SDK. Today `loadOtlpProvider()` catches every dynamic-import failure, logs a warning, and returns `ConsoleProvider`.

Optional dependencies are intentionally installable-but-omittable: package managers normally install them, while `--omit=optional` excludes them and leaves the application responsible for handling their absence ([npm `optionalDependencies` contract](https://docs.npmjs.com/files/package.json/#optionaldependencies)). Open Mercato's correct handling depends on operator intent:

- no backend, `noop`, or unknown backend means absolute off and must remain a silent no-op;
- `console` intentionally uses no OpenTelemetry SDK;
- a registered custom provider owns its own dependency model;
- an explicit built-in OTLP alias requests remote export and cannot be fulfilled without the optional SDK.

The last case must fail truthfully rather than substitute a different provider.

## 📝 Problem Statement

The current fallback converts a hard configuration failure into apparent partial success:

1. An operator builds an image without optional dependencies.
2. The deployment sets `TELEMETRY_BACKEND=otlp`, `signoz`, or `newrelic` and supplies an OTLP endpoint.
3. The provider import fails.
4. Open Mercato logs one warning, initializes `ConsoleProvider`, registers the telemetry runtime/logger bridge, and logs `Telemetry initialized`.
5. No remote traces, metrics, or logs reach the configured backend.

This is worse than a clean startup error because health checks can pass while observability is silently absent. The benchmark and incident workflows that depend on telemetry cannot distinguish a valid OTLP pipeline from local-only console output without inspecting implementation-specific logs.

## 📝 Proposed Solution

Keep the existing provider selection order and dynamic-import boundary, but change the built-in OTLP import failure contract:

- return a real OTLP provider when the import succeeds;
- throw a dedicated internal `Error` when the import fails;
- include the normalized built-in backend name in the message;
- say that OpenTelemetry runtime dependencies are unavailable and explain the three safe remediations: install optional dependencies, choose `console`, or disable telemetry;
- attach the original thrown value through the standard `cause` option without stringifying arbitrary object properties;
- never instantiate or register `ConsoleProvider` on this path.

The helper remains internal to `init.ts` (or an unexported neighboring implementation file). There is no new package export, public error class, environment variable, or configuration shape.

### Preserved provider selection

```text
TELEMETRY_BACKEND unset/blank/noop
  -> no provider, no package hooks, resolve successfully

registered provider with the exact configured name
  -> registered provider wins, unchanged

console
  -> ConsoleProvider, unchanged

otlp/signoz/newrelic
  -> dynamic import succeeds: OtlpProvider
  -> dynamic import fails: actionable bootstrap error

unknown/unregistered name
  -> unsupported warning and disabled telemetry, unchanged
```

### Error safety

The thrown error message is static apart from the already-normalized backend enum. It must not include:

- endpoint URLs;
- `OTEL_EXPORTER_OTLP_HEADERS`;
- environment dumps;
- arbitrary thrown-object serialization;
- module resolution search paths.

`cause` preserves diagnostic context for the host/logger without manually expanding values. Tests assert only safe message fragments and error identity, never credential-like fixtures.

## 📝 Architecture

The change stays inside `@open-mercato/telemetry`'s initialization boundary:

```text
host checks isTelemetryBackendEnabled()
  -> dynamic import @open-mercato/telemetry
     -> initTelemetry()
        -> resolve registered/custom provider first
        -> resolve built-in provider
           -> dynamic import ./provider/otlp-provider
              -> success: start/register OTLP provider
              -> failure: reject host bootstrap with safe cause chain
```

Default-unloaded behavior is preserved because the host never imports this package when telemetry is off. OpenTelemetry imports remain confined to `provider/otlp-provider.ts`. No global registry or logger/runtime bridge is mutated until `provider.start()` succeeds, so a provider-load rejection leaves telemetry uninitialized and re-initializable after configuration is corrected.

For deterministic testing, the internal loader may accept an optional importer function or use a module mock, provided the injection seam is not exported from the package root. Production calls use the real dynamic import.

## 📝 Data Model

Not applicable. No persistent state, entity, migration, cache, tenant scope, or data flow changes.

## 📝 API Contracts

Not applicable. No HTTP route, CLI command, public TypeScript export, event, queue payload, DI key, or generated artifact changes.

## 📝 UI/UX

Not applicable. This is an operator-visible startup failure, documented in the companion telemetry deployment page; it adds no application UI or translatable end-user string.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Required behavior | Verification |
|----------|-------------------|--------------|
| Backend unset, blank, or `noop` | Resolve without importing provider code or registering hooks. | Existing default-unloaded and init tests. |
| Backend `console` | Start `ConsoleProvider` without importing OpenTelemetry packages. | Existing console provider test. |
| Backend is an unknown unregistered string | Keep the current unsupported warning and disabled result. | Existing env/registry test. |
| Exact custom provider is registered | Custom provider starts before built-in resolution and is unaffected even if its name resembles a future backend. | Existing custom-provider env-load-order test. |
| Built-in OTLP alias and provider import succeeds | Start `OtlpProvider`; active provider/runtime/logger bridge register once. | Existing in-memory OTLP integration plus focused init assertion. |
| Built-in OTLP alias and provider import fails | Reject with safe actionable error and original `cause`; no console provider, active provider, logger extension, or runtime bridge. | New deterministic loader-failure unit test. |
| Initialization is retried after failure | A corrected configuration can call `initTelemetry()` again because `initialized` was never set. | New retry regression test. |
| Provider module loads but `provider.start()` fails | Preserve current rejection and re-initializable state; do not rewrite it as a missing-dependency error. | Existing initialization ordering test or focused assertion. |

## 📝 Migration & Backward Compatibility

No protected contract from `BACKWARD_COMPATIBILITY.md` changes. The internal helper is not exported, all public function signatures/import paths remain stable, and no route/schema/event/DI/ACL/notification/CLI/generated surface changes.

Default behavior remains byte-for-byte equivalent for telemetry-off deployments. Explicit console, unknown, and custom-provider behavior also remains unchanged.

The sole intentional behavior correction affects a contradictory opt-in configuration: a built-in remote backend is selected while its runtime packages are unavailable. That configuration currently cannot perform its requested export. It now fails startup with remediation instead of silently switching providers. Operators migrate by rebuilding with optional dependencies included, selecting `TELEMETRY_BACKEND=console`, or unsetting/disabling telemetry.

Rollback restores the catch-and-console-fallback implementation. There is no stored state to migrate or undo.

## 📝 Testing Strategy

- Preserve existing tests for the off path, explicit console provider, unknown backend, registered custom provider, OTLP integration, and initialization idempotency.
- Add an internal importer seam or module mock that forces the dynamic import to reject with a known `Error`.
- Assert `initTelemetry()` rejects with a message naming the selected built-in backend and safe remediation.
- Assert `error.cause` is the original error object.
- Assert no active provider, console provider, logger extension, or shared runtime bridge was installed.
- Correct the importer/configuration and assert a subsequent call can initialize successfully.
- Run `yarn workspace @open-mercato/telemetry test`, `yarn workspace @open-mercato/telemetry build`, and `yarn typecheck` within the selected validation runner.

No network, database, Docker daemon, or browser is required.

## 📝 Risks & Impact Review

### Misconfigured deployments stop instead of degrading

- **Scenario**: A custom image intentionally omits optional packages but leaves a built-in OTLP backend selected; after upgrade, its host process exits during bootstrap.
- **Severity**: Medium.
- **Affected area**: Web, worker, scheduler, or CLI hosts sharing the explicit telemetry configuration.
- **Mitigation**: Limit failure to built-in OTLP aliases, provide exact remediation, document it beside deployment steps, and preserve off/console/custom paths with regression tests.
- **Residual risk**: The deployment remains unavailable until corrected; accepted because remote telemetry was explicitly required and console substitution is a false success.

### Import failure is misclassified

- **Scenario**: The provider module exists but throws for an internal code defect, and the error message describes runtime dependencies as unavailable.
- **Severity**: Medium.
- **Affected area**: Telemetry-enabled startup and diagnostics.
- **Mitigation**: Preserve the original `cause`, keep the message broad enough to cover unavailable/unusable runtime packages, and let package tests exercise the real provider import path.
- **Residual risk**: The top-level remediation may be incomplete for a provider code defect, but the cause chain retains the concrete failure for debugging.

### Error content leaks configuration

- **Scenario**: A module-loader error or arbitrary thrown value contains a path or configuration value and is manually interpolated into the public message.
- **Severity**: Medium.
- **Affected area**: Startup logs.
- **Mitigation**: Use a static top-level message, attach the original value only as standard `cause`, never serialize arbitrary properties, and test with a credential-like cause that the message omits it.
- **Residual risk**: A host that logs full error causes may expose module paths from the runtime; no new endpoint/header values are added by this change.

### Retry leaves partial global state

- **Scenario**: A failed initialization mutates a provider/logger/runtime global and a retry double-registers or observes stale state.
- **Severity**: Low.
- **Affected area**: Process-local telemetry registry.
- **Mitigation**: Keep the failure before `provider.start()`, `setActiveProvider`, logger extension, runtime registration, and `initialized=true`; assert clean retry behavior.
- **Residual risk**: None beyond pre-existing provider module evaluation side effects, which the import-only provider file does not register globally before construction.

## 📋 Phasing

### Phase 1 — Internal fail-fast contract

Replace the built-in OTLP console fallback with the safe actionable error while preserving provider selection and optional import boundaries.

### Phase 2 — Regression and operator coverage

Pin every provider-selection branch and retry invariant in unit tests, then link the failure/remediation from the Docker telemetry documentation delivered by the companion topology spec.

## 📋 Implementation Plan

### Phase 1 — Internal fail-fast contract

1. Refactor the internal OTLP provider loader in `packages/telemetry/src/init.ts` so a dynamic-import failure throws the documented safe error with `cause` instead of returning `ConsoleProvider`.
2. Keep built-in provider resolution, custom-provider precedence, and state mutation ordering unchanged.
3. Build the telemetry package to verify the internal error/cause shape against the repository's TypeScript target.

### Phase 2 — Regression and operator coverage

4. Add focused unit coverage for real OTLP success, forced importer failure, safe message/cause, no console/runtime fallback, and successful retry after correction.
5. Run the telemetry unit suite and typecheck.
6. Ensure the companion Docker telemetry documentation explains the error and the install/console/off remediation paths.
7. Update this spec's changelog with implementation and validation evidence; retain it in the pending/root specs directory until merged and deployed.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/telemetry/src/init.ts` | Modify | Replace false-success console fallback with an internal actionable error. |
| `packages/telemetry/src/__tests__/telemetry.test.ts` or a focused init test | Modify/Add | Pin provider-selection, failure, cause, clean state, and retry behavior. |
| `apps/docs/docs/framework/runtime/telemetry.mdx` | Coordinate | Document remediation through the companion topology implementation. |
| `.ai/specs/2026-08-30-telemetry-otlp-missing-dependency-fail-fast.md` | Add/Update | Source design and implementation evidence. |

## Final Compliance Report — 2026-08-30

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/telemetry/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| Root `AGENTS.md` | Preserve behavior unless the issue/spec explicitly requests a change. | Compliant | Issue #5783 explicitly requests loud failure when optional OTLP packages are absent; all other provider paths remain unchanged. |
| Root `AGENTS.md` | Ask before adding production dependencies. | Compliant | No dependency is added, moved, or re-versioned. |
| `.ai/specs/AGENTS.md` | Significant behavior changes require an implementation-accurate spec and tests. | Compliant | The affected branch, state invariants, failure modes, rollback, and tests are explicit. |
| `packages/telemetry/AGENTS.md` | Host integration remains default-unloaded and unset/noop is absolute off. | Compliant | The host/off path is untouched and regression-tested. |
| `packages/telemetry/AGENTS.md` | OpenTelemetry packages stay optional and may only be imported by `provider/otlp-provider.ts`. | Compliant | Dependency placement and the dynamic import boundary remain unchanged. |
| `packages/telemetry/AGENTS.md` | Never emit credentials, PII, SQL parameters, request bodies, or arbitrary thrown-object properties. | Compliant | The new top-level error is static and the original value is attached only as `cause`. |
| `BACKWARD_COMPATIBILITY.md` | Protected types, signatures, import paths, and other contract surfaces may not break. | Compliant | The loader/error remains internal and no protected surface changes. |
| Root data/API/UI rules | Tenant scoping, validation, encryption, mutation guards, design system, and i18n. | N/A | No data, API, mutation, or application UI is involved. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Both are not applicable. |
| API contracts match UI/UX section | Pass | All are not applicable; operator failure is startup-only. |
| Risks cover all state changes | Pass | Clean initialization state and retry are explicit. |
| Commands defined for all mutations | Pass | No business mutation exists. |
| Cache strategy covers all read APIs | Pass | No cache or read API exists. |
| Compatibility matches implementation plan | Pass | Only an internal false-success branch changes; all protected paths are pinned. |
| Tests map to every behavior branch | Pass | Off, console, unknown, custom, OTLP success, OTLP failure, and retry are covered. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: Approved — ready for implementation.**

## Changelog

### 2026-08-30

- Split missing-optional-dependency runtime hardening from the Docker topology spec after a fresh-context cohesion review.
- Kept OTEL packages optional and specified a safe, actionable failure limited to explicit built-in OTLP aliases.
- Added clean-state, retry, secrets-safety, compatibility, and validation requirements.

### Review — 2026-08-30

- **Reviewer**: Agent; a fresh-context review passed this as one cohesive runtime-hardening capability after it was split from Docker topology work.
- **Security**: Passed — the error is static, credentials are excluded, and arbitrary causes are not manually serialized.
- **Performance**: Passed — the off path and dynamic import boundary are unchanged.
- **Cache**: Passed — no cache surface is involved.
- **Commands**: Passed — no business command or mutation is involved.
- **Risks**: Passed — startup availability, misclassification, error leakage, and retry state are covered.
- **Verdict**: Approved.

### Implementation — 2026-08-31

- Implemented in PR #5799 on `feat/telemetry-docker-topology`; the runtime hardening, legacy CLI migration, review, and run-ledger changes are complete at `b403e61f4c`.
- Replaced the selected-OTLP console fallback with an internal actionable error that retains the original import failure as `cause`, leaves initialization state clean, and permits retry after correction while keeping OpenTelemetry packages optional.
- Marked only that intentional dependency failure for propagation through the reusable Next.js helper; unrelated provider initialization failures remain best effort.
- Terminated the shipped app host at its instrumentation boundary with exit code 1 and a sanitized top-level stderr message, mirrored the behavior into the create-app template and `mercato telemetry init` output, and added regression coverage that proves the nested cause is not printed.
- Validation evidence: the telemetry suite passes 97/97 tests, the app host-boundary test passes, the CLI telemetry-init suite passes 16/16, telemetry and CLI package typechecks pass, and the full repository `yarn typecheck` and `yarn lint` gates pass (with 10 pre-existing warnings only).
