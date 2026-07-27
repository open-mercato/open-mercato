# `mercato upgrade` — a single, lock-guarded reconcile phase for existing deployments

**Date:** 2026-07-27
**Status:** draft — awaiting maintainer decision on Open Question 1
**Owner:** unassigned (proposed by Full Stack House, surfaced from a production incident)
**Scope:** OSS. Touches `packages/cli`, `packages/core/src/modules/{entities,auth,feature_toggles}`, `docker/scripts/`, `packages/create-app/template/`, `apps/docs/docs/cli/`.

**Related work:**
- **Prerequisite, separate PR, NOT part of this spec:** `nav.ts` enabled-modules cache fingerprint + TTL (`packages/core/src/modules/auth/api/admin/nav.ts:141-176`). ~10 lines, no contract surface, ships independently. This spec does not depend on it.
- `.ai/specs/2026-06-04-aws-terraform-deployment-playbook.md:127,742,1160` — already routes around `init-or-migrate.sh` because its marker file races across Fargate tasks. Independent confirmation that the current bootstrap contract does not survive multi-replica deploys.
- `.ai/specs/2026-05-12-railway-one-command-deploy.md` + `apps/docs/docs/deployment/railway.mdx` — Railway runs `init-or-migrate.sh` inside the app container, so N replicas race on boot.
- CHANGELOG #1181 (`#1099`) — "Add seed:defaults command for existing databases". Examined in detail below; **it is not the safe precedent it appears to be.**

---

## TLDR

Open Mercato ships idempotent reconcile commands that its own docs tell operators to run after a module change. **No deployment path in the repo runs them.** After first boot, every Open Mercato deployment runs `yarn db:migrate` and nothing else, forever. Enable a module that declares custom fields or ACL features, deploy it, and the schema lands while the *definitions* silently do not.

Proposal: add `mercato upgrade` — one advisory-locked phase composing the **four provably-idempotent** reconcile steps — and point `init-or-migrate.sh`'s steady-state path at it.

**`setup.seedDefaults` is deliberately excluded.** An audit of all 21 implementations found three that destructively overwrite tenant configuration on re-run (`sync_excel` wipes integration credentials to `{}`), several that silently revert admin customisations, and explicit in-repo comments stating "seed hooks are not fully idempotent". Reconciling that class needs a separate opt-in `setup.reconcile?()` hook, proposed here as future work rather than smuggled into a deploy-time command.

---

## Problem Statement

### 1. `init` hard-aborts on a populated database, and the fallback drops everything but migrations

`mercato init` refuses to run once `users` is non-empty:

```typescript
// packages/cli/src/mercato.ts:1030-1041
if (Number.isFinite(existingUsersCount) && existingUsersCount > 0) {
  console.error(
    `❌ Initialization aborted: found ${existingUsersCount} existing user(s) in the database.`,
  )
  ...
  return 1
}
```

`init-or-migrate.sh` string-matches that message and degrades to migrations alone:

```sh
# docker/scripts/init-or-migrate.sh:7
ALREADY_INITIALIZED_PATTERN='Initialization aborted: found [0-9][0-9]* existing user\(s\) in the database\.'
# :43-48
if grep -Eq "${ALREADY_INITIALIZED_PATTERN}" "${LOG_FILE}"; then
  echo "Initialization reported existing users; treating database as already initialized."
  echo "Running migrations..."
  ...MIGRATE_COMMAND...
```

…and the steady-state path — every deploy after the first — is unconditionally migrations-only (`:67`, `echo "Subsequent run: migrations only..."`).

This script is the deploy entrypoint on every path the repo ships: `docker/scripts/dev-entrypoint.sh:58`, `docker/scripts/railway-entrypoint.sh:13`, `docker-compose.fullapp.yml:135`, `packages/create-app/template/docker/scripts/dev-entrypoint.sh:93`, `packages/create-app/template/docker-compose.fullapp.yml:22`, `packages/create-app/template/scripts/railway-start.sh:9`.

### 2. The skipped steps are documented as required

