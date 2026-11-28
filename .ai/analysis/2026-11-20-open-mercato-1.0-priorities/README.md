# Open Mercato 1.0 priorities

_Snapshot of the GitHub backlog as of 2026-11-20: 1729 open issues (144 labelled `security`). The decoupling model follows the business-module extraction spec in [PR #9678](https://github.com/open-mercato/open-mercato/pull/9678)._

## 1.0 vision

1.0 is the **platform kernel with no business modules**. It is judged on five pillars: **swappability/extensibility**, **decoupling** (kernel works with optional peers disabled), **security**, **reusable core UI** (CrudForm + DataTable), and the **reusable core CRUD/API framework**. Business domains (catalog, customers, sales, cart, wms, staff and the rest) move to their own packages under #9678, so their bugs are not 1.0 blockers unless they hit a kernel contract.

## Executive summary

- **58 P0 blockers, 61 P1 and 27 P2 items** in 7 focus areas. 21 business-module decoupling bugs move to the #9678 extraction track, 14 business issues are explicitly excluded, and 25 issues from the earlier analysis are already closed.
- **21 of the 58 P0s already have an open fix PR or are in progress.** The fastest route to 1.0 is review and merge throughput on those PRs. Most of them are security and CRUD-factory fixes.
- **The CRUD factory is the highest-leverage security target** ([#9016](https://github.com/open-mercato/open-mercato/issues/9016), [#9896](https://github.com/open-mercato/open-mercato/issues/9896), [#9015](https://github.com/open-mercato/open-mercato/issues/9015), [#9154](https://github.com/open-mercato/open-mercato/issues/9154), [#9106](https://github.com/open-mercato/open-mercato/issues/9106), [#9139](https://github.com/open-mercato/open-mercato/issues/9139)). Every module, including third-party ones, inherits these bugs, so one fix in `packages/shared/src/lib/crud` hardens the whole platform.
- **Kernel-only apps do not work yet.** auth, configs, entities, workflows, data_sync, scheduler and record_locks all fail when a peer is disabled, and the ephemeral test env cannot even boot without `customers` ([#9311](https://github.com/open-mercato/open-mercato/issues/9311)). [#8784](https://github.com/open-mercato/open-mercato/issues/8784) (dependency integrity, spec merged) is the plan to adopt for this.
- **Freeze the extension contract deliberately.** Spot IDs ([#4633](https://github.com/open-mercato/open-mercato/issues/4633)), mutation-guard bypasses ([#9710](https://github.com/open-mercato/open-mercato/issues/9710), [#7674](https://github.com/open-mercato/open-mercato/issues/7674)), override remounts ([#5194](https://github.com/open-mercato/open-mercato/issues/5194)) and generic CrudForm section overrides ([#6686](https://github.com/open-mercato/open-mercato/issues/6686) via spec PR #6769) all have to settle before BACKWARD_COMPATIBILITY.md freezes them.
- **Contract decisions to make before 1.0:** payload casing ([#1821](https://github.com/open-mercato/open-mercato/issues/1821)), command-ID naming ([#1784](https://github.com/open-mercato/open-mercato/issues/1784)), whether api_docs stays public ([#3808](https://github.com/open-mercato/open-mercato/issues/3808)), undo scope (more than 40 module-level undo conflict bugs come from one generic gap, [#8873](https://github.com/open-mercato/open-mercato/issues/8873)), and the per-request DI cost ([#8989](https://github.com/open-mercato/open-mercato/issues/8989)).
- **Relabel the `road-to-v1.0.0` issues.** 5 of the 6 open ones are business-module issues ([#8423](https://github.com/open-mercato/open-mercato/issues/8423), [#8404](https://github.com/open-mercato/open-mercato/issues/8404), [#8221](https://github.com/open-mercato/open-mercato/issues/8221), [#8140](https://github.com/open-mercato/open-mercato/issues/8140), [#8421](https://github.com/open-mercato/open-mercato/issues/8421)). Under the kernel-only vision only [#8258](https://github.com/open-mercato/open-mercato/issues/8258) belongs there.

## Focus areas at a glance

| # | Focus area | Pillar | P0 | P1 | P2 |
|---|---|---|---|---|---|
| 1 | Kernel runs with every business module off | Decoupling | 12 | 3 | 2 |
| 2 | Freeze the extension contract | Swappability | 6 | 10 | 6 |
| 3 | Tenant isolation and auth hardening | Security | 18 | 20 | 6 |
| 4 | CRUD factory: security and query correctness | Reusable CRUD API + Security | 11 | 4 | 0 |
| 5 | CrudForm: data integrity and feedback | Reusable core UI | 5 | 8 | 4 |
| 6 | DataTable: sort, filter, URL state, a11y | Reusable core UI | 1 | 4 | 5 |
| 7 | CRUD and API runtime: contract, events, performance | Reusable CRUD API | 5 | 12 | 4 |

## 1. Kernel runs with every business module off

_Pillar: Decoupling_

A 1.0 kernel has to generate, boot, seed and test with no business domain enabled. Today, kernel modules (auth, configs, entities, workflows, data_sync, scheduler, messages, record_locks) still fail when a peer module is disabled. [#8784](https://github.com/open-mercato/open-mercato/issues/8784) (dependency integrity) and the [#9678](https://github.com/open-mercato/open-mercato/issues/9678) extraction spec are the two plans that cover this. Fix the kernel-side failures first. Business-side failures belong to the extraction phases.

### P0

| Issue | Title | Why it matters / status |
|---|---|---|
| [#8784](https://github.com/open-mercato/open-mercato/issues/8784) | Implement: module dependency integrity — verified optional dependencies, preset boot tests and module diagnost | Foundation: declared and verified optional deps, preset boot tests, `mercato modules doctor`. Spec merged ([#8790](https://github.com/open-mercato/open-mercato/issues/8790)); fix PRs [#9326](https://github.com/open-mercato/open-mercato/issues/9326)/[#9395](https://github.com/open-mercato/open-mercato/issues/9395)/[#9664](https://github.com/open-mercato/open-mercato/issues/9664) open. |
| [#6733](https://github.com/open-mercato/open-mercato/issues/6733) | Fix: cross-module data ownership violations across Open Mercato (batch audit) | Batch audit: 273 candidate cross-module entity imports. [#9678](https://github.com/open-mercato/open-mercato/issues/9678) Phase 0 requires this to be finished before anything is extracted. |
| [#2113](https://github.com/open-mercato/open-mercato/issues/2113) | refactor(sales): remove direct cross-module ORM imports of customers/catalog entities | sales imports customers/catalog ORM entities directly. Hard prerequisite for [#9678](https://github.com/open-mercato/open-mercato/issues/9678) Phase 3. |
| [#9311](https://github.com/open-mercato/open-mercato/issues/9311) | bug(cli): test:ephemeral readiness probe requires the customers module, so apps without it never become ready | A kernel-only app never reaches 'ready' in test:ephemeral, so the kernel cannot be tested at all. PR [#9531](https://github.com/open-mercato/open-mercato/issues/9531) open. |
| [#6950](https://github.com/open-mercato/open-mercato/issues/6950) | auth sync-role-acls fails with "Metadata for entity CustomerRole not found" when customer_accounts is disabled | `auth sync-role-acls` crashes without customer_accounts (auth is kernel). |
| [#8381](https://github.com/open-mercato/open-mercato/issues/8381) | bug: [scheduler] jobs of modules disabled in src/modules.ts keep being dispatched and fail | Scheduler keeps dispatching jobs that belong to disabled modules. |
| [#9568](https://github.com/open-mercato/open-mercato/issues/9568) | fix(configs): let disabled-customer deployments pass normal typechecking | configs (kernel) does not typecheck without customers. PR [#9395](https://github.com/open-mercato/open-mercato/issues/9395) open. |
| [#9191](https://github.com/open-mercato/open-mercato/issues/9191) | bug(configs): upgrade-action banner gets stuck on a failing action when customers or attachments is disabled | configs upgrade-action banner gets stuck without customers or attachments. |
| [#9197](https://github.com/open-mercato/open-mercato/issues/9197) | bug(entities): custom-entity settings API returns 500 (AwilixResolutionError) when configs is disabled | Custom entities (kernel) return 500 without configs. PR [#9326](https://github.com/open-mercato/open-mercato/issues/9326) open. |
| [#9205](https://github.com/open-mercato/open-mercato/issues/9205) | bug(record_locks): edit forms cannot be saved and the OSS optimistic-lock floor is silently dropped when audit | record_locks: the OSS optimistic-lock floor is silently dropped when audit_logs or configs is off. In progress. |
| [#9194](https://github.com/open-mercato/open-mercato/issues/9194) | bug(data_sync): sync runs, run routes and schedule routes fail with AwilixResolutionError when progress or sch | data_sync (kernel per [#9678](https://github.com/open-mercato/open-mercato/issues/9678)) needs progress and scheduler. |
| [#9217](https://github.com/open-mercato/open-mercato/issues/9217) | bug(workflows): bulk replay, CALL_API and guard-rule features fail hard when progress, api_keys or business_ru | workflows (kernel) fails hard without progress, api_keys or business_rules. |

### P1

| Issue | Title | Why it matters / status |
|---|---|---|
| [#9201](https://github.com/open-mercato/open-mercato/issues/9201) | bug(messages): inbox list, compose/reply/forward and email delivery fail when attachments or notifications is  | messages (kernel per [#9678](https://github.com/open-mercato/open-mercato/issues/9678)) fails without attachments or notifications. |
| [#8803](https://github.com/open-mercato/open-mercato/issues/8803) | Fix: Translate actions on dictionary entries and custom-field definitions cannot save without the translations | Translate actions in dictionaries and custom fields need the translations module. PR [#9569](https://github.com/open-mercato/open-mercato/issues/9569) open. |
| [#9188](https://github.com/open-mercato/open-mercato/issues/9188) | bug(agent_orchestrator): `mercato init` aborts and process executions crash-loop when workflows or customers i | Enterprise agent_orchestrator: `mercato init` aborts without workflows or customers. |

### P2

| Issue | Title | Why it matters / status |
|---|---|---|
| [#6278](https://github.com/open-mercato/open-mercato/issues/6278) | 0.8.0 upgrade notes: enabling outbound email also requires registering `communication_channels` | Upgrade notes: outbound email silently needs communication_channels. |
| [#2071](https://github.com/open-mercato/open-mercato/issues/2071) | refactor: extract UpgradeActionBanner / upgrade-actions into an optional, non-default npm package | Move UpgradeActionBanner into an optional package. |

## 2. Freeze the extension contract

_Pillar: Swappability_

Once 1.0 ships, spot IDs, override hooks and replacement handles become FROZEN contract surfaces (BACKWARD_COMPATIBILITY.md). Unify, fill and test them before the freeze. A missing generic seam here pushes downstream apps toward ejecting modules.

### P0

| Issue | Title | Why it matters / status |
|---|---|---|
| [#6043](https://github.com/open-mercato/open-mercato/issues/6043) | Framework feedback from a production deployment — 26 items (we run 0.6.5, verified against 0.6.7) | Production framework feedback (26 items). Triage it into 1.0 must-haves. Spec PR [#6769](https://github.com/open-mercato/open-mercato/issues/6769) (generic CrudForm section overrides) is open. |
| [#6686](https://github.com/open-mercato/open-mercato/issues/6686) | Implement: let app modules hide catalog product edit sections coherently | Coherent section hide/override for CrudForm (generic, via [#6769](https://github.com/open-mercato/open-mercato/issues/6769)). In progress. |
| [#5194](https://github.com/open-mercato/open-mercato/issues/5194) | Async override delivery remounts every late-overridden component once per page load | Component overrides delivered async remount every overridden component on each page load, so the replacement system works incorrectly. |
| [#4633](https://github.com/open-mercato/open-mercato/issues/4633) | feat(customers): unify detail-page injection spot ids — two page variants expose different spot ids, forcing d | Detail-page spot IDs differ between page variants. Normalize them before they are frozen. |
| [#9710](https://github.com/open-mercato/open-mercato/issues/9710) | bug: dictionaries — deleting or deactivating a dictionary skips registered mutation guards and has no command  | Dictionary delete/deactivate skips mutation guards and has no command to intercept, so the extension contract is bypassed. |
| [#7674](https://github.com/open-mercato/open-mercato/issues/7674) | Notification actions skip the target module's mutation guards | Notification actions skip the target module's mutation guards. |

### P1

| Issue | Title | Why it matters / status |
|---|---|---|
| [#675](https://github.com/open-mercato/open-mercato/issues/675) | feat: research and exted: `injection system` | Umbrella: one extension model across injection, events, guards and replacement. Use it as the 1.0 'extension contract' spec. |
| [#8386](https://github.com/open-mercato/open-mercato/issues/8386) | feat: [ui] AppShell and DataTable slots for a custom page skeleton (plain header, pageHeader, round actions, h | AppShell and DataTable slots for a custom page skeleton. |
| [#6335](https://github.com/open-mercato/open-mercato/issues/6335) | feat(ui,undo): make `LastOperationBanner` opt-out or replaceable from `AppShell` instead of hard-mounting it | LastOperationBanner is hard-mounted in AppShell; make it replaceable or opt-out. |
| [#9671](https://github.com/open-mercato/open-mercato/issues/9671) | feat(ui): stable data-* ids for row actions, column headers and page actions | Stable data-* IDs on row actions, headers and page actions (testable and targetable). |
| [#4736](https://github.com/open-mercato/open-mercato/issues/4736) | feat(entities/crud-form): per-mode (create/edit) field visibility + make the customFields group respect fieldB | Per-mode (create/edit) field visibility; customFields group respects fieldById overrides. |
| [#3303](https://github.com/open-mercato/open-mercato/issues/3303) | Implement: Platform Map — module introspection for developers | Platform Map: introspect modules and extension points (spec merged [#3141](https://github.com/open-mercato/open-mercato/issues/3141)). |
| [#8258](https://github.com/open-mercato/open-mercato/issues/8258) | feat: Markdown editor: code block language list cannot be extended: a module cannot add its own language | Markdown editor code-block language registry (road-to-v1.0.0; spec merged, draft PR [#8622](https://github.com/open-mercato/open-mercato/issues/8622)). |
| [#10048](https://github.com/open-mercato/open-mercato/issues/10048) | Inline event subscribers' ctx.container may outlive the request — scope before register() | Inline subscribers' ctx.container can outlive the request. PR [#10018](https://github.com/open-mercato/open-mercato/issues/10018) open. |
| [#6380](https://github.com/open-mercato/open-mercato/issues/6380) | Translate command-interceptor rejection bodies at the route boundary too | Translate command-interceptor rejection bodies at the route boundary. |
| [#5435](https://github.com/open-mercato/open-mercato/issues/5435) | Honour the command interceptor HTTP status on the 17 core routes whose commandBus call has no enclosing catch | Honour the interceptor HTTP status on 17 core routes. |

### P2

| Issue | Title | Why it matters / status |
|---|---|---|
| [#6773](https://github.com/open-mercato/open-mercato/issues/6773) | Narrow the API bootstrap's injection-widget entries to server-resolved spots | Narrow API-bootstrap injection-widget entries to server-resolved spots. |
| [#6374](https://github.com/open-mercato/open-mercato/issues/6374) | perf(app): parallelize ComponentOverridesBootstrap's dispatch and dynamic imports | Parallelize ComponentOverridesBootstrap. |
| [#9784](https://github.com/open-mercato/open-mercato/issues/9784) | feat(ui): let apps customize how AiChat renders assistant prose (markdown components or an inline renderer reg | AiChat prose renderer registry. |
| [#4378](https://github.com/open-mercato/open-mercato/issues/4378) | feat(entities): no app-side control of custom-field card layout (priority passthrough, native-group injection, | App-side control of the custom-field card layout. |
| [#1783](https://github.com/open-mercato/open-mercato/issues/1783) | AI overrides + module-level disable — tenant UX, cascading disable, generator typo-guard | AI overrides: tenant UX, cascading disable. |
| [#5308](https://github.com/open-mercato/open-mercato/issues/5308) | Implement: opt-in experimental contract gate for standalone agent sessions | Opt-in experimental contract gate. |

## 3. Tenant isolation and auth hardening

_Pillar: Security_

These are platform-level findings in kernel modules (auth, directory, sso, api_keys, attachments, notifications, search, workflows, telemetry, CI). Most P0s already have an open fix PR, so the bottleneck is review and merge throughput, not engineering.

### P0

| Issue | Title | Why it matters / status |
|---|---|---|
| [#9014](https://github.com/open-mercato/open-mercato/issues/9014) | security(sso): SSO config manager can map IdP groups to `superadmin` and auto-link any same-org user — full pr | priority-extreme: an SSO config manager can map IdP groups to superadmin (privilege escalation). PR [#9577](https://github.com/open-mercato/open-mercato/issues/9577) open. |
| [#5173](https://github.com/open-mercato/open-mercato/issues/5173) | Fix: require per-user authorization for AI MCP tool calls | priority-extreme: per-user authorization for AI MCP tool calls. PR [#9314](https://github.com/open-mercato/open-mercato/issues/9314) open. |
| [#9136](https://github.com/open-mercato/open-mercato/issues/9136) | security(notifications): delivery settings are stored instance-global, so any tenant admin rewrites `appUrl`,  | Notification delivery settings are instance-global; any tenant admin can rewrite appUrl and sender. PR [#9809](https://github.com/open-mercato/open-mercato/issues/9809) open. |
| [#9135](https://github.com/open-mercato/open-mercato/issues/9135) | security(search): tenant embedding settings mutate a process-wide `EmbeddingService`, sending other tenants' s | Tenant embedding settings mutate a process-wide EmbeddingService, so other tenants' queries can leak. PR [#9808](https://github.com/open-mercato/open-mercato/issues/9808) open. |
| [#9134](https://github.com/open-mercato/open-mercato/issues/9134) | security(workflows): `EMIT_EVENT` emits any event with an author-controlled payload, so a forged `tenantId`/`o | workflows EMIT_EVENT accepts a forged tenantId/organizationId. |
| [#8677](https://github.com/open-mercato/open-mercato/issues/8677) | security: Enforce actor organization scope on organization update/delete and hierarchy changes | Organization update/delete and hierarchy ignore actor org scope. PR [#8687](https://github.com/open-mercato/open-mercato/issues/8687) open. |
| [#8674](https://github.com/open-mercato/open-mercato/issues/8674) | Fix: record locks bypass target-record read permissions and leak incoming changes | Record locks bypass target-record read permissions. |
| [#8678](https://github.com/open-mercato/open-mercato/issues/8678) | security: Require step-up for recovery email changes and revoke prior sessions | Recovery-email change without step-up; prior sessions are not revoked. |
| [#7216](https://github.com/open-mercato/open-mercato/issues/7216) | Fix: MFA challenge failures leave an unrestricted login token | An MFA challenge failure leaves an unrestricted login token. |
| [#4034](https://github.com/open-mercato/open-mercato/issues/4034) | security(api_keys): CRUD deletion does not evict the API-key authentication cache | Deleting an API key does not evict the auth cache. |
| [#3814](https://github.com/open-mercato/open-mercato/issues/3814) | security(api_keys): findSessionApiKeyWithSecret returns decrypted secret with no ownership check (apiKeyServic | findSessionApiKeyWithSecret returns the decrypted secret with no ownership check. |
| [#3914](https://github.com/open-mercato/open-mercato/issues/3914) | security(storage_s3): StorageService accepts a tenant scope but never enforces it (lib/storage-service.ts:99) | StorageService accepts a tenant scope but never enforces it. |
| [#8760](https://github.com/open-mercato/open-mercato/issues/8760) | Fix: enforce read permissions for private attachment file and image routes | Read permissions are not enforced on private attachment file and image routes. |
| [#8891](https://github.com/open-mercato/open-mercato/issues/8891) | Fix: authorize protected attachment owners before generic uploads | Protected attachment owners are not authorized before generic uploads. |
| [#3845](https://github.com/open-mercato/open-mercato/issues/3845) | security(dictionaries): cross-org IDOR on entry-create via null-org fail-open (commands/entries.ts:23-32) | dictionaries: cross-org IDOR via null-org fail-open. |
| [#5087](https://github.com/open-mercato/open-mercato/issues/5087) | Audit the 53 persistent emit sites that omit trusted tenant/org scope in emit options | 53 persistent emit sites omit the trusted tenant/org scope. |
| [#9805](https://github.com/open-mercato/open-mercato/issues/9805) | Fix: telemetry traces export full request URLs, leaking password-reset, magic-link and OAuth tokens | Telemetry exports full URLs, leaking reset, magic-link and OAuth tokens. PR [#9816](https://github.com/open-mercato/open-mercato/issues/9816) open. |
| [#9109](https://github.com/open-mercato/open-mercato/issues/9109) | security(ci): npm publish token and release-app key are readable outside the `production` approval gate | The npm publish token and release-app key are readable outside the production gate (supply chain). Draft PR [#9962](https://github.com/open-mercato/open-mercato/issues/9962). |

### P1

| Issue | Title | Why it matters / status |
|---|---|---|
| [#9143](https://github.com/open-mercato/open-mercato/issues/9143) | security(ent_security): self-service password change leaves every existing session valid | Changing a password leaves every session valid. PR [#9449](https://github.com/open-mercato/open-mercato/issues/9449) open. |
| [#7530](https://github.com/open-mercato/open-mercato/issues/7530) | [Security] Require local MFA or verified IdP assurance before completing SSO login | SSO login completes without MFA or verified IdP assurance. |
| [#9145](https://github.com/open-mercato/open-mercato/issues/9145) | security(ent_security): MFA factors can be added, removed and re-issued with no step-up; Email OTP enrols an u | MFA factors can be changed with no step-up. Same enterprise MFA cluster: [#9150](https://github.com/open-mercato/open-mercato/issues/9150), [#9152](https://github.com/open-mercato/open-mercato/issues/9152), [#9153](https://github.com/open-mercato/open-mercato/issues/9153), [#3854](https://github.com/open-mercato/open-mercato/issues/3854). |
| [#3854](https://github.com/open-mercato/open-mercato/issues/3854) | security(ent_security): TOTP shared secrets stored plaintext at rest — no module encryption (data/entities.ts: | TOTP secrets are stored in plaintext. PR [#8987](https://github.com/open-mercato/open-mercato/issues/8987) open. |
| [#9138](https://github.com/open-mercato/open-mercato/issues/9138) | security(workflows): code-workflow override lookup ignores the organization, so a sibling organization can ove | Workflow override lookup ignores the organization. PR [#9525](https://github.com/open-mercato/open-mercato/issues/9525) open. |
| [#9017](https://github.com/open-mercato/open-mercato/issues/9017) | security(messages): draft attachment linking re-parents, hard-deletes and externally mails any same-org attach | Message draft attachments can re-parent or delete any same-org file. PR [#9690](https://github.com/open-mercato/open-mercato/issues/9690) open. |
| [#2440](https://github.com/open-mercato/open-mercato/issues/2440) | security(webhooks): outbound dispatch trusts tenant/org scope from event payload instead of trusted scope | Outbound webhooks trust the scope in the event payload. PR [#7174](https://github.com/open-mercato/open-mercato/issues/7174) open. |
| [#3889](https://github.com/open-mercato/open-mercato/issues/3889) | security(record_locks): record-lock settings are instance-global, not tenant-scoped (recordLockService.ts:474- | Record-lock settings are instance-global. |
| [#2115](https://github.com/open-mercato/open-mercato/issues/2115) | security(customers): command paths bypass findWithDecryption on encrypted entities | Command paths bypass findWithDecryption (encryption contract). PR [#8744](https://github.com/open-mercato/open-mercato/issues/8744) open. |
| [#5447](https://github.com/open-mercato/open-mercato/issues/5447) | Encrypted-entity reads via plain em.find are load-order dependent and can return ciphertext | Encrypted reads through plain em.find depend on load order and can return ciphertext. |
| [#2825](https://github.com/open-mercato/open-mercato/issues/2825) | Audit broader occurrence of missing structural tenant scope on detail GET endpoints; reuse helper | Missing structural tenant scope on detail GET endpoints; needs a reusable helper. |
| [#9141](https://github.com/open-mercato/open-mercato/issues/9141) | security(scheduler): `GET /api/scheduler/queue-jobs/[jobId]` returns the payload of any job on any queue to `s | The scheduler job endpoint returns any queue's payload. |
| [#7549](https://github.com/open-mercato/open-mercato/issues/7549) | Fix: prevent default global rate-limit bucket from blocking unrelated logins | The default global rate-limit bucket blocks unrelated logins. |
| [#9019](https://github.com/open-mercato/open-mercato/issues/9019) | security(sso): `returnUrl` sanitizer normalizes dot segments into a protocol-relative URL — open redirect afte | SSO returnUrl normalizes into an open redirect. |
| [#3487](https://github.com/open-mercato/open-mercato/issues/3487) | bug: message action href allows arbitrary external redirect (open-redirect / phishing) | Message action href allows an open redirect. In progress. |
| [#9116](https://github.com/open-mercato/open-mercato/issues/9116) | security(docker): `fullapp.dev` compose publishes unauthenticated OpenCode (superadmin MCP key) and MCP on all | fullapp.dev compose exposes an unauthenticated OpenCode superadmin key. PR [#9731](https://github.com/open-mercato/open-mercato/issues/9731) open. |
| [#7061](https://github.com/open-mercato/open-mercato/issues/7061) | security: high-severity dependency advisories on `develop` | High-severity dependency advisories. |
| [#5183](https://github.com/open-mercato/open-mercato/issues/5183) | Add row-aware authorization for polymorphic search results | Row-aware authorization for polymorphic search results. |
| [#244](https://github.com/open-mercato/open-mercato/issues/244) | feat: Implement Row-Level Security for Automatic Tenant Scoping | Postgres RLS as defense in depth (enterprise spec and proof merged [#9353](https://github.com/open-mercato/open-mercato/issues/9353)). |
| [#8593](https://github.com/open-mercato/open-mercato/issues/8593) | Umbrella: GDPR-ready Open Mercato deployments — implementation plan | GDPR-ready deployments umbrella. |

### P2

| Issue | Title | Why it matters / status |
|---|---|---|
| [#9112](https://github.com/open-mercato/open-mercato/issues/9112) | security(storage_s3): tenant can borrow the platform's AWS identity via `authMode: ambient` or `credentialsEnv | storage_s3 ambient AWS identity can be borrowed. Draft PR [#9793](https://github.com/open-mercato/open-mercato/issues/9793). |
| [#9140](https://github.com/open-mercato/open-mercato/issues/9140) | security(directory, portal): organization slug is unique per tenant but the platform-domain portal resolves it | Org slug resolved globally on the platform portal domain. |
| [#5083](https://github.com/open-mercato/open-mercato/issues/5083) | security(shared): decide the rate-limit failure posture repo-wide for public state-mutating endpoints | Decide the rate-limit failure posture for public endpoints. |
| [#1518](https://github.com/open-mercato/open-mercato/issues/1518) | feat(security): multi-auth dispatcher framework — typed requireAuth with build-time validation | Multi-auth dispatcher with typed requireAuth. |
| [#8920](https://github.com/open-mercato/open-mercato/issues/8920) | security(ai_assistant): decide run-trace visibility for organization-visible conversations before enabling the | AI run-trace visibility for org-visible conversations. |
| [#9345](https://github.com/open-mercato/open-mercato/issues/9345) | [FR] [Enterprise] Record ownership, row-level and field-level access control with masking (UI, API, export, ag | Enterprise FR: record/row/field-level access with masking (post-1.0). |

## 4. CRUD factory: security and query correctness

_Pillar: Reusable CRUD API + Security_

`makeCrudRoute` and the query engine are the security boundary for every module, including third-party ones, so one bug there exposes every module at once. This is the cheapest high-leverage cluster in the backlog.

### P0

| Issue | Title | Why it matters / status |
|---|---|---|
| [#9016](https://github.com/open-mercato/open-mercato/issues/9016) | security(shared/crud): client advanced-filter conditions overwrite server `buildFilters` keys (object spread) | Client advanced-filter conditions overwrite the server's buildFilters keys (object spread). PR [#9526](https://github.com/open-mercato/open-mercato/issues/9526) open. |
| [#9896](https://github.com/open-mercato/open-mercato/issues/9896) | security: advanced-filter override can widen the time-projects list past narrowIds scoping | Advanced-filter override can widen past narrowIds scoping (same family as [#9016](https://github.com/open-mercato/open-mercato/issues/9016)). |
| [#9015](https://github.com/open-mercato/open-mercato/issues/9015) | security(shared/crud): `exportScope=full` drops the route's `buildFilters`, exporting rows the caller may not  | exportScope=full drops the route's buildFilters, so export leaks rows. |
| [#9154](https://github.com/open-mercato/open-mercato/issues/9154) | security(shared/crud): every query-engine list honours a raw `?withDeleted=true` | A raw ?withDeleted=true is honoured on every query-engine list. PR [#9502](https://github.com/open-mercato/open-mercato/issues/9502) open. |
| [#9106](https://github.com/open-mercato/open-mercato/issues/9106) | security(entities): `relations/options` reads any column of any ORM table, cross-tenant for tables without a t | entities relations/options reads any column of any table, cross-tenant. PR [#9686](https://github.com/open-mercato/open-mercato/issues/9686) open. |
| [#9139](https://github.com/open-mercato/open-mercato/issues/9139) | security(translations): `translations.manage` overrides any field of any entity in CRUD list responses, with n | translations.manage overrides any field in CRUD list responses. PR [#9970](https://github.com/open-mercato/open-mercato/issues/9970) open. |
| [#7598](https://github.com/open-mercato/open-mercato/issues/7598) | Other modules' write commands still load their target by bare id before the scope checks | Write commands load the target by bare id before the scope check (catalog fixed in [#7577](https://github.com/open-mercato/open-mercato/issues/7577); other modules remain). |
| [#7673](https://github.com/open-mercato/open-mercato/issues/7673) | Commands that rely only on route-level features have no in-command authorization | Commands that rely only on route-level features have no in-command authorization. |
| [#7831](https://github.com/open-mercato/open-mercato/issues/7831) | Fix: Reject empty OR and unsupported QueryEngine filter operators | QueryEngine accepts an empty OR and unsupported operators. PR [#7996](https://github.com/open-mercato/open-mercato/issues/7996) open. |
| [#9548](https://github.com/open-mercato/open-mercato/issues/9548) | bug: list columns stop sorting when their field is not in the route's sort map (WMS, deals status, leave statu | Sort-map boundary: columns silently stop sorting; same PR [#8972](https://github.com/open-mercato/open-mercato/issues/8972) as [#3827](https://github.com/open-mercato/open-mercato/issues/3827) and [#9550](https://github.com/open-mercato/open-mercato/issues/9550). |
| [#7579](https://github.com/open-mercato/open-mercato/issues/7579) | [Cache / i18n] CRUD list cache key omits resolved locale, risking cross-language responses | The CRUD list cache key omits the locale, so responses can come back in the wrong language. |

### P1

| Issue | Title | Why it matters / status |
|---|---|---|
| [#3827](https://github.com/open-mercato/open-mercato/issues/3827) | security(catalog): sortField not strictly allowlisted, raw client value falls through to query engine (shared/ | sortField is not strictly allowlisted and falls through to the query engine. PR [#8972](https://github.com/open-mercato/open-mercato/issues/8972) open. |
| [#7529](https://github.com/open-mercato/open-mercato/issues/7529) | CRUD list cache: staff time-project lists ignore membership and assignment-window changes, and apps have no pe | The CRUD list cache ignores membership changes; no per-request bypass. |
| [#7637](https://github.com/open-mercato/open-mercato/issues/7637) | Guard the latent empty in()/not-in() shape in join-column and custom-field/JSON-doc query filters | Guard the empty in()/not-in() shape in join and custom-field filters. |
| [#5803](https://github.com/open-mercato/open-mercato/issues/5803) | CRUD list `search` returns the wrong row: hashed-token substitution is applied to plaintext columns | CRUD search: hashed-token substitution on plaintext columns (partly mitigated in [#5884](https://github.com/open-mercato/open-mercato/issues/5884)). |

## 5. CrudForm: data integrity and feedback

_Pillar: Reusable core UI_

CrudForm is the single form engine every module uses. For 1.0, prioritize silent data loss (a value dropped or an edit discarded while a success toast shows) and error surfacing over polish.

### P0

| Issue | Title | Why it matters / status |
|---|---|---|
| [#9093](https://github.com/open-mercato/open-mercato/issues/9093) | DatePicker / CrudForm: a picked but unapplied day is dropped and the old date saves with a success toast | A picked but unapplied date is dropped and the old date saves with a success toast. PR [#9443](https://github.com/open-mercato/open-mercato/issues/9443) open. |
| [#6073](https://github.com/open-mercato/open-mercato/issues/6073) | bug: untouched CrudForm combobox silently clears its value when it is the autofocused first field on an async  | An untouched autofocused combobox silently clears its value on async edit pages. |
| [#9810](https://github.com/open-mercato/open-mercato/issues/9810) | bug: Escape inside an open select closes the whole dialog and discards unsaved edits | Escape inside an open select closes the whole dialog and discards unsaved edits. |
| [#9457](https://github.com/open-mercato/open-mercato/issues/9457) | bug: CrudForm — the browser Back button leaves a form with unsaved changes without a warning (Next 16 App Rout | The browser Back button leaves a dirty form without a warning (Next 16). |
| [#8646](https://github.com/open-mercato/open-mercato/issues/8646) | bug(ui,CrudForm): a server rejection with field errors shows no banner and no toast, and field messages are ra | A server rejection with field errors shows no banner or toast, and messages are raw English Zod text. PR [#8770](https://github.com/open-mercato/open-mercato/issues/8770) open. |

### P1

| Issue | Title | Why it matters / status |
|---|---|---|
| [#2466](https://github.com/open-mercato/open-mercato/issues/2466) | [Umbrella] CrudForm data-persistence QA sweep (#2333 follow-up) | Umbrella: CrudForm data-persistence QA sweep (in progress). |
| [#8204](https://github.com/open-mercato/open-mercato/issues/8204) | feat:  UI — always bring a message that blocks or rejects a save into view (drawers, dialogs, long pages) | Always scroll a save-blocking message into view (drawers, dialogs). PR [#8672](https://github.com/open-mercato/open-mercato/issues/8672) open. |
| [#5511](https://github.com/open-mercato/open-mercato/issues/5511) | bug: [UI] CrudForm labels are not associated with their inputs, on every form in the product | Labels are not associated with inputs on every form. PR [#7432](https://github.com/open-mercato/open-mercato/issues/7432) open. |
| [#5478](https://github.com/open-mercato/open-mercato/issues/5478) | Wire ARIA on CrudForm's wrapper error node so field validation is announced | ARIA on the error node so validation is announced. PR [#7432](https://github.com/open-mercato/open-mercato/issues/7432) open. |
| [#9708](https://github.com/open-mercato/open-mercato/issues/9708) | bug: custom field editor — "Add rule" submits the definitions form and drops unsaved edits | Custom-field editor 'Add rule' submits the host form. PR [#9712](https://github.com/open-mercato/open-mercato/issues/9712) open. |
| [#9711](https://github.com/open-mercato/open-mercato/issues/9711) | feat: let a module defer a custom field's `required` rule (draft saves, later workflow steps) | Let a module defer a custom field's `required` rule (draft saves). |
| [#658](https://github.com/open-mercato/open-mercato/issues/658) | bug: record-locks - fix the `Accpet mine` on conflicts on non-crud forms (sales, customers) | Record-lock 'Accept mine' on non-CrudForm forms. |
| [#3651](https://github.com/open-mercato/open-mercato/issues/3651) | Record locks: enterprise conflict dialog shows no field diff on customers company/person (and other command-ba | Record-lock conflict dialog shows no field diff for command-based entities. |

### P2

| Issue | Title | Why it matters / status |
|---|---|---|
| [#9458](https://github.com/open-mercato/open-mercato/issues/9458) | bug: CrudForm — the unsaved-changes dialog uses the generic "Confirm" button instead of naming the action | The unsaved-changes dialog uses a generic 'Confirm' button. |
| [#5859](https://github.com/open-mercato/open-mercato/issues/5859) | Thread disabled/readOnly into CrudForm's NumberInput and settle the stepping asymmetry with InjectedField | Thread disabled/readOnly into NumberInput. |
| [#6023](https://github.com/open-mercato/open-mercato/issues/6023) | Add browser coverage for CrudForm grouped-layout rendering (hiddenGroupIds) | Browser coverage for grouped layout (hiddenGroupIds). |
| [#6004](https://github.com/open-mercato/open-mercato/issues/6004) | Add an integration test that declared CrudForm hosts are reachable on every create surface (TC-CRM-CRUDFORM-HO | Test that declared CrudForm hosts are reachable on every create surface. |

## 6. DataTable: sort, filter, URL state, a11y

_Pillar: Reusable core UI_

DataTable plus perspectives is the second universal UI primitive. The open items are about contract correctness (sort/filter) and reload-safe state. Visual issues are minor.

### P0

| Issue | Title | Why it matters / status |
|---|---|---|
| [#7459](https://github.com/open-mercato/open-mercato/issues/7459) | Advanced filter tags fields: has all of returns every row, has any of fails on array columns, and the builder  | Advanced filter on tags fields: 'has all of' returns every row, and 'has any of' fails on arrays. |

### P1

| Issue | Title | Why it matters / status |
|---|---|---|
| [#9550](https://github.com/open-mercato/open-mercato/issues/9550) | bug: DataTable headers have no aria-sort, so screen readers never hear the sort state | No aria-sort on headers. PR [#8972](https://github.com/open-mercato/open-mercato/issues/8972) open. |
| [#5525](https://github.com/open-mercato/open-mercato/issues/5525) | Make list search a URL permalink on all DataTable backend pages | List search as a URL permalink on all backend pages ([#5527](https://github.com/open-mercato/open-mercato/issues/5527) is the reload-safe twin). |
| [#8632](https://github.com/open-mercato/open-mercato/issues/8632) | perspectives: Clone of a shared view can replace an existing role view with the same copy name | Cloning a shared perspective can replace an existing role view. |
| [#5738](https://github.com/open-mercato/open-mercato/issues/5738) | DataTable overflows the viewport on mobile widths | DataTable overflows the viewport on mobile widths. |

### P2

| Issue | Title | Why it matters / status |
|---|---|---|
| [#3882](https://github.com/open-mercato/open-mercato/issues/3882) | security(perspectives): persisted pageSize allows up to 500 in a saved view (data/validators.ts:12) | A saved view's pageSize allows up to 500 (in progress). |
| [#2157](https://github.com/open-mercato/open-mercato/issues/2157) | feat(perspectives): declare ACL feature dependencies | Perspectives should declare ACL feature dependencies. |
| [#8149](https://github.com/open-mercato/open-mercato/issues/8149) | Follow up DataTable sticky-header ancestor tracking and scroll measurements | Sticky-header ancestor tracking follow-ups. |
| [#8567](https://github.com/open-mercato/open-mercato/issues/8567) | test(ui): cover custom DataTable date renderers across list consumers | Coverage for custom date renderers. |
| [#234](https://github.com/open-mercato/open-mercato/issues/234) | feat: editable data table component | Editable data table component (post-1.0 feature). |

## 7. CRUD and API runtime: contract, events, performance

_Pillar: Reusable CRUD API_

Decide on the contract-level items before 1.0 freezes them: payload casing, command IDs, OpenAPI and error localization. The runtime cost (a DI container rebuilt per request) is the main performance blocker for a production-grade 1.0.

### P0

| Issue | Title | Why it matters / status |
|---|---|---|
| [#1821](https://github.com/open-mercato/open-mercato/issues/1821) | bug: CRUD payload casing is inconsistent between list and detail endpoints (snake_case vs camelCase) | Payload casing differs between list and detail (snake vs camel). Decide before the freeze. |
| [#3116](https://github.com/open-mercato/open-mercato/issues/3116) | bug: api_docs OpenAPI/Markdown export and Explorer return an empty document (0 endpoints) | OpenAPI/Markdown export and Explorer return 0 endpoints (priority-high). Verify against main. |
| [#3024](https://github.com/open-mercato/open-mercato/issues/3024) | Custom (user-defined) entities don't emit CRUD events — workflows/business-rules can't auto-trigger on them | User-defined custom entities emit no CRUD events, so workflows and rules cannot trigger on them. |
| [#2596](https://github.com/open-mercato/open-mercato/issues/2596) | Framework: make custom-field writes full-payload atomic and flush-safe by construction | Make custom-field writes atomic and flush-safe by construction (partly merged). |
| [#8989](https://github.com/open-mercato/open-mercato/issues/8989) | Implement: build the DI container once per process and scope it per request | Build the DI container once per process with a scope per request (~4 containers per lookup today). Opt-in merged [#9837](https://github.com/open-mercato/open-mercato/issues/9837); spec PR [#9836](https://github.com/open-mercato/open-mercato/issues/9836) open. |

### P1

| Issue | Title | Why it matters / status |
|---|---|---|
| [#2963](https://github.com/open-mercato/open-mercato/issues/2963) | stability(shared/di): make bootstrap services cross-request safe to unlock OM_BOOTSTRAP_CACHE (finish #2044 Ph | Make bootstrap services cross-request safe (unlocks OM_BOOTSTRAP_CACHE). PR [#9628](https://github.com/open-mercato/open-mercato/issues/9628) open. |
| [#2333](https://github.com/open-mercato/open-mercato/issues/2333) | SQL transaction-safety audit — atomic writes across all commands & routes (umbrella) | SQL transaction-safety audit umbrella. |
| [#8873](https://github.com/open-mercato/open-mercato/issues/8873) | bug: undo of a create or update ignores what happened to the record afterwards (promo codes, document addresse | Undo of a create/update ignores later changes. This is generic undo conflict detection; the pattern has more than 40 module instances. |
| [#8949](https://github.com/open-mercato/open-mercato/issues/8949) | Undo/redo: a crash mid-replay leaves the source log claimed with nothing applied | An undo/redo crash mid-replay leaves the log claimed with nothing applied ([#8950](https://github.com/open-mercato/open-mercato/issues/8950) is its twin). |
| [#9220](https://github.com/open-mercato/open-mercato/issues/9220) | CRUD factory: organization-scope refusals are untranslatable English literals, and the feature check drops sel | CRUD factory org-scope refusals are untranslatable English literals. |
| [#9239](https://github.com/open-mercato/open-mercato/issues/9239) | Route-local `'Invalid input'` 400 bodies are still English | Route-local 'Invalid input' 400 bodies are still English (CRUD part fixed in [#9224](https://github.com/open-mercato/open-mercato/issues/9224)). |
| [#8639](https://github.com/open-mercato/open-mercato/issues/8639) | fix(cli,openapi): the OpenAPI generator bundles with `target: 'node18'`, which strips `with { type: 'json' }`  | The OpenAPI generator's node18 target strips JSON import attributes. |
| [#8635](https://github.com/open-mercato/open-mercato/issues/8635) | feat(core,query_index): no hook to clean projections, tokens and coverage after a hard `nativeDelete` | query_index: no hook to clean projections after a hard nativeDelete. |
| [#8636](https://github.com/open-mercato/open-mercato/issues/8636) | feat(core,query_index): no parent-scope resolver for tables scoped only through a parent (reindex refuses, cov | query_index: no parent-scope resolver for parent-scoped tables. |
| [#5779](https://github.com/open-mercato/open-mercato/issues/5779) | perf(crud): run same-priority response enrichers concurrently and wire the dead requestedFields enrichment opt | Run response enrichers concurrently; wire the requestedFields opt-in. |
| [#2983](https://github.com/open-mercato/open-mercato/issues/2983) | perf(ui): server-first data delivery — server-fetched initialData seam seeding the react-query cache for backe | Server-first data delivery: an initialData seam for list/detail pages. |
| [#5636](https://github.com/open-mercato/open-mercato/issues/5636) | Widen the command-interceptor coverage guard beyond packages/core so a new package cannot ship an unmapped bus | Extend the command-interceptor coverage guard beyond packages/core. |

### P2

| Issue | Title | Why it matters / status |
|---|---|---|
| [#1784](https://github.com/open-mercato/open-mercato/issues/1784) | feat: incremental module-by-module migration to singular kebab-case command IDs | Singular kebab-case command IDs: decide before the freeze or drop. |
| [#2351](https://github.com/open-mercato/open-mercato/issues/2351) | perf(crud): skip enricher + interceptor re-runs on CRUD cache hits | Skip enricher and interceptor re-runs on CRUD cache hits. |
| [#2237](https://github.com/open-mercato/open-mercato/issues/2237) | perf: CRUD response cache (ENABLE_CRUD_API_CACHE) is off by default; evaluate enabling for read-heavy list/det | Decide the default for the CRUD response cache. |
| [#7642](https://github.com/open-mercato/open-mercato/issues/7642) | Integration runner hard-codes ENABLE_CRUD_API_CACHE=true, so an app cannot test with the CRUD cache off | The integration runner hard-codes ENABLE_CRUD_API_CACHE=true. |

## Extraction track (business-module decoupling, handled under #9678)

These are business-module failures with optional peers disabled. Fix each as part of its [#9678](https://github.com/open-mercato/open-mercato/issues/9678) extraction phase, not as a separate 1.0 stream. They have to be closed before that domain moves into its own package, because the package boundary is exactly 'works when the optional peer is absent'.

| Issue | Title |
|---|---|
| [#9184](https://github.com/open-mercato/open-mercato/issues/9184) | bug(communication_channels): history import, system email and re-auth notifications fail hard when progress, integrations or notif |
| [#9185](https://github.com/open-mercato/open-mercato/issues/9185) | bug(channel_resend): `yarn generate` rejects the module set when integrations is disabled, although env-only sending does not need |
| [#9186](https://github.com/open-mercato/open-mercato/issues/9186) | bug(channel_ses): `yarn generate` rejects the module set when integrations is disabled, although env-only sending does not need it |
| [#9187](https://github.com/open-mercato/open-mercato/issues/9187) | bug(channel_smtp): `yarn generate` rejects the module set when integrations is disabled, although env-only SMTP relay does not nee |
| [#9192](https://github.com/open-mercato/open-mercato/issues/9192) | bug(customer_accounts): portal notification routes and portal-user CRM link validation return 500 when notifications or customers  |
| [#9193](https://github.com/open-mercato/open-mercato/issues/9193) | bug(customers): `yarn generate`, tenant setup, bulk deal updates and person email routes fail when progress, dictionaries, feature |
| [#9195](https://github.com/open-mercato/open-mercato/issues/9195) | bug(documents): yarn generate rejects documents, and document duplicate fails with 503, when attachments is disabled |
| [#9196](https://github.com/open-mercato/open-mercato/issues/9196) | bug(ecommerce): module refuses to load and storefront API returns 500 when customer_groups or customer_accounts is disabled |
| [#9203](https://github.com/open-mercato/open-mercato/issues/9203) | bug(portal): `yarn generate` fails, and tenant setup would fail, when feature_toggles is disabled, only because of the optional `p |
| [#9206](https://github.com/open-mercato/open-mercato/issues/9206) | bug(resources): tenant init and capacity-unit writes fail when dictionaries is disabled; `yarn generate` fails when planner is dis |
| [#9207](https://github.com/open-mercato/open-mercato/issues/9207) | bug(sales): generation, tenant seeding, document writes and history fail when catalog, customers, feature_toggles or audit_logs ar |
| [#9210](https://github.com/open-mercato/open-mercato/issues/9210) | bug(staff): tenant init, timesheet recalculation and portal attachments fail when dashboards, progress or attachments is disabled; |
| [#9211](https://github.com/open-mercato/open-mercato/issues/9211) | bug(sync_akeneo): hard `sales` requirement for optional channel mapping blocks apps when sales is disabled |
| [#9212](https://github.com/open-mercato/open-mercato/issues/9212) | bug(tillio): "Pull calls" returns 500 (AwilixResolutionError for progressService) when progress is disabled |
| [#9216](https://github.com/open-mercato/open-mercato/issues/9216) | bug(wms): `yarn generate` rejects the module set, and seedDefaults would crash, when customers or feature_toggles is disabled |
| [#9396](https://github.com/open-mercato/open-mercato/issues/9396) | resources: dictionary-backed selects fail in the UI when dictionaries is disabled |
| [#9384](https://github.com/open-mercato/open-mercato/issues/9384) | staff: tenant init aborts when the dashboards module is disabled |
| [#9382](https://github.com/open-mercato/open-mercato/issues/9382) | staff: guard dictionaries and planner usage before relaxing `requires` (planner, resources, dictionaries) |
| [#8801](https://github.com/open-mercato/open-mercato/issues/8801) | Fix: a deal cannot be marked lost without the sales module — the loss-reason dictionary is seeded only by sales |
| [#8802](https://github.com/open-mercato/open-mercato/issues/8802) | Fix: Schedule activity offers an "Offer" link type that is always empty without the sales module |
| [#5260](https://github.com/open-mercato/open-mercato/issues/5260) | feat: decouple WMS from Sales through an optional integration boundary |

## Probably fixed or decided: verify and close

| Issue | Title | Evidence |
|---|---|---|
| [#9204](https://github.com/open-mercato/open-mercato/issues/9204) | bug(promotions): every promotion evaluation fails with "relation does not exist" when catalog is dis | [#9533](https://github.com/open-mercato/open-mercato/issues/9533) merged: 'evaluate promotions without the catalog module' |
| [#9190](https://github.com/open-mercato/open-mercato/issues/9190) | bug(catalog): price writes, bulk operations and catalog settings crash when sales, progress or confi | [#9544](https://github.com/open-mercato/open-mercato/issues/9544) and [#9665](https://github.com/open-mercato/open-mercato/issues/9665) merged: price/tax writes without sales, settings without configs. Check the remaining progress path. |
| [#9610](https://github.com/open-mercato/open-mercato/issues/9610) | catalog: bulk create/delete fail with 500 when the progress module is disabled | Catalog bulk ops without progress; check whether [#9544](https://github.com/open-mercato/open-mercato/issues/9544) covered it |
| [#9804](https://github.com/open-mercato/open-mercato/issues/9804) | fix(telemetry): redact query values from pg error spans | [#9803](https://github.com/open-mercato/open-mercato/issues/9803) and [#9806](https://github.com/open-mercato/open-mercato/issues/9806) merged: SQL literals stripped from pg spans |
| [#3808](https://github.com/open-mercato/open-mercato/issues/3808) | security(api_docs): full OpenAPI spec served with no authentication (api/docs/openapi/route.ts:10) | api_docs is public by design (decision on PR [#2301](https://github.com/open-mercato/open-mercato/issues/2301), implemented in [#5265](https://github.com/open-mercato/open-mercato/issues/5265) for [#2270](https://github.com/open-mercato/open-mercato/issues/2270)). Close as by-design or reopen the decision. |
| [#3809](https://github.com/open-mercato/open-mercato/issues/3809) | security(api_docs): interactive OpenAPI Explorer page /docs/api renders publicly (frontend/docs/api/ | Same as [#3808](https://github.com/open-mercato/open-mercato/issues/3808): public Explorer by design |
| [#3810](https://github.com/open-mercato/open-mercato/issues/3810) | security(api_docs): backend docs page has requireAuth but no requireFeatures; module declares zero A | PR [#8658](https://github.com/open-mercato/open-mercato/issues/8658) open: gate backend docs by feature |
| [#6176](https://github.com/open-mercato/open-mercato/issues/6176) | CrudForm "Cancel" triggers the unsaved-changes prompt; customers company API returns a hardcoded Eng | Cancel triggering the unsaved prompt: retest on main |
| [#5315](https://github.com/open-mercato/open-mercato/issues/5315) | Decide the DataTable showQueryTime default: keep it on, make it environment-dependent, or flip it of | [#5310](https://github.com/open-mercato/open-mercato/issues/5310) merged: showQueryTime opt-out exists. Close once the default is decided. |
| [#5527](https://github.com/open-mercato/open-mercato/issues/5527) | Make ?search= a reload-safe permalink on every DataTable list page | [#5524](https://github.com/open-mercato/open-mercato/issues/5524) fixed customers only. Keep [#5525](https://github.com/open-mercato/open-mercato/issues/5525) as the generic issue. |
| [#8748](https://github.com/open-mercato/open-mercato/issues/8748) | agent_orchestrator: declare its module requires (workflows, api_keys, auth, attachments) | [#7008](https://github.com/open-mercato/open-mercato/issues/7008) merged: packaged requires validated |
| [#7871](https://github.com/open-mercato/open-mercato/issues/7871) | Reuse extractModuleRequiresFromSource in module-facts so requires parsing cannot drift | [#7008](https://github.com/open-mercato/open-mercato/issues/7008) merged: requires parsing shared |
| [#7675](https://github.com/open-mercato/open-mercato/issues/7675) | Review or expire notifications with command actions created through the API before the action-author | [#7669](https://github.com/open-mercato/open-mercato/issues/7669) merged: notifications run only declared commands. Only the data review remains. |
| [#6029](https://github.com/open-mercato/open-mercato/issues/6029) | audit(entities,shared,auth): remaining `$in: [id, null]` scope filters cannot match NULL rows | [#6026](https://github.com/open-mercato/open-mercato/issues/6026) and [#6836](https://github.com/open-mercato/open-mercato/issues/6836) merged: org-NULL CF definitions. Check the remaining $in sites. |
| [#2241](https://github.com/open-mercato/open-mercato/issues/2241) | security: KMS derived-key fallback activates silently from AUTH_SECRET on any Vault hiccup (no fail- | [#6847](https://github.com/open-mercato/open-mercato/issues/6847) merged: KMS fallback fingerprint removed |

## Explicitly excluded from 1.0 (business modules)

| Issue | Title | Reason |
|---|---|---|
| [#8421](https://github.com/open-mercato/open-mercato/issues/8421) | feat: Ecommerce - Cart detail, conversation page and credit panel cannot be extended: no injection s | Ecommerce cart extension spots: business; handled by the extension pattern in area 2 |
| [#8140](https://github.com/open-mercato/open-mercato/issues/8140) | feat: Sales — quote "Send to customer" dialog cannot be extended: the default validity (14 days) can | Sales quote dialog extension: business |
| [#8423](https://github.com/open-mercato/open-mercato/issues/8423) | bug: Checkout - An order paid through a gateway shows nothing paid and the full amount still to pay | Checkout payment display: business (labelled road-to-v1.0.0; recommend relabel) |
| [#8404](https://github.com/open-mercato/open-mercato/issues/8404) | bug: Sales - Undoing an order cancellation leaves a live order with no credit reservation and no sto | Sales undo cancellation: business (labelled road-to-v1.0.0; recommend relabel) |
| [#8221](https://github.com/open-mercato/open-mercato/issues/8221) | bug:  Cart — parallel bulk-add requests to the same cart lose quantity or fail with 500 — cart total | Cart concurrency: business (labelled road-to-v1.0.0; recommend relabel) |
| [#7260](https://github.com/open-mercato/open-mercato/issues/7260) | Pipeline board: let apps customize the deal card (registered DealCard or injection spot) | Deal card customization: business |
| [#6490](https://github.com/open-mercato/open-mercato/issues/6490) | feat(customers): company/person detail header avatar cannot be replaced without ejecting the module | Customer header avatar replace: business (spec merged [#6689](https://github.com/open-mercato/open-mercato/issues/6689)) |
| [#6730](https://github.com/open-mercato/open-mercato/issues/6730) | Implement: extensible Documents record-link registry for module-owned custom entities | Documents record-link registry: business (spec merged [#6731](https://github.com/open-mercato/open-mercato/issues/6731)) |
| [#9852](https://github.com/open-mercato/open-mercato/issues/9852) | bug: sales payments - edits that do not change totals overwrite concurrent changes without a 409 | Sales payments optimistic lock: business |
| [#7963](https://github.com/open-mercato/open-mercato/issues/7963) | bug: Customer address updates ignore the optimistic-lock header, so a stale edit silently overwrites | Customer address optimistic lock: business |
| [#9851](https://github.com/open-mercato/open-mercato/issues/9851) | bug: OpenAPI - payment_gateways/status and checkout/links response schemas are not declared | OpenAPI schemas for payment_gateways/checkout: business |
| [#6414](https://github.com/open-mercato/open-mercato/issues/6414) | sales: give the tax-rate CrudForm an entityId so crud-form field injection (customer group picker) r | Sales tax-rate CrudForm entityId: business |
| [#9162](https://github.com/open-mercato/open-mercato/issues/9162) | security(portal): the `portal_enabled` switch is enforced only in the page layout | portal_enabled enforcement: portal is extracted |
| [#9107](https://github.com/open-mercato/open-mercato/issues/9107) | security(customer_accounts): pre-account takeover — unverified signup is auto-linked to the CRM comp | Portal pre-account takeover: customer_accounts is extracted (still security P0 for that package) |

## Removed from the earlier analysis: already closed

| Issue | Title |
|---|---|
| [#9198](https://github.com/open-mercato/open-mercato/issues/9198) | bug(eudr): persistent notification subscribers fail and retry when notifications is disabled |
| [#9199](https://github.com/open-mercato/open-mercato/issues/9199) | bug(forms): yarn generate rejects forms, and theme-logo upload returns 500, when customer_accounts or attachments is dis |
| [#9200](https://github.com/open-mercato/open-mercato/issues/9200) | bug(inbox_ops): proposal notifier job fails and retries forever when notifications is disabled |
| [#9202](https://github.com/open-mercato/open-mercato/issues/9202) | bug(planner): tenant initialization fails with "Metadata for entity Dictionary not found" when dictionaries is disabled |
| [#9208](https://github.com/open-mercato/open-mercato/issues/9208) | bug(search): fulltext and vector reindex/cancel routes return 500 when progress is disabled |
| [#9209](https://github.com/open-mercato/open-mercato/issues/9209) | bug(security): MFA and password security e-mails are never sent when notifications is disabled |
| [#9213](https://github.com/open-mercato/open-mercato/issues/9213) | bug(translations): supported-locales API returns 500 when configs is disabled |
| [#9214](https://github.com/open-mercato/open-mercato/issues/9214) | bug(warranty_claims): tenant init, SLA escalation and portal attachments fail when dictionaries, notifications or attach |
| [#9215](https://github.com/open-mercato/open-mercato/issues/9215) | bug(webhooks): outbound delivery, inbound, test and retry fail with an IntegrationState metadata error when integrations |
| [#8715](https://github.com/open-mercato/open-mercato/issues/8715) | Add durable browser coverage for CrudForm redirect submit locking |
| [#9033](https://github.com/open-mercato/open-mercato/issues/9033) | bug: Perspectives drop saved filters on every DataTable that uses the classic FilterBar |
| [#3386](https://github.com/open-mercato/open-mercato/issues/3386) | Roll out two-phase bounded encrypted-sort to remaining UI-sortable list endpoints |
| [#2253](https://github.com/open-mercato/open-mercato/issues/2253) | security(integrations): GET credentials endpoint returns fully decrypted secrets (no masking / write-only handling) |
| [#2270](https://github.com/open-mercato/open-mercato/issues/2270) | security(api_docs): unauthenticated OpenAPI/markdown endpoints expose full internal API surface + ACL feature names |
| [#3836](https://github.com/open-mercato/open-mercato/issues/3836) | security(communication_channels): OAuth state cookie is not single-use (replayable within 5-min TTL) (lib/oauth-state.ts |
| [#3852](https://github.com/open-mercato/open-mercato/issues/3852) | security(ent_security): passkey MFA second factor bypassable via non-cryptographic fallback (PasskeyProvider.ts:47-55) |
| [#3856](https://github.com/open-mercato/open-mercato/issues/3856) | security(ent_security): emergency MFA bypass flag disables the second factor tenant-wide when enabled (lib/security-conf |
| [#5212](https://github.com/open-mercato/open-mercato/issues/5212) | Fix: reject MFA-pending tokens from general staff APIs |
| [#3820](https://github.com/open-mercato/open-mercato/issues/3820) | security(auth): user-consents GET returns cross-tenant rows for null-tenant super admin (route.ts:60) |
| [#2662](https://github.com/open-mercato/open-mercato/issues/2662) | security(ai_assistant): Code Mode logs AI-generated code and tool args verbatim (potential secret disclosure) |
| [#3805](https://github.com/open-mercato/open-mercato/issues/3805) | security(ai_assistant): mutation-approval gate bypassable via direct tool execution (api/tools/execute/route.ts:60) |
| [#5211](https://github.com/open-mercato/open-mercato/issues/5211) | Fix: enforce per-entity ACL in the legacy AI search tool pack |
| [#3928](https://github.com/open-mercato/open-mercato/issues/3928) | security(webhooks): route-level inbound replay protection relies solely on messageId dedup, no timestamp-window enforcem |
| [#2250](https://github.com/open-mercato/open-mercato/issues/2250) | security(currencies): cross-tenant write/delete of currencies & exchange rates via id-only command load (fail-open scopi |
| [#8255](https://github.com/open-mercato/open-mercato/issues/8255) | bug: Markdown editor: Ctrl+Enter saves the old text and silently loses what was just typed |

## Method

1. Fetched all 1,729 open and 2,700 most recent closed issues with `gh issue list`. Checked the state of every issue in the earlier list and dropped the ones that are now closed.
2. Keyword-classified every open issue into the five pillars (decoupling, swappability, CrudForm, DataTable, CRUD/API, security), then read about 700 candidate titles and selected by hand. Labels `security`, `extensibility` and `road-to-v1.0.0` were always included.
3. Pulled cross-referenced PRs for every selected issue (GraphQL timeline) to separate _fix PR open_ from _likely already fixed_ from _no work started_.
4. Tiered each issue against the kernel scope in #9678: modules that stay in core count toward 1.0, business modules go to the extraction track.

**Tiers:** P0 = must close before 1.0 · P1 = strong 1.0 candidate · P2 = polish or a decision that can follow 1.0.
