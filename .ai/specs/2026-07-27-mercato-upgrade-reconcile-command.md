# `mercato upgrade` — a single, lock-guarded reconcile phase for existing deployments

**Date:** 2026-07-27
**Status:** draft, revised 2026-10-07 to answer the **merge-time** review on PR #4547 — a `CHANGES_REQUESTED` submitted eight seconds before the merge and never addressed. Phases 1-2 ship together in the PR carrying this revision; Phase 3, Phase 4, Phase 5, the defects PR and the gated phases are explicitly sequenced after it. Only Q1 decides new contract surface, and it gates Phase 6 alone.
**Owner:** unassigned (proposed by Full Stack House, surfaced from a production incident)
**Scope:** OSS. Touches `packages/cli`, `packages/core/src/modules/{entities,auth,feature_toggles}`, `docker/scripts/`, `packages/create-app/template/`, `apps/docs/docs/cli/`.

**Related work:**
- **Prerequisite, now landed.** The `nav.ts` enabled-modules cache fingerprint + TTL shipped independently, as this spec proposed: the cache key carries `v7:${getModuleSurfaceFingerprint()}` (`packages/core/src/modules/auth/api/admin/nav.ts:8,166`) and the write is TTL-bounded with `NAV_CACHE_TTL_MS` (`:201`). § Why there is no post-deploy step argued from this fix as a pending prerequisite; it is now a fact, and that argument is correspondingly stronger.
- `.ai/specs/2026-06-04-aws-terraform-deployment-playbook.md:127,742,1160` — already routes around `init-or-migrate.sh` because its marker file races across Fargate tasks. Independent confirmation that the current bootstrap contract does not survive multi-replica deploys.
- `.ai/specs/2026-05-12-railway-one-command-deploy.md` + `apps/docs/docs/deployment/railway.mdx` — Railway runs `init-or-migrate.sh` inside the app container, so N replicas race on boot.
- CHANGELOG #1181 (`#1099`) — "Add seed:defaults command for existing databases". Examined in detail below; **it is not the safe precedent it appears to be.**

---

## TLDR

Open Mercato ships idempotent reconcile commands that its own docs tell operators to run after a module change. **No deployment path in the repo runs them properly.** After first boot, every Open Mercato deployment runs `yarn db:migrate` plus — since 2026-08 — one unlocked, non-fatal `auth sync-role-acls` bolted into a shell script. Enable a module that declares custom fields, deploy it, and the schema lands while the *definitions* silently do not.

Proposal: one advisory-lock **contract** covering every shipped migration entrypoint, not a lock on one new command. `db:migrate` becomes the locked public migration path; `mercato upgrade` composes it with the **three provably-idempotent** reconcile steps under the same, singly-acquired lock; `init-or-migrate.sh`'s steady-state path points at `upgrade`. Whichever door a process comes in through, it serializes on the same lock.

**`setup.seedDefaults` is deliberately excluded from the default path.** An audit of 21 implementations found three that destructively overwrite tenant configuration on re-run (`sync_excel` wipes integration credentials to `{}`), several that silently revert admin customisations, and explicit in-repo comments stating "seed hooks are not fully idempotent". It is reachable only through an explicit `--with-seed-defaults` flag that prints the hazard list before it runs. Reconciling that class *safely* needs a separate opt-in `setup.reconcile?()` hook, proposed here as future work rather than smuggled into a deploy-time command.

`upgrade` also **tells the operator what it did not do** — the follow-up commands it deliberately skips, and the instruction to check `UPGRADE_NOTES.md` for source-level changes and apply the companion `om-auto-upgrade-<from>-<to>` skill with a coding agent if one is listed.

---

## Problem Statement

### 1. `init` hard-aborts on a populated database, and the fallback drops every reconcile step but one

`mercato init` refuses to run once `users` is non-empty:

```typescript
// packages/cli/src/mercato.ts:1070-1081
if (Number.isFinite(existingUsersCount) && existingUsersCount > 0) {
  console.error(
    `❌ Initialization aborted: found ${existingUsersCount} existing user(s) in the database.`,
  )
  ...
  return 1
}
```

`init-or-migrate.sh` string-matches that message and degrades to migrations plus one reconcile step:

```sh
# docker/scripts/init-or-migrate.sh:8
ALREADY_INITIALIZED_PATTERN='Initialization aborted: found [0-9][0-9]* existing user\(s\) in the database\.'
# :65-73
if grep -Eq "${ALREADY_INITIALIZED_PATTERN}" "${LOG_FILE}"; then
  ...
      if run_command_with_cli_recovery "${MIGRATE_COMMAND}" "${RECOVERY_LOG_FILE}"; then
        ...
        sync_role_acls
```

…and the steady-state path — every deploy after the first — does the same: `MIGRATE_COMMAND`, then `sync_role_acls` (`:90-96`).

**This spec's first draft said that path was "unconditionally migrations-only". It no longer is, and the correction matters.** Commit `eb1a539306` (2026-08-20, *"fix(docker): sync role ACLs on redeploy so newly enabled modules stay reachable"*) added a `sync_role_acls()` helper (`:38-49`, env-overridable via `SYNC_ROLE_ACLS_COMMAND` at `:7`) that runs `yarn mercato auth sync-role-acls` after every successful migration, on **both** the existing-users fallback path (`:73`) and the steady-state path (`:96`). The `echo "Subsequent run: migrations only..."` at `:90` is now false advertising for its own script. The template copy is byte-identical to the root one.

That does not weaken the case for `upgrade`; it sharpens it into a comparison:

| Property | Today's `sync_role_acls()` | What `upgrade` provides |
|---|---|---|
| Serialization | None. Every replica fires it concurrently with every other replica's migrate. | One advisory lock across every migration entrypoint. |
| Failure semantics | Non-fatal by design: a `WARNING` line and a zero exit (`:43-46`). A deploy that silently failed to reconcile looks green. | A step that fails fails the run. |
| Coverage | One of the four reconcile steps. | All four, in a defined order, schema first. |
| Cache coherence | Does not invalidate the RBAC cache — defect 5, unfixed. | Invalidation inside the same lock (Phase 3). |
| Scope hygiene | Inherits defect 1 (writes ACLs to soft-deleted tenants). | Explicit scope flags, never per-command defaults. |

Three consequences for the rest of this spec:

1. **Phase 4 changes shape**: it no longer *adds* a reconcile to the deploy path, it **replaces a partial, unlocked, non-fatal one** — and deletes the now-false `:90` echo.
2. **`entities install` and `feature_toggles seed-defaults` are still steps that no deployment path in the repo runs.** The originating incident class is intact; only its ACL step has an ad-hoc patch.
3. The patch is independent evidence that the gap is real enough that someone fixed one of its four steps in a shell script rather than wait for this spec.

This script is the deploy entrypoint on every path the repo ships: `docker/scripts/dev-entrypoint.sh:58`, `docker/scripts/railway-entrypoint.sh:13`, `docker-compose.fullapp.yml:183`, `packages/create-app/template/docker/scripts/dev-entrypoint.sh:93`, `packages/create-app/template/docker-compose.fullapp.yml:28`, `packages/create-app/template/scripts/railway-start.sh:9`.

### 2. The skipped steps are documented as required

| Source | What it says |
|---|---|
| `apps/docs/docs/cli/entities-install.mdx:7` | "It is typically executed **after `yarn db:migrate`** or any time module metadata changes." |
| `packages/core/src/modules/customers/AGENTS.md:103` | declare fields in `ce.ts` "so `yarn mercato entities install` can **repair existing tenants**" |
| `BACKWARD_COMPATIBILITY.md:340` | "The new ACL feature `communication_channels.channel.push.manage` **must be granted via `yarn mercato auth sync-role-acls` post-deploy** for the 'Re-register push' button to appear." |
| `packages/core/AGENTS.md:256-260` | lists `auth sync-role-acls` as the mechanism for propagating `defaultRoleFeatures` to existing tenants |

`BACKWARD_COMPATIBILITY.md:340` is the sharpest statement of the problem: a shipped feature's documented migration path is a manual CLI invocation. The 2026-08 shell patch (§1) covers that one line by accident, unlocked and non-fatally; nothing covers the others.

Grep confirms `entities install` still runs at deploy time nowhere — zero hits across `.github/`, `docker/`, `scripts/` and the create-app template outside doc comments in `example/ce.ts`.

### 3. `db:migrate` takes no lock

```typescript
// packages/cli/src/lib/db/commands.ts:400-415 (pre-Phase-1)
const migrator = orm.migrator as Migrator
const pending = await migrator.getPending()
...
for (const migration of pending) {
  await migrator.up(migrationName ? { migrations: [migrationName] } : undefined)
```

Two concurrent runs both observe the same `getPending()` and both apply → `42P07 relation already exists`. Today the only guard is GitHub Actions' `concurrency:` group, which does not cover a manual `kubectl create job`, an orphaned migrate Job, or a multi-replica rollout. On Railway the entrypoint runs *inside the app container*, arbitrated only by a marker file on a shared volume.

MikroORM will not solve this upstream: v7 takes no lock of any kind — no advisory lock, no lock table, no `FOR UPDATE` on the tracking table (which also lacks a unique index on `name`). What "serializes" two concurrent migrators today is the `ACCESS EXCLUSIVE` DDL locks inside the migration bodies — the second run blocks, then crashes. And this repo's loop above weakens even `allOrNothing`: one `migrator.up()` per migration per module means a run is `N_modules × M_migrations` independent transactions across separate ORM instances, with no umbrella transaction to hang safety on. Prior art is unambiguous about where the fix belongs: every migration tool that owns the deploy path locks by default (Rails, Prisma, Knex, Flyway, Liquibase, EF Core 9+, Atlas, Ecto), single-upgrade-verb platforms lock the verb (Magento `setup:upgrade`, Frappe `bench migrate`, Keycloak's Liquibase boot), and all of them take **one** global lock around the entire run — none lock per-migration.