| Source | What it says |
|---|---|
| `apps/docs/docs/cli/entities-install.mdx:7` | "It is typically executed **after `yarn db:migrate`** or any time module metadata changes." |
| `packages/core/src/modules/customers/AGENTS.md:103` | declare fields in `ce.ts` "so `yarn mercato entities install` can **repair existing tenants**" |
| `BACKWARD_COMPATIBILITY.md:303` | "The new ACL feature `communication_channels.channel.push.manage` **must be granted via `yarn mercato auth sync-role-acls` post-deploy** for the 'Re-register push' button to appear." |
| `packages/core/AGENTS.md:259` | lists `auth sync-role-acls` as the mechanism for propagating `defaultRoleFeatures` |

`BACKWARD_COMPATIBILITY.md:303` is the sharpest statement of the problem: a shipped feature's documented migration path is a manual CLI invocation that no deployment performs. Every operator who did not read that line has a half-installed feature.

Grep confirms none of these run at deploy time — `entities install` appears in zero scripts or workflows.

### 3. `db:migrate` takes no lock

```typescript
// packages/cli/src/lib/db/commands.ts:391-406
const migrator = orm.migrator as Migrator
const pending = await migrator.getPending()
...
for (const migration of pending) {
  await migrator.up(migrationName ? { migrations: [migrationName] } : undefined)
```

Two concurrent runs both observe the same `getPending()` and both apply → `42P07 relation already exists`. Today the only guard is GitHub Actions' `concurrency:` group, which does not cover a manual `kubectl create job`, an orphaned migrate Job, or a multi-replica rollout. On Railway the entrypoint runs *inside the app container*, arbitrated only by a marker file on a shared volume.

### 4. Cache purge is a workaround, not a fix — and is out of scope

Recorded so the spec's exclusions are auditable. `mercato configs cache structural` enumerates keys via the **blocking Redis `KEYS`** command, not `SCAN`:

```typescript
// packages/cache/src/strategies/redis.ts:354-359
const keys = async (pattern?: string): Promise<string[]> => {
  const client = await getRedisClient()
  const searchPattern = pattern ? `${keyPrefix}${pattern}` : `${keyPrefix}*`
  const cacheKeys = await client.keys(searchPattern)
```

`runStructuralCachePurge` loops three fixed requests (`configs/cli.ts:19-23`), each creating and disposing its own DI container, so `--all-tenants` issues `3 × (1 + T)` blocking keyspace scans exactly when cold pods are taking traffic. (Correcting a common misreading: the command **defaults to global scope only** — `configs/cli.ts:111-113` — so the plain invocation is already the cheap one; `--all-tenants` is the expensive opt-in.)

Purge is also order-sensitive against a rollout: purge before rollout and an old pod re-warms the key from the old manifest. That is why the nav fingerprint fix, not a purge step, is the right answer for nav. **`upgrade` includes no cache purge.**

---

## Proposed Solution

### First: why `seed:defaults` is not the precedent it looks like

`mercato seed:defaults` (`packages/cli/src/mercato.ts:1425-1485`) iterates every organization in a populated database and calls every module's `seedDefaults`. It was added "for existing databases" (CHANGELOG #1181). The tempting conclusion is that re-running `seedDefaults` on every deploy is already sanctioned and `upgrade` can simply include it.

**An audit of all 21 `seedDefaults` implementations says otherwise.** The repo does not believe its own seed hooks are idempotent, and says so in three places:

```typescript
// packages/onboarding/src/modules/onboarding/lib/provisioning.ts:24-30
if (isUniqueViolation(error)) {
  // Expected when a concurrent verify / re-verify re-applies a step against
  // rows that already exist (seed hooks are not fully idempotent). The
  // workspace is already provisioned, so the collision is harmless — log at
  // info to keep genuine non-fatal failures visible.
```

The same comment appears at `packages/onboarding/src/modules/onboarding/api/get/onboarding/verify.ts:70-77`, and `packages/onboarding/src/__tests__/provisioning.test.ts:44-47` is a regression test asserting the duplicate-key collision is expected.

Concrete failures a deploy-time `seedDefaults` would cause:

