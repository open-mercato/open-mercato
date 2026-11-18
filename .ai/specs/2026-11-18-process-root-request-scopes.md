# Process DI root with isolated caller scopes

## TLDR
Issue #8989 moves repeatable registration and process infrastructure setup off the request path. One generation-owned root supplies cheap caller scopes; each legacy `createRequestContainer()` call retains its own EntityManager, mutation boundary, registrations, and services. The request context groups work without silently merging its units of work.

## Overview and problem statement
The current builder repeats module registrars, core bootstrap, subscriber discovery and query-index subscription setup. Its opt-in bootstrap cache replays objects capturing the first caller's container or EntityManager. #9717 demonstrated that sharing the EntityManager causes unrelated dirty entities to flush, and that factories closing over a parent container cannot see caller-local auth. Reducing setup work must preserve both contracts.

Related work: #2963/#9628 supplies execution-local event selection; #2977/#9717 demonstrates unsafe shared units of work; #8990 owns request memos and any deliberate unit-of-work consolidation; #8993 owns general performance budgets. PR #9388 supplies a separate request-cost benchmark. None is silently subsumed here.

## Resolved direction
1. Keep one process registration root per registry generation, not one shared EntityManager. HTTP request and job contexts may contain multiple isolated caller scopes. Count root initialization, registrar execution, and scope creation separately; never label scope reuse as one unit of work.
2. Preserve `register(container)` and existing DI import paths. Add explicit audited process-registration opt-in and a helper whose scoped factories receive the actual resolving container. Do not infer safety by executing registrars or proxying a mutable "latest container".
3. If an enabled module or app registrar is not opted in, use the complete legacy builder, preserving original ordering and side effects. Compatibility fallback is observable. Standard first-party registrars are audited and migrated, including the app/template registrar; arbitrary third-party registrations keep working without migration.
4. Keep #8990–#8994 independent. This change includes only the isolation, count, and integration checks necessary to validate its lifetime split.
5. Roll out behind `OM_PROCESS_CONTAINER_ROOT`, initially off. Turn it on by default only after the validation and request-count/isolation evidence below pass; preserve an explicit off switch. If that evidence is unavailable, leave rollout incomplete and the implementation PR draft rather than assert #8989 complete.

## Proposed solution and architecture

### Registration contracts
Add `defineProcessDiRegistrar` to mark the same registrar function with a globally stable symbol; its parameter and result conventions are unchanged. Add `asScopedService(factory)` to supply an Awilix SCOPED resolver whose factory receives the resolving caller container. It must not capture the root. No new magic DI key is required. Immutable configuration or process clients may be values; mutable/EM/auth/container-bound services must be scoped factories.

An opted-in registrar performs registration only: no eager request resolution, database query, subscription, timer, or request-local side effect. Root initialization failures do not publish partial roots. Unmarked registrars run through the original builder, including asynchronous app hooks and override ordering. The fallback path must not accidentally replay cached request services.

Core registration order remains core defaults, module registrations, core bootstrap unless an event bus was supplied, app registrar, module overrides, then per-EM encryption subscriber attachment. Overrides remain caller-local where they can depend on request state. Any override capability that cannot safely use the root selects compatibility mode rather than changing precedence.

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
Coalesce concurrent root initialization with a generation-owned promise. A rejection clears only that generation's promise and is retryable. Registrar/app-registrar/override/module registry replacement invalidates the generation. A slow obsolete initializer cannot replace the current root. Existing scopes retain their generation; new calls use the new one. Process clients (cache/KMS/transport pools) remain process-owned through their existing shutdown owners, never allocated again solely because of a registry generation. Generation-owned state consists of container definitions and in-memory listener registries; retiring a generation removes it from global ownership, allowing collection once callers/streams release their references. Do not add process event handlers or timers per generation. Failed initialization drops temporary definitions and listeners and never publishes them; any resource introduced during implementation must have an explicit disposer and failure cleanup test. Child scope disposal is caller-owned, never inferred from response return. Test repeated invalidation, failed initialization and stream cancellation without listener/client growth.

Initialize after complete app registration, in Node instrumentation outside production build, and in the equivalent standalone path. Retain lazy initialization for tests, CLI callers and workers after `bootstrapFromAppRoot` completes. Do not import the full application graph in edge runtime. Avoid initialization from `registerDiRegistrars` itself because other registries are not complete then.

### Caller and background compatibility
Keep fresh EM forks with clear identity maps and fresh event managers per legacy helper call. Services resolved from a caller retain that caller's registration context after another caller is created. Explicitly independent parallel/background tasks enter independent execution contexts. Streaming response work keeps valid references until it actually finishes; returning a Response is not evidence that its stream finished. Existing CLI and worker disposal/EM cleanup semantics remain intact.