### 4. Cache purge is a workaround, not a fix — and is out of scope

Recorded so the spec's exclusions are auditable. `mercato configs cache structural` enumerates keys via the **blocking Redis `KEYS`** command, not `SCAN`:

```typescript
// packages/cache/src/strategies/redis.ts:427-433
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

`mercato seed:defaults` (`packages/cli/src/mercato.ts:1479-1539`) iterates every non-deleted organization in a populated database and calls every module's `seedDefaults` (`:1515-1526`). It was added "for existing databases" (CHANGELOG #1181). The tempting conclusion is that re-running `seedDefaults` on every deploy is already sanctioned and `upgrade` can simply include it.

**An audit of all `seedDefaults` implementations says otherwise.** The repo does not believe its own seed hooks are idempotent, and says so in three places:

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
| **`sync_excel`** | `packages/core/src/modules/sync_excel/setup.ts:10-17` | `credentialsService.save('sync_excel', {}, scope)` — `save()` unconditionally overwrites an existing row (`integrations/lib/credentials-service.ts:289-292`). **Wipes the tenant's configured credentials to `{}` and force-re-enables the integration.** Data loss, every deploy. |
| `sso` | `packages/enterprise/src/modules/sso/setup.ts:24-29` | `existing.allowedDomains = domains` unconditional overwrite from env. Dev-gated, so limited blast radius. |
| `sync_akeneo` | `packages/sync-akeneo/src/modules/sync_akeneo/setup.ts:11-31` | `applyAkeneoEnvPreset(...)` — same env-overwrite family. |
| `customers` | `commands/shared.ts:187-210` | `ensureDictionaryEntry` resets `color`/`icon` to seed values whenever the seed supplies them — **silently reverts admin-customised dictionary styling** across ~15 dictionary kinds. |
| `workflows` | `workflows/lib/seeds.ts:89-115` | Heuristic structural diff on step/transition counts (`needsUpdate`, `:111-115`) **overwrites a tenant-edited workflow definition**. |
| `dashboards`, `staff` | `dashboards/lib/role-widgets.ts:41-75` | Append-only union — **a widget an admin deliberately removed comes back every run.** |
| `customers` | `customers/cli.ts:2966-2990` | `seedDefaultPipeline` keys on `isDefault: true`, not name; two `flush()` calls (`:2977`, `:2989`) with no transaction. A crash between them leaves a stage-less pipeline that re-runs will **not** repair (early return on `existing`, `:2968`). Non-converging state. |
| systemic | e.g. `sales/seed/examples-data.ts:153-163`, `catalog/lib/seeds.ts:60-65` | Existence checks filter `deletedAt: null`, so **soft-deleted rows are resurrected as fresh duplicates.** |
| systemic | `customers/setup.ts:41-56`, `portal/setup.ts:7-8` | `FeatureToggle` lookups have **no tenant filter** — first tenant to run wins globally. |

Roughly 15 of the 21 audited hooks converge on row count; exactly one (`sales/setup.ts:14-45`) wraps itself in a transaction. Zero use `nativeInsert`/`ON CONFLICT`; the universal pattern is read-then-create, idempotent within one serialized run but racy across concurrent runs — which is precisely why onboarding sees 23505s.

**The audited set has since grown and the audit was not repeated.** The July audit covered the 21 `seedDefaults` implementations present at `e5ad6e8cdc`; `develop` at `109790f058` has **34** (`grep -rlE '^\s+(async )?seedDefaults' --include=setup.ts packages apps`, minus the type declaration in `packages/shared/src/modules/setup.ts`). Thirteen are unaudited. That is an argument for the exclusion, not against it: an unaudited hook with write access to tenant configuration is exactly what must not be on the automatic path of every deploy.

**Conclusion:** `seed:defaults` is a manually-invoked operator tool whose hazards are tolerable because a human chose to run it. Putting it on the automatic path of every deploy converts "occasionally surprising" into "wipes `sync_excel` credentials on every rollout". `upgrade` therefore excludes it, and the drift-correction class gets its own opt-in hook (Open Question 1).

There is a nice exhibit for why the hook should be separate: `directory/setup.ts:6-48` (`backfillOrganizationSlugs`) filters `slug: null` and is a genuine no-op on re-run. **It seeds nothing and repairs pre-existing rows — it is already a `reconcile()`, misfiled as a `seedDefaults`.**

### `mercato upgrade`

A new top-level command. Under a single Postgres advisory lock:

| # | Step | Idempotency evidence | Notes |
|---|------|---------------------|-------|
| 1 | `dbMigrateUnlocked(resolver)` | MikroORM migrations table | Schema first. The internal, lock-free primitive — `upgrade` already holds the lock (see Advisory locking). Called directly, **not** via `runModuleCommand` — see Architecture. |
| 2 | `entities install` | Checksum-cache short-circuit (`entities/lib/install-from-ce.ts:246-254`), field-level diff (`lib/field-definitions.ts:143-153`), `upsertCustomEntity` returns `'unchanged'` (`lib/register.ts:74-79`) | Strongest of the four. Defaults to all non-deleted tenants (`install-from-ce.ts:196-201`). **Do not pass `--force`** — it defeats the cache and forces invalidation on every scope. |
| 3 | `auth sync-role-acls` | `ensureRoleAclFor` merges by set-union with change detection (`auth/lib/setup-app.ts:657-694`) | Additive-only: removing a feature from `defaultRoleFeatures` never revokes it. This is the step that fixes the originating incident, and the step the 2026-08 shell patch already runs unlocked and non-fatally (Problem §1). |
| 4 | `feature_toggles seed-defaults` | Create-only skip (`feature_toggles/cli.ts:335-339`) | Global, no tenant concept. Safe but does **not** reconcile drift — an edited toggle's `name`/`defaultValue` is skipped, not updated. `{ optional: true }`, plus an `ENOENT` tolerance (defect 7). |

**Explicitly excluded, with reasons:**

- **`setup.seedDefaults` / `seed:defaults`** — see the audit above. The single largest scope reduction from the originating proposal. Reachable only through the explicit `--with-seed-defaults` opt-in described below, never on the default path.
- **`configs restore-defaults`** — passes `force: true`, resetting `vector.auto_index_enabled` and notifications delivery config on every run (`configs/cli.ts:318-332`).
- **`setup.seedExamples`** — demo data.
- **Any cache purge** — Problem §4.
- **Reindexing** — `mercato reindex` (→ `query_index reindex`, `mercato.ts:1605-1609`) is minutes-scale and belongs to a separate operator decision.
- **User/tenant/org creation** — `upgrade` never creates a tenant, org, or user. This invariant is what makes it safe to run unattended.

#### What `upgrade` tells the operator it did not do

The merge-time review on PR #4547 asked for two things this spec's design did not provide: that the operator be told about the follow-up commands `upgrade` deliberately skips (with the option to auto-call them), and that they be pointed at `UPGRADE_NOTES.md` for changes affecting their own source. Both are design surface, not documentation, so both are specified here and ship with Phase 1+2.

**1. A "Not run by `upgrade`" block on every successful run.** Printed after the last step, naming each excluded follow-up with the one-line reason it is excluded and a pointer at this spec's audit:

```
ℹ️  Not run by `upgrade` (deliberately — see .ai/specs/2026-07-27-mercato-upgrade-reconcile-command.md):
   • mercato seed:defaults          module seed hooks are not idempotent; 3 of them overwrite
                                    tenant configuration on re-run. Opt in with --with-seed-defaults.
   • mercato reindex                minutes-scale; schedule it as its own operator decision.
   • mercato configs restore-defaults   passes force:true, resetting vector + notifications config.
```

**2. An `UPGRADE_NOTES.md` instruction on every successful run.** `upgrade` reconciles the *database*; it cannot reconcile the operator's own code against a platform contract change. The repo already ships the mechanism for that — `UPGRADE_NOTES.md:19-21` points at per-window companion skills under `.ai/skills/om-auto-upgrade-<from>-<to>/SKILL.md`, and `:374` is a live instance (`om-auto-upgrade-0.7.0-to-0.8.0`; four such skills exist today). So the output names it:

```
📋 Database reconciled. Source-level changes are not: review UPGRADE_NOTES.md for the window you
   upgraded across and apply anything affecting your own modules. If that section names a companion
   `om-auto-upgrade-<from>-<to>` skill, run it with a coding agent — it migrates most patterns
   mechanically.
```

**3. `--with-seed-defaults` — the opt-in escape hatch.** OFF by default. When passed, `upgrade` runs the `seed:defaults` pass (`mercato.ts:1479-1539`'s per-organization loop) as a **fifth** step, inside the same lock, after step 4. Before running it, the command prints a blocking warning naming the concrete hazards from this spec's own audit:

```
⚠️  --with-seed-defaults runs module seed hooks, which this repo does not treat as idempotent.
   Known destructive behaviour on re-run:
     • sync_excel      wipes configured integration credentials to {} and force-re-enables it
     • customers       reverts admin-customised dictionary colour/icon to seed values
     • workflows       overwrites a tenant-edited workflow definition on a structural diff
     • dashboards/staff  resurrects widgets an admin deliberately removed
     • systemic        existence checks filter deletedAt:null, so soft-deleted rows return as duplicates
   34 seedDefaults implementations exist; 21 were audited. MUST NOT be wired into a deploy script.