| Module | File:line | Behaviour on re-run |
|---|---|---|
| **`sync_excel`** | `packages/core/src/modules/sync_excel/setup.ts:10-18` | `credentialsService.save('sync_excel', {}, scope)` — `save()` unconditionally overwrites (`integrations/lib/credentials-service.ts:243-247`). **Wipes the tenant's configured credentials to `{}` and force-re-enables the integration.** Data loss, every deploy. |
| `sso` | `packages/enterprise/src/modules/sso/setup.ts:24-29` | `existing.allowedDomains = domains` unconditional overwrite from env. Dev-gated, so limited blast radius. |
| `sync_akeneo` | `packages/sync-akeneo/src/modules/sync_akeneo/setup.ts:11-31` | `applyAkeneoEnvPreset(...)` — same env-overwrite family. |
| `customers` | `commands/shared.ts:182-207` | `ensureDictionaryEntry` resets `color`/`icon` to seed values — **silently reverts admin-customised dictionary styling** across ~15 dictionary kinds. |
| `workflows` | `workflows/lib/seeds.ts:87-115` | Heuristic structural diff on step/transition counts **overwrites a tenant-edited workflow definition**. |
| `dashboards`, `staff` | `dashboards/lib/role-widgets.ts:41-75` | Append-only union — **a widget an admin deliberately removed comes back every run.** |
| `customers` | `customers/cli.ts:2949-2973` | `seedDefaultPipeline` keys on `isDefault: true`, not name; two `flush()` calls with no transaction. A crash between them leaves a stage-less pipeline that re-runs will **not** repair (early return on `existing`). Non-converging state. |
| systemic | e.g. `sales/seed/examples-data.ts:153-163`, `catalog/lib/seeds.ts:60-65` | Existence checks filter `deletedAt: null`, so **soft-deleted rows are resurrected as fresh duplicates.** |
| systemic | `customers/setup.ts:41-56`, `portal/setup.ts:7-8` | `FeatureToggle` lookups have **no tenant filter** — first tenant to run wins globally. |

Roughly 15 of 21 converge on row count; exactly one (`sales/setup.ts:16-46`) wraps itself in a transaction. Zero use `nativeInsert`/`ON CONFLICT`; the universal pattern is read-then-create, idempotent within one serialized run but racy across concurrent runs — which is precisely why onboarding sees 23505s.

**Conclusion:** `seed:defaults` is a manually-invoked operator tool whose hazards are tolerable because a human chose to run it. Putting it on the automatic path of every deploy converts "occasionally surprising" into "wipes `sync_excel` credentials on every rollout". `upgrade` therefore excludes it, and the drift-correction class gets its own opt-in hook (Open Question 1).

There is a nice exhibit for why the hook should be separate: `directory/setup.ts:6-48` (`backfillOrganizationSlugs`) filters `slug: null` and is a genuine no-op on re-run. **It seeds nothing and repairs pre-existing rows — it is already a `reconcile()`, misfiled as a `seedDefaults`.**

### `mercato upgrade`

A new top-level command. Under a single Postgres advisory lock:

| # | Step | Idempotency evidence | Notes |
|---|------|---------------------|-------|
| 1 | `dbMigrate(resolver)` | MikroORM migrations table | Schema first. Called directly, **not** via `runModuleCommand` — see Architecture. |
| 2 | `entities install` | Checksum-cache short-circuit (`entities/lib/install-from-ce.ts:245-253`), field-level diff (`lib/field-definitions.ts:126-136`), `upsertCustomEntity` returns `'unchanged'` (`lib/register.ts:53-60`) | Strongest of the four. Defaults to all non-deleted tenants (`install-from-ce.ts:195-200`). **Do not pass `--force`** — it defeats the cache and forces invalidation on every scope. |
| 3 | `auth sync-role-acls` | `ensureRoleAclFor` merges by set-union with change detection (`auth/lib/setup-app.ts:632-663`) | Additive-only: removing a feature from `defaultRoleFeatures` never revokes it. This is the step that fixes the originating incident. |
| 4 | `feature_toggles seed-defaults` | Create-only skip (`feature_toggles/cli.ts:335-339`) | Global, no tenant concept. Safe but does **not** reconcile drift — an edited toggle's `name`/`defaultValue` is skipped, not updated. `{ optional: true }`. |

**Explicitly excluded, with reasons:**

