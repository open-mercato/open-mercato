# Module-owned instance configuration defaults

Extends: .ai/specs/implemented/SPEC-013-2026-01-27-decouple-module-setup.md

## TLDR

Search and Notifications define the instance defaults they own. Configs restores contributions from enabled modules before tenant setup and through the existing operator command. Disabling an owner leaves its stored settings untouched.

## Resolved assumptions (autonomous defaults)

| # | Question | Default | Rationale |
|---|---|---|---|
| Q1 | How should #10476 be split? | One design PR with six independently implementable specs across four issue workstreams. | The workstreams share an ownership rule and have independent runtime lifecycles. |
| Q2 | Where do instance defaults live? | One optional server-only property of the existing module setup contract. | The generated server and CLI registries already discover setup for app, workspace and installed modules. |
| Q3 | Which existing restore behavior carries over? | Force-restore enabled owners' defaults using the same storage keys and environment precedence. | Operators keep their reset semantics, and older binaries can still read the same rows. |

## Overview

This is the first implementation workstream of [#10476](https://github.com/open-mercato/open-mercato/issues/10476), under [#10144](https://github.com/open-mercato/open-mercato/issues/10144). The other workstreams cover Workflows [key issuance](2026-11-24-workflow-one-time-key-provider.md) and [named rules](2026-11-24-workflow-named-rule-provider.md), Record Locks [audit history](enterprise/2026-11-24-record-locks-audit-history-provider.md) and [settings initialization](enterprise/2026-11-24-record-locks-settings-initialization.md), and [Orchestrator example workflows](enterprise/agent-orchestrator/2026-11-24-owner-provided-example-workflow-seeding.md). Each ships in its own implementation PR. Refresh behavior from main after [#10129](https://github.com/open-mercato/open-mercato/pull/10129) lands.

## Problem Statement

The target baseline guards the `mercato init` call to `configs restore-defaults` when Configs is disabled. The command still directly imports Notifications and writes defaults for Notifications and Search even when their modules are disabled. Normal tenant setup hooks already dispatch by module, but they run after tenant creation. Instance defaults must still run after migrations and server bootstrap and before `auth setup`. [Init dispatch](https://github.com/open-mercato/open-mercato/blob/0784f37d75283d3b551e994991d4cf318452977e/packages/cli/src/mercato.ts#L1267-L1275) · [Central catalog](https://github.com/open-mercato/open-mercato/blob/0784f37d75283d3b551e994991d4cf318452977e/packages/core/src/modules/configs/cli.ts#L293-L329)

## Proposed Solution

Adopt the separation between owner declarations and shared persistence used by the [WordPress Options API](https://developer.wordpress.org/plugins/settings/options-api/) and the enabled-owner selection used by Mercato's [module-owned upgrade actions design](2026-11-23-module-owned-upgrade-actions.md). Instance defaults use the existing setup registry. Upgrade actions, their ledger and tenant seed profiles retain their own lifecycle.

## 📝 Delta

### Capability: instance-config-defaults

#### MODIFIED Requirement: Restore shipped instance configuration defaults
The command SHALL force-restore configuration defaults declared by enabled owners and preserve rows belonging to disabled owners.

##### Scenario: Search is disabled and Notifications is enabled
- WHEN an operator runs the existing restore command with a pre-existing Search row
- THEN Notifications is restored at instance scope, the Search row retains its value and timestamp, and no Search row is inserted if it was absent.

##### Scenario: Search is enabled
- WHEN an operator restores defaults with the current or legacy vector auto-indexing environment setting
- THEN the existing precedence determines the value stored under `vector.auto_index_enabled` without changing tenant overrides.

##### Scenario: A nonempty owner catalog fails to restore during init
- WHEN the strict restore cannot resolve an EntityManager, or an entry lookup, persistence step, or flush fails
- THEN restore exits nonzero, no catalog changes or refreshed cache entries are published, and init never invokes `auth setup` or tenant hooks.

Frozen by: `packages/core/src/modules/configs/lib/__tests__/restore-instance-defaults.test.ts` (add the characterization before the cutover).

## Architecture

- Add optional `ModuleSetupConfig.instanceConfigDefaults` in `packages/shared/src/modules/setup.ts`. It is a synchronous provider returning a readonly array of `{ name, value, legacyStorageNamespace? }` entries with finite JSON values. Providers may read their own existing environment policy at invocation time. They run without an EntityManager, tenant, credentials or network I/O.
- Resolve contributions once per restore from enabled server `Module.setup` entries. Derive owner identity from the module ID. Default the persisted namespace to that ID. The published contract reserves the legacy alias `vector` for a contribution from `search`; enforce that exception as a one-key compatibility rule for `auto_index_enabled`. No other cross-namespace writes are accepted. Normalize keys using Configs' existing rule and reject malformed JSON descriptors and duplicate final keys before the first write. Iterate in deterministic key order. Keep providers out of generated client and route-metadata graphs.
- `packages/search/src/modules/search/setup.ts` derives the legacy vector default with the shared `envDisablesAutoIndexing` helper and the published key constants. Preserve the current primary variable and deprecated alias behavior, including precedence when both are set. `notifications/setup.ts` returns the current stored delivery configuration from its own module.
- `configs/cli.ts` passes the validated catalog to a Configs-owned strict restore operation that force-restores instance rows. Keep the existing `moduleConfigService.restoreDefaults` signature and best-effort behavior for other callers. The strict path uses a fresh EntityManager and a single transaction. A missing EntityManager or any lookup, persistence, flush or commit error fails the command. Roll back the catalog writes on failure and publish refreshed cache entries only after commit. The global unique index arbitrates concurrent restores. A conflicting invocation can retry with a fresh manager. Never delete absent defaults. Invalid contributions fail before any writes. Logs name the owner/key or phase and omit values.
- Leave restore as an explicit CLI step. Keep `mercato init` dispatching after migration/bootstrap and before `auth setup`, and skip it when Configs is absent. An empty enabled catalog is a successful no-op. Calling a tenant hook or ordinary server bootstrap does not run restore.

## Data Model

Use existing global `module_configs` rows, with null tenant and organization. `module_configs_global_unique` addresses rows by namespace and name. Existing tenant rows, fallback reads, and cache keys retain their semantics. No migration or backfill is required.

## API Contracts

`yarn mercato configs restore-defaults` retains its command name, arguments and help behavior. Successful execution reports the restore result using CLI conventions. A disabled Search contributor produces no vector status line. Discovery and strict restore failures exit nonzero. There is no new HTTP route or UI surface.

## Migration & Backward Compatibility

The setup property is optional and uses existing server discovery. Module authors can omit it. Preserve all existing setup hooks, public service signatures, generated exports, CLI flags and the two stored keys. An older binary can read the same rows and retains its own restore behavior. Rolling back code does not undo a force-restore. Operators who need to recover prior values use the existing config management paths or a saved database snapshot.

## Risks & Impact Review

| Risk | Mitigation and residual risk |
|---|---|
| High — forced restore overwrites a different module's setting. | Derive ownership, pin the one legacy alias and reject duplicate normalized keys before writes. Restore still intentionally overwrites known enabled-owner defaults. |
| Medium — broken packaged discovery omits an enabled owner. | Exercise workspace, packaged and app-local fixtures through server generation and CLI bootstrap. Verify that disabled owners contribute no rows. |
| High — setup starts with an incomplete catalog. | Propagate strict restore errors, roll back the write transaction, and assert init never starts tenant setup on restore failure. |
| Medium — cache exposes stale settings after a committed restore. | Keep the Configs cache-update path and read test warmed entries after restore. Cache outages retain existing recovery behavior. |

## Phasing

Ship one implementation PR for the instance restore path. The four issue workstreams can land independently once each has verified its post-#10129 baseline.

## Implementation Plan

1. Characterize the current restore command, including the two built-in defaults, disabled-owner writes, explicit force behavior, environment precedence, pre-tenant ordering and Configs-off behavior. Freeze the current CLI help path in `packages/cli/src/__tests__/mercato.test.ts`.
2. Add the optional setup property and owner declarations. Check registry discovery with app-local, workspace and packed modules and verify that generated client artifacts do not reach the providers. Run `yarn generate` on the reduced fixture.
3. Cut over the command. Test both owners enabled, each disabled, both disabled, re-enable, duplicate and malformed declarations, retry after a competing insert, cache refresh, tenant override preservation and existing row/timestamp preservation. Exercise explicit restore and init in isolated app/database fixtures. Verify the post-migration restore executes before auth setup. Inject missing-manager, per-entry lookup and persistence, and flush failures. Fail a later entry after an earlier write is staged and verify rollback, no cache publication, a nonzero command result, and no invocation of auth setup or tenant hooks. Verify existing best-effort callers retain their behavior.
4. Document the authoring property and the legacy namespace. Archive the Delta into `.ai/specs/capabilities/instance-config-defaults.md` with the implementation.

## Final Compliance Report

The design reuses module discovery and Configs persistence, limits writes to instance defaults, preserves stored keys and tenant overrides, and introduces no UI, database migration or external dependency. Independent scope review kept this catalog and example seeding as cohesive capabilities and identified independent Workflow and Record Locks cutovers. Each now has its own spec. Generator and runtime acceptance tests belong to the implementation PR.

## Changelog

- 2026-11-24 — Proposed independent instance-default ownership as the first workstream of #10476.
- 2026-11-24 — Specified strict restore failures, catalog rollback, and the init regression cases.