```

This does **not** soften the audit. The hazards are real, the exclusion from the default path is unchanged, and the conclusion stands: `seed:defaults` is a tool a human chooses to run. The flag changes only *which* command a human reaches for when they have chosen — one locked, serialized invocation instead of a bare `mercato seed:defaults` racing the migrate Job. It must never appear in `init-or-migrate.sh`, a Dockerfile `CMD`, a Railway start script, or an ECS task definition, and `UPGRADE_NOTES.md` says so in those words (Phase 4).

The exclusion-guard unit test (Risk 1's control) is unchanged in intent and extended in scope: the **default** path must never invoke `seedDefaults`, `seedExamples`, `configs restore-defaults` or any reindex, *and* the flag must read false unless explicitly passed, *and* passing it must emit the warning before the step runs.

### Advisory locking — one lock, every entrypoint

A dedicated `pg.Client` — **never** the MikroORM pool, which recycles connections and would silently drop a session-level lock. Consistent with how `init` already opens raw clients (`mercato.ts:981,1059`).

```typescript
const UPGRADE_LOCK_NAMESPACE = 0x4f4d  // 'OM'
const UPGRADE_LOCK_ID = 0x5547         // 'UG'
```

`pg_try_advisory_lock(int4, int4)` with bounded retry — **not** plain `pg_advisory_lock`, which blocks indefinitely and converts a deploy race into a hung Job indistinguishable from slow migrations. On exhaustion: exit non-zero naming the lock, so the Job crashloops visibly. Defaults: retry every 5s for 10 minutes; `--lock-timeout=<seconds>`, `--no-lock` escape for local use.

**`db:migrate` participates in the same lock.** Locking only `upgrade` while `db:migrate` stayed bare would leave the exact race from Problem §3 open through the doors that section names — the manual `kubectl create job`, the orphaned migrate Job, the `MIGRATE_COMMAND` override. So the migration primitive splits in two:

- **`dbMigrate(resolver)`** — the public entry, wrapped in `withUpgradeLock`. What `yarn db:migrate` and every deploy script reach. Signature and CLI surface unchanged; it gains the same `--lock-timeout`/`--no-lock` flags.
- **`dbMigrateUnlocked(resolver)`** — the internal primitive, no lock, exported for two callers: `upgrade`, which invokes it while already holding the lock, and `dbGreenfield`.

`dbGreenfield` is deliberately the second caller rather than a third locked entrypoint. It has already dropped every table before it migrates, outside any lock, so taking one for its final phase alone would protect nothing while implying the whole destructive sequence was serialized. The lock covers the *deployment* migration entrypoints; greenfield is a local reset. Locking its full body is a coherent future change, but it is a different guarantee from the one this spec makes.

The split is load-bearing, not cosmetic. Naively locking both `upgrade` and the inner migrate call self-deadlocks: `upgrade` holds the lock on its dedicated `pg.Client` (session A) while the nested acquisition would run on a different connection (session B). Advisory-lock re-entrancy is per-*session*, so B waits on A forever — and Postgres's deadlock detector never fires, because A is not blocked on a lock; it is blocked in application code waiting for the migrate call to return. The failure mode is a hung Job indistinguishable from slow migrations. One lock, acquired exactly once at the outermost entrypoint, is also the unanimous prior-art shape (Problem §3).

Two operational constraints on the lock connection:

- **Direct database URL only — never a transaction-mode pooler.** PgBouncer in transaction mode hands successive statements different backend sessions, silently dropping a session-level advisory lock while the caller believes it is held. This is a documented production failure mode for Rails, Prisma, Alembic and golang-migrate. Hard requirement for the AWS/K8s paths, where a pooler is most likely to sit in front of the database; goes in `UPGRADE_NOTES.md` and the docs page (Phase 4).
- **The lock connection must stay separate from the connection running DDL.** Already true here (the lock lives on the dedicated client, migrations run on the ORM pool), recorded as a constraint so a future refactor does not merge them — a session advisory lock held on the same connection interferes with patterns like `CREATE INDEX CONCURRENTLY` (the reason Flyway exposes an opt-out for its session lock).

Choosing a session advisory lock over a lock table is itself the recovery story: the lock **dies with its connection**. Kill the process — or let Kubernetes kill the pod — and the lock is released; there is no `DATABASECHANGELOGLOCK`-style stranded row and no `migrate:unlock` command to build and document (Knex, Liquibase and EF Core each need one). The runbook reduces to inspecting `pg_locks` — see § Rollback & Recovery.

Separately and as cheap defence in depth: `mikro_orm_migrations_<mod>` has no unique constraint on `name`. Adding one turns a lost race from silent double-apply into a constraint violation. Proposed as an independent follow-up (needs a migration per module table), not a blocker.

### Rewiring the deploy path

`init-or-migrate.sh`'s default `MIGRATE_COMMAND` becomes `yarn mercato upgrade` (`:6`), reached on both the fallback path (`:70`) and the steady-state path (`:93`). The env var stays overridable, so `MIGRATE_COMMAND='yarn db:migrate'` restores the migrations-only behaviour — but it is no longer an *unlocked* bypass: with Phase 1, `db:migrate` acquires the same lock, so the override opts out of reconciliation, never of serialization.

The rewire also **removes** the three pieces the 2026-08 patch added, because `upgrade` subsumes them properly: the `sync_role_acls()` helper (`:38-49`), its two call sites (`:73`, `:96`), and the `SYNC_ROLE_ACLS_COMMAND` env var (`:7`). Leaving them would run step 3 twice per deploy — once locked and fatal inside `upgrade`, once unlocked and non-fatal after it. The `echo "Subsequent run: migrations only..."` at `:90` goes with them; it is already false. Operators who relied on `SYNC_ROLE_ACLS_COMMAND` get a `UPGRADE_NOTES.md` entry naming `upgrade` as its replacement (Phase 4).

Because `upgrade` self-serializes, the marker file stops being load-bearing for correctness, and the AWS playbook's reason for bypassing the script (`2026-06-04-aws-terraform-deployment-playbook.md:742`) partly dissolves. Pipelines collapse from *migrate Job → rollout → purge Job* to *upgrade Job → rollout*.

**Ordering rationale (pre-rollout, not post):** steps 2-4 are additive — they install definitions and grant features that the *new* code declares, while old pods still serve. Old pods ignore what they don't know about. Running post-rollout would instead leave new pods serving without their features for the duration of the reconcile.

Note the Job runs the **new** image (it needs the new `modules.ts`, migrations, `ce.ts` and `acl.ts`); only the serving Deployment is still on the old one during the window.

### Why there is no post-deploy step

The originating proposal's pipeline ended with a post-rollout purge Job (PR #206, closed unmerged). Three distinct jobs such a step could do, each resolved separately:

1. **Purge the nav cache.** Obsoleted by the fingerprint fix, which has since landed (`nav.ts:166`, `v7:${getModuleSurfaceFingerprint()}`). Old pods compute the old fingerprint and write old-fingerprint keys; new pods read new-fingerprint keys. The two populations stop sharing a cache entry, which removes both the staleness *and* the ordering constraint that made a purge Job hard to place. A purge would also mean a thundering herd of cold nav rebuilds precisely when new pods are taking first traffic.

2. **Run the reconcile once new code is live.** This is strictly worse than pre-rollout, not a missing safeguard. Post-rollout leaves new pods serving without their definitions and ACLs for the duration of the reconcile — reintroducing the exact bug this spec exists to fix. Pre-rollout is not a compromise; it is the correct placement.

3. **Invalidate caches that `upgrade`'s own writes made stale.** This one is real, and is handled *inside* `upgrade` rather than by a Job — see the defect below. It needs a targeted `deleteByTags` call, not a keyspace scan in a separate pod.

The invalidation gap in detail: `auth sync-role-acls` writes `RoleAcl` rows via `ensureRoleAclFor` and **never invalidates the RBAC cache**, while every *request* path performing the same mutation does — those mutations now run through the command pattern, whose `invalidate` hooks call it: `auth/commands/acl.ts:405-412` (role ACL → `invalidateTenantCache`), `auth/commands/acl.ts:468-472` (user ACL → `invalidateUserCache`), `auth/commands/users.ts:1058`. `RbacService.invalidateTenantCache(tenantId)` already exists for this (`rbacService.ts:312-318`, tag-based via `deleteCacheByTags` at `:317`), and its doc comment says so verbatim: *"Call this when a role's ACL is modified, since roles are tenant-scoped and affect all users in that tenant who have that role."* (`:305-311`). The CLI is the odd one out — and because `init-or-migrate.sh` now invokes it on every deploy (Problem §1), the gap is on the hot path today, not hypothetically after Phase 4.

Two properties bound the blast radius, and are why this is a defect fix rather than an argument for a purge Job:

- **It self-heals.** The RBAC cache sets a TTL (`rbacService.ts:211`, 5 minutes default; applied at `:263,785`). Worst case is a ≤5-minute stale-grant window, not the immortal-key class of bug.
- **It cannot cross-contaminate across image versions.** The cached `AclData.features` is the **raw** grant list; `filterGrantsByEnabledModules` is applied at *check* time (`rbacService.ts:866,875`), so each pod filters against its own module registry. An old pod warming the RBAC cache during the pre-rollout window cannot poison new pods with old-module-set filtering. This is exactly why nav — which caches the already-filtered payload — needed a fingerprint and the RBAC cache does not.

Fixing it in `sync-role-acls` itself (Phase 3) rather than in `upgrade` also repairs the manual invocation path that `BACKWARD_COMPATIBILITY.md:340` instructs operators to use, **and** the shell-script path that `init-or-migrate.sh:73,96` already drives.

---

## Architecture

```
mercato upgrade [--tenant <id>] [--lock-timeout=<s>] [--no-lock] [--with-seed-defaults]
  │
  ├─ guard: module registry non-empty (bin.ts already bootstrapped; see below)
  │
  ├─ acquire pg_try_advisory_lock(0x4F4D, 0x5547) on a dedicated pg.Client
  │  └─ retry loop, each wait clamped to the remaining budget; non-zero exit on timeout
  │
  ├─ guard: empty `users` table → exit non-zero pointing at `mercato init`
  ├─ guard: --tenant resolves to a live, non-deleted tenant                 ← see defect 6
  │     └─ both run on the lock connection, so two racing deploys cannot both pass them
  │
  ├─ 1. await dbMigrateUnlocked(resolver)      ← lock already held; direct import, see below
  ├─ 2. runModuleCommand(mods, 'entities', 'install', scopeArgs)
  ├─ 3. runModuleCommand(mods, 'auth', 'sync-role-acls', scopeArgs)
  ├─ 4. runModuleCommand(mods, 'feature_toggles', 'seed-defaults', [], { optional: true })
  │     └─ catch ENOENT → warn + continue; any other error fails the run   ← see defect 7
  ├─ 5. seed:defaults pass                     ← ONLY with --with-seed-defaults; warns first
  │
  ├─ print "Not run by `upgrade`" block + the UPGRADE_NOTES.md instruction
  └─ release lock (on every path, including throw)