- **`setup.seedDefaults` / `seed:defaults`** — see the audit above. The single largest scope reduction from the originating proposal.
- **`configs restore-defaults`** — passes `force: true`, resetting `vector.auto_index_enabled` and notifications delivery config on every run (`configs/cli.ts:316-330`).
- **`setup.seedExamples`** — demo data.
- **Any cache purge** — Problem §4.
- **Reindexing** — `mercato reindex` (→ `query_index reindex`, `mercato.ts:1551-1555`) is minutes-scale and belongs to a separate operator decision. Note in passing: `apps/docs/docs/framework/database/hybrid-query-engine.mdx:20` documents `entities install --reindex`, **a flag that does not exist in the code** and is silently swallowed. Doc bug to fix in Phase 5.
- **User/tenant/org creation** — `upgrade` never creates a tenant, org, or user. This invariant is what makes it safe to run unattended.

### Advisory locking

A dedicated `pg.Client` — **never** the MikroORM pool, which recycles connections and would silently drop a session-level lock. Consistent with how `init` already opens raw clients (`mercato.ts:1020`).

```typescript
const UPGRADE_LOCK_NAMESPACE = 0x4f4d  // 'OM'
const UPGRADE_LOCK_ID = 0x5547         // 'UG'
```

`pg_try_advisory_lock(int4, int4)` with bounded retry — **not** plain `pg_advisory_lock`, which blocks indefinitely and converts a deploy race into a hung Job indistinguishable from slow migrations. On exhaustion: exit non-zero naming the lock, so the Job crashloops visibly. Defaults: retry every 5s for 10 minutes; `--lock-timeout=<seconds>`, `--no-lock` escape for local use.

Separately and as cheap defence in depth: `mikro_orm_migrations_<mod>` has no unique constraint on `name`. Adding one turns a lost race from silent double-apply into a constraint violation. Proposed as an independent follow-up (needs a migration per module table), not a blocker.

### Rewiring the deploy path

`init-or-migrate.sh`'s default `MIGRATE_COMMAND` becomes `yarn mercato upgrade`, on both the fallback path (`:48`) and the steady-state path (`:70`). The env var stays overridable, so `MIGRATE_COMMAND='yarn db:migrate'` restores the old behaviour.

Because `upgrade` self-serializes, the marker file stops being load-bearing for correctness, and the AWS playbook's reason for bypassing the script (`2026-06-04-aws-terraform-deployment-playbook.md:742`) partly dissolves. Pipelines collapse from *migrate Job → rollout → purge Job* to *upgrade Job → rollout*.

**Ordering rationale (pre-rollout, not post):** steps 2-4 are additive — they install definitions and grant features that the *new* code declares, while old pods still serve. Old pods ignore what they don't know about. Running post-rollout would instead leave new pods serving without their features for the duration of the reconcile.

Note the Job runs the **new** image (it needs the new `modules.ts`, migrations, `ce.ts` and `acl.ts`); only the serving Deployment is still on the old one during the window.

### Why there is no post-deploy step

The originating proposal's pipeline ended with a post-rollout purge Job (PR #206, closed unmerged). Three distinct jobs such a step could do, each resolved separately:

1. **Purge the nav cache.** Obsoleted by the fingerprint fix. Old pods compute the old fingerprint and write old-fingerprint keys; new pods read new-fingerprint keys. The two populations stop sharing a cache entry, which removes both the staleness *and* the ordering constraint that made a purge Job hard to place. A purge would also mean a thundering herd of cold nav rebuilds precisely when new pods are taking first traffic.

2. **Run the reconcile once new code is live.** This is strictly worse than pre-rollout, not a missing safeguard. Post-rollout leaves new pods serving without their definitions and ACLs for the duration of the reconcile — reintroducing the exact bug this spec exists to fix. Pre-rollout is not a compromise; it is the correct placement.

3. **Invalidate caches that `upgrade`'s own writes made stale.** This one is real, and is handled *inside* `upgrade` rather than by a Job — see the defect below. It needs a targeted `deleteByTags` call, not a keyspace scan in a separate pod.

The invalidation gap in detail: `auth sync-role-acls` writes `RoleAcl` rows via `ensureRoleAclFor` and **never invalidates the RBAC cache**, while every *API* path performing the same mutation does — `auth/api/roles/acl/route.ts:254`, `auth/api/users/acl/route.ts:243`, `auth/commands/users.ts:1068`. `RbacService.invalidateTenantCache(tenantId)` already exists for this, and its doc comment says so verbatim: *"Call this when a role's ACL is modified, since roles are tenant-scoped and affect all users in that tenant who have that role."* The CLI is the odd one out.

Two properties bound the blast radius, and are why this is a defect fix rather than an argument for a purge Job:

