# Full enterprise PostgreSQL RLS implementation

Source doc: .ai/specs/enterprise/2026-11-12-row-level-security.md
PR: #9424
Engine: om-auto-continue-pr-loop

## Tasks

> Authoritative status table. Status is todo or done. One commit per Step. Exec cells are inline because production scope propagation, pool ownership, policy lifecycle and tests form one tightly coupled change. Independent read-only investigations and final reviews may be dispatched.

| Phase | Step | Title | Exec | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| 0 | 0.1 | Preserve completed isolated connection proof and integration runner | inline | done | 4349cbf789 |
| 1 | 1.1 | Complete activation design and compatibility/security review | inline | done | 349e99034a |
| 1 | 1.1-review-fix | Define activation lifetime contracts and executable step exits | inline | done | 6946667369 |
| 1 | 1.2 | Add edition-neutral database lifecycle and execution scope hooks | inline | done | 390002aa6d |
| 1 | 1.3 | Implement enterprise scoped pool ownership and topology guards | inline | done | ad9284c457 |
| 1 | 1.4 | Implement table manifest, effective policy and runtime role verification | inline | done | 86a5570e49 |
| 1 | 1.4-review-fix | Reject partial tenant metadata in deferred manifest entries | inline | done | e467e3c46d |
| 1 | 1.5 | Register enterprise enforcement before ORM initialization | inline | done | 762a2d0ccc |
| 2 | 2.1 | Propagate trusted API identity before authorization and handler queries | inline | done | 4d99b71fc4 |
| 2 | 2.2 | Implement request/RSC resolver and canonical portal bootstrap | inline | done | this commit |
| 2 | 2.2-modular | Replace module-specific runtime knowledge with module-owned declarations | inline | done | this commit |
| 2 | 2.2-storage | Discover module-owned legacy storage and keep test probes with their owner | inline | done | this commit |
| 2 | 2.2-storage-fix | Declare retained catalog relations discovered by the live database gate | inline | done | this commit |
| 2 | 2.2-rsc | Verify deferred Next render lifetime and audience against the live canary | inline | done | live retry: 3/3; comment6856492040 |
| 2 | 2.2-public-signup | Keep verified signup/invitation continuations and subscribers in tenant scope | inline | done | this commit |
| 2 | 2.2-public-tokens | Scope verified email, magic-link and password-reset continuations | inline | done | this commit |
| 2 | 2.2-public-login | Scope authenticated customer login and awaited success subscribers | inline | done | this commit |
| 2 | 2.2-public-storefront | Scope resolved storefront and validated buyer continuations in the owning module | inline | done | this commit |
| 2 | 2.2-public | Scope verified public token, storefront and provisioning continuations | inline | todo | — |
| 2 | 2.3 | Propagate worker, subscriber and scheduler tenant contexts | inline | todo | — |
| 2 | 2.4 | Separate tenant CLI operations from privileged maintenance | inline | todo | — |
| 2 | 2.5 | Classify and integrate independent search, vector and event pools | inline | todo | — |
| 3 | 3.1 | Reconcile explicit canary policies through migrations with rollback | inline | todo | — |
| 3 | 3.2 | Add self-contained canary CRUD and cross-tenant HTTP integration tests | inline | todo | — |
| 3 | 3.3 | Add dispatcher, job retry and maintenance integration coverage | inline | todo | — |
| 3 | 3.4 | Verify canary browser flow and publish working-app screenshots | inline | todo | — |
| 3 | 3.5-concurrency | Verify tenant isolation at 20, 30, 50 and 100 concurrent users and publish analysis | inline | todo | — |
| 3 | 3.5 | Benchmark checkout overhead and pool pressure | inline | todo | — |
| 4 | 4.0 | Remove PoC code and retain production regression coverage | inline | done | 3b4195bffa + parent live verification |
| 4 | 4.1 | Run full repository and integration validation gates | inline | todo | — |
| 4 | 4.2 | Complete independent code and security review with fixes | inline | todo | — |
| 4 | 4.3 | Publish full implementation results and finalize PR | inline | todo | — |

## Goal

Implement the complete enterprise RLS specification, including production integration and an explicitly reviewed table canary, with real HTTP/worker/database/browser evidence on PR #9424. The user corrected the prior Phase-0-only scope and explicitly selected the PR-loop engine. That authorization supersedes the earlier prototype-only assumption; deployment to production and applying migrations to the user database remain outside scope.

