# Process DI root with isolated caller scopes

## TLDR
The process DI root for #8989 landed in [#9628](https://github.com/open-mercato/open-mercato/pull/9628) with the implementation from [#9837](https://github.com/open-mercato/open-mercato/pull/9837). It is available behind `OM_PROCESS_CONTAINER_ROOT=on` and defaults to `off`. Each `createRequestContainer()` call keeps its own EntityManager and mutation boundary. The remaining rollout decision is whether to enable the root by default.

## Overview and problem statement
The legacy builder repeats module registrars, core bootstrap, subscriber discovery and query-index subscription setup. Its opt-in bootstrap cache can replay objects capturing the first caller's container or EntityManager. #9717 demonstrated that sharing the EntityManager causes unrelated dirty entities to flush, and that factories closing over a parent container cannot see caller-local auth. Reducing setup work must preserve both contracts.

Related work includes execution-local event selection (#2963/#9628) and the shared-unit-of-work findings in #2977/#9717. #8990 owns request memos and deliberate unit-of-work consolidation. #8993 owns general performance budgets. PR #9388 supplies a separate request-cost benchmark.

## Resolved direction
1. Keep one process registration root per registry generation, not one shared EntityManager. HTTP request and job contexts may contain multiple isolated caller scopes. Count root initialization, registrar execution, and scope creation separately; never label scope reuse as one unit of work.
2. Preserve `register(container)` and existing DI import paths. Add explicit audited process-registration opt-in and a helper whose scoped factories receive the actual resolving container. Do not infer safety by executing registrars or proxying a mutable "latest container".
3. Use the complete legacy builder when an enabled module or app registrar has not opted in, any composed module DI override is present, a module or app supplies a custom event bus, or required process infrastructure sharing is disabled. Fallback preserves legacy ordering and setup side effects. `getProcessContainerStats()` reports the fallback reason.
4. Keep #8990–#8994 independent. This change includes only the isolation, count, and integration checks necessary to validate its lifetime split.
5. Keep `OM_PROCESS_CONTAINER_ROOT` off by default. Use the rollout acceptance criteria below for a separate maintainer decision on changing the default. Preserve the explicit off switch.

## Shipped implementation and architecture

### Registration contracts
Add `defineProcessDiRegistrar` to mark the same registrar function with a globally stable symbol; its parameter and result conventions are unchanged. Add `asScopedService(factory)` to supply an Awilix SCOPED resolver whose factory receives the resolving caller container. It must not capture the root. No new magic DI key is required. Immutable configuration or process clients may be values; mutable/EM/auth/container-bound services must be scoped factories.

An opted-in registrar performs registration only: no eager request resolution, database query, subscription, timer, or request-local side effect. Root initialization failures do not publish partial roots. Unmarked registrars run through the original builder, including asynchronous app hooks and override ordering. The fallback path must not accidentally replay cached request services.

The legacy builder retains its registration order and applies module overrides before attaching encryption to the caller EntityManager. The optimized path requires an empty set of composed module DI overrides. A module- or app-provided event bus also selects the complete legacy path, preserving its subscriber order. [Fallback implementation](https://github.com/open-mercato/open-mercato/blob/8ddb50257500d64dd0055e268c4f3ace0ed19e5d/packages/shared/src/lib/di/container.ts#L374-L393).

### Lifetime inventory
| Lifetime | Services/state |
| --- | --- |
| Process | ORM connection pool; cache; KMS; rate limiter; producer infrastructure |
| Root generation | Immutable registration/configuration definitions; event listener definitions |
| Caller scope | EntityManager and fresh event manager; Basic/Hybrid query engines; data engine; auth and local registrations; tenant encryption service; search/indexer/presenter/token services; factories retaining a container |
| Execution context | HTTP/job identity and event-dispatch context; counters; optional references to caller scopes, never a mutable global current container |

Search may retain immutable configuration and stateless drivers only after audit. It must not retain the first scope's SQL accessor, encryption service, presenter, or source builder. KMS health is evaluated at operation time; initialization during an outage must not permanently disable encryption. Attach the encryption subscriber after final per-scope overrides to the actual forked EM.

### Event ownership
Build listener/subscriber definitions once per generation and dispatch through a facade bound to the emitting scope. A facade captures its own scope permanently, so using two sibling services in interleaved work does not select whichever was built last. Persistent dispatch preserves its explicit job resolver. Calls without a scope enter an isolated scope at the async emission boundary; synchronous `ctx.resolve` never waits for initialization and never resolves a process-root EM.

Existing ambient `createModuleEvents().emit()` retains #9628's execution-local selection contract; this work does not infer which arbitrary object owns a bare function call. Add an explicit `runWithRequestScopeContainer(container, fn)` boundary for operations that require a specific caller after a sibling is created, preserving it through awaits. Independent parallel/background tasks enter separate execution scopes. Regression coverage exercises both the ambient contract and A-owned execution wrapped explicitly after B was created, proving that subscribers resolve A. Bound bus facades remain exact without ambient inference.

Replace search-delete closures with event-context resolution of the indexer. Register query-index bridges once per generation, removing per-container polling timers and custom-field entity discovery. Preserve filtering and read-your-writes behavior; do not change persistent delivery, audience scoping, or event IDs. Registry refreshes replace deleted subscribers, including the zero-subscriber case. New custom-field definitions must still obtain bridge coverage without a restart.

### Initialization and invalidation
Coalesce concurrent root initialization with a generation-owned promise. A rejection clears only that generation's promise and is retryable. Registrar/app-registrar/override/module registry replacement invalidates the generation. A slow obsolete initializer cannot replace the current root. Existing scopes retain their generation; new calls use the new one. Process clients (cache/KMS/transport pools) remain process-owned through their existing shutdown owners, never allocated again solely because of a registry generation. Retiring a generation prevents new scopes from being acquired from that root. Existing caller and nested scopes keep the generation alive until their owners dispose them. The retired root then disposes generation-owned singletons exactly once. Failed initialization disposes temporary resources and preserves the initialization error. [Generation lifetime implementation](https://github.com/open-mercato/open-mercato/blob/8ddb50257500d64dd0055e268c4f3ace0ed19e5d/packages/shared/src/lib/di/container.ts#L318-L365).

Initialize after complete app registration, in Node instrumentation outside production build, and in the equivalent standalone path. Retain lazy initialization for tests, CLI callers and workers after `bootstrapFromAppRoot` completes. Do not import the full application graph in edge runtime. Avoid initialization from `registerDiRegistrars` itself because other registries are not complete then.

### Caller and background compatibility
Keep fresh EM forks with clear identity maps and fresh event managers per legacy helper call. Services resolved from a caller retain that caller's registration context after another caller is created. Explicitly independent parallel/background tasks enter independent execution contexts. App and standalone API dispatchers keep authorization and handler scopes through response-body close, error or cancellation. A HEAD response starts cancellation of its suppressed body and returns without waiting for cancellation to settle. Scope ownership persists until cancellation settles. App-shell lookups own their scopes until the lookup finishes. Worker job boundaries own and dispose their caller and nested scopes. Other owners dispose every acquired caller and nested scope, including background work. [Runtime ownership contract](https://github.com/open-mercato/open-mercato/blob/8ddb50257500d64dd0055e268c4f3ace0ed19e5d/apps/docs/docs/framework/runtime/request-lifecycle.mdx#L18-L45).

## Data models, API contracts, and UI/UX
No tables, migrations, routes, response bodies, event IDs, ACL IDs, or UI are added. The registrar opt-in, scoped-service helper, and `runWithRequestScopeContainer` are additive exported APIs. Existing generated registrar arrays remain unchanged. Instrumentation/dispatcher/template changes are mirrored; no generated file is hand edited. Default activation and performance measurements are documented separately from implementation availability.

## Migration and backward compatibility
Unknown third-party and app registrars keep the legacy path, with diagnostics explaining why the root optimization is unavailable. Opting in requires registration-only behavior and scoped factories for request dependencies. Existing registrar and container APIs stay supported. The root does not replay request-owned bootstrap cache entries or adopt #9717’s shared EntityManager. Set `OM_PROCESS_CONTAINER_ROOT=off` to restore the legacy builder.

## Research and alternatives
Awilix scopes cache SCOPED instances separately, but inherit value registrations and root singletons. Its disposal only handles the container's cached services, not all child scopes. These semantics require explicit lifetime registration, not merely `createScope()` around existing registrations. Source: https://github.com/jeffijoe/awilix (createScope, lifetimes, disposal).

Rejected: one EM for every legacy caller (observed write corruption); dynamic latest-container proxies (interleaving ambiguity); automatic registrar probing (side effects and eager captures); only caching ORM/registrar inputs (does not remove the measured setup cost); replaying harvested bootstrap instances (retains request state).

### Registration side effects and process capacity

`registerCallerSetup(root, setup)` installs per-caller subscribers or decorators after caller services exist. `registerProcessEventSetup(root, setup)` installs generation-owned bus listeners. `registerProcessActivation(root, activate)` defers synchronous global adapter/enricher publication until a successful, current generation is ready. These callbacks must be audited synchronous setters; arbitrary external side effects cannot be rolled back transactionally. Legacy registrars retain their immediate publication order.

The agent workspace manager owns process-wide concurrency capacity, so its active leases and waiters survive generation changes. Its first-resolved process configuration remains fixed until process restart. Existing module-import side effects and setter-only global registries retain their existing disabled-module behavior; this change removes captured caller state without introducing a general global-registry unregister protocol.

## Edge cases and risks
| Failure | Severity | Mitigation and residual risk |
| --- | --- | --- |
| Root retains auth/EM/encryption/search context | Critical | No request dependencies on root; real interleaved scope tests and tenant API fixtures; audited opt-in, legacy fallback |
| Caller flush persists another caller's changes | Critical | Separate EM per helper call; managed-entity regression and single-field CRM edit |
| Unknown registrar changes override order | High | Whole-builder compatibility fallback, not mixed partial replay |
| Duplicate/stale subscribers on repeated requests or HMR | High | Generation ownership, replacement including empty registries, listener-count tests, dynamic custom-field coverage |
| Cold initialization race or failed startup | High | Shared generation promise, rejection eviction, stale-publication test |
| Scope disposed before streaming/background work completes | High | Preserve caller ownership; no eager response-finally disposal; explicit task scopes |
| KMS outage pins encryption off | Critical | Shared KMS health remains dynamic; subscriber attached by static config and tested through recovery |
| Default rollout without workload proof | High | Keep the flag off by default until the rollout decision. Measure roots, registrations and callers separately |

## Completed implementation and rollout decision

| Phase | Shipped in [#9628](https://github.com/open-mercato/open-mercato/pull/9628) |
| --- | --- |
| 1 · Lifecycle primitives | Audited registrar and scoped-factory helpers, generation initialization and retirement, isolated caller scopes and legacy fallback |
| 2 · Registration and events | Process bootstrap, caller-owned encryption and search dependencies, caller-bound event resolution, generation-owned query-index setup, first-party registrar and template updates |
| 3 · Entry points and qualification | Node and standalone startup, lazy CLI and worker support, app and API ownership boundaries, and enabled/disabled runtime coverage |

The [recorded workload and isolation results](https://github.com/open-mercato/open-mercato/blob/8ddb50257500d64dd0055e268c4f3ace0ed19e5d/.ai/runs/2026-11-18-process-root-request-scopes.md#L73-L83) report 13 of 13 production-runtime scenarios passing per mode, with 120 distinct caller EntityManagers in both modes. The enabled workload executed 63 registrars for the cold generation and none across 100 warm callers. The disabled workload executed 7,560 registrars across the same 120 callers. These counts measure setup work with warm ORM and imports. The [final lifecycle checks](https://github.com/open-mercato/open-mercato/blob/8ddb50257500d64dd0055e268c4f3ace0ed19e5d/.ai/runs/2026-11-18-process-root-request-scopes.md#L138-L144) also cover response completion and cancellation in both modes.

**Default-on remains a separate rollout decision.** Before proposing a default change, record the acceptance results below on the proposed rollout revision. Compare both flag modes in representative app and standalone workloads, including fallback configurations, and check that caller isolation, scope disposal and rollback hold. A maintainer must review that evidence and explicitly decide whether to change the default. The opt-in implementation is already available.

## Acceptance matrix
- Cold concurrent initialization: 20 concurrent callers, one root initialization, each opted-in registrar invoked once per generation, 20 distinct caller EMs and scoped service sets.
- Warm requests: ten sequential and ten concurrent company lookups/lists; no root rebuild, registrar replay, subscriber growth, or per-caller query-index setup/discovery query. Scope and EM counters increase per helper invocation and are reported honestly.
- Isolation: two tenants plus two organizations within one tenant; interleave auth-bearing scopes and company create/read/update, preserve unrelated fields on a single-field edit, and deny cross-scope reads. Re-run cart/promotion evaluations enabled and disabled with identical outcomes.
- Background: two concurrent worker jobs, nested emit and explicit caller-owned emit after a sibling creation; subscriber resolve uses its bound caller and listeners do not multiply.
- Compatibility: one unaudited module or app registrar forces the full legacy path; registration ordering, eager reads, custom event bus and app overrides match flag-off behavior.
- Generations: invalidate twice during cold initialization, reject one initialization, replace subscribers with zero, and cancel a response stream; no stale publication, duplicate listeners or lost caller-owned references.
- Rollout: relevant unit/integration suites and configured validation pass (or documented baseline-only failures independently verified), no functional regression on enabled/disabled workloads, and warm setup counters meet the above invariants. Missing live isolation or workload evidence blocks default-on. Report latency alongside the setup and isolation measurements.

## Final compliance report
- Contracts: additive helpers; legacy registrar and helper semantics retained; no public route/data changes.
- Tenant/data safety: scoped services, separate identity maps, explicit event resolution, isolation tests required.
- Scope: DI lifetime optimization only; later artifact-roadmap capabilities remain separate.
- Verification: the shipped unit and enabled/disabled integration coverage supports opt-in use. The default change requires the separate rollout decision above.
- Rollback: feature off returns to compatible legacy construction.

## Changelog
- 2026-11-18: Initial design from #8989 and the concrete isolation regressions found in #9717; separates registration reuse from unit-of-work sharing.
- 2026-11-23 recorded the opt-in implementation shipped in #9628, the full legacy fallback and scope-disposal rules, and the outstanding default-on decision.