- **It self-heals.** The RBAC cache sets a TTL (`rbacService.ts:30`, 5 minutes default), unlike nav's TTL-less `set`. Worst case is a ≤5-minute stale-grant window, not the immortal-key class of bug.
- **It cannot cross-contaminate across image versions.** The cached `AclData.features` is the **raw** grant list; `filterGrantsByEnabledModules` is applied at *check* time (`rbacService.ts:416,467`), so each pod filters against its own module registry. An old pod warming the RBAC cache during the pre-rollout window cannot poison new pods with old-module-set filtering. This is exactly why nav — which caches the already-filtered payload — needed a fingerprint and the RBAC cache does not.

Fixing it in `sync-role-acls` itself (Phase 3) rather than in `upgrade` also repairs the manual invocation path that `BACKWARD_COMPATIBILITY.md:303` instructs operators to use.

---

## Architecture

```
mercato upgrade [--tenant <id>] [--dry-run]
                [--lock-timeout=<s>] [--no-lock] [--skip=<step,...>]
  │
  ├─ acquire pg_try_advisory_lock(0x4F4D, 0x5547) on a dedicated pg.Client
  │  └─ retry loop; non-zero exit on timeout
  │
  ├─ guard: empty `users` table → exit non-zero pointing at `mercato init`
  ├─ generators + bootstrapFromAppRoot + registerCliModules  (as init does, mercato.ts:1052-1078)
  │
  ├─ 1. await dbMigrate(resolver)                                    ← direct import, see below
  ├─ 2. runModuleCommand(mods, 'entities', 'install', scopeArgs)
  ├─ 3. runModuleCommand(mods, 'auth', 'sync-role-acls', scopeArgs)
  ├─ 4. runModuleCommand(mods, 'feature_toggles', 'seed-defaults', [], { optional: true })
  │
  └─ release lock (on every path, including throw)
```

**Placement.** `run()` in `packages/cli/src/mercato.ts:862` is a series of `if (first === 'x') { … return N }` early returns, then a generic `<module> <command>` dispatcher from `:1487`. `upgrade` goes as a top-level early-return block alongside `init`, i.e. in the `:1324`–`:1485` band, because it orchestrates other modules the way `init` does.

**Two implementation traps the code makes easy to fall into:**

1. **`buildAllModules()` does not include the built-in modules.** It returns generated CLI modules plus the app's `@/cli` as a pseudo-module (`mercato.ts:843-860`); `db`, `deploy`, `queue`, `generate`, `server` and `test` are pushed inline in the *generic* dispatch path at `:1577`+ and are invisible to it. So `runModuleCommand(await buildAllModules(), 'db', 'migrate')` fails with `missing-module`. Step 1 must `await import('./lib/db')` and call `dbMigrate` directly, exactly as the built-in `db` module does at `:1925-1931`.

2. **`{ optional: true }` only tolerates *resolution* failure**, not runtime failure (`mercato.ts:679-707`). It returns `false` when the module is absent, has no `cli`, or lacks the command; an exception thrown by `run()` propagates regardless. That is the semantics we want for step 4 (`feature_toggles` may be disabled) — but it must not be mistaken for "best-effort, ignore errors".

**Scope flags must be passed explicitly.** Per-command defaults are inconsistent: `entities install` defaults to all tenants, `configs cache structural` defaults to global-only. `upgrade` should never rely on them.

### Pre-existing defects worth fixing in the same change

Cheap, in-scope, and each is a latent bug that `upgrade` would amplify:

1. `auth sync-role-acls` selects tenants with `em.find(Tenant, {})` (`auth/cli.ts:830`) — **no `deletedAt` filter**, unlike `entities install` (`install-from-ce.ts:196`). Soft-deleted tenants get ACL writes.
2. Its flag parser (`auth/cli.ts:790-803`) only supports `--tenant <id>`, not `--tenant=<id>`; the latter is read as a flag literally named `tenant=<id>` and silently ignored — a scoped run would become an all-tenant run.
3. `ensureCustomRoleAcls` resolves and merges each custom role **twice per tenant** (once via `ensureDefaultRoleAcls` at `setup-app.ts:582-587`, once directly at `:620-626`), each with its own `flush()`.
4. `feature_toggles seed-defaults` never disposes its DI container, unlike its sibling `override-set-value` (`feature_toggles/cli.ts:302-307`) — a leak that matters once it runs inside a longer chained process.
5. **`auth sync-role-acls` does not invalidate the RBAC cache** after mutating `RoleAcl` rows, unlike every equivalent API path (`roles/acl/route.ts:254`, `users/acl/route.ts:243`, `commands/users.ts:1068`). Call `RbacService.invalidateTenantCache(tenantId)` once per synced tenant. Bounded today by the 5-minute TTL at `rbacService.ts:30`, which is why it has gone unnoticed. This is the fix that removes the last argument for a post-deploy Job.

