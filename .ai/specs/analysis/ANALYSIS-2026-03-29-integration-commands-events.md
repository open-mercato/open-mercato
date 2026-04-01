# Pre-Implementation Analysis: 2026-03-29 Integration Commands & Events

## Executive Summary

The spec is directionally strong, but it is not implementation-ready. The biggest blockers are unresolved event-registration mechanics, under-specified project/webhook correlation, and conflicting product design inside the document itself.

Recommendation: update the spec before implementation. Without those changes, the likely failure modes are silent event non-delivery, duplicated external writes, wrong-project execution, and a provider implementation that cannot actually infer the declared Google Sheets events.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Function signatures | The spec says "no existing functions modified", but project-aware gateway execution depends on project-aware credentials/state/health resolution and `listProjects()`, which do not exist in current services. | Warning | Explicitly state this spec is blocked on `2026-03-29-integration-projects`, or define a temporary single-project fallback contract. |
| 2 | Generated file contracts | The spec introduces `commands.generated.ts` but does not define where bootstrap registers it or how standalone templates consume it. | Warning | Add explicit generated-file bootstrap wiring and template-update requirements. |
| 3 | Event IDs | The document contains conflicting Google Sheets event IDs (`sync_google_sheets.import.*` vs `sync_google_sheets_products.import.*`). | Critical | Normalize the event IDs in one place and add a compatibility bridge only if both were already published. |

### Missing BC Section

The spec has a Migration & Backward Compatibility section, but it is incomplete: it does not explain rollout ordering relative to the draft `integration-projects` dependency, and it understates generated-file/bootstrap contract changes.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Integration Test Coverage | Required coverage is implied in phase steps but not defined as a concrete API/UI test matrix. | Add an explicit coverage section with API paths, UI paths, webhook scenarios, and cross-process/SSE cases. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Proposed Solution | The spec still contains the old `importMode` toggle, but later says the Google Workspace redesign removes it. | Delete the toggle design or explicitly mark it rejected. |
| Events & SSE | It does not explain how integration events become declared events under the current `events.ts` / `createModuleEvents()` contract. | Define the exact registration model and generator output. |
| API Contracts | `isReady()` is underspecified: required fields, health-check behavior, bundle fallthrough, and module dependency checks are unclear. | Define readiness semantics precisely and keep network checks optional/explicit. |
| Google Sheets Provider Extension | Row-added/updated/deleted semantics are declared, but the provider-side detection model is not described. | Specify the reconciliation/state model needed to derive row-level events from Google notifications. |
| Risks & Impact Review | The risk section assumes commands are mostly read-only, but the spec includes write commands like `write-row`. | Add duplicate-write, timeout, retry, and audit-redaction risks. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| Events MUST be declared in `events.ts` using `createModuleEvents()` | `integrationEvents` registration design | Either move emitted integration events into provider `events.ts`, or clearly extend the platform contract and generator/bootstrap flow to register them equivalently. |
| Shared package should export narrow interfaces, not `unknown`-heavy contracts | `IntegrationCommandHandler`, `resolve<T = unknown>`, `execute<TOutput = unknown>` | Tighten exported types or define typed helper wrappers around the raw handler interface. |
| Specs must stay implementation-accurate | Google Workspace sections | Remove the obsolete `importMode` path and unify the connector/import-child design. |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Event registration model does not match the current platform event contract | Integration events may never appear in `getDeclaredEvents()`, `isBroadcastEvent()`, or SSE, even if provider code emits them. | Define a concrete registration path that feeds the existing event registry before implementation. |
| Project correlation for commands/webhooks is under-specified | Commands or webhook events may run with the wrong credentials/project, which is a tenant data integrity issue. | Make this spec explicitly dependent on the project model rollout and define mandatory project resolution for every entry point. |
| Google Sheets webhook events are declared at row granularity without a derivation design | Provider implementation may emit wrong or noisy events because Google notifications do not natively give row-level semantic deltas. | Specify the provider state, polling/reconciliation, idempotency, and conflict rules. |
| Write commands lack idempotency/retry semantics | Network retries, browser resubmits, or queued reprocessing can duplicate external writes (for example `write-row`). | Add command-side idempotency keys, retry policy, timeout rules, and audit expectations. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| SSE payload limit is 4096 bytes and the client deduplicates within 500ms | Rich integration events may be truncated, skipped, or merged away, causing broken progress UI. | Add payload-size guidance, event-shape limits, and explicit "summary-only" event payload rules. |
| Schema serialization is not specified | Capabilities/execute APIs may produce unstable or broken JSON schema output, especially for shared/ref-cached Zod schemas. | Pick one converter, define supported schema features, and add tests for shared schema reuse. |
| `isReady()` semantics are ambiguous | UI badges and API prechecks may disagree, creating false "ready" or false "not ready" states. | Separate "configured", "enabled", and "healthy" explicitly. |
| New generated registry may be HMR-fragile | Handlers may duplicate or disappear in dev if the registry is purely module-local. | Use `globalThis`-backed registries or duplicate-safe bootstrap patterns. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Marketplace/API counts may create extra per-integration work | Listing integrations could regress if readiness/count resolution becomes dynamic. | Keep counts static from definitions and avoid per-row network checks. |
| Execute ACL vs credential ACL is not clarified | Users may be able to execute commands without clear policy on secret access. | Add a small authorization section defining whether execute requires `integrations.manage`, `integrations.credentials.manage`, or both. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- Event declaration contract: the spec must explain exactly how `integrationEvents` become first-class declared events in the current platform.
- Project dependency model: the spec must define whether it is blocked by `integration-projects` or provide a safe single-project fallback.
- Google Sheets event derivation: row-level webhook events are not implementable from the current description alone.
- Command write semantics: idempotency, retries, timeouts, and logging/redaction rules are missing.
- Spec consistency: remove the obsolete `importMode` flow and unify Google event IDs.

