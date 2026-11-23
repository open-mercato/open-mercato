# Execution plan — module-owned upgrade actions

Source doc: .ai/specs/2026-11-23-module-owned-upgrade-actions.md
Base: stacked on #10129 (`fix/kernel-optional-module-gaps-9678` @ `0784f37d75`); PR targets `main`. Rebase onto `main` after #10129 merges.

## Goal

Modules own their upgrade actions in a server-only `upgrades.ts` manifest plus one file per action under `upgrades/`. `configs` discovers them through the registered module list, executes them under a scoped transaction lock against the existing `upgrade_action_runs` ledger, and exposes the same catalog through the unchanged banner API and a new `configs upgrade-actions list|up|down` CLI.

## Scope

- `@open-mercato/shared`: `modules/upgrade-actions` contract types; optional `Module.upgradeActions`.
- `@open-mercato/cli` generator: emit `upgradeActions` from `upgrades.ts` into the runtime, app-bootstrap and CLI registries (not client, route-manifest or i18n outputs).
- `configs`: catalog resolver (discovery + legacy array + validation + eligibility), locked runner with `scope` and `down`, CLI commands, compatibility facade.
- Owner modules (`attachments`, `devices`, `customers`, `payment_gateways`, `phone_calls`, `ecommerce`, `cart`, `promotions`): `upgrades.ts` + `upgrades/<version>-<slug>.ts`.
- `scheduler`: backward-compatible transaction-aware `register(registration, { em, afterCommit })` and deferred `afterFlush` sync for those writes.
- Docs: `UPGRADE_NOTES.md` deprecation + author guidance; capability archive.

## Non-goals

- No schema migration, ID/version rename, or ledger backfill.
- No package extraction of `configs`, no banner UI change, no change to `db:migrate`, tenant provisioning or release automation.
- No `down` for any shipped action (all stay forward-only); `down` is proven with a test-only fixture action.
- No bulk rollback.

## Re-inventory against the post-#10129 catalog (9 actions)

| ID | Version | Owner | Scope | Notes |
|---|---|---|---|---|
| `attachments.reconcile-organization` | 0.6.6 | attachments | tenant | reconciles every attachment in the tenant |
| `devices.seed-push-token-encryption-map` | 0.6.6 | devices | organization | peer: `entities` (encryption-map helper) |
| `customers.seed-interaction-statuses` | 0.6.5 | customers | organization | |
| `payment_gateways.register-session-initialization-prune` | 0.6.6 | payment_gateways | organization | schedule keyed by tenant+org → transaction-aware scheduler path, not tenant-wide (not listed in the spec; classified here) |
| `phone_calls.seed-call-encryption-maps` | 0.7.1 | phone_calls | organization | peer: `entities` |
| `ecommerce.seed-draft-store` | 0.9.1 | ecommerce | organization | currency resolver stays soft-optional |
| `cart.register-sweeper-schedules` | 0.9.1 | cart | tenant | schedule keyed by tenant |
| `promotions.register-code-reservation-sweep-schedule` | 0.9.1 | promotions | tenant | schedule keyed by tenant |
| `customers.seed-deal-loss-reasons` | 0.10.0 | customers | organization | |

## Design decisions (autonomous)

- **Owner binding**: owner = registering module id; a manifest action id MUST start with `<owner>.`; eligibility requires owner + declared `requiredModules`.
- **Invalid or conflicting descriptors** are excluded and logged rather than thrown, so a broken third-party manifest cannot take down the banner for everyone; an exact `(id, version)` duplicate excludes every copy.
- **Facade**: `configs/lib/upgrade-actions.ts` keeps its exports; `upgradeActions` stays a mutable array that is re-synced from `tryGetModules()` on read (reference-compared), so discovered entries reflect the current registration and manually pushed legacy entries are preserved. Before bootstrap only legacy entries exist (fail closed for discovered actions; no optional module import).
- **Lock**: `withAdvisoryXactLock` keyed `configs_upgrade_actions:<tenant>:<org|*tenant*>:<version>:<id>`; the completion row is re-read under the lock. Tenant-wide actions lock on the tenant key but keep per-organization completion rows.
- **Scheduler**: `afterFlush` skips only schedules tagged by the transaction-aware path; those sync after commit through the runner's `deferAfterCommit`. Committed-but-unsynced schedules recover through the existing `BullMQSchedulerService.syncAll()`.

## Implementation Plan

### Phase 1 — Module ownership

1. Characterize the post-#10129 catalog: unit test freezing IDs, versions, translation keys, order, `requiredModules`; service tests for disabled modules and existing completion rows.
2. Shared contract: `@open-mercato/shared/modules/upgrade-actions` types + optional `Module.upgradeActions`.
3. Generator: discover `upgrades.ts` for runtime, app-bootstrap and CLI registries; parity tests for app/workspace/package fixtures and client exclusion.
4. Catalog resolver in `configs`: discovery from the registered modules, validation, collisions, owner/peer eligibility, legacy facade sync, refresh on registry replacement and on translation-only registration.
5. Scheduler transaction-aware registration + deferred `afterFlush` sync; tests for rollback, post-commit sync, sync failure recovery, absent scheduler.
6. Move the nine actions into owner modules (`upgrades.ts` + `upgrades/*.ts`); schedule helpers accept the transactional options; setup callers unchanged.
7. Runner: advisory lock + reread, `scope`, post-commit callbacks, `revertUpgradeAction` for `down`; service unit tests.
8. Integration: extend the upgrade-actions API coverage (GET order/labels, POST completed/already, old-row suppression, other-org isolation).
9. Docs: `UPGRADE_NOTES.md` deprecation entry and module author guidance.

### Phase 2 — Operator CLI

10. CLI `list` and `up`: scope validation (active tenant + org of that tenant), version ceiling, tenant-wide opt-in, migration-style output; unit tests.
11. CLI targeted `down`; unit tests with a test-only reversible action.
12. CLI integration test through the installed `mercato` entry point against fixture tenant/org.
13. Archive the Delta into `.ai/specs/capabilities/upgrade-actions.md`.

## Risks

- Stacked on an unmerged PR: #10129 changes to `upgrade-actions.ts` will need a rebase.
- Moving definitions must not change `(id, version)`; guarded by Step 1's characterization test.
- Mixed binaries during rollout do not share the new lock; documented in `UPGRADE_NOTES.md`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Module ownership

- [ ] 1.1 Characterize the post-#10129 catalog
- [ ] 1.2 Add the shared upgrade-action contract
- [ ] 1.3 Discover upgrades.ts in the generator
- [ ] 1.4 Build the configs catalog resolver
- [ ] 1.5 Add transaction-aware scheduler registration
- [ ] 1.6 Move actions into owner modules
- [ ] 1.7 Lock, scope and revert in the runner
- [ ] 1.8 Extend upgrade-actions API integration coverage
- [ ] 1.9 Document the authoring path and deprecation

### Phase 2: Operator CLI

- [ ] 2.1 Wire CLI list and up
- [ ] 2.2 Wire CLI targeted down
- [ ] 2.3 Add CLI integration coverage
- [ ] 2.4 Archive the Delta