### Cost on the rollout critical path

Steps 2 and 3 iterate every tenant when unscoped.

- **Step 2** is `E_global + (E_tenant × T)` iterations at ~3 queries each, but collapses to a single cache `GET` per iteration when warm and undrifted. There are 13 `ce.ts` files, so `E` is a few dozen.
- **Step 3** is the chatty one: roughly `T × (6 + 4·C)` queries where `C` is the number of custom roles, with a `flush()` per ACL write and no batching.
- **Step 4** is constant (5 selects, zero writes on re-run).

Negligible at one tenant; unmeasured at high tenant counts. In scope: `--tenant` scoping and per-step timings on stdout. **Out of scope: optimising the per-tenant loops.** This spec deliberately makes no performance claim it has not measured; that is a follow-up once real numbers exist.

## Data Models

No schema changes. No new entities, columns, or migrations.

The adjacent observation — the missing unique constraint on `mikro_orm_migrations_<mod>.name` — is called out above as a separate follow-up.

## API Contracts

No HTTP API changes. No route, OpenAPI, event, widget-spot, DI-key, ACL-feature or notification-ID changes.

**CLI contract surface** — `BACKWARD_COMPATIBILITY.md:231-235`, category 13, classified STABLE:

> - MUST NOT rename or remove existing CLI commands or their required flags
> - MAY add new commands or optional flags freely

`mercato upgrade` is purely additive, which the contract permits without a deprecation cycle. `seed:defaults`, `entities install`, `auth sync-role-acls` and `feature_toggles seed-defaults` keep their names, flags and behaviour. Once `upgrade` ships it is itself covered by the same rule.

**`ModuleSetupConfig`** — `BACKWARD_COMPATIBILITY.md:25,62` lists it as MUST-NOT-remove but explicitly permits *adding optional hooks*. So the `reconcile?()` of Open Question 1 is sanctioned; this spec's Phase 1-5 do not add one.

**Behavioural change requiring documentation:** `init-or-migrate.sh`'s steady-state path does more than before. `UPGRADE_NOTES.md` entry with the `MIGRATE_COMMAND='yarn db:migrate'` opt-out.

## Phases

Each phase is independently mergeable and independently useful.

**Phase 1 — lock primitive.** `withUpgradeLock(fn)` + unit tests (acquire, contend, timeout, release-on-throw, dedicated-client assertion). No behaviour change to any existing command.

**Phase 2 — `mercato upgrade`.** The command composing steps 1-4, the empty-database guard, per-step timings. Docs page `apps/docs/docs/cli/upgrade.mdx` + CLI overview entry.

**Phase 3 — pre-existing defect fixes.** The four items above. Independently reviewable; each gets a test.

**Phase 4 — deploy rewire.** `init-or-migrate.sh` default `MIGRATE_COMMAND`, mirrored into `packages/create-app/template/` per the root AGENTS.md template-sync rule. `UPGRADE_NOTES.md`.

**Phase 5 — documentation truth-up.**
- `ModuleSetupConfig.seedDefaults` JSDoc (`packages/shared/src/modules/setup.ts:39-46`): correct "Called during `mercato init`" — `seed:defaults` and onboarding's `verify.ts:285-300` also call it — and state plainly that it is **not** guaranteed idempotent and is **not** run at deploy time.
- Add the missing `apps/docs/docs/cli/seed-defaults.mdx`; the command has shipped since #1099 with no docs page and no CLI-overview entry. Document the re-run hazards.
- Fix `apps/docs/docs/framework/database/hybrid-query-engine.mdx:20` — `entities install --reindex` does not exist.

