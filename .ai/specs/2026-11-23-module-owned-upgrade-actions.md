# Module-owned upgrade actions

Extends: .ai/specs/implemented/SPEC-013-2026-01-27-decouple-module-setup.md

## 📝 TLDR

Modules should own versioned upgrade files for the data changes they ship. Today `configs` declares the actions and wires in optional business modules. This proposal feeds a shared runner through the enabled-module registry and adds migration-style CLI commands for showing, applying and safely reverting actions in one explicit tenant and organization.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Why | Confirm? |
|---|---|---|---|---|
| Q1 | Module config or dedicated files? | A server-only `upgrades.ts` entry point and one versioned action per file under `upgrades/`. | Authors get a migration-like layout. A typed manifest lets the existing generator resolve source and published modules. | Reversible before adoption |
| Q2 | One spec or separate discovery and CLI specs? | One spec with two independently shippable phases. | The CLI is a second entry point into the same discovery, scope and completion rules. The discovery refactor can land first. | Reversible |
| Q3 | Which actions support undo? | Explicit `down` for actions with a proven inverse. Select one action by ID and version. Existing shipped actions start as irreversible. | Historical completion rows record success. They cannot establish which data a particular run created or changed. | Reversible |
| Q4 | Should CLI batches include actions with tenant-wide effects? | Require a targeted apply and explicit tenant-wide opt-in for those actions. | One organization is the normal CLI scope. Attachment reconciliation and the cart/promotions sweeper registrations affect the whole tenant. | Reversible |

## 📝 Overview