## Scope and compatibility

Keep enterprise behavior in the commercial package. Add only edition-neutral hooks to OSS infrastructure and preserve disabled-mode behavior. Resolve trusted identity before tenant authorization; do not use raw tenant headers or query values as authority. Preserve RBAC, encryption, mutation guards, optimistic locking, short transactions and side effects. Fail closed for invalid topology, roles, policies and escaped connection scopes. Global maintenance uses a separate explicit database role/connection boundary. Maintain reviewed table coverage and justified exclusions; enable only the canary initially.

## Non-goals

No row/team authorization, dependency upgrade, transaction-proxy support, implicit superadmin bypass, global auto-enable of every tenant table, production deployment, local application migration, branch/base merge, or removal of application scoping.

## Implementation Plan

### Step 1.1: Complete activation design and compatibility/security review

Files: Current activation spec, shared/runtime proposed types, BACKWARD_COMPATIBILITY.md and independent readiness report.

Depends on: None; retain Phase0 evidence as historical.

Exit gate: Independent om-pre-implement-spec re-review resolves all Critical readiness findings; document interface signatures, ownership, pre/post-migration states and per-step gates. No runtime enablement.

### Step 1.1-review-fix: Define activation lifetime contracts and executable step exits

Files: activation spec and this plan.

Depends on: independent readiness report10382a6c identified Critical R4/R5 gaps.

Exit gate: specify exact neutral interfaces, resolver states and invocation lifetime, distinct released lease generations, PostgreSQL16–18 finite policy/role contract, preflight vs reconciliation, durable executed-migration reindex recovery and operator upgrade guidance. Every production step has concrete files, prerequisite and named test oracle. Independent readiness re-review must resolve Critical findings before activation work proceeds.

### Step 1.2: Add edition-neutral database lifecycle and execution scope hooks

Files: packages/shared/src/lib/db/runtime.ts, mikro.ts and db/__tests__/{runtime,mikro.runtime,mikro}.test.ts.

Depends on: 1.1 accepted design.

Exit gate: yarn workspace @open-mercato/shared test --runInBand --testPathPatterns="db/__tests__/(runtime|mikro|mikro.runtime).test.ts" plus shared typecheck; concurrent first callers wait for ready, rejected startup closes before disposal and can retry, no-adapter behavior unchanged.

### Step 1.3: Implement enterprise scoped pool ownership and topology guards

Files: packages/enterprise/src/lib/rls/runtime/{scope,pool}.ts and __tests__; disposable database harness.

Depends on: 1.2 neutral hooks.

Exit gate: Pool tests and live PostgreSQL prove distinct lease facades, old released handles never inherit a new lease, same/different-tenant retained transaction rejection, active request tokens, Promise/callback paths, max1 setup-failure recovery and module duplication. No activation yet.

### Step 1.4: Implement table manifest, effective policy and runtime role verification

Files: Enterprise runtime manifest/catalog/roles/policies modules, versioned inventory and tests.

Depends on: 1.3 ownership protocol.

Exit gate: Disposable PostgreSQL rejects privileged/member/owner/TRUNCATE/DDL roles, unknown tables, widening/role/command/definer/view policy drift and unsupported versions/topology. Preflight without canary policies succeeds only for maintenance; runtime readiness requires exact installed policy. No application activation.

### Step 1.5: Register enterprise enforcement before ORM initialization

Files: New tenant_boundaries enterprise module generator plugin/registration and app module activation mirrored into template.

Depends on: 1.4 checks implemented; context phases still disable live enrollment.

Exit gate: yarn generate and enterprise/shared generator tests prove app/API/CLI bootstrap registration precedes ORM; absent/off modes are unchanged, on mode refuses incomplete catalog/topology. Checkpoint1 publishes actual evidence.

### Step 2.1: Propagate trusted API identity before authorization and handler queries

Files: Shared auth/server identity seams and actual catch-all dispatcher, mirrored template and tests.

Depends on: 1.5 bootstrap; no canary activation until all2.x contexts complete.

Exit gate: Actual dispatcher tests verify actorA→selectedB sibling scopes before RBAC, concurrent tenants, absent/invalid identities, API keys and direct auth handlers. Preserve existing auth503/cookie behavior and tenant-selection guards.