**Phase 6 (future, gated on Open Question 1) — `setup.reconcile?()`.** Opt-in hook for the drift-correction class, with `reconcile?: false` added to `SetupOverridesShape` (`packages/shared/src/modules/overrides.ts:100-107`) and its delete line (`:1276-1278`), plus a `contract-overrides.test.ts` case. Migrate `directory.backfillOrganizationSlugs` to it as the reference implementation. Only then does `upgrade` gain a fifth step.

## Test Coverage

Per root `AGENTS.md` a spec must list integration coverage for affected API and UI paths. **This change has no API routes and no UI surface** — CLI and deploy scripts only. The equivalent obligation:

| Area | Coverage |
|------|----------|
| `withUpgradeLock` | Unit: acquires; second holder contends and times out non-zero; releases on throw; uses a dedicated client, not the ORM pool; `--no-lock` bypass. |
| `upgrade` step order | Unit with mocked `runModuleCommand`: asserts the exact 4-step order and that step 1 calls `dbMigrate` directly rather than via `runModuleCommand`. |
| **Exclusion guard** | Unit: asserts `seedDefaults`, `seedExamples`, `configs restore-defaults` and any reindex are **never** invoked. This is a regression guard against someone re-adding them without revisiting the audit. |
| `feature_toggles` disabled | Unit: step 4 tolerates absence via `{ optional: true }`; and a runtime throw from step 4 still fails the command. |
| Empty-DB guard | Unit: exits non-zero pointing at `mercato init`. |
| Idempotency | Integration: run `upgrade` twice against a seeded ephemeral DB (`yarn test:integration:ephemeral`); assert the second run adds no rows to `custom_field_defs`, `custom_entities`, `role_acls`, `feature_toggles`. **This is the test that would have caught the original incident.** |
| Defect fixes (Phase 3) | Unit: soft-deleted tenants excluded from `sync-role-acls`; `--tenant=<id>` parsed; custom roles merged once per tenant; container disposed; **`invalidateTenantCache` called once per synced tenant** (the post-deploy-step replacement — assert it is tag-based, not a keyspace scan). |
| Deploy script | Shell-level: `init-or-migrate.sh` invokes `upgrade` on the steady-state path and honours a `MIGRATE_COMMAND` override. |

Integration tests must be self-contained per `.ai/qa/AGENTS.md`: fixtures created in setup, cleaned up in teardown, no reliance on seeded demo data.

## Risks & Impact Review

| # | Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|---|
| 1 | Someone later adds `seedDefaults` to `upgrade`, wiping `sync_excel` credentials on every deploy. | **High** | Any tenant with a configured integration | The audit is recorded in this spec; the exclusion-guard unit test fails the build if a step is added. | Low while the test stands. **The test is the control — do not drop it.** |
| 2 | Lock acquisition times out; the deploy Job exits non-zero and blocks the rollout. | Medium | Deploy pipeline | Bounded retry with a message naming the lock; `--lock-timeout`; `--no-lock`. | A genuinely stuck lock still blocks — correct, but needs a documented `pg_advisory_unlock` recovery runbook. |
| 3 | Per-tenant loops make `upgrade` slow enough to stall rollouts at high tenant counts. | Medium | Multi-tenant installs | `--tenant` scoping; per-step timings; nothing minutes-scale (no reindex) on the default path. | **Unquantified.** No measurements exist. Explicitly deferred. |
| 4 | `entities install` resurrects definitions an operator intentionally removed. | Medium | Existing tenants | Inherent to `install`'s declared purpose ("repair existing tenants"); unchanged by this spec, but now runs automatically rather than on request. | Real behaviour change. Call out in `UPGRADE_NOTES.md`. |
| 5 | `auth sync-role-acls` is additive-only, so a feature removed from `defaultRoleFeatures` is never revoked. | Medium | RBAC hygiene | Pre-existing (`setup-app.ts:632-663`); documented, not changed here. | Real; revocation needs its own design. |
| 6 | `upgrade` runs against a never-initialised database, producing confusing partial state. | Medium | New installs | Empty-`users` guard, exit non-zero pointing at `mercato init`. | Low. |
| 7 | Advisory lock taken on a pooled connection and silently dropped mid-run. | High if mis-implemented | Migration safety | Dedicated `pg.Client`; asserted in the Phase 1 unit test. | Low once tested. |
| 8 | Users see stale grants for up to 5 minutes after a pre-rollout `upgrade`, because `sync-role-acls` does not bust the RBAC cache. | Medium | Any deploy granting new ACL features | Phase 3 defect 5 — `invalidateTenantCache` per synced tenant. Until then, bounded and self-healing via the 5-minute TTL (`rbacService.ts:30`). | Low after Phase 3. Note Phase 2 without Phase 3 ships this window — a reason to keep them in one release. |
| 9 | Downstream apps pin an older `@open-mercato/*` and never receive the fix. | Medium | Fleet | Out of scope — dependency automation is per-consuming-repo. | Real; owned elsewhere. |