```

Every step runs with `process.exitCode` captured and restored around it — the same technique `run()` already uses at `mercato.ts:58-68`, applied per step inside the orchestrator rather than once around the command — so a step that signals failure by setting a non-zero code instead of throwing still fails the run rather than being swallowed by the next step.

**No generators, and no second bootstrap.** `upgrade` is not in `BOOTSTRAP_FREE_COMMANDS` (`lib/cli-bootstrap-mode.ts`), so `bin.ts` has already bootstrapped the app and registered its CLI modules before `run()` is reached; bootstrapping again would compile the whole module graph twice. Generators are deliberately not run either, unlike `init`: a deployed image already carries its generated output, and a deploy container's filesystem may be read-only, so the reconcile must never depend on being able to write generated files. An app that has never been generated fails in `bin.ts` with its existing "run `yarn mercato generate`" banner, before `upgrade` is entered.

**No `--dry-run`, no `--skip` in v1.** Both appeared in this spec's first draft and are dropped: `dbMigrate` has no dry-run contract to compose, and skipping the schema step while still running entity/ACL reconciliation is an invalid sequence with no safe semantics. Either flag may return once it has a concrete contract — validated step dependencies, per-step planned-vs-executed output, rejection of unsafe combinations, and tests — as a follow-up spec, not a synopsis line.

**Placement.** `run()` in `packages/cli/src/mercato.ts:897` is a series of `if (first === 'x') { … return N }` early returns, then a generic `<module> <command>` dispatcher from `:1541`. `upgrade` goes as a top-level early-return block alongside `init` (`:906`) and `seed:defaults` (`:1479`), i.e. in the `:1364`–`:1539` band, because it orchestrates other modules the way `init` does.

**Two implementation traps the code makes easy to fall into:**

1. **`buildAllModules()` does not include the built-in modules.** It returns generated CLI modules plus the app's `@/cli` as a pseudo-module `app` (`mercato.ts:879-895`, the push at `:892`); the six ids in `BUILTIN_CLI_MODULE_IDS` (`:134`) — `queue`, `generate`, `deploy`, `db`, `server`, `test` — are pushed inline in the *generic* dispatch path from `:1631` and are invisible to it. So `runModuleCommand(await buildAllModules(), 'db', 'migrate')` fails with `missing-module`. Step 1 must `await import('./lib/db')` and call `dbMigrateUnlocked` directly, mirroring how the built-in `db` module dispatches to `dbMigrate` at `:2011-2019`.

2. **`{ optional: true }` only tolerates *resolution* failure**, not runtime failure (`mercato.ts:711-738`; the `options.optional` branch is `:720-725`). It returns `false` when the module is absent, has no `cli`, or lacks the command; an exception thrown by `run()` propagates regardless (`:736`). That is the semantics we want for step 4 (`feature_toggles` may be disabled) — but it must not be mistaken for "best-effort, ignore errors", and it is specifically **not** enough for the `ENOENT` case in defect 7.

**Scope flags must be passed explicitly.** Per-command defaults are inconsistent: `entities install` defaults to all tenants, `configs cache structural` defaults to global-only. `upgrade` should never rely on them.

### Pre-existing defects `upgrade` would amplify

Seven defects. Per review finding #2 and the resolution of Open Question 3, items 1–4 and 6 — independent of `upgrade` — ship as their **own PR**, ahead of or alongside this spec's implementation. Item 5 stays in scope here (Phase 3): `upgrade`'s correctness argument depends on it (Risk 8, § Why there is no post-deploy step). Item 7 is handled by a design decision inside `upgrade` and recorded here so the decision is auditable.

Note that items 1, 2, 3, 5 and 6 are **live on the deploy path today**, not latent, because `init-or-migrate.sh` already invokes `auth sync-role-acls` on every redeploy (Problem §1).

1. `auth sync-role-acls` selects tenants with `em.find(Tenant, {})` (`auth/cli.ts:862`) — **no `deletedAt` filter**, unlike `entities install` (`install-from-ce.ts:198`). Soft-deleted tenants get ACL writes.
2. Its flag parser (`auth/cli.ts:822-835`) only supports `--tenant <id>`, not `--tenant=<id>`; the latter is read as a flag literally named `tenant=<id>` and silently ignored (`:833`) — a scoped run would become an all-tenant run.
3. `ensureCustomRoleAcls` resolves and merges each custom role **twice per tenant** (once via `ensureDefaultRoleAcls` at `setup-app.ts:607-612`, once directly at `:645-651`), each with its own `flush()` inside `ensureRoleAclFor` (`:679`, `:692`).
4. `feature_toggles seed-defaults` never disposes its DI container. **Still open.** It resolves one at `feature_toggles/cli.ts:327` and the command body ends at `:356` with no `finally`, while all four sibling commands dispose theirs: `toggle-create` (`:151-153`), `toggle-update` (`:212-214`), `toggle-delete` (`:249-251`), `override-set-value` (`:302-307`). A leak that matters once it runs inside a longer chained process.
5. **`auth sync-role-acls` does not invalidate the RBAC cache** after mutating `RoleAcl` rows, unlike every equivalent request path (`auth/commands/acl.ts:405-412`, `auth/commands/acl.ts:468-472`, `auth/commands/users.ts:1058`). Call `RbacService.invalidateTenantCache(tenantId)` (`rbacService.ts:312-318`) once per synced tenant. Bounded today by the 5-minute TTL at `rbacService.ts:211`, which is why it has gone unnoticed. This is the fix that removes the last argument for a post-deploy Job.
6. **A composed step can refuse silently and report success.** `auth sync-role-acls` returns early on three paths without throwing and without setting an exit code: "No CLI modules registered" (`auth/cli.ts:840-843`), "Invalid `--tenant` value" (`:851-854`), "Tenant not found" (`:856-859`). Each is `console.error(…)` followed by a bare `return`. `runModuleCommand` awaits `resolved.command.run(args)` and returns `true` (`mercato.ts:736-737`), so a composing caller sees a successful step that reconciled **nothing** — a deploy that quietly skipped its ACL sync against a mistyped tenant id looks green. `runWithCapturedExitCode` (`mercato.ts:58-68`) preserves a `process.exitCode` a step does set, but a bare `return` sets none. Two consequences, deliberately split:
   - **In `upgrade` (Phase 1+2):** pre-validate before dispatching. `upgrade` resolves its own `--tenant` against a live `Tenant` row and asserts the module registry is non-empty *before* step 1, so all three branches are unreachable from `upgrade`; and it wraps every step in exit-code capture so a step that does set a non-zero code fails the run. This makes `upgrade` correct without changing `sync-role-acls`.
   - **In the defects PR:** make those three paths actually fail — throw, or set a non-zero exit code — so the **manual** invocation and the shell-script invocation stop lying too. Listed alongside defects 1–4 per the Q3 split.
7. **`feature_toggles seed-defaults` can `ENOENT` before it creates anything.** It reads its seed file at module-load-resolved `defaultFilePath` (`feature_toggles/cli.ts:16`, `path.resolve(__dirname, 'defaults.json')`) with a bare `fs.readFileSync(filePath, 'utf8')` at `:317` — before `createRequestContainer()` at `:327`. `{ optional: true }` tolerates *resolution* failure only, as stated above, so a packaging slip that ships the compiled `cli.js` without its sibling `defaults.json` would throw a runtime `ENOENT` and **fail a deploy** on a step whose entire purpose is best-effort toggle creation. **Design decision:** step 4 catches `ENOENT` specifically, warns naming the missing path, and continues; any other error from the step fails the run. A blanket `try/catch` would re-create the "best-effort, ignore errors" semantics this spec explicitly rejects.

### Release-ordering constraint: the `customer_accounts` crash guard

Promoting `sync-role-acls` to a **blocking** step (one that fails the run) is only safe where it cannot crash on a module that is merely disabled. Issue #6950 — *"auth sync-role-acls fails with 'Metadata for entity CustomerRole not found' when customer_accounts is disabled"* — is open against released `0.8.0` and describes exactly that: a portal-less deployment reaching `em.findOne(CustomerRole)` and dying there.

`develop` already guards it. `syncCustomerRoleAcls` checks the **module registry** before importing the portal helper and returns `null` when `customer_accounts` is absent (`auth/cli.ts:811`, with the reasoning in the doc comment at `:795-805`); the guard landed in `45a3cee87f` (2026-09-21). An import-failure guard would not have worked, because every core module ships inside `@open-mercato/core` whether or not `modules.ts` lists it.

So this is a **release-ordering constraint, not a blocker**: the release that carries `upgrade` MUST also carry `45a3cee87f`. On `develop` that is already true and nothing is required. It matters only if `upgrade` is ever backported to a `0.8.x` patch line, where the guard would have to travel with it.

### Cost on the rollout critical path

Steps 2 and 3 iterate every tenant when unscoped.

- **Step 2** is `E_global + (E_tenant × T)` iterations at ~3 queries each, but collapses to a single cache `GET` per iteration when warm and undrifted. There are 18 `ce.ts` files (up from 13 at the first draft), so `E` is a few dozen.
- **Step 3** is the chatty one: roughly `T × (6 + 4·C)` queries where `C` is the number of custom roles, with a `flush()` per ACL write and no batching.
- **Step 4** is constant (5 selects, zero writes on re-run).
- **Step 5** does not exist on the default path. With `--with-seed-defaults` it is `O(organizations)` with every module's hook per organization (`mercato.ts:1515-1526`) and is by far the most expensive thing `upgrade` can be asked to do — a second reason the flag must not reach a deploy script.

Negligible at one tenant; unmeasured at high tenant counts. In scope: `--tenant` scoping and per-step timings on stdout. **Out of scope: optimising the per-tenant loops.** This spec deliberately makes no performance claim it has not measured; that is a follow-up once real numbers exist.

## Data Models

No schema changes. No new entities, columns, or migrations.

The adjacent observation — the missing unique constraint on `mikro_orm_migrations_<mod>.name` — is called out above as a separate follow-up.

## API Contracts

No HTTP API changes. No route, OpenAPI, event, widget-spot, DI-key, ACL-feature or notification-ID changes.

**CLI contract surface** — `BACKWARD_COMPATIBILITY.md:265-268`, category 13, classified STABLE:

> - MUST NOT rename or remove existing CLI commands or their required flags
> - MAY add new commands or optional flags freely

`mercato upgrade` and its `--tenant` / `--lock-timeout` / `--no-lock` / `--with-seed-defaults` flags are purely additive, which the contract permits without a deprecation cycle. `seed:defaults`, `entities install`, `auth sync-role-acls` and `feature_toggles seed-defaults` keep their names, flags and behaviour. `db:migrate` keeps its name and gains only optional flags. Once `upgrade` ships it is itself covered by the same rule — including `--with-seed-defaults`, which therefore cannot be removed later without a deprecation cycle. That is a deliberate price for answering the review's "auto-call the follow-ups" ask with a flag rather than a doc line.

**`ModuleSetupConfig`** — `BACKWARD_COMPATIBILITY.md:39,78` lists it as MUST-NOT-remove but explicitly permits *adding optional hooks*. So the `reconcile?()` of Open Question 1 is sanctioned; this spec's Phase 1-5 do not add one.

**Behavioural changes requiring documentation:**
- `init-or-migrate.sh`'s steady-state path does more than before. `UPGRADE_NOTES.md` entry with the `MIGRATE_COMMAND='yarn db:migrate'` opt-out.
- The `SYNC_ROLE_ACLS_COMMAND` env var that `eb1a539306` introduced is **removed** along with the helper it drove (§ Rewiring the deploy path). It is a deploy-script variable, not a platform contract surface under the 13 categories, but it is observable by any operator who set it — so it gets its own `UPGRADE_NOTES.md` line naming `upgrade` as the replacement.

## Phases

**Phases 1 and 2 ship together in one PR.** The first revision presented them as independently mergeable; they are not independently *useful*. A lock primitive with no caller is dead code, and a `upgrade` command without the `dbMigrate` / `dbMigrateUnlocked` split is the self-deadlock described in § Advisory locking. More to the point, the public-path split is the substance of review finding #1 — "make every shipped deployment migration entrypoint participate in the same lock" — so splitting it from the command it exists to serve would ship half an answer. One capability, one PR. Every phase after it stays separate and is sequenced after.

**Phase 1+2 — the lock contract and `mercato upgrade`.** *(shipping in the PR carrying this revision)*
- `withUpgradeLock(fn)` with unit tests (acquire, contend, timeout, release-on-throw, dedicated-client assertion, `--no-lock` bypass).
- The migrate split: public `dbMigrate` wraps itself in the lock; `dbMigrateUnlocked` is the internal primitive for a caller already holding it. The only behaviour change to `db:migrate` is serialization — a solo run is unaffected; a concurrent run now waits or fails loudly instead of crashing with `42P07`.
- `mercato upgrade` composing steps 1-4, the empty-database guard, the `--tenant` and module-registry pre-validation (defect 6), the `ENOENT` tolerance on step 4 (defect 7), per-step timings.
- The operator-facing output of § What `upgrade` tells the operator it did not do: the "Not run by `upgrade`" block, the `UPGRADE_NOTES.md` instruction, and `--with-seed-defaults` with its warning.
- Docs page `apps/docs/docs/cli/upgrade.mdx` + CLI overview entry.

**Phase 3 — RBAC cache invalidation (defect 5 only).** `sync-role-acls` calls `RbacService.invalidateTenantCache` once per synced tenant. Separate PR, **sequenced after** Phase 1+2 but in the same release (Risk 8). Defects 1–4 and 6 are out of this spec's scope — separate PR, per Open Question 3's resolution.

**Phase 4 — deploy rewire + operational docs.** Separate PR, sequenced after Phase 1+2. Not "add a reconcile" but **replace the partial one** (Problem §1):
- `init-or-migrate.sh`: default `MIGRATE_COMMAND` → `yarn mercato upgrade` (`:6`); delete `sync_role_acls()` (`:38-49`), both call sites (`:73`, `:96`), the `SYNC_ROLE_ACLS_COMMAND` var (`:7`) and the now-false `:90` echo. Mirrored into `packages/create-app/template/docker/scripts/init-or-migrate.sh` per the root AGENTS.md template-sync rule — the two files are byte-identical today and must stay so.
- **`.ai/specs/2026-06-04-aws-terraform-deployment-playbook.md`.** Picked up here because review finding #1 asked for it explicitly ("update the AWS playbook and operator docs accordingly") and the first revision adopted only the lock-contract half of that finding. The playbook still prescribes bare `yarn db:migrate` for the migration one-off task at `:14`, `:67`, `:691`, `:831`, `:858`, `:1184`, and its concurrency note at `:1247` ends with *"For extra safety, wrap migrations in a Postgres advisory lock"* — which Phase 1 makes unnecessary to do by hand. Update those to `yarn mercato upgrade`, state the direct-DB-URL (no transaction-mode pooler) requirement where it names `DATABASE_URL` for the migration task (`:858`), and record that the marker-file bypass rationale (`:127`, `:742`, `:1160`) is now about Fargate ergonomics rather than correctness.
- `UPGRADE_NOTES.md`: the `init-or-migrate.sh` behaviour change, Risk 4 (`entities install` now automatic), the `MIGRATE_COMMAND='yarn db:migrate'` opt-out, the `SYNC_ROLE_ACLS_COMMAND` removal, and — in these words — that **`--with-seed-defaults` must never be wired into a deploy script**, with the hazard list.
- Owns the operational deliverables from § Rollback & Recovery: the stuck-lock runbook and the direct-DB-URL requirement, in both `UPGRADE_NOTES.md` and `apps/docs/docs/cli/upgrade.mdx`.

**Phase 5 — documentation truth-up.** Separate PR; no ordering dependency.
- `ModuleSetupConfig.seedDefaults` JSDoc (`packages/shared/src/modules/setup.ts:39-46`): correct "Called during `mercato init`" — `seed:defaults` (`mercato.ts:1515-1526`) and onboarding's `verify.ts:287-296` also call it — and state plainly that it is **not** guaranteed idempotent and is **not** run at deploy time unless `--with-seed-defaults` is passed.
- Add the missing `apps/docs/docs/cli/seed-defaults.mdx`; the command has shipped since #1099 with no docs page and no CLI-overview entry (confirmed absent on `109790f058`). Document the re-run hazards and cross-link `--with-seed-defaults`.
- ~~Fix `hybrid-query-engine.mdx:20` — `entities install --reindex` does not exist.~~ **Already fixed upstream.** The page now documents the real commands (`mercato query_index rebuild|rebuild-all|reindex|purge`, with `yarn mercato reindex` named as shorthand) at `apps/docs/docs/framework/database/hybrid-query-engine.mdx:116`. Dropped from this phase.

**Phase 6 (future, gated on Open Question 1) — `setup.reconcile?()`.** Opt-in hook for the drift-correction class, with `reconcile?: false` added to `SetupOverridesShape` (`packages/shared/src/modules/overrides.ts:101-107`) and its delete line (`:1496-1498`), plus a `shared/src/modules/__tests__/contract-overrides.test.ts` case. Migrate `directory.backfillOrganizationSlugs` to it as the reference implementation. Only then does `upgrade` gain a reconcile step of its own.

**Phase 7 (future, gated — needs a maintainer call like Q1) — an app-level reconcile step.** **Explicitly not part of the work shipping now.**

Every step `upgrade` runs is a *platform-module* step. An app's own convergence work has no seam at all: owned roles that are not declared in any module's `defaultRoleFeatures`, storage or object-store configuration, data backfills behind a feature the app shipped last release. Today every Open Mercato app hand-writes a composite command and wires it into its own deploy path — which is the same failure this spec exists to fix, one layer up.

The seam already exists and costs nothing to use. `buildAllModules()` loads the app's `@/cli` and pushes it as a pseudo-module with id `app` (`packages/cli/src/mercato.ts:884-892`), and `runModuleCommand`'s `{ optional: true }` returns `false` rather than throwing when a module has no `cli` or lacks a command (`:718-725`). So the proposal is one line of composition: a final, optional step
```ts
runModuleCommand(mods, 'app', 'reconcile', scopeArgs, { optional: true })
```
which runs the app's own `reconcile` command when it declares one and is a silent no-op otherwise.

This is the *principled* form of the review's "add the option to auto-call those follow-ups" ask: instead of `upgrade` deciding which of the platform's hazardous seed hooks to run, the app declares what converging means for itself and `upgrade` calls it under the same lock, in the same ordering, with the same failure semantics. The hazards catalogued in this spec are hazards of *this repo's* `seedDefaults` implementations; an app's own `reconcile` is code its author controls.

It needs a maintainer decision because it is additive **CLI contract surface** (`app:reconcile` becomes a reserved command name under category 13, `BACKWARD_COMPATIBILITY.md:265-268`), it needs a documented contract (idempotency obligation, scope flags, failure semantics, whether it runs before or after the platform steps), and it overlaps Phase 6 — if `setup.reconcile?()` lands, an app module gets the same hook and the `app:reconcile` command may be redundant. Resolve Phase 6 first.

## Test Coverage

Per root `AGENTS.md` a spec must list integration coverage for affected API and UI paths. **This change has no API routes and no UI surface** — CLI and deploy scripts only. The equivalent obligation:

| Area | Coverage |
|------|----------|
| `withUpgradeLock` | Unit: acquires; second holder contends and times out non-zero; releases on throw; uses a dedicated client, not the ORM pool; `--no-lock` bypass. |
| `db:migrate` lock adoption | Unit: public `dbMigrate` acquires the lock; `dbMigrateUnlocked` never does; `--no-lock` bypass on the public path. |
| `upgrade` step order | Unit with mocked `runModuleCommand`: asserts the exact 4-step order and that step 1 calls `dbMigrateUnlocked` directly rather than via `runModuleCommand`. |
| **Per-step outcome (defect 6)** | Unit: a step that *refuses* must fail the run. Stub a step to mimic `sync-role-acls`'s bare-`return` branches (`console.error` + return, no throw, no exit code) and assert `upgrade` does not report success; stub one that sets a non-zero `process.exitCode` and assert `runWithCapturedExitCode` surfaces it. Plus: `upgrade` rejects an unresolvable `--tenant` and an empty module registry **before** step 1, so those three branches are unreachable from `upgrade`. |
| **Scope-flag parsing** | Unit on `parseUpgradeTenantScope`, the function the CLI entry point itself parses with: `--tenant <id>`, `--tenant=<id>` and the `--tenantId` alias all resolve; an absent flag means every tenant; a flag **present with no value** — bare, followed by another flag, `--tenant=`, or whitespace-only — is refused before the lock is taken. Structural assertions that `mercato.ts` delegates to that function (no second parser of its own) and that the parse precedes `withUpgradeLock`. Without the refusal, `--tenant=` from an empty variable expansion reads as "all tenants" and widens the reconcile past the requested scope. |
| **`ENOENT` tolerance (defect 7)** | Unit: step 4 throwing `ENOENT` for a missing `defaults.json` warns naming the path and the run still succeeds; step 4 throwing any other error fails the run. Guards against both the packaging slip and a blanket `try/catch`. |
| **`--with-seed-defaults`** | Unit: absent from `argv` → the seed pass is never invoked and the exclusion guard below holds unchanged; present → the hazard warning is emitted **before** the pass runs, the pass runs inside the lock, and it runs after step 4. A grep-level assertion that the string `--with-seed-defaults` appears in no file under `docker/`, `packages/create-app/template/`, or `.github/workflows/`. |
| **Operator guidance output** | Unit: a successful run prints the "Not run by `upgrade`" block naming `seed:defaults`, `reindex` and `configs restore-defaults`, and prints the `UPGRADE_NOTES.md` instruction naming the `om-auto-upgrade-<from>-<to>` skill convention. Asserted on content, not formatting — this is the review's deliverable and must not silently regress. |
| **Concurrency (the core guarantee)** | Integration, ephemeral DB, two independent processes: while one session holds the lock (a spawned `upgrade` mid-run, or a harness connection holding `pg_advisory_lock(0x4F4D, 0x5547)`), a second real `mercato upgrade` process blocks and then exits non-zero on `--lock-timeout`, and succeeds after release. Repeat with the second process running `yarn db:migrate` — proving the bypass is closed, not just the happy path. |
| Lock span & release-on-failure | Integration: probe with `pg_try_advisory_lock` from a second connection at checkpoints to assert the lock is held from before step 1 through step 4 **and** the RBAC cache invalidation; an injected failure in step 3 still releases the lock and exits non-zero. |
| **Exclusion guard** | Unit: on the **default** path, asserts `seedDefaults`, `seedExamples`, `configs restore-defaults` and any reindex are **never** invoked, **and** that `--with-seed-defaults` reads false unless explicitly passed. This is a regression guard against someone re-adding them — or flipping the flag's default — without revisiting the audit. |
| `feature_toggles` disabled | Unit: step 4 tolerates absence via `{ optional: true }`; and a runtime throw from step 4 still fails the command. |
| Empty-DB guard | Unit: exits non-zero pointing at `mercato init`. |
| Idempotency | Integration: run `upgrade` twice against a seeded ephemeral DB (`yarn test:integration:ephemeral`); assert the second run adds no rows to `custom_field_defs`, `custom_entities`, `role_acls`, `feature_toggles`. **This is the test that would have caught the original incident.** |
| RBAC invalidation (Phase 3) | Unit: **`invalidateTenantCache` called once per synced tenant** (the post-deploy-step replacement — assert it is tag-based, not a keyspace scan). Tests for defects 1–4 and 6 (soft-deleted tenant filter, `--tenant=<id>` parsing, single merge per tenant, container disposal, refusals that exit non-zero) travel with their separate PR. |
| Deploy script (Phase 4) | Shell-level: `init-or-migrate.sh` invokes `upgrade` on **both** the existing-users fallback path (`:70`) and the steady-state path (`:93`), and honours a `MIGRATE_COMMAND` override on each. Plus the **removal** assertions: no `sync_role_acls` helper, no `SYNC_ROLE_ACLS_COMMAND`, no "migrations only" echo — otherwise step 3 runs twice per deploy, once locked and once not. Plus byte-equality with `packages/create-app/template/docker/scripts/init-or-migrate.sh`. |

Integration tests must be self-contained per `.ai/qa/AGENTS.md`: fixtures created in setup, cleaned up in teardown, no reliance on seeded demo data.

### Manually verified for Phase 1+2, against a throwaway PostgreSQL 17 database

The automated suite above mocks the connection. These were exercised end to end against a real
database before the PR was opened, because the guarantee is about two processes and a real lock:

| Verified | Result |
|---|---|
| Lock ids match the documented runbook query | `pg_try_advisory_lock(20301, 21831)` registers as `classid=20301, objid=21831`, which is what `classid = x'4F4D'::int` selects |
| Refusal on an uninitialised database | exit 1, "no users table, so it has never been initialized. Run `yarn mercato init` first" |
| Contention and timeout | with the lock held by a second session, `upgrade --lock-timeout=6` waited at 0s and 5s, then exited 1 naming the lock and printing the holder query |
| **The closed bypass** | `mercato db migrate --lock-timeout=4` contended on the *same* lock and exited non-zero — review finding #1's requirement, demonstrated rather than asserted |
| Release on success | zero advisory locks remained after a successful run |
| `--tenant` validation | a non-UUID argument was refused before any step ran; a real tenant id completed all four steps |
| **Two-run idempotency** | run 1 installed 32 `custom_field_defs` that `mercato init` had left uninstalled; run 2 added **zero** rows to `custom_field_defs`, `custom_entities`, `role_acls` and `feature_toggles`, reporting `updated=0, fieldsChanged=0, skipped=57` and `created: 0, skipped: 4` |
| `--with-seed-defaults` | printed the five-hazard warning, ran as a fifth step, and the follow-ups block then stopped advertising the flag |

Two findings came out of this and are fixed in the same PR: a `--lock-timeout` at or below the retry
interval used to fail on the first attempt without ever waiting (each wait is now clamped to the
remaining budget, with a regression test), and the "Not run by `upgrade`" block used to advertise
`--with-seed-defaults` even when it had just run.

The first run installing 32 definitions on a **freshly initialised** database is worth recording on
its own: it means the gap this spec describes is not limited to long-lived deployments that enabled a
module late. `mercato init` itself does not leave the definition surface complete.

## Rollback & Recovery

**What an app rollback does and does not undo.** Rolling the Deployment back to the previous image does not revert what `upgrade` reconciled: installed custom-field/entity definitions, granted ACL features, and created feature toggles all persist. That is safe by construction — every step is additive, and old code ignores definitions and grants it never references (the same property that makes the pre-rollout ordering correct). Setting `MIGRATE_COMMAND='yarn db:migrate'` back only changes *future* runs; it undoes nothing.

**Reversing an unintended reconcile.** Definitions: `entities install` installs what the running image's `ce.ts` declares, so the durable fix is reverting the declaration and redeploying; an already-installed stray definition is removed via the entities admin surface (soft delete — `install` filters deleted tenants and will not resurrect a deliberately removed definition unless it is still declared, which is Risk 4 and an `UPGRADE_NOTES.md` call-out). Grants: `sync-role-acls` is additive-only (Risk 5), so an unwanted grant is revoked per role via the roles admin, and the revocation sticks unless the feature remains in `defaultRoleFeatures`. Toggles: create-only; edit or remove the row.

**Stuck-lock runbook (Risk 2).** The session advisory lock dies with its connection, so a "stuck" lock is almost always a live, slow holder. When a Job exits non-zero on lock timeout:

1. Identify the holder: `SELECT a.pid, a.state, a.query_start, a.query FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE l.locktype = 'advisory' AND l.classid = x'4F4D'::int;`
2. If it is a live migrate/upgrade run, do nothing — the failed Job's retry/crashloop is the designed behaviour, and the next attempt succeeds once the holder finishes.
3. Only if the holder is genuinely orphaned (a zombie connection from a killed pod): `SELECT pg_terminate_backend(pid);`. Nothing to clean up afterwards — no lock-table row, no unlock command.

Ships with Phase 4 in `UPGRADE_NOTES.md` and the docs page.

## Risks & Impact Review

| # | Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|---|
| 1 | Someone later adds `seedDefaults` to `upgrade`'s **default** path, wiping `sync_excel` credentials on every deploy. | **High** | Any tenant with a configured integration | The audit is recorded in this spec; the exclusion-guard unit test fails the build if a step is added to the default path **or** if `--with-seed-defaults` stops defaulting to off. Note the flag is now a deliberate, documented path to this exact hazard — the control is that reaching it requires a human to type it and read the warning. | Low while the test stands. **The test is the control — do not drop it.** |
| 2 | Lock acquisition times out; the deploy Job exits non-zero and blocks the rollout. | Medium | Deploy pipeline | Bounded retry with a message naming the lock; `--lock-timeout`; `--no-lock`; runbook in § Rollback & Recovery, shipped with Phase 4. | A genuinely stuck lock still blocks — correct and loud. Session advisory locks die with their connection, so recovery is `pg_terminate_backend` at worst, never lock-table surgery. |
| 3 | Per-tenant loops make `upgrade` slow enough to stall rollouts at high tenant counts. | Medium | Multi-tenant installs | `--tenant` scoping; per-step timings; nothing minutes-scale (no reindex) on the default path. | **Unquantified.** No measurements exist. Explicitly deferred. |
| 4 | `entities install` resurrects definitions an operator intentionally removed. | Medium | Existing tenants | Inherent to `install`'s declared purpose ("repair existing tenants"); unchanged by this spec, but now runs automatically rather than on request. | Real behaviour change. Call out in `UPGRADE_NOTES.md`. |
| 5 | `auth sync-role-acls` is additive-only, so a feature removed from `defaultRoleFeatures` is never revoked. | Medium | RBAC hygiene | Pre-existing (`setup-app.ts:657-694` — the merge at `:683` is a set union, with no revocation path); documented, not changed here. | Real; revocation needs its own design. |
| 6 | `upgrade` runs against a never-initialised database, producing confusing partial state. | Medium | New installs | Empty-`users` guard, exit non-zero pointing at `mercato init`. | Low. |
| 7 | Advisory lock taken on a pooled connection and silently dropped mid-run. | High if mis-implemented | Migration safety | Dedicated `pg.Client`; asserted in the Phase 1 unit test. | Low once tested. |
| 8 | Users see stale grants for up to 5 minutes after a pre-rollout `upgrade`, because `sync-role-acls` does not bust the RBAC cache. | Medium | Any deploy granting new ACL features | Phase 3 defect 5 — `invalidateTenantCache` per synced tenant. Until then, bounded and self-healing via the 5-minute TTL (`rbacService.ts:211`). | Low after Phase 3. Note Phase 1+2 without Phase 3 ships this window — a reason to keep them in one release. The window exists on `develop` **today**, because `init-or-migrate.sh:96` already runs `sync-role-acls` on every deploy (Problem §1). |
| 9 | Downstream apps pin an older `@open-mercato/*` and never receive the fix. | Medium | Fleet | Out of scope — dependency automation is per-consuming-repo. | Real; owned elsewhere. |
| 10 | An operator wires `--with-seed-defaults` into a deploy script, converting the opt-in hatch into exactly the every-deploy credential wipe Risk 1 describes. | **High** | Any tenant with a configured integration | The flag's own warning names the five hazard classes before it runs; `UPGRADE_NOTES.md` and `apps/docs/docs/cli/upgrade.mdx` say in those words that it must never appear in a deploy script; a grep-level test asserts the string is absent from `docker/`, the create-app template and `.github/workflows/`. | **Real and unbounded in a consumer's own repo** — the grep guards this repo only. This is the price of answering the review's ask with a flag; the alternative (documentation alone) leaves operators composing an unlocked `mercato seed:defaults` instead, which is worse. |
| 11 | Phase 4 lands the `MIGRATE_COMMAND` change but leaves `sync_role_acls()` in place, so step 3 runs twice per deploy — once locked and fatal, once unlocked and non-fatal. | Medium | Deploy pipeline | Phase 4 deletes the helper, both call sites and the env var as one change; the shell-level removal assertions in § Test Coverage fail the build otherwise. | Low once tested. The duplicate is wasteful rather than corrupting (`ensureRoleAclFor` is additive and converges), but it would mask defect 6's silent-refusal class for another release. |

## Open Questions for Maintainers

Proposed answers recorded 2026-07-28 (author). Q2 and Q3 need only an ack; Q1 is the one genuine maintainer call, and it gates Phase 6 alone.

1. **Does the `seedDefaults` audit justify a separate `setup.reconcile?()` hook (Phase 6), or should the drift-correction class stay a manual `seed:defaults` invocation indefinitely?**
   **Proposed answer: yes, directionally — and more than a side hook.** The author's position is that *seeding itself should converge on reconcile semantics*: `seedDefaults` implementations migrate toward safe, upsert-style logic under an explicit `reconcile()` contract, leaving destructive one-shot seeding behind rather than adding a parallel hook forever. That is its own spec, work and PR — Phase 6 stays gated, and nothing in Phases 1–5 depends on the answer. The question still stands for maintainers because it decides contract surface (`ModuleSetupConfig.reconcile?` — additive and already permitted by `BACKWARD_COMPATIBILITY.md:39`) and the long-term fate of `seedDefaults`.
2. **Should Phase 4 (default-on in `init-or-migrate.sh`) ship in the same release as Phase 1+2, or one release later?**
   **Proposed answer: same release — and the argument got stronger, not weaker.** The first revision argued that an opt-in soak defeats itself, because the bug being fixed is "nobody opts in". Problem §1's correction changes the shape of the question: the steady-state path **already performs a partial reconcile** (`init-or-migrate.sh:96`, unlocked, non-fatal, one step of four, inheriting defects 1, 2, 3, 5 and 6). So Phase 4 is no longer "introduce a reconcile into the deploy path by default" but "**replace an ad-hoc one with a serialized, complete, fatal-on-failure one**". Deferring it leaves the worse version running by default for a release, which is the opposite of a soak. The opt-out (`MIGRATE_COMMAND='yarn db:migrate'`) ships in the same release, `UPGRADE_NOTES.md` carries the Risk 4 call-out and the `SYNC_ROLE_ACLS_COMMAND` removal, and Full Stack House commits to running the default-on path in production from the first release.
3. **Are the Phase 3 defect fixes wanted here, or should they be a separate PR?**
   **Resolved: split, per review finding #2.** Defects 1–4 move to their own PR, joined by defect 6 (silent refusal) once the third revision found it. Defect 5 (RBAC cache invalidation) remains this spec's Phase 3 and ships in the same release as Phase 1+2 — it is what makes a post-deploy step unnecessary (Risk 8). Defect 7 (`ENOENT`) needs no change to `feature_toggles`; `upgrade` absorbs it as a design decision. Spec text updated accordingly.

## Final Compliance Report

*(to be completed at implementation)*

- [ ] `.ai/agentic.config.json` validation sequence: `yarn build:packages` → `yarn generate` → `yarn build:packages` → `yarn i18n:check-sync` → `yarn i18n:check-usage` → `yarn typecheck` → `yarn test` → `yarn build:app`
- [ ] `yarn workspace @open-mercato/cli test`
- [ ] `yarn test:integration:ephemeral` for the two-run idempotency test
- [ ] `BACKWARD_COMPATIBILITY.md` category 13 reviewed — additive command, no rename/removal
- [ ] `UPGRADE_NOTES.md` entry: `init-or-migrate.sh` behaviour change, Risk 4 (`entities install` now automatic), the `MIGRATE_COMMAND` opt-out, the `SYNC_ROLE_ACLS_COMMAND` removal, and that `--with-seed-defaults` MUST NOT be wired into a deploy script
- [ ] `packages/create-app/template/` mirrored per the root AGENTS.md template-sync rule, including byte-equality of `docker/scripts/init-or-migrate.sh`
- [ ] `.ai/specs/2026-06-04-aws-terraform-deployment-playbook.md` updated — migration task runs `upgrade`, direct-DB-URL requirement recorded, the `:1247` hand-rolled-advisory-lock suggestion retired (review finding #1's second half)
- [ ] `apps/docs/docs/cli/upgrade.mdx` + `seed-defaults.mdx` added; `overview.mdx` index + `apps/docs/sidebars.ts` updated
- [ ] Operator-facing output present and asserted: the "Not run by `upgrade`" block, the `UPGRADE_NOTES.md` / auto-upgrade-skill instruction, the `--with-seed-defaults` hazard warning (the merge-time review's two asks)
- [ ] Grep guard: `--with-seed-defaults` appears in no file under `docker/`, `packages/create-app/template/`, `.github/workflows/`
- [ ] Release carrying `upgrade` also carries `45a3cee87f` (the `customer_accounts` guard, issue #6950) — automatic on `develop`, a hard check on any backport
- [ ] No hard-coded user-facing strings (`[internal]` convention where applicable)
- [ ] `yarn agents:check-budget` if any `AGENTS.md` is touched

## Changelog

- **2026-10-08** (fourth revision) — Answers the review on the Phase 1+2 implementation PR #7003. The scope flag did not fail before writing: `--tenant` with no value — bare, followed by another flag, or `--tenant=` from an empty variable expansion — parsed as absent, so `assertTenantExists` was skipped and both tenant-aware steps received an empty scope and reconciled **every** tenant. The parse moves out of an inline closure in `mercato.ts` into `parseUpgradeTenantScope` in `lib/upgrade.ts`, which refuses a present-but-valueless flag as an `UpgradeRefusal` before the lock is acquired, covers both spellings and the `--tenantId` alias, and is the function the entry point itself calls (asserted structurally, since `mercato.ts` cannot be imported in a unit test). New Test Coverage row: *Scope-flag parsing*. Also removes the `any[]` cast in the `--no-lock` preflight adapter, which discarded the parameter typing the `UpgradeQuery` contract already carries, in favour of pg's own `unknown[]` query generic.
- **2026-10-07** (third revision) — **Answers the merge-time review on PR #4547**, a second `CHANGES_REQUESTED` from `pkarw` submitted 2026-08-01T11:32:47Z — eight seconds before the merge — and never addressed. It asked for two things, both now design surface rather than documentation: (1) `upgrade` prints a **"Not run by `upgrade`"** block naming the deliberately-excluded follow-ups with a reason each, plus a new **opt-in `--with-seed-defaults`** flag that runs the seed pass as a fifth step inside the lock, OFF by default, printing the five concrete hazard classes from this spec's own audit before it runs; (2) `upgrade` instructs the operator to check `UPGRADE_NOTES.md` for source-level changes and to apply the companion `om-auto-upgrade-<from>-<to>` skill with a coding agent if one is listed (`UPGRADE_NOTES.md:19-21,374`; four such skills exist). The `seedDefaults` audit is **not** softened: the default-path exclusion is unchanged, the hazards are real, and the flag is a documented escape hatch that must never be wired into a deploy script (Risk 10, `UPGRADE_NOTES.md` in Phase 4, grep-level test).
  **Three of this spec's own claims had gone stale and are corrected.** (a) Problem §1 said the steady-state deploy path was "unconditionally migrations-only". It has not been since `eb1a539306` (2026-08-20), which added a `sync_role_acls()` helper running `yarn mercato auth sync-role-acls` after every migration on both paths, non-fatally (`init-or-migrate.sh:38-49,73,96`). Reframed honestly as a comparison table: that call is ad-hoc, unlocked, non-fatal, runs one of four steps and never invalidates the RBAC cache — so Phase 4 becomes *replace a partial reconcile*, not *add one*, and must delete the helper, its two call sites, the `SYNC_ROLE_ACLS_COMMAND` var and the now-false `:90` echo (Risk 11). `entities install` and `feature_toggles seed-defaults` remain steps no deployment runs. (b) The `nav.ts` fingerprint + TTL prerequisite has landed (`nav.ts:8,166,201`), so § Why there is no post-deploy step argues from fact. (c) The `hybrid-query-engine.mdx` `entities install --reindex` doc bug is fixed upstream (`:116`) and is dropped from Phase 5.
  **Two new numbered defects.** Defect 6: a composed step can refuse silently — `auth sync-role-acls` does `console.error(…); return` on three paths (`auth/cli.ts:840-843,851-854,856-859`) with no throw and no exit code, so `runModuleCommand` reports success having reconciled nothing. Split in two: `upgrade` pre-validates `--tenant` and the module registry before dispatching (unreachable from `upgrade`) and wraps every step in `runWithCapturedExitCode` (`mercato.ts:58-68`); making those paths actually fail goes to the defects PR alongside 1–4. Defect 7: `feature_toggles seed-defaults` reads `defaults.json` with a bare `readFileSync` before creating its container (`feature_toggles/cli.ts:16,317,327`), and `{ optional: true }` tolerates resolution failure only — so step 4 catches `ENOENT`, warns and continues; any other error fails the run. Defect 4 re-verified and kept **open**: `seed-defaults` still never disposes its container while all four siblings do (`:151-153,212-214,249-251,302-307`).
  **Phases restructured.** Phases 1 and 2 ship as **one PR** — a lock with no caller is dead code, the `dbMigrate`/`dbMigrateUnlocked` split is the substance of review finding #1, and splitting them ships half an answer. Phase 3, Phase 4, Phase 5 and the defects PR are each separate and explicitly sequenced after. Phase 4 picks up `.ai/specs/2026-06-04-aws-terraform-deployment-playbook.md` — review finding #1 asked for it ("update the AWS playbook and operator docs accordingly") and the second revision adopted only the lock-contract half; the playbook still prescribes bare `yarn db:migrate` at `:14,67,691,831,858,1184` and suggests hand-rolling an advisory lock at `:1247`. New **Phase 7 (future, gated)**: an optional final `app:reconcile` step, since `buildAllModules()` already exposes the app's `@/cli` as pseudo-module `app` (`mercato.ts:884-892`) — the principled form of the review's "auto-call the follow-ups" ask, additive CLI contract surface, needs a maintainer call like Q1 and sequenced after Phase 6.
  **Q2's answer re-argued, not reversed.** Given (a) above, flipping the default replaces an ad-hoc call rather than introducing a new one, so deferring Phase 4 leaves the *worse* version running by default for a release. Q1 and Q3 unchanged. Added a release-ordering constraint (not a blocker): the release carrying `upgrade` must carry `45a3cee87f`, the `customer_accounts` registry guard (`auth/cli.ts:811`) for open issue #6950 against released `0.8.0` — already true on `develop`, a hard check on any `0.8.x` backport. Added four Test Coverage rows (per-step outcome, `ENOENT` tolerance, the flag's default and warning, the operator-guidance output), two Risks (10: the flag in a deploy script; 11: Phase 4 leaving the duplicate), and recorded that the audited `seedDefaults` surface has grown from 21 to 34 implementations without being re-audited.
  **Citations re-verified against `109790f058`** (the second revision verified against `e5ad6e8cdc`); every drifted `file:line` corrected, listed in the PR description.
  **Implemented and verified live in the same PR.** Phase 1+2 ship with this revision, and the concurrency guarantee was exercised against a real PostgreSQL 17 database rather than only mocked — including `db migrate` contending on the same lock (review finding #1, demonstrated) and a two-run idempotency check whose second run added zero rows. See § Test Coverage → *Manually verified*. Three implementation decisions are recorded there and in § Advisory locking: `dbGreenfield` deliberately calls the unlocked primitive (it has already dropped every table by then, so locking its last phase would protect nothing), `upgrade` runs no generators and does not re-bootstrap (`bin.ts` already did, and a deploy filesystem may be read-only), and each lock wait is clamped to the remaining budget — a `--lock-timeout` at or below the retry interval previously failed without ever retrying. Also corrects a stale claim in a *sibling* doc found en route: `apps/docs/docs/cli/db-migrate.mdx` documented `yarn db:migrate` as running generators and `entities install --global`, which the script has never done — it is `yarn mercato db migrate` and nothing else, which is precisely the gap this spec exists to close.
- **2026-07-28** (second revision) — Recorded proposed answers to all three open questions. Q1: yes directionally, and stronger than the question asks — seeding itself should converge on upsert/reconcile semantics under a `reconcile()` contract; separate spec/PR, Phase 6 stays gated. Q2: **same release** — an opt-in soak defeats itself when the bug being fixed is "nobody opts in"; `MIGRATE_COMMAND` is the opt-out and Full Stack House runs default-on in production from release one. Q3: **split** — defects 1–4 move to their own PR; Phase 3 narrows to defect 5 (RBAC cache invalidation), which ships with Phase 2. Restructured the defects section, Phase 3, and the test table to match.
- **2026-07-28** — Revision after maintainer review on PR #4547. Adopted the review's strongest finding: the advisory lock is now a **contract over every migration entrypoint**, not a property of one command — public `dbMigrate` acquires the lock, `upgrade` calls a new internal `dbMigrateUnlocked` while already holding it, and `MIGRATE_COMMAND='yarn db:migrate'` stops being an unlocked bypass. Documented why naive nested locking self-deadlocks across sessions (undetectably, from Postgres's point of view). Grounded Problem §3 in prior art: MikroORM v7 takes no lock (and this repo's per-module/per-migration loop voids `allOrNothing` as an umbrella), while Rails/Prisma/Knex/Flyway/Liquibase/EF Core/Atlas/Ecto and Magento/Frappe/Keycloak all lock — one global lock per run, never per-migration. Added two operational constraints: direct DB URL for the lock connection (transaction-mode PgBouncer silently drops session advisory locks) and keeping the lock connection separate from the DDL connection. Dropped `--dry-run`/`--skip` from v1 (no defined safe semantics). Test plan now proves the concurrency guarantee with two real processes, asserts lock span through the final invalidation step and release-on-failure, and covers both deploy-script paths. Added § Rollback & Recovery (rollback semantics, grant/definition reversal, stuck-lock runbook) with Phase 4 owning the deliverable — the runbook doubles as the justification for advisory locks over a lock table, since the lock dies with its connection. Fixed the Phase 3 four/five count.
- **2026-07-27** — Initial draft. Verified against `develop` at `e5ad6e8cdc`: `init` abort (`mercato.ts:1030-1041`), `init-or-migrate.sh:7,43-48,67`, `dbMigrate` lock absence (`lib/db/commands.ts:391-406`), `configs restore-defaults` `force: true` (`configs/cli.ts:316-330`), Redis `KEYS` (`cache/src/strategies/redis.ts:354-359`), `seed:defaults` semantics (`mercato.ts:1425-1485`), `ModuleSetupConfig` JSDoc gap (`shared/src/modules/setup.ts:32-46`), and a full idempotency audit of all 21 `setup.seedDefaults` implementations.
  Scope reduced twice from the originating proposal: no cache-purge step, no reindex, no performance budget — and, after the audit, **no `seedDefaults` step**, which was the proposal's largest component. The audit reversed this spec's own first draft, which had argued `seed:defaults` made re-running `seedDefaults` safe.
  Added "Why there is no post-deploy step" after review challenged the pre-rollout-only pipeline. That review surfaced Phase 3 defect 5: `auth sync-role-acls` never invalidates the RBAC cache, unlike the three API paths performing the same mutation. Confirmed bounded by the 5-minute TTL at `rbacService.ts:30`, and confirmed non-contaminating across image versions because `AclData.features` caches **raw** grants with `filterGrantsByEnabledModules` applied at check time (`rbacService.ts:416,467`) — the asymmetry with nav's cached-filtered-payload that explains why only nav needs a fingerprint.