### Step 2.2: Implement request/RSC resolver and canonical portal bootstrap

Files: Enterprise request-cached resolver, staff/customer auth, backend/frontend layouts/pages/metadata, proxy trusted pathname; template mirror.

Depends on: 2.1 trusted identity hooks.

Exit gate: Request bridge, resolver and portal identity unit tests cover before-container bootstrap, stable cached invocation, route audience with both cookies, identity unavailability, organization/domain binding, response completion and cancellation. Package typechecks pass. This is implementation only; real-framework verification remains mandatory in 2.2-rsc.

### Step 2.2-rsc: Verify deferred Next render lifetime and audience against the live canary

Files: Enterprise tenant_boundaries integration tests and isolated application fixtures; actual Next app remains repository-native.

Depends on: 2.2 resolver implementation.

Exit gate: Real deferred RSC tests prove route-audience choice with both cookies, cold start non-recursion, stable query/checkout token, Next after revocation, response cancellation/stream completion and bounded resolver/container work. Publish actual app evidence; no mock-only completion.

Verified 2026-11-13: native isolated retry passed all three real Next tests (concurrent deferred staff rendering, both-cookie portal/selected staff tenant, cancellation). Restricted role, FORCE canary and one-connection pool used. First attempt failed before fixtures on database connection timeout. Retry teardown logged Next exit143 after the passing summary. Screenshots and exact limits: PR comment6856492040. This does not complete the People CRUD browser gate.

### Step 2.2-public-signup: Keep verified signup/invitation continuations and subscribers in tenant scope

Files: Customer-account signup/invitation routes and route unit tests.

Exit gate: Existing authentication response/cookie behavior remains compatible. Invalid organization binding and expired token never enter a tenant continuation. The continuation creates a fresh container and awaits event subscribers before returning. Focused route units and core typecheck pass; live public integration remains required by 2.2-public.

### Step 2.2-public: Scope verified public token, storefront and provisioning continuations

Files: Customer signup/invitation/token success continuations, portal/storefront services and onboarding provisioning boundaries identified in inventory ec59c4e3.

Depends on: 2.2-rsc verified request lifetime; persistent subscribers and deferred jobs are completed in 2.3/2.4.

Exit gate: Integration proves tenant authority comes from persisted verified tokens/accounts/domain/store bindings, never raw tenant inputs or unrelated cookies. Continuations start before acquiring new transactions; consume tokens once and retain atomic rechecks. All prior 2.2 production gates remain required.

### Step 2.3: Propagate worker, subscriber and scheduler tenant contexts

Files: CLI per-job handler, events dispatch/worker bridge, scheduler services and tests.

Depends on: 2.2-rsc invocation lifetime and 2.2-public verified continuations.

Exit gate: Actual worker handler before-container scope, nested event envelope validation, retry/finally isolation, ephemeral callback fresh scopes and scheduler global maintenance poll tests pass; malformed/ambiguous tenant metadata fails closed.

### Step 2.4: Separate tenant CLI operations from privileged maintenance

Files: CLI module-command dispatch, db connection URL selection, scheduler raw Client probe, provisioning/encryption/reindex maintenance.

Depends on: 2.3 execution wrappers.

Exit gate: Integration tests show tenant CLI uses restricted role; global migration/init/provisioning/reindex/encryption/scheduler paths require distinct maintenance credentials. Missing tenant never becomes privileged. Existing off-mode CLI tests pass.

### Step 2.5: Classify and integrate independent search, vector and event pools

Files: Search DI/default/custom pgvector pools, validate/provision storage seam, event Pool/LISTEN Client classification and registry.

Depends on: 2.4 explicit maintenance selection.

Exit gate: Default/injected/custom/cache-disabled vector configurations validate without runtime DDL; privileged provisioning covers extensions/columns/indexes/dimensions/ledger. Event transport only runs pg_notify/LISTEN and application callbacks require tenant scope. Checkpoint2 includes real restricted-role tests.

### Step 3.1: Reconcile explicit canary policies through migrations with rollback

Files: Enterprise canary migration/reconciliation and snapshot, CLI dbMigrate lifecycle/reindex recovery, UPGRADE_NOTES.md.

Depends on: All2.x contexts verified.