## Open Questions for Maintainers

1. **Does the `seedDefaults` audit justify a separate `setup.reconcile?()` hook (Phase 6), or should the drift-correction class stay a manual `seed:defaults` invocation indefinitely?** This spec ships `upgrade` without either, so Phases 1-5 are unblocked regardless — but the answer determines whether `seed:defaults`' hazards get fixed or merely documented. `BACKWARD_COMPATIBILITY.md:25` already permits adding optional hooks to `ModuleSetupConfig`.
2. **Should Phase 4 (default-on in `init-or-migrate.sh`) ship in the same release as Phase 2, or one release later?** Default-on fixes the fleet silently; a release of opt-in soak time is safer given Risk 4.
3. **Are the Phase 3 defect fixes wanted here, or should they be a separate PR?** Four of the five are independent of `upgrade` and bundling is convenience. **Defect 5 (RBAC cache invalidation) is not** — it is what makes a post-deploy step unnecessary, so it should land no later than Phase 2 (see Risk 8).

## Final Compliance Report

*(to be completed at implementation)*

- [ ] `.ai/agentic.config.json` validation sequence: `yarn build:packages` → `yarn generate` → `yarn build:packages` → `yarn i18n:check-sync` → `yarn i18n:check-usage` → `yarn typecheck` → `yarn test` → `yarn build:app`
- [ ] `yarn workspace @open-mercato/cli test`
- [ ] `yarn test:integration:ephemeral` for the two-run idempotency test
- [ ] `BACKWARD_COMPATIBILITY.md` category 13 reviewed — additive command, no rename/removal
- [ ] `UPGRADE_NOTES.md` entry: `init-or-migrate.sh` behaviour change, Risk 4 (`entities install` now automatic), the `MIGRATE_COMMAND` opt-out
- [ ] `packages/create-app/template/` mirrored per the root AGENTS.md template-sync rule
- [ ] `apps/docs/docs/cli/upgrade.mdx` + `seed-defaults.mdx` added; `overview.mdx` index updated; `hybrid-query-engine.mdx:20` corrected
- [ ] No hard-coded user-facing strings (`[internal]` convention where applicable)
- [ ] `yarn agents:check-budget` if any `AGENTS.md` is touched

## Changelog

- **2026-07-27** — Initial draft. Verified against `develop` at `e5ad6e8cdc`: `init` abort (`mercato.ts:1030-1041`), `init-or-migrate.sh:7,43-48,67`, `dbMigrate` lock absence (`lib/db/commands.ts:391-406`), `configs restore-defaults` `force: true` (`configs/cli.ts:316-330`), Redis `KEYS` (`cache/src/strategies/redis.ts:354-359`), `seed:defaults` semantics (`mercato.ts:1425-1485`), `ModuleSetupConfig` JSDoc gap (`shared/src/modules/setup.ts:32-46`), and a full idempotency audit of all 21 `setup.seedDefaults` implementations.
  Scope reduced twice from the originating proposal: no cache-purge step, no reindex, no performance budget — and, after the audit, **no `seedDefaults` step**, which was the proposal's largest component. The audit reversed this spec's own first draft, which had argued `seed:defaults` made re-running `seedDefaults` safe.
  Added "Why there is no post-deploy step" after review challenged the pre-rollout-only pipeline. That review surfaced Phase 3 defect 5: `auth sync-role-acls` never invalidates the RBAC cache, unlike the three API paths performing the same mutation. Confirmed bounded by the 5-minute TTL at `rbacService.ts:30`, and confirmed non-contaminating across image versions because `AclData.features` caches **raw** grants with `filterGrantsByEnabledModules` applied at check time (`rbacService.ts:416,467`) — the asymmetry with nav's cached-filtered-payload that explains why only nav needs a fingerprint.