- Design baseline: [central registry at the supplied revision](https://github.com/open-mercato/open-mercato/blob/672d672f15f739f2ca763f7cd123ddffc8da0423/packages/core/src/modules/configs/lib/upgrade-actions.ts) and [PR #10129](https://github.com/open-mercato/open-mercato/pull/10129). Start implementation after #10129 and this spec merge into `main`. Re-inventory actions at that point.
- Supports the modularization work tracked in [#10144](https://github.com/open-mercato/open-mercato/issues/10144). [#2071](https://github.com/open-mercato/open-mercato/issues/2071) covers package extraction and banner opt-in. This spec keeps the existing service, HTTP route and banner in their current locations. It also keeps SQL migrations, tenant provisioning and release automation on their existing paths.

## 📝 Problem Statement

The `configs` upgrade catalog contains action IDs, versions, banner translation keys and handlers that import optional modules. [PR #10129](https://github.com/open-mercato/open-mercato/pull/10129) adds required-module checks so disabled modules cannot leave the banner stuck on their actions. Module authors still have to edit the central catalog. The CLI has no equivalent to the banner for release operators who need to inspect or run the same upgrade work from a deployment shell.

## 📝 Prior spec drift

Section 8 of the module-setup spec addressed missing modules with guarded dynamic imports. PR #10129 adds eligibility checks before execution. Use those checks as the compatibility baseline for module-owned registration.

## 📝 Proposed Solution

Auto-discover the module-root `upgrades.ts` manifest. It lists versioned, single-action files under that module's `upgrades/` directory. Bind ownership from the resolved module entry, then use that registry for both the existing banner API and a `configs upgrade-actions` command group. Operators use `list`, `up` and `down`, with progress and per-module summaries modelled on Mercato's `db:migrate`.

Putting definitions in `setup.ts` would mix release maintenance and tenant creation. Scanning arbitrary files at runtime would require a second discovery mechanism and introduce source-versus-package drift. The module manifest gives the existing generator a single typed entry point.

[Drupal's post-update hooks](https://api.drupal.org/api/drupal/core%21lib%21Drupal%21Core%21Extension%21module.api.php/function/hook_post_update_NAME/main) separate module-owned application-data updates from schema updates. [MikroORM migrations](https://mikro-orm.io/docs/migrations) provide the precedent for pending work, explicit apply and opt-in reversal. Mercato retains its existing tenant/organization completion ledger and release-version gate.

## 📝 Delta

### Capability: upgrade-actions

#### ADDED Requirement: Discover module-owned upgrade files
The system SHALL expose eligible actions declared by enabled modules through the same catalog used by the upgrade API and CLI.

##### Scenario: An optional module is turned off
- WHEN a generated deployment excludes the module that owns an action or an explicitly required peer is unavailable
- THEN the action is unavailable in both entry points, its handler is never invoked, and any historical completion row remains intact

#### ADDED Requirement: Inspect and apply upgrade actions through the CLI
The CLI SHALL list and apply eligible actions for one validated tenant and organization through the same completion ledger as HTTP.

##### Scenario: An action was completed through the banner
- WHEN an operator runs `list` and then `up` in that scope
- THEN the CLI shows the action as applied, skips its handler and reports the count of newly applied actions

#### ADDED Requirement: Revert one reversible upgrade action
The CLI SHALL revert a targeted, completed action only through its declared compensation.

##### Scenario: The inverse is unavailable or fails
- WHEN an operator targets a forward-only action or its inverse rejects the current state
- THEN the command fails, retains the completion row, and leaves the action applied

## 📝 Architecture

### Ownership and discovery

- Add neutral types under `@open-mercato/shared/modules/upgrade-actions`. A manifest exports a named `upgradeActions` list. For example, `customers/upgrades.ts` references `customers/upgrades/0.10.0-seed-deal-loss-reasons.ts`. The file name aids navigation. The descriptor supplies identity, target app release version, existing translation keys, `requiredModules?`, `run(ctx)`, optional `down(ctx)` and optional `scope: 'organization' | 'tenant'` with `organization` as the default. Keep `run` as the up handler for compatibility.
- Add an optional `Module.upgradeActions` field to the server-side module registration paths used by Next.js and the CLI bootstrap. Reuse the resolver and registry conventions of `setup.ts` in `packages/cli/src/lib/generators/module-registry.ts`. Cover app modules, built-in workspaces and published module packages. Keep executable actions out of client, route-metadata and i18n-only artifacts. Importing a manifest only loads descriptors. Load module implementation helpers from the handlers and keep optional-peer access behind the appropriate DI/availability boundary.
- Build the server catalog from the registered modules, deriving each action's owner from its module ID and requiring that owner plus all declared peers to be enabled. Refresh on full registry replacement, preserving current state through translation-only registration. Fail closed before bootstrap or when availability cannot be established. Validate malformed descriptors and conflicting IDs before invoking handlers. New manifest definitions use globally unique module-prefixed IDs, with a new ID per new action. Keep persisted identity as the exact `(id, version)` pair. Preserve legacy helper behavior for repeated IDs at different versions.
- `configs` owns version comparison, eligibility, execution, locking and the ledger. Move the current definitions into the owner modules identified by their ID prefixes, including the attachment reconciliation, device and phone encryption maps, customer dictionary seeds, ecommerce draft store and schedule registrations. Preserve helper behavior, versions, existing localization keys and post-commit invalidation. Keep any genuine configs-owned action in `configs/upgrades/`. Eliminate business-module handler references from the configs upgrade runner and discovery facade. Give newly authored actions translation keys under the owning module.
- A reused helper may require another module. Keep the owner responsible for checking that capability. For example, verify the devices/phone-calls encryption-map helper against the entities dependency on the post-#10129 baseline. Gate any required peer in action eligibility and keep optional integrations such as the ecommerce currency resolver soft-optional. The module declarations do not add hard application-install dependencies.

### Scope, transaction and recovery

The HTTP route continues to derive scope through the existing authenticated directory resolver and require `configs.manage`. The CLI runs with the deployment operator's database authority and requires explicit UUIDs for an active, non-deleted tenant and an active, non-deleted organization belonging to that tenant. Reject mismatches before action discovery or writes. Never infer scope from a default company, current session, or environment. Honor `UPGRADE_ACTIONS_ENABLED` on both channels.

Each mutating operation locks one action/version/scope in PostgreSQL, rereads the completion record under the lock, and commits its data effects and ledger write together through the supplied transactional `EntityManager`. Reuse the parameterized transaction-lock pattern already used in core. Classify scope by the handler's actual effects, including work performed through DI services, rather than its context shape. The current tenant-wide actions are `attachments.reconcile-organization`, `cart.register-sweeper-schedules` and `promotions.register-code-reservation-sweep-schedule`: the schedule helpers ignore the selected organization and register tenant-scoped jobs. Declare all three with `scope: 'tenant'`, then re-inventory the post-#10129 catalog for any additional wider-scope effects. Serialize each tenant-wide action by tenant and action/version across organization selections while preserving existing per-organization completion keys and HTTP behavior. The CLI marks every tenant-wide action and requires an exact target and `--allow-tenant-wide`. Default batches skip them and identify each omitted action. A bulk apply commits each eligible action separately in version-then-ID order and stops on the first failure.

Schedule registrations need explicit transaction participation. Today `schedulerService.register()` forks its own `EntityManager`, flushes schedule rows independently and immediately synchronizes BullMQ; merely passing `ctx.em` to the upgrade handler does not join those writes to the ledger transaction. Add a backward-compatible transaction-aware registration path through the scheduler service boundary that uses the supplied manager, preserves schedule validation and quota checks, and defers BullMQ synchronization until the runner commits. Include `ScheduledJobSubscriber.afterFlush` in that deferral: a flush inside an explicit outer transaction is not proof of commit. Update the owner helpers to use that path during upgrade execution while preserving their existing setup callers and scheduler-unavailable behavior. Keep scheduler access soft-optional and do not import scheduler persistence entities into owner modules. A failure before commit must roll back every schedule row written by that action and its ledger row, with no external queue activation. Schedule actions remain forward-only. For a failed post-commit synchronization, use the scheduler's existing `BullMQSchedulerService.syncAll()` reconciliation (including its cold-start path in `scheduler/di.ts`) to recover committed schedules without rerunning the action's data handler; document the operator recovery steps and test that path.

Only an action with an explicit, organization-scoped `down` may be undone. The author must prove its inverse can distinguish the original action's effects from pre-existing data, later business edits and dependent actions. If those preconditions cannot be proven from durable domain state in the same transaction, omit `down`. Reject undo of an unrecorded, disabled or unavailable exact target before handler execution. On undo success, delete that exact completion row in the same transaction. It becomes pending again for the CLI and banner. On undo failure the row and data remain applied. There is no bulk rollback. Prevent rollback of changed data or active dependents in the owner's compensation logic.

Post-commit callbacks continue to use the runner boundary for effects such as idempotent cache invalidation. A callback failure occurs after the ledger and data commit. The CLI reports the committed state with a follow-up failure, exits nonzero and identifies the action with a safe error summary. Retrying the CLI must consult the ledger before invoking an already-committed handler. Authors document recovery for effects outside the transaction. A reversible action keeps all domain writes in the transaction.

## 📝 Data Model

Reuse `upgrade_action_runs`, including its unique key on `(version, action_id, organization_id, tenant_id)` and its scope index. Existing completion rows suppress reapplication after moving definitions and remain readable with the module disabled. `list` may show such rows as applied with their definition unavailable. The ledger stores no payload, undo snapshot or credentials. It represents current completion state. No schema migration, ID rewrite or backfill is required.

## 📝 API Contracts

- `GET /api/configs/upgrade-actions` returns the oldest eligible pending action in the existing `{ version, actions }` response. Preserve its labels and translation fallback. `POST /api/configs/upgrade-actions` still accepts `{ actionId }` and returns `{ status, message, version }`, with existing feature guards, flag behavior, status codes, and request validation. The existing banner calls the same two routes.
- Keep `configs/lib/upgrade-actions.ts` as a compatibility facade for `UpgradeActionContext`, `UpgradeActionDefinition`, `upgradeActions`, `compareVersions`, `actionsUpToVersion` and `findUpgradeAction`. The array export remains an array and reflects discovered actions after server bootstrap. Preserve manual legacy registrations through the existing array for at least one minor release, with required-module filtering at runtime and collision validation. Document the module manifest as the supported authoring path and add a deprecation entry to `UPGRADE_NOTES.md`. Catalog reads before explicit bootstrap must not import optional business modules.
- New CLI commands use standard Mercato module dispatch and help. `SCOPE` below means `--tenant <uuid> --organization <uuid>`. Validate IDs and flag combinations with Zod. Target versions must match an exact registered action version and stay within the installed app version ceiling.

  ```text
  yarn mercato configs upgrade-actions list SCOPE
  yarn mercato configs upgrade-actions up SCOPE
  yarn mercato configs upgrade-actions up SCOPE --action <id> --version <version> [--allow-tenant-wide]
  yarn mercato configs upgrade-actions down SCOPE --action <id> --version <version>
  ```

  `list` shows action ID, version, owner if known, pending/applied state, scope and reversal availability. `up` applies all eligible organization-scoped actions or a targeted action. Already-applied targets are successful no-ops. Errors in scope, availability, application or reversal exit nonzero. Help works without mutating or needing a scope. The command group is available when `configs` is installed.

### CLI output

Reuse the `db:migrate` format from `packages/cli/src/lib/db/commands.ts`: progress with a count on interactive terminals, compact per-module summary lines, and no progress bar with `OM_CLI_QUIET=1`, `MERCATO_QUIET=1` or non-interactive stdout. Display grouping by module does not change execution order.

```text
   customers: [====================] 2/2
 customers: 2 upgrade actions applied
 payment_gateways: no pending upgrade actions
```

A successful targeted undo prints `<module>: 1 upgrade action reverted`. A failed action identifies its module, ID and version without leaking data or secrets. Partial batches still print the summaries for committed actions. Emit an overall empty result when no module has eligible entries. The proposed surface is the terminal, so text transcripts serve as the implementation evidence for progress, no-op, failure and rollback states.

## 📝 Migration & Backward Compatibility

Existing deployments can upgrade in place. Preserve the action list’s order and helper signatures across the cutover. Take the current app schema through its normal SQL migrations first. Shipped IDs, versions, required-module guards, the completion key, translation keys, app-version ordering, API route and response shapes, and web/server feature flags carry forward. A normal `db:migrate`, boot or tenant setup never runs an upgrade action. During deployment, finish or drain older upgrade-action invocations before enabling the new CLI. Older application binaries do not participate in the new transaction-lock convention.

Code rollback to the post-#10129 binary reads the same ledger and IDs for existing actions. Data rollback uses the explicit inverse only where one exists. Reverting the deployment binary alone does not reverse action effects. The implementation must document each irreversible operation's recovery path where one exists.

## 📝 Risks & Impact Review

| Severity | Failure | Mitigation and residual risk |
|---|---|---|
| High | An upgrade reruns after deployment because a moved ID or version changed. | Test the full pre/post catalog and a pre-existing scoped completion row. Completion identity must survive package moves. |
| High | An undo deletes user data, or an operator acts on a different tenant. | Validate the scope pair, require an exact reversible definition, and test compensation and ledger atomicity. Attachment reconciliation and the cart/promotions schedule actions are explicitly tenant-wide, forward-only and excluded from default CLI batches. The owner's inverse remains responsible for protecting changed or dependent records. |
| High | CLI and HTTP race or a failed batch is read as fully applied. | Use the shared transaction lock and a ledger reread. Print committed counts and halt on error. Mixed binaries require the rollout drain described above. |
| High | Schedule rows commit or queues activate before an action's ledger transaction fails. | Use the transaction-aware scheduler boundary and post-commit synchronization. Force a ledger failure after schedule registration and verify no rows or external activation survive; verify recovery after a committed synchronization failure separately. |
| Medium | Source generation works but packaged or partial-module deployments miss or import the wrong action. | Test generator variants and CLI/server boot for package and app fixtures. Keep handler code out of client artifacts and verify the disabled-module compilation path. |

## 📋 Phasing

1. **Module ownership.** Ship discovery and the registry cutover through the existing API, preserving completion and banner behavior.
2. **Operator CLI.** Ship list, up and targeted down with shared execution and migration-style summaries.

## 📋 Implementation Plan

### Phase 1 — Module ownership

1. **Characterize the post-#10129 catalog.** Freeze IDs, versions, translation keys, order, disabled-module handling, status behavior and completion rows. Extend `TC-CONF-006` and #10129's `TC-CONF-9191` regressions with isolated fixtures.
2. **Add typed discovery.** Add the optional shared contract and server registry output. Test app, workspace and compiled package fixtures, generator parity, collisions, full registry replacement, translation-only registration, and missing owners/peers. Run `yarn generate` with the reduced-module fixture and verify it compiles.
3. **Cut over the catalog and execution.** Move all definitions, preserve public exports, share registry resolution and serialize scoped writes. Add the scheduler's transaction-aware registration path and thread it through schedule owner helpers without changing existing setup callers. Verify API GET order/labels, disabled behavior, ACL and scope errors, POST success/already-completed/failure, old-row suppression, untouched other-tenant and other-organization rows for organization-scoped actions, and one banner apply-and-refresh path. For tenant-wide actions, verify intended cross-organization effects stay within the selected tenant. Use live schedule fixtures to force a ledger failure after registration and prove schedule/ledger rollback and no pre-commit queue activation; test successful commit, idempotent retry, post-commit synchronization failure/recovery, and absent scheduler. Update author guidance and the upgrade notes.

### Phase 2 — Operator CLI

4. **Wire list and up.** Exercise the installed CLI entry point against the same isolated app/DB as HTTP. Verify list/up visibility in both directions, package-module actions, scope mismatch, version ceiling, no-op, clean help, quiet output, and partial-failure retry. Pin attachment reconciliation and both cart/promotions schedule actions as tenant-wide: default batches omit them, targeted execution without opt-in refuses them, and opt-in executes them with a tenant-level lock. Race two organization selections within one tenant to verify schedule serialization, and verify other tenants remain unchanged. Snapshot terminal summaries against the existing migration output conventions.
5. **Wire targeted down.** Use a test-only action with a proven inverse. Verify up/down/up, failed compensation, irreversible and unavailable actions, exact-version selection, changed data rejection, retained ledger on failure, and competing HTTP/CLI apply or down isolation. Use fixture-created tenants, organizations and action data with cleanup in `finally`. Run the affected generator, configs service and live integration suites without seeded/demo records.
6. **Archive the Delta.** Record implemented requirements in `.ai/specs/capabilities/upgrade-actions.md` when implementation ships.

## 🧪 Final Compliance Report

Design review covers module dependency direction, scoped execution, backward compatibility and CLI failure semantics. The proposal adds a server-only module manifest contract and CLI commands. An independent scope review confirmed that discovery and CLI share one capability and can ship in two phases. HTTP, browser and CLI tests are acceptance gates for the implementation PR.

## Changelog

- 2026-11-23 — Proposed module-owned action discovery and migration-style CLI operations as a follow-up to #10129.
- 2026-11-23 — Review clarified all existing tenant-wide actions and required transaction-aware schedule registration, post-commit synchronization and rollback/retry coverage.
