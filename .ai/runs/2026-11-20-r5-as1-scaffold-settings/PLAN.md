# Execution Plan — r5-as1-scaffold-settings

**Date:** 2026-11-20
**Slug:** r5-as1-scaffold-settings
**Branch:** feat/r5-as1-scaffold-settings (forked from `refs/remotes/pr/9997` @ `54d29ecebd`; PR base `main`)
**Binding spec:** `.ai/specs/2026-09-22-assisted-selling.md` (rev 6.3) — §11 step row **AS1**, Phase 1 items 1–2, §5.6, §6.0, §6.1 (settings rows), §6.9, §10.1 settings rows
**Reference implementation:** closed PR #8268 @ `bdb747c36a` (diff base `b7b5309ccc`) — ported, not redesigned
**Audit:** `.ai/analysis/pre-implement-2026-09-22-assisted-selling-release-5.md` + spec changelog 2026-11-19 (D-R5-AS1…AS10)

## Tasks

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Run folder and execution plan | inline | done | — |
| 2 | 2.1 | `ecommerce`: optional store-by-id read on `storeContextService` (§6.0) | inline | done | — |
| 2 | 2.2 | Module scaffold: index, acl, setup grants, events, registration, ACL labels | inline | done | — |
| 2 | 2.3 | `AssistedSellingStoreSettings` entity, migration, `lib/settings.ts` | inline | todo | — |
| 2 | 2.4 | Settings validators (`rep \| off`, §5.6 bounds, `.strict()`) + tests | inline | todo | — |
| 2 | 2.5 | `assisted_selling.settings.save` command (`withAtomicFlush`, 409 on first-save race) + tests | inline | todo | — |
| 2 | 2.6 | `GET/PUT /api/assisted_selling/settings/:storeId` (store-org ownership, 404, 500) + tests | inline | todo | — |
| 3 | 3.1 | UPGRADE_NOTES + spec changelog line | inline | todo | — |

## Goal

Register the `assisted_selling` module with its full §6.9 ACL and ship the per-store settings API (`mode` limited to `rep | off`), so that later steps AS2a–AS8 build on a registered module. Mode defaults to `off`; no settings page (AS7, D-R5-AS4).

## Scope

In (paths under `packages/core/src/modules/assisted_selling/` unless stated):
- `index.ts` (`requires: ['cart']`, `ejectable: true`), `acl.ts` (six features), `setup.ts` (`defaultRoleFeatures` only), `events.ts` (see Decision 1)
- `data/entities.ts`: `AssistedSellingStoreMode`, `AssistedSellingStoreSettings`; migration via `yarn db:generate`
- `data/validators.ts`: the three settings schemas; `lib/settings.ts`; `commands/shared.ts` (scope re-exports, resource kind, `VersionedRecord`, `enforceAssistedSellingOptimisticLock`); `commands/settings.ts`; `api/settings/[storeId]/route.ts`
- Tests: `__tests__/validators.test.ts`, `commands/__tests__/settings.test.ts`, plus route and setup tests
- i18n (en, de, es, ko, pl): `assisted_selling.audit.settings.save` + seven `assisted_selling.errors.*`; six `auth.acl.features.assisted_selling.*` labels
- Registration: `apps/mercato/src/modules.ts`, `packages/create-app/template/src/modules.ts`, `scripts/template-sync.ts`
- `packages/core/src/modules/ecommerce/lib/storeContextService.ts`: one optional read member (see Decision 2)

## Non-goals

- Settings admin page → AS7 (D-R5-AS4); a follow-up issue tracks the reference gap.
- `seedDefaults`, `lib/scheduling.ts`, sweepers → AS6.
- Conversation entities, `encryption.ts`, `requireAssistedSellingFeatures`, thread routes → AS2a.
- `AssistedSellingAttribution` → AS8.
- The store-context `mode` exposure (S12, deferred).

## Decisions and card/spec differences (rule R4: the spec wins)

1. **`events.ts` ships in AS1.** The card defers it to AS2a; the spec's §11 AS1 row lists `events.ts` among AS1's deliverables. Following the spec: the twelve §6.8 ids are declared (no `.reopened`), `clientBroadcast: true` on thread/participant/message/proposal events, not on `attribution.degraded`. Nothing emits them until AS2a+. AS1–AS5 ship in one release tag, so no release carries declared-but-unemitted ids without their writers.
2. **Store ownership (I4, audit #17).** §5.6/§6.0 require the store be resolved through `ecommerce`'s DI store-by-id read within the caller's tenant and `organizationIds`, `404` otherwise or when `ecommerce` is absent, and the row read/written under the **store's** organization. `ecommerce` has no such read today, so this run adds an optional member `findStoreForOrganizations?` to `StoreContextService` (additive, BC §9 "MAY add optional methods"). `assisted_selling` resolves it with a soft `tryResolve` and imports no `ecommerce` type (§6.0, module-decoupling). The reference wrote under the caller's selected organization and never checked the store — not ported.
3. **`withAtomicFlush`** replaces the reference's bare `em.flush()` (audit row "Command pattern with `withAtomicFlush`").
4. **Unexpected errors answer `500`** (§5.6), not the reference's `400`.
5. **`max_proposal_lines` bounded 1–100** (§5.6, audit §5.6 row); the reference allowed 500.
6. **Error keys.** The reference's `organization_required` is no longer reachable (ownership comes from the store), so the seven `assisted_selling.errors.*` keys are `unauthorized`, `invalid_store_id`, `store_not_found`, `invalidInput`, `conflict`, `load_failed`, `save_failed`.
7. **Employee grant** (D-R5-AS1): `threads.view`, `threads.participate`, `messages.post`, `cart.proposals.view`; `proposals.author`, `attributions.view`, `settings.manage` admin only (`assisted_selling.*`).
8. **Release-tag rule (§11, I14):** AS1–AS5 ship in one release tag; stated in the PR body.

## Audit findings that concern AS1

- D1/I1 → D-R5-AS1: employee gets `cart.proposals.view` from this module's `setup.ts` (Decision 7).
- I4 / audit #17: store check, store-org ownership, `withAtomicFlush`, `500` on unexpected errors (Decisions 2–4).
- §5.6 bounds row: retention 1–3650, idle-close 1–365, max lines 1–100 (Decision 5).
- D8 → D-R5-AS7: defaults 365 / 30 days, per store.
- D4 → D-R5-AS4: settings page ships in AS7, not here.
- R17 / I14: one release tag for AS1–AS5 (Decision 8).

## Risks

- **Binding plan file missing.** `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` (§6 rules R1–R14 and the AS1 card) was not in the primary checkout nor on `pr/9997`. The operator told the run to proceed autonomously; the card content used is the task brief, and R4 (spec wins) as quoted in the brief. Any other R-rule not restated in the brief may be unapplied — reviewers should check against the plan.
- Touches a second module (`ecommerce`) with one additive optional member, as required by spec §6.0.
- Stacked PR: CI on a stacked PR may not run the full suite (see PR body).

## External skill URLs

None.