Exit gate: Disposable dbMigrate integration covers preflight/no-pending, partial schema failure, reconciliation failure, concurrent advisory lock, off→on no-op ledger, exact down/re-enable and durable reindex history replay. No migration of user DB; exact customer_entities allowlist only.

### Step 3.2: Add self-contained canary CRUD and cross-tenant HTTP integration tests

Files: tenant_boundaries/__integration__/TC-RLS-001.spec.ts with independent tenants/accounts, plus restricted raw SQL probe.

Depends on: 3.1 canary applied in isolated integration database.

Exit gate: Run OM_ENABLE_ENTERPRISE_MODULES=true OM_TENANT_RLS=on configured isolated app and yarn playwright test --config=.ai/qa/tests/playwright.config.ts TC-RLS-001; assert list/detail/create/update/delete, cross-ID/write denial, custom fields/encryption/side effects/guards/optimistic409 and unfiltered SQL isolation. Fixtures created and removed by tests; no seeded dependency.

### Step 3.3: Add dispatcher, job retry and maintenance integration coverage

Files: tenant_boundaries integration TC-RLS-002 and actual worker/migration CLI entrypoints.

Depends on: 3.2 shared fixture provisioner.

Exit gate: Run focused TC-RLS-002 plus actual Node worker/CLI harness on disposable PostgreSQL/Redis. Prove concurrent/retried jobs, nested events, invalid metadata, scheduled dispatch and privileged maintenance separation before container creation.

### Step 3.4: Verify canary browser flow and publish working-app screenshots

Files: tenant_boundaries/__integration__/TC-RLS-003.spec.ts using existing people UI.

Depends on: 3.2 and3.3 isolated full app ready under restricted role.

Exit gate: Actual browser people create/read/edit/delete, tenant switch, validation and optimistic-conflict flows pass. Capture working-app screenshots and publish PR comment through evidence descriptor; verification-report screenshots alone do not satisfy this step.

### Step 3.5: Benchmark checkout overhead and pool pressure

Files: Enterprise benchmark runner and checkpoint3 evidence.

Depends on: All3.x functional integration passes.

Exit gate: Paired off/on same-driver workload reports p50/p95, acquisition counts, waits and peak connections for max1/max3 plus normal pool size; verify actual scope and result equality before interpreting timings. Record tradeoff, no invented performance target.

### Step 4.1: Run full repository and integration validation gates

Files: Run final-gate-checks.md and repository-native validation/integration runners.

Depends on: 1.x–3.x done.

Exit gate: All configured validation.commands in order, yarn test:integration, yarn test:create-app:integration for template changes, template parity and applicable DS guard pass; record every skip/failure and resolve blockers.

### Step 4.2: Complete independent code and security review with fixes

Files: Full diff and independent om-auto-review-pr/security review report; append fix steps if needed.

Depends on: 4.1 green evidence.

Exit gate: No unresolved Critical/High/Medium findings; actual code, compatibility, roles, retained leases, RSC lifetimes, migration recovery and integration evidence reviewed. Re-gate meaningful fixes; formal self-approval limitation disclosed separately.

### Step 4.3: Publish full implementation results and finalize PR

Files: PR9424 body/comments/labels, run HANDOFF/NOTIFY and final task handoff.

Depends on: 4.2 accepted code with full runtime evidence.

Exit gate: All tasks done, final head pushed, complete summary and working-app screenshots on PR, ready state, claim released and started processes cleaned. Production deployment/user DB migrations remain excluded; do not mark done with implementation or verification outstanding.

## Verification and checkpoints

Checkpoint after Steps 1.5, 2.5 and 3.5: targeted validation, real database/integration evidence, HANDOFF rewrite and append-only NOTIFY, PR evidence comment. Working-app screenshots at Step 3.4. Final gate: all configured validation.commands, full Playwright integration suite, template integration when synced app surfaces change, independent review. Earlier Phase 0 evidence remains historical and must not be presented as production verification.

## Risks

An unclassified context/pool or missing scope can cause false empty reads or denied writes; activation stays off until the full topology is verified. Privileged roles, widening policies, retained clients and module duplication can defeat isolation and must be rejected. Session mode is incompatible with transaction pooling. Additional checkout round trips need measurement. Migration generation must not touch unrelated tables; apply migrations only in disposable test environments, never the user application database.

## External references

No external skill URLs. Repository spec and installed driver source are the implementation references.