## Data models, API contracts, and UI/UX
No tables, migrations, routes, response bodies, event IDs, ACL IDs, or UI are added. The registrar opt-in, scoped-service helper, and `runWithRequestScopeContainer` are additive exported APIs. Existing generated registrar arrays remain unchanged. Instrumentation/dispatcher/template changes are mirrored; no generated file is hand edited. Default activation and performance measurements are documented separately from implementation availability.

## Migration and backward compatibility
Unknown third-party and app registrars keep the legacy path, with diagnostics explaining why the root optimization is unavailable. Opting in requires registration-only behavior and scoped factories for request dependencies; unchanged legacy helpers remain supported. Existing `OM_BOOTSTRAP_CACHE` remains accepted but must not override the new safety rules or replay caller-bound instances on the root path. `OM_PROCESS_CONTAINER_ROOT=off` is the rollback. #9628 remains a dependency; #9717's shared-EM implementation is not a dependency and is not copied. The implementation is based on #9628, where `OM_REQUEST_CONTAINER_MEMO`/`shareContainer` are absent. If #9717 lands first, integration must remove the shared-EM branch from the process-root path and preserve `fresh` as an explicit independent-unit-of-work request; neither flag may silently reactivate a shared EM. Do not claim compatibility with the unmodified #9717 branch.

## Research and alternatives
Awilix scopes cache SCOPED instances separately, but inherit value registrations and root singletons. Its disposal only handles the container's cached services, not all child scopes. These semantics require explicit lifetime registration, not merely `createScope()` around existing registrations. Source: https://github.com/jeffijoe/awilix (createScope, lifetimes, disposal).

Rejected: one EM for every legacy caller (observed write corruption); dynamic latest-container proxies (interleaving ambiguity); automatic registrar probing (side effects and eager captures); only caching ORM/registrar inputs (does not remove the measured setup cost); replaying harvested bootstrap instances (retains request state).

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
| Default rollout without workload proof | High | Remain opt-in/draft until evidence; counters distinguish roots, registrations and scopes |

## Implementation plan
### Phase 1 — Define and prove lifecycle primitives
1. Add opt-in registrar/scoped-factory helpers and root-generation state with concurrency, failure, invalidation and compatibility tests.
2. Integrate the root/caller builder while preserving override ordering and isolated managed entities.
### Phase 2 — Split bootstrap and migrate registrations
3. Separate process infrastructure from scoped encryption/search and scope-bound event dispatch; preserve subscriber semantics.
4. Move query-index subscription work to generation ownership with dynamic entity coverage.
5. Audit and migrate enabled first-party DI registrars and app/template hooks; unmarked external registrars keep full fallback.
### Phase 3 — Wire execution entry points and verify
6. Initialize after app registration in Node and standalone startup; retain lazy CLI/job paths and independent background execution scopes.
7. Add self-contained integration coverage for company lookup/list/create/update across tenants, single-field edits preserving unrelated fields, cart/promotion auth, event side effects, and independent worker scopes. Record root/registrar/scope counters and compare enabled/disabled behavior.
8. Run validation, independent review and workload qualification; document results and only enable the default after evidence supports it.

## Acceptance matrix
- Cold concurrent initialization: 20 concurrent callers, one root initialization, each opted-in registrar invoked once per generation, 20 distinct caller EMs and scoped service sets.
- Warm requests: ten sequential and ten concurrent company lookups/lists; no root rebuild, registrar replay, subscriber growth, or per-caller query-index setup/discovery query. Scope and EM counters increase per helper invocation and are reported honestly.
- Isolation: two tenants plus two organizations within one tenant; interleave auth-bearing scopes and company create/read/update, preserve unrelated fields on a single-field edit, and deny cross-scope reads. Re-run cart/promotion evaluations enabled and disabled with identical outcomes.
- Background: two concurrent worker jobs, nested emit and explicit caller-owned emit after a sibling creation; subscriber resolve uses its bound caller and listeners do not multiply.
- Compatibility: one unaudited module or app registrar forces the full legacy path; registration ordering, eager reads, custom event bus and app overrides match flag-off behavior.
- Generations: invalidate twice during cold initialization, reject one initialization, replace subscribers with zero, and cancel a response stream; no stale publication, duplicate listeners or lost caller-owned references.
- Rollout: relevant unit/integration suites and configured validation pass (or documented baseline-only failures independently verified), no functional regression on enabled/disabled workloads, and warm setup counters meet the above invariants. Missing live isolation/workload evidence blocks default-on and completion. Latency is reported, never used as a substitute for these invariants.

## Final compliance report
- Contracts: additive helpers; legacy registrar and helper semantics retained; no public route/data changes.
- Tenant/data safety: scoped services, separate identity maps, explicit event resolution, isolation tests required.
- Scope: DI lifetime optimization only; later artifact-roadmap capabilities remain separate.
- Verification: unit and integration coverage ships with the implementation; missing live evidence blocks completion/default rollout.
- Rollback: feature off returns to compatible legacy construction.

## Changelog
- 2026-11-18: Initial design from #8989 and the concrete isolation regressions found in #9717; separates registration reuse from unit-of-work sharing.