### Important Gaps (Should Address)

- Explicit Integration Test Coverage section for API, UI, SSE, worker, and webhook paths.
- Bootstrap/generated-file wiring for `commands.generated.ts`.
- Readiness semantics and response fields.
- Duplicate-handler registration behavior and dev/HMR safety.
- Clear guidance on what parts of command results/events may be logged or broadcast.

### Nice-to-Have Gaps

- Per-command authorization model beyond global integration features.
- Capability caching strategy.
- Provider guidance for schema examples/default input generation in the "Try It" dialog.

## Remediation Plan

### Before Implementation (Must Do)

1. Resolve the event contract: decide whether integration events live in provider `events.ts` or via a generator-backed equivalent registration path.
2. Mark the spec as dependent on `2026-03-29-integration-projects` or define a temporary single-project fallback with explicit limitations.
3. Remove the obsolete Google `importMode` design and normalize all Google event IDs.
4. Add a provider design for Google webhook-to-row-event derivation and project/account correlation.
5. Add command execution rules for idempotency, retries, timeouts, and log redaction.

### During Implementation (Add to Spec)

1. Add a generated-file/bootstrap subsection covering `commands.generated.ts` and standalone template updates.
2. Add a readiness contract subsection covering `enabled`, `configured`, `healthy`, and `requiredModules`.
3. Add SSE payload constraints and event-shape rules.
4. Add explicit integration test scenarios for execute, capabilities, webhook ingestion, SSE delivery, and cross-process workers.

### Post-Implementation (Follow Up)

1. Add lessons if registry/bootstrap or SSE edge cases appear during rollout.
2. Validate provider examples against the final contracts and update related specs accordingly.

## Recommendation

Needs spec updates first. The current draft is close on architecture, but the unresolved event/project/webhook details are large enough that implementation would otherwise invent contract behavior on the fly.
